package ren

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"io"
	"log/slog"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	v4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	"github.com/stretchr/testify/require"
)

const emptySHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

type certs struct {
	dir    string
	ca     string
	cert   string
	key    string
	server tls.Certificate
	pool   *x509.CertPool
}

func writePEM(t *testing.T, path, kind string, der []byte) {
	t.Helper()
	require.NoError(t, os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: kind, Bytes: der}), 0o600))
}

func newCerts(t *testing.T) certs {
	t.Helper()
	dir := t.TempDir()
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	caTemplate := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "ren test ca"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign,
		BasicConstraintsValid: true,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTemplate, caTemplate, &caKey.PublicKey, caKey)
	require.NoError(t, err)
	caCert, err := x509.ParseCertificate(caDER)
	require.NoError(t, err)
	leafKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	leafTemplate := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: "localhost"},
		DNSNames:     []string{"localhost"},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth},
		KeyUsage:     x509.KeyUsageDigitalSignature,
	}
	leafDER, err := x509.CreateCertificate(rand.Reader, leafTemplate, caCert, &leafKey.PublicKey, caKey)
	require.NoError(t, err)
	keyDER, err := x509.MarshalECPrivateKey(leafKey)
	require.NoError(t, err)
	c := certs{dir: dir, ca: filepath.Join(dir, "ca.pem"), cert: filepath.Join(dir, "cert.pem"), key: filepath.Join(dir, "key.pem")}
	writePEM(t, c.ca, "CERTIFICATE", caDER)
	writePEM(t, c.cert, "CERTIFICATE", leafDER)
	writePEM(t, c.key, "EC PRIVATE KEY", keyDER)
	c.server, err = tls.LoadX509KeyPair(c.cert, c.key)
	require.NoError(t, err)
	c.pool = x509.NewCertPool()
	c.pool.AddCert(caCert)
	return c
}

type hook struct {
	server   *httptest.Server
	calls    atomic.Int32
	down     atomic.Bool
	answer   atomic.Value
	lastBody atomic.Value
	hold     atomic.Pointer[held]
	reports  chan string
}

// held stops the hook after it read a request: entered closes, then the
// hook waits for release before it answers.
type held struct {
	entered chan struct{}
	release chan struct{}
}

func (h *hook) holdNext() *held {
	next := &held{entered: make(chan struct{}), release: make(chan struct{})}
	h.hold.Store(next)
	return next
}

func newHook(t *testing.T, c certs) *hook {
	t.Helper()
	h := &hook{reports: make(chan string, 100)}
	h.answer.Store(Reply{Allow: true, Workload: "brain:brn_1:1", TTL: 30, Labels: []string{"STRIPE_API_KEY"}, Inject: []Op{{Op: "replace", Placeholder: "ren:STRIPE_API_KEY", Value: "sk_live_real", In: []string{"header"}}}})
	h.server = httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.calls.Add(1)
		body, _ := io.ReadAll(r.Body) // a test hook; a short read fails the assertions below
		h.lastBody.Store(string(body))
		if wait := h.hold.Swap(nil); wait != nil {
			close(wait.entered)
			<-wait.release
		}
		if h.down.Load() {
			http.Error(w, "down", http.StatusServiceUnavailable)
			return
		}
		if r.URL.Path == "/egress/v1/unauthorized" {
			h.reports <- string(body)
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.URL.Path == "/egress/v1/authenticate" {
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "workload": "brain:brn_1:1"}) // test hook
			return
		}
		_ = json.NewEncoder(w).Encode(h.answer.Load()) // test hook
	}))
	h.server.TLS = &tls.Config{Certificates: []tls.Certificate{c.server}, ClientCAs: c.pool, ClientAuth: tls.RequireAndVerifyClientCert}
	h.server.StartTLS()
	t.Cleanup(h.server.Close)
	return h
}

type clock struct{ now time.Time }

func (c *clock) advance(d time.Duration) { c.now = c.now.Add(d) }

