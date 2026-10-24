package ren

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"slices"
	"strings"
	"sync"
	"time"
)

// Config is the `ren` block of the iron-proxy config.
type Config struct {
	// Hook is Ren's egress API base URL, for example https://ren-server:4443.
	Hook string `yaml:"hook"`
	// CACert verifies Ren's server certificate and the client certificates
	// of Ren's calls to the control listener.
	CACert string `yaml:"ca_cert"`
	// Cert and Key are this egress's client certificate for the hook.
	Cert string `yaml:"cert"`
	Key  string `yaml:"key"`
	// ControlListen serves Ren's invalidate calls and the health check (mTLS).
	ControlListen string `yaml:"control_listen"`
	// ControlCert and ControlKey are the control listener's server
	// certificate. They default to Cert and Key.
	ControlCert string `yaml:"control_cert"`
	ControlKey  string `yaml:"control_key"`
	// Fresh is how long an answer is reused (default 30s). Stale is how long
	// the last allow answer is used when Ren does not answer (default 15m).
	Fresh Duration `yaml:"fresh"`
	Stale Duration `yaml:"stale"`
	// Drain is how long a stopping egress keeps open connections (default 15m).
	Drain Duration `yaml:"drain"`
}

// Duration decodes Go duration strings ("30s", "15m").
type Duration time.Duration

func (d *Duration) UnmarshalText(text []byte) error {
	parsed, err := time.ParseDuration(string(text))
	if err != nil {
		return err
	}
	*d = Duration(parsed)
	return nil
}

// Validate refuses a config that would make the egress look healthy while
// refusing all traffic (README §6.10 rule 1, ren-v1 INV-89).
func (c Config) Validate() error {
	missing := []string{}
	for name, value := range map[string]string{"hook": c.Hook, "ca_cert": c.CACert, "cert": c.Cert, "key": c.Key, "control_listen": c.ControlListen} {
		if value == "" {
			missing = append(missing, name)
		}
	}
	if len(missing) > 0 {
		slices.Sort(missing)
		return fmt.Errorf("ren: %s required", strings.Join(missing, ", "))
	}
	for _, file := range []string{c.CACert, c.Cert, c.Key} {
		if _, err := os.Stat(file); err != nil {
			return fmt.Errorf("ren: %w", err)
		}
	}
	return nil
}

func (c Config) fresh() time.Duration { return orDefault(c.Fresh, 30*time.Second) }
func (c Config) stale() time.Duration { return orDefault(c.Stale, 15*time.Minute) }

// DrainTimeout is how long Shutdown waits for open connections.
func (c Config) DrainTimeout() time.Duration { return orDefault(c.Drain, 15*time.Minute) }

func orDefault(d Duration, fallback time.Duration) time.Duration {
	if d == 0 {
		return fallback
	}
	return time.Duration(d)
}

// Reply is Ren's answer to a resolve.
type Reply struct {
	Allow    bool   `json:"allow"`
	Workload string `json:"workload,omitempty"`
	TTL      int    `json:"ttl,omitempty"`
	// ExpiresAt is when the first value in the answer stops working (Unix
	// seconds). The egress never uses the answer after it, also when Ren is
	// down.
	ExpiresAt int64    `json:"expiresAt,omitempty"`
	Labels    []string `json:"labels,omitempty"`
	Inject    []Op     `json:"inject,omitempty"`
	Reason    string   `json:"reason,omitempty"`
	Label     string   `json:"label,omitempty"`
}

type entry struct {
	reply    Reply
	login    string
	storedAt time.Time
}

type authEntry struct {
	workload string
	login    string
	storedAt time.Time
}

// Client calls Ren's egress API and keeps Ren's answers in memory (C37).
type Client struct {
	cfg    Config
	http   *http.Client
	logger *slog.Logger
	now    func() time.Time

	mu      sync.Mutex
	answers map[string]entry
	logins  map[string]authEntry
	conns   map[string]map[net.Conn]struct{}
	open    sync.WaitGroup
	// epoch counts invalidates. An answer is kept only when no invalidate
	// ran while it was in flight, because Ren may have read the old value.
	epoch     uint64
	lastSweep time.Time
}

// fresh is how long an answer is reused without asking Ren: Ren's ttl,
// or the configured default.
func (c *Client) fresh(reply Reply) time.Duration {
	if reply.TTL > 0 {
		return time.Duration(reply.TTL) * time.Second
	}
	return c.cfg.fresh()
}

// usable says whether a kept answer may still be used, given how long
// answers of its kind are kept. No answer is used past its expiry.
func (c *Client) usable(kept entry, keep time.Duration) bool {
	now := c.now()
	if kept.reply.ExpiresAt != 0 && !now.Before(time.Unix(kept.reply.ExpiresAt, 0)) {
		return false
	}
	return now.Sub(kept.storedAt) < keep
}