func newClient(t *testing.T) (*Client, *hook, *clock) {
	t.Helper()
	c := newCerts(t)
	h := newHook(t, c)
	client, err := New(Config{Hook: h.server.URL, CACert: c.ca, Cert: c.cert, Key: c.key, ControlListen: "127.0.0.1:0"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	require.NoError(t, err)
	clk := &clock{now: time.Unix(1_800_000_000, 0)}
	client.now = func() time.Time { return clk.now }
	return client, h, clk
}

func stripe(login string) Request {
	return Request{Login: login, Host: "api.stripe.com", Port: 443, Method: "POST", Path: "/v1/charges", Placeholders: []string{"ren:STRIPE_API_KEY"}}
}

func TestResolveKeepsAnswers(t *testing.T) {
	client, h, clk := newClient(t)
	ctx := t.Context()

	_, err := client.Resolve(ctx, stripe("ren-a"))
	require.NoError(t, err)
	_, err = client.Resolve(ctx, stripe("ren-a"))
	require.NoError(t, err)
	require.Equal(t, int32(1), h.calls.Load(), "a fresh answer is reused for 30s")
	require.Contains(t, h.lastBody.Load(), `"ops":["replace","setHeader","route","awsSign"]`)

	clk.advance(31 * time.Second)
	h.down.Store(true)
	reply, err := client.Resolve(ctx, stripe("ren-a"))
	require.NoError(t, err)
	require.True(t, reply.Allow, "the last allow answer is used while Ren is down")

	clk.advance(15 * time.Minute)
	_, err = client.Resolve(ctx, stripe("ren-a"))
	require.ErrorIs(t, err, ErrUnavailable, "after 15 minutes the call fails")
}

func TestResolveNeverKeepsADenial(t *testing.T) {
	client, h, _ := newClient(t)
	ctx := t.Context()
	h.answer.Store(Reply{Allow: false, Reason: "credential_missing", Label: "STRIPE_API_KEY"})
	reply, err := client.Resolve(ctx, stripe("ren-a"))
	require.NoError(t, err)
	require.False(t, reply.Allow)
	h.down.Store(true)
	_, err = client.Resolve(ctx, stripe("ren-a"))
	require.ErrorIs(t, err, ErrUnavailable, "a denial is never reused, also when Ren is down")
}

func TestInvalidate(t *testing.T) {
	client, h, _ := newClient(t)
	ctx := t.Context()
	_, err := client.Resolve(ctx, stripe("ren-a"))
	require.NoError(t, err)
	require.Equal(t, 1, client.Invalidate(Selector{Label: "STRIPE_API_KEY"}))
	_, err = client.Resolve(ctx, stripe("ren-a"))
	require.NoError(t, err)
	require.Equal(t, int32(2), h.calls.Load(), "an invalidated answer is asked again")

	h.down.Store(true)
	client.Invalidate(Selector{Workload: "brain:brn_1:"})
	_, err = client.Resolve(ctx, stripe("ren-a"))
	require.ErrorIs(t, err, ErrUnavailable, "an invalidated answer is never used as a stale answer")
}

func TestResolveUsesRensTTL(t *testing.T) {
	client, h, clk := newClient(t)
	ctx := t.Context()
	h.answer.Store(Reply{Allow: true, Workload: "brain:brn_1:1", TTL: 5, Labels: []string{"STRIPE_API_KEY"}, Inject: []Op{}})
	_, err := client.Resolve(ctx, stripe("ren-a"))
	require.NoError(t, err)
	clk.advance(6 * time.Second)
	_, err = client.Resolve(ctx, stripe("ren-a"))
	require.NoError(t, err)
	require.Equal(t, int32(2), h.calls.Load(), "an answer is fresh for the ttl Ren gave it")
}

func TestResolveNeverUsesAnAnswerPastItsExpiry(t *testing.T) {
	client, h, clk := newClient(t)
	ctx := t.Context()
	h.answer.Store(Reply{Allow: true, Workload: "brain:brn_1:1", TTL: 30, ExpiresAt: clk.now.Add(10 * time.Minute).Unix(), Labels: []string{"MODELS"}, Inject: []Op{}})
	_, err := client.Resolve(ctx, stripe("ren-a"))
	require.NoError(t, err)

	clk.advance(5 * time.Minute)
	h.down.Store(true)
	reply, err := client.Resolve(ctx, stripe("ren-a"))
	require.NoError(t, err)
	require.True(t, reply.Allow, "before the value expires, the last allow answer is used while Ren is down")

	clk.advance(5 * time.Minute)
	_, err = client.Resolve(ctx, stripe("ren-a"))
	require.ErrorIs(t, err, ErrUnavailable, "a value past its expiry is never sent, also when Ren is down")
}

func TestResolveDoesNotKeepAnAnswerInvalidatedWhileInFlight(t *testing.T) {
	client, h, _ := newClient(t)
	ctx := t.Context()
	wait := h.holdNext()
	done := make(chan error, 1)
	go func() {
		_, err := client.Resolve(ctx, stripe("ren-a"))
		done <- err
	}()
	<-wait.entered
	client.Invalidate(Selector{Label: "STRIPE_API_KEY"})
	close(wait.release)
	require.NoError(t, <-done)

	_, err := client.Resolve(ctx, stripe("ren-a"))
	require.NoError(t, err)
	require.Equal(t, int32(2), h.calls.Load(), "an answer Ren read before an invalidate is not kept after it")
}

func TestAuthenticateDoesNotKeepALoginInvalidatedWhileInFlight(t *testing.T) {
	client, h, _ := newClient(t)
	ctx := t.Context()
	wait := h.holdNext()
	done := make(chan error, 1)
	go func() {
		_, err := client.Authenticate(ctx, "ren-a", "secret", "")
		done <- err
	}()
	<-wait.entered
	client.Invalidate(Selector{Login: "ren-a"})
	close(wait.release)
	require.NoError(t, <-done)

	_, err := client.Authenticate(ctx, "ren-a", "secret", "")
	require.NoError(t, err)
	require.Equal(t, int32(2), h.calls.Load(), "a login answer Ren gave before an invalidate is not kept after it")
}

func TestInvalidateLoginClosesItsConnections(t *testing.T) {
	client, _, _ := newClient(t)
	server, peer := net.Pipe()
	defer peer.Close()
	done := client.Track("ren-a", server)
	defer done()
	client.Invalidate(Selector{Login: "ren-a"})
	_, err := server.Read(make([]byte, 1))
	require.Error(t, err, "the old login's connection is closed")
}

func TestHandleDeniesWithTheLabel(t *testing.T) {
	client, h, _ := newClient(t)
	h.answer.Store(Reply{Allow: false, Reason: "credential_missing", Label: "MISSING"})
	req := newRequest(t, "GET", "https://api.example.com/v1", nil, "")
	req.Host = "api.example.com"
	req.Header.Set("Authorization", "Bearer ren:MISSING")
	resp, _ := client.Handle(t.Context(), req, "ren-a")
	require.NotNil(t, resp)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.Equal(t, "credential_missing", resp.Header.Get("X-Ren-Egress"))
	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	require.JSONEq(t, `{"error":"ren_credential_missing","label":"MISSING"}`, string(body))
}

func TestHandleNeverForwardsAnUnresolvedPlaceholder(t *testing.T) {
	client, h, _ := newClient(t)
	h.answer.Store(Reply{Allow: true, Workload: "brain:brn_1:1", Inject: []Op{}})
	req := newRequest(t, "GET", "https://api.example.com/v1", nil, "")
	req.Host = "api.example.com"
	req.Header.Set("X-Api-Key", "ren:OTHER")
	resp, _ := client.Handle(t.Context(), req, "ren-a")
	require.NotNil(t, resp)
	require.Equal(t, "credential_missing", resp.Header.Get("X-Ren-Egress"))
}

func TestHandleRoutes(t *testing.T) {
	client, h, _ := newClient(t)
	h.answer.Store(Reply{Allow: true, Workload: "brain:brn_1:1", Inject: []Op{
		{Op: "route", Upstream: "http://ren-server:4000"},
		{Op: "setHeader", Name: "Authorization", Value: "Bearer host-token"},
	}})
	req := newRequest(t, "POST", "https://ren.internal/host/pull", nil, "")
	req.Host = "ren.internal"
	resp, applied := client.Handle(t.Context(), req, "ren-a")
	require.Nil(t, resp)
	require.Equal(t, "http://ren-server:4000/host/pull", applied.Upstream.String())
	require.Equal(t, "Bearer host-token", req.Header.Get("Authorization"))
}

func TestConfigRefusesMissingFiles(t *testing.T) {
	err := Config{Hook: "https://ren:4443", CACert: "/nope/ca.pem", Cert: "/nope/c.pem", Key: "/nope/k.pem", ControlListen: ":9443"}.Validate()
	require.Error(t, err)
	err = Config{}.Validate()
	require.ErrorContains(t, err, "ca_cert, cert, control_listen, hook, key required")
}

func TestHandleTreatsAPlaceholderInABodyAsText(t *testing.T) {
	client, h, _ := newClient(t)
	h.answer.Store(Reply{Allow: true, Workload: "brain:brn_1:1", Inject: []Op{
		{Op: "replace", Placeholder: "ren:MODELS", Value: "sk-ant-real", In: []string{"header"}},
	}})
	body := `{"tools":[{"description":"Credentials hold placeholders such as ren:STRIPE_API_KEY."}]}`
	req := newRequest(t, "POST", "https://llm.example.com/v1/messages", []byte(body), "application/json")
	req.Host = "llm.example.com"
	req.Header.Set("X-Api-Key", "ren:MODELS")
	denied, _ := client.Handle(t.Context(), req, "ren-a")
	require.Nil(t, denied, "a model call whose prompt mentions a placeholder is not refused")
	require.Contains(t, h.lastBody.Load(), `"placeholders":["ren:MODELS"]`)
	sent, err := io.ReadAll(req.Body)
	require.NoError(t, err)
	require.Equal(t, body, string(sent), "the body goes on unchanged")
}

func TestHandleSaysWhenAPlaceholderSitsWhereItsCredentialDoesNotGo(t *testing.T) {
	client, h, _ := newClient(t)
	h.answer.Store(Reply{Allow: true, Workload: "brain:brn_1:1", Labels: []string{"STRIPE_API_KEY"}, Inject: []Op{
		{Op: "replace", Placeholder: "ren:STRIPE_API_KEY", Value: "sk_live_secret_1", In: []string{"header"}},
	}})
	req := newRequest(t, "GET", "https://api.stripe.com/v1/customers/ren:STRIPE_API_KEY", nil, "")
	req.Host = "api.stripe.com"
	req.Header.Set("Authorization", "Bearer ren:STRIPE_API_KEY")
	denied, _ := client.Handle(t.Context(), req, "ren-a")
	require.NotNil(t, denied)
	require.Equal(t, "location_not_allowed", denied.Header.Get("X-Ren-Egress"))
	body, err := io.ReadAll(denied.Body)
	require.NoError(t, err)
	require.JSONEq(t, `{"error":"ren_location_not_allowed","label":"STRIPE_API_KEY"}`, string(body))
}

func linear(t *testing.T, client *Client) *Applied {
	t.Helper()
	req := newRequest(t, "POST", "https://mcp.linear.app/mcp", nil, "")
	req.Host = "mcp.linear.app"
	req.Header.Set("Authorization", "Bearer ren:MCP_LINEAR")
	denied, applied := client.Handle(t.Context(), req, "ren-a")
	require.Nil(t, denied)
	return applied
}

func upstreamAnswer(status int, challenge string) *http.Response {
	header := http.Header{}
	if challenge != "" {
		header.Set("WWW-Authenticate", challenge)
	}
	return &http.Response{StatusCode: status, Header: header, Body: io.NopCloser(strings.NewReader(""))}
}

func TestObserveReportsOneUpstream401AndDropsTheKeptAnswer(t *testing.T) {
	client, h, _ := newClient(t)
	h.answer.Store(Reply{Allow: true, Workload: "brain:brn_1:1", TTL: 30, Labels: []string{"MCP_LINEAR"},
		Refreshable: []Refreshable{{Label: "MCP_LINEAR", Revision: 3}},
		Inject:      []Op{{Op: "replace", Placeholder: "ren:MCP_LINEAR", Value: "tok_old", In: []string{"header"}}}})
	applied := linear(t, client)
	var wg sync.WaitGroup
	for range 10 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			resp := upstreamAnswer(http.StatusUnauthorized, `Bearer error="invalid_token"`)
			client.Observe(applied, resp)
			require.Equal(t, http.StatusUnauthorized, resp.StatusCode, "the 401 goes back to the workload unchanged")
		}()
	}
	wg.Wait()
	client.reporting.Wait()
	require.Len(t, h.reports, 1, "10 parallel 401s for one revision send one report")
	require.JSONEq(t, `{"login":"ren-a","host":"mcp.linear.app","status":401,"labels":[{"label":"MCP_LINEAR","revision":3}]}`, <-h.reports)
	calls := h.calls.Load()
	linear(t, client)
	require.Equal(t, calls+1, h.calls.Load(), "the kept answer was dropped, so Ren is asked again")
}

func TestObserveReportsAScopeChallengeAndKeepsTheAnswer(t *testing.T) {
	client, h, _ := newClient(t)
	h.answer.Store(Reply{Allow: true, Workload: "brain:brn_1:1", TTL: 30, Labels: []string{"MCP_LINEAR"},
		Refreshable: []Refreshable{{Label: "MCP_LINEAR", Revision: 1}},
		Inject:      []Op{{Op: "replace", Placeholder: "ren:MCP_LINEAR", Value: "tok", In: []string{"header"}}}})
	applied := linear(t, client)
	client.Observe(applied, upstreamAnswer(http.StatusForbidden, `Bearer error="forbidden"`))
	client.Observe(applied, upstreamAnswer(http.StatusForbidden, `Bearer error="insufficient_scope", scope="issues:write admin"`))
	client.reporting.Wait()
	require.Len(t, h.reports, 1, "only an insufficient_scope 403 is reported")
	require.JSONEq(t, `{"login":"ren-a","host":"mcp.linear.app","status":403,"scope":"issues:write admin","labels":[{"label":"MCP_LINEAR","revision":1}]}`, <-h.reports)
	calls := h.calls.Load()
	linear(t, client)
	require.Equal(t, calls, h.calls.Load(), "a 403 keeps the answer")
}