// sweep drops answers and logins that can no longer be used, at most once
// per fresh period, so the maps do not keep logins of gone sandboxes. Call
// with mu held.
func (c *Client) sweep() {
	now := c.now()
	if now.Sub(c.lastSweep) < c.cfg.fresh() {
		return
	}
	c.lastSweep = now
	for key, kept := range c.answers {
		if !c.usable(kept, c.cfg.stale()) {
			delete(c.answers, key)
		}
	}
	for key, kept := range c.logins {
		if now.Sub(kept.storedAt) >= c.cfg.stale() {
			delete(c.logins, key)
		}
	}
}

// New builds a client from a validated config.
func New(cfg Config, logger *slog.Logger) (*Client, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	pool, err := loadPool(cfg.CACert)
	if err != nil {
		return nil, err
	}
	cert, err := tls.LoadX509KeyPair(cfg.Cert, cfg.Key)
	if err != nil {
		return nil, fmt.Errorf("ren: load client certificate: %w", err)
	}
	transport := &http.Transport{
		TLSClientConfig:     &tls.Config{RootCAs: pool, Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12},
		MaxIdleConnsPerHost: 32,
	}
	return &Client{
		cfg:     cfg,
		http:    &http.Client{Transport: transport, Timeout: 5 * time.Second},
		logger:  logger,
		now:     time.Now,
		answers: map[string]entry{},
		logins:  map[string]authEntry{},
		conns:   map[string]map[net.Conn]struct{}{},
	}, nil
}