func TestObserveIgnoresAnswersWithoutRefreshableLabels(t *testing.T) {
	client, h, _ := newClient(t)
	h.answer.Store(Reply{Allow: true, Workload: "brain:brn_1:1", Labels: []string{"MCP_LINEAR"},
		Inject: []Op{{Op: "replace", Placeholder: "ren:MCP_LINEAR", Value: "tok", In: []string{"header"}}}})
	client.Observe(linear(t, client), upstreamAnswer(http.StatusUnauthorized, ""))
	client.Observe(nil, upstreamAnswer(http.StatusUnauthorized, ""))
	client.reporting.Wait()
	require.Empty(t, h.reports)
}

func TestHandleSignsAgainWithRensAWSKeys(t *testing.T) {
	cases := []struct{ name, url, host string }{
		{"a list on the bucket host", "https://ren-drives.s3.us-east-1.amazonaws.com/?delimiter=%2F&list-type=2&prefix=org_1%2Fdrives%2Forg%2F", "ren-drives.s3.us-east-1.amazonaws.com"},
		{"a ranged get of a Unicode key, path-style", "http://rustfs:9000/ren-drives/org_1/drives/org/r%C3%A9sum%C3%A9%20final.pdf", "rustfs:9000"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			client, h, _ := newClient(t)
			h.answer.Store(Reply{Allow: true, Workload: "brain:brn_1:1", Inject: []Op{
				{Op: "awsSign", AccessKeyID: "ASIAREALKEY", SecretAccessKey: "real-secret-access-key", SessionToken: "real-session-token"},
			}})
			req := newRequest(t, "GET", tc.url, nil, "")
			req.Host = tc.host
			req.Header.Set("Accept-Encoding", "gzip")
			req.Header.Set("User-Agent", "rclone/v1.75.2")
			req.Header.Set("Range", "bytes=0-99")
			req.Header.Set("X-Amz-Content-Sha256", emptySHA256)
			placeholder := aws.Credentials{AccessKeyID: "ren:DRIVE", SecretAccessKey: "ren:DRIVE"}
			require.NoError(t, v4.NewSigner().SignHTTP(t.Context(), placeholder, req, emptySHA256, "s3", "us-east-1", time.Now().Add(-time.Minute), func(o *v4.SignerOptions) { o.DisableURIPathEscaping = true }))
			require.Equal(t, []string{"ren:DRIVE"}, findPlaceholders(req))

			resp, _ := client.Handle(t.Context(), req, "ren-a")
			require.Nil(t, resp)
			require.Empty(t, findPlaceholders(req))
			require.Equal(t, "real-session-token", req.Header.Get("X-Amz-Security-Token"))
			require.Contains(t, req.Header.Get("Authorization"), "SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token,")

			signedAt, err := time.Parse("20060102T150405Z", req.Header.Get("X-Amz-Date"))
			require.NoError(t, err)
			expected, err := http.NewRequest("GET", tc.url, nil)
			require.NoError(t, err)
			expected.Host = tc.host
			expected.Header.Set("X-Amz-Content-Sha256", emptySHA256)
			real := aws.Credentials{AccessKeyID: "ASIAREALKEY", SecretAccessKey: "real-secret-access-key", SessionToken: "real-session-token"}
			require.NoError(t, v4.NewSigner().SignHTTP(t.Context(), real, expected, emptySHA256, "s3", "us-east-1", signedAt, func(o *v4.SignerOptions) { o.DisableURIPathEscaping = true }))
			require.Equal(t, expected.Header.Get("Authorization"), req.Header.Get("Authorization"))
		})
	}
}

func TestHandleRefusesAWSSignWithoutASignature(t *testing.T) {
	client, h, _ := newClient(t)
	h.answer.Store(Reply{Allow: true, Workload: "brain:brn_1:1", Inject: []Op{
		{Op: "awsSign", AccessKeyID: "ASIAREALKEY", SecretAccessKey: "real-secret-access-key", SessionToken: "real-session-token"},
	}})
	req := newRequest(t, "GET", "https://ren-drives.s3.us-east-1.amazonaws.com/?list-type=2", nil, "")
	req.Host = "ren-drives.s3.us-east-1.amazonaws.com"
	req.Header.Set("X-Amz-Meta-Note", "ren:DRIVE")
	resp, _ := client.Handle(t.Context(), req, "ren-a")
	require.NotNil(t, resp)
	require.Equal(t, "credential_missing", resp.Header.Get("X-Ren-Egress"))
}