func loadPool(file string) (*x509.CertPool, error) {
	pem, err := os.ReadFile(file)
	if err != nil {
		return nil, fmt.Errorf("ren: read ca_cert: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(pem) {
		return nil, errors.New("ren: ca_cert holds no certificate")
	}
	return pool, nil
}

func (c *Client) post(ctx context.Context, path string, body any, out any) error {
	encoded, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimSuffix(c.cfg.Hook, "/")+path, bytes.NewReader(encoded))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, resp.Body) // drain so the connection is reused
		return fmt.Errorf("ren %s answered %d", path, resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func loginKey(login, password string) string {
	sum := sha256.Sum256([]byte(login + "\x00" + password))
	return hex.EncodeToString(sum[:])
}

// ErrUnavailable means Ren did not answer and no usable answer was kept.
var ErrUnavailable = errors.New("ren_unavailable")

// Authenticate checks a proxy login with Ren once per connection (fork
// change 1). Ren's allow answers are kept like resolve answers, so a running
// turn opens new connections while Ren is down.
func (c *Client) Authenticate(ctx context.Context, login, password, remoteAddr string) (string, error) {
	key := loginKey(login, password)
	c.mu.Lock()
	kept, ok := c.logins[key]
	epoch := c.epoch
	c.mu.Unlock()
	if ok && c.now().Sub(kept.storedAt) < c.cfg.fresh() {
		return kept.workload, nil
	}
	var reply struct {
		OK       bool   `json:"ok"`
		Workload string `json:"workload"`
		Reason   string `json:"reason"`
	}
	err := c.post(ctx, "/egress/v1/authenticate", map[string]any{
		"proof":      map[string]string{"kind": "ProxyLogin", "username": login, "password": password},
		"remoteAddr": remoteAddr,
	}, &reply)
	c.mu.Lock()
	defer c.mu.Unlock()
	if err != nil {
		// Read again: an invalidate during the call drops the kept answer.
		kept, ok = c.logins[key]
		if ok && c.now().Sub(kept.storedAt) < c.cfg.stale() {
			c.logger.Warn("ren did not answer; using the last login answer", slog.String("login", login))
			return kept.workload, nil
		}
		return "", fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	if !reply.OK {
		delete(c.logins, key)
		return "", fmt.Errorf("%s", reply.Reason)
	}
	if c.epoch == epoch {
		c.sweep()
		c.logins[key] = authEntry{workload: reply.Workload, login: login, storedAt: c.now()}
	}
	return reply.Workload, nil
}

func answerKey(r Request) string {
	sorted := slices.Clone(r.Placeholders)
	slices.Sort(sorted)
	return r.Login + "\x00" + r.Host + "\x00" + strings.Join(sorted, ",")
}

// Request is what the egress asks Ren about one request.
type Request struct {
	Login        string
	Host         string
	Port         int
	Method       string
	Path         string
	Placeholders []string
}

// Resolve asks Ren what a request gets. A fresh allow answer is reused; when
// Ren does not answer, the last allow answer is used until it is stale. No
// answer is used past its expiry. A denial is never kept, so a credential
// connected after a denial works on the next request (README §6.3 rules 1
// and 9).
func (c *Client) Resolve(ctx context.Context, r Request) (Reply, error) {
	key := answerKey(r)
	c.mu.Lock()
	kept, ok := c.answers[key]
	epoch := c.epoch
	c.mu.Unlock()
	if ok && c.usable(kept, c.fresh(kept.reply)) {
		return kept.reply, nil
	}
	var reply Reply
	err := c.post(ctx, "/egress/v1/resolve", map[string]any{
		"proof":        map[string]string{"kind": "Login", "username": r.Login},
		"host":         r.Host,
		"port":         r.Port,
		"method":       r.Method,
		"path":         r.Path,
		"placeholders": nonNil(r.Placeholders),
		"ops":          SupportedOps,
	}, &reply)
	c.mu.Lock()
	defer c.mu.Unlock()
	if err != nil {
		// Read again: an invalidate during the call drops the kept answer.
		kept, ok = c.answers[key]
		if ok && c.usable(kept, c.cfg.stale()) {
			c.logger.Warn("ren did not answer; using the last allow answer", slog.String("host", r.Host))
			return kept.reply, nil
		}
		return Reply{}, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	switch {
	case !reply.Allow:
		delete(c.answers, key)
	case c.epoch == epoch:
		c.sweep()
		c.answers[key] = entry{reply: reply, login: r.Login, storedAt: c.now()}
	}
	return reply, nil
}

func nonNil(list []string) []string {
	if list == nil {
		return []string{}
	}
	return list
}

// Selector names the answers Ren wants dropped (fork change 6).
type Selector struct {
	Workload string `json:"workload,omitempty"`
	Label    string `json:"label,omitempty"`
	Login    string `json:"login,omitempty"`
}

// Invalidate drops the matching answers. A login selector also drops that
// login's kept authentication and closes its open connections, so a replaced
// sandbox gets no more injections on a connection it kept open (C40).
func (c *Client) Invalidate(s Selector) int {
	c.mu.Lock()
	c.epoch++
	dropped := 0
	for key, kept := range c.answers {
		if (s.Workload != "" && strings.HasPrefix(kept.reply.Workload, s.Workload)) ||
			(s.Label != "" && (slices.Contains(kept.reply.Labels, s.Label) || strings.Contains(key, "ren:"+s.Label))) ||
			(s.Login != "" && kept.login == s.Login) {
			delete(c.answers, key)
			dropped++
		}
	}
	var closing []net.Conn
	if s.Login != "" {
		for key, kept := range c.logins {
			if kept.login == s.Login {
				delete(c.logins, key)
			}
		}
		for conn := range c.conns[s.Login] {
			closing = append(closing, conn)
		}
	}
	if s.Workload != "" {
		for key, kept := range c.logins {
			if strings.HasPrefix(kept.workload, s.Workload) {
				delete(c.logins, key)
				for conn := range c.conns[kept.login] {
					closing = append(closing, conn)
				}
			}
		}
	}
	c.mu.Unlock()
	for _, conn := range closing {
		_ = conn.Close() // the peer may already be gone
	}
	return dropped
}

// Track records an open connection of a login until done is called. Drain
// waits for tracked connections.
func (c *Client) Track(login string, conn net.Conn) (done func()) {
	c.mu.Lock()
	if c.conns[login] == nil {
		c.conns[login] = map[net.Conn]struct{}{}
	}
	c.conns[login][conn] = struct{}{}
	c.open.Add(1)
	c.mu.Unlock()
	var once sync.Once
	return func() {
		once.Do(func() {
			c.mu.Lock()
			delete(c.conns[login], conn)
			if len(c.conns[login]) == 0 {
				delete(c.conns, login)
			}
			c.mu.Unlock()
			c.open.Done()
		})
	}
}

// Drain waits until every tracked connection is closed or ctx ends.
func (c *Client) Drain(ctx context.Context) {
	done := make(chan struct{})
	go func() {
		c.open.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-ctx.Done():
		c.logger.Warn("drain ended with open connections")
	}
}

// Health runs one real resolve through the hook (README §6.10 rule 2).
func (c *Client) Health(ctx context.Context) error {
	var reply Reply
	return c.post(ctx, "/egress/v1/resolve", map[string]any{
		"proof":        map[string]string{"kind": "Login", "username": "ren-health-probe"},
		"host":         "health.ren.internal",
		"port":         443,
		"method":       "GET",
		"path":         "/",
		"placeholders": []string{},
		"ops":          SupportedOps,
	}, &reply)
}
