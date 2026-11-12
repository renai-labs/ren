package ren

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
)

// IdentityConfig is the `ren.identity` block: the HTTPS entry for credential
// requests that E2B names with a workload identity token (fork change 14).
type IdentityConfig struct {
	// Listen is the address of the entry, for example 0.0.0.0:443.
	Listen string `yaml:"listen"`
	// Cert and Key are the entry's server certificate. E2B checks it, so it
	// is a public certificate for the egress host name.
	Cert string `yaml:"cert"`
	Key  string `yaml:"key"`
	// Issuer is E2B's token issuer (default https://id.e2b.dev). The SPIFFE
	// trust domain in `sub` is its host.
	Issuer string `yaml:"issuer"`
	// Audience is the audience that Ren asks E2B to put in the tokens: the
	// egress URL of this deployment.
	Audience string `yaml:"audience"`
	// Project is Ren's E2B project id. A token of another project is refused.
	Project string `yaml:"project"`
}

func (c IdentityConfig) issuer() string {
	if c.Issuer == "" {
		return "https://id.e2b.dev"
	}
	return strings.TrimSuffix(c.Issuer, "/")
}

// Validate refuses an entry that would accept tokens of any audience or
// project.
func (c IdentityConfig) Validate() error {
	if c.Listen == "" {
		return nil
	}
	missing := []string{}
	for _, field := range []struct{ name, value string }{{"audience", c.Audience}, {"cert", c.Cert}, {"key", c.Key}, {"project", c.Project}} {
		if field.value == "" {
			missing = append(missing, "identity."+field.name)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("ren: %s required", strings.Join(missing, ", "))
	}
	return nil
}

// Identity is the sandbox execution that a verified token names.
type Identity struct {
	SandboxID   string
	ExecutionID string
}

// Caller is who sent a request: a proxy login that Ren checked (fork
// change 1), or a sandbox execution that E2B named (fork change 14).
type Caller struct {
	Login    string
	Identity Identity
}

// key keeps the answers of each caller apart. A sandbox keeps its answers
// across executions, because a resume names the same workload.
func (c Caller) key() string {
	if c.Identity.SandboxID != "" {
		return "e2b:" + c.Identity.SandboxID
	}
	return c.Login
}

// proof names the caller to Ren. A login was checked when its connection
// opened, so only the name goes (fork change 2).
func (c Caller) proof() map[string]string {
	if c.Identity.SandboxID != "" {
		return map[string]string{"kind": "E2BIdentity", "sandboxId": c.Identity.SandboxID, "executionId": c.Identity.ExecutionID}
	}
	return map[string]string{"kind": "Login", "username": c.Login}
}

// keyReload is the shortest time between two loads of E2B's keys.
const keyReload = 30 * time.Second

// leeway allows for clock skew between E2B and the egress.
const leeway = 30 * time.Second

// Verifier checks E2B workload identity tokens with E2B's published keys.
type Verifier struct {
	cfg  IdentityConfig
	http *http.Client
	now  func() time.Time

	mu       sync.Mutex
	keys     jose.JSONWebKeySet
	loadedAt time.Time
	loading  sync.Mutex
}

// NewVerifier builds a verifier. It loads the keys at the first token.
func NewVerifier(cfg IdentityConfig, client *http.Client) *Verifier {
	return &Verifier{cfg: cfg, http: client, now: time.Now}
}

// Verify checks a token: ES256 with a published key, issuer, audience, time,
// and a `sub` of Ren's project that names the token's sandbox and execution.
func (v *Verifier) Verify(ctx context.Context, raw string) (Identity, error) {
	token, err := jwt.ParseSigned(raw, []jose.SignatureAlgorithm{jose.ES256})
	if err != nil {
		return Identity{}, fmt.Errorf("parse: %w", err)
	}
	key, err := v.key(ctx, token.Headers[0].KeyID)
	if err != nil {
		return Identity{}, err
	}
	var claims jwt.Claims
	var named struct {
		SandboxID   string `json:"sandbox_id"`
		ExecutionID string `json:"execution_id"`
	}
	if err := token.Claims(key.Key, &claims, &named); err != nil {
		return Identity{}, fmt.Errorf("signature: %w", err)
	}
	if err := claims.ValidateWithLeeway(jwt.Expected{Issuer: v.cfg.issuer(), AnyAudience: jwt.Audience{v.cfg.Audience}, Time: v.now()}, leeway); err != nil {
		return Identity{}, err
	}
	if named.SandboxID == "" || named.ExecutionID == "" || strings.Contains(named.SandboxID+named.ExecutionID, "/") {
		return Identity{}, errors.New("no sandbox or execution id")
	}
	issuer, _ := url.Parse(v.cfg.issuer()) // a parse error leaves an empty host, which no sub matches
	if claims.Subject != "spiffe://"+issuer.Host+"/"+v.cfg.Project+"/"+named.SandboxID+"/"+named.ExecutionID {
		return Identity{}, errors.New("sub is not this project's sandbox")
	}
	return Identity{SandboxID: named.SandboxID, ExecutionID: named.ExecutionID}, nil
}

// key finds the key with this id, and loads the keys again when it is
// unknown and the last load is older than keyReload.
func (v *Verifier) key(ctx context.Context, kid string) (jose.JSONWebKey, error) {
	if found, ok := v.find(kid); ok {
		return found, nil
	}
	v.loading.Lock()
	defer v.loading.Unlock()
	if found, ok := v.find(kid); ok {
		return found, nil
	}
	v.mu.Lock()
	recent := !v.loadedAt.IsZero() && v.now().Sub(v.loadedAt) < keyReload
	v.mu.Unlock()
	if recent {
		return jose.JSONWebKey{}, fmt.Errorf("unknown key id %q", kid)
	}
	keys, err := v.load(ctx)
	if err != nil {
		return jose.JSONWebKey{}, fmt.Errorf("load keys: %w", err)
	}
	v.mu.Lock()
	v.keys, v.loadedAt = keys, v.now()
	v.mu.Unlock()
	if found, ok := v.find(kid); ok {
		return found, nil
	}
	return jose.JSONWebKey{}, fmt.Errorf("unknown key id %q", kid)
}

func (v *Verifier) find(kid string) (jose.JSONWebKey, bool) {
	v.mu.Lock()
	defer v.mu.Unlock()
	found := v.keys.Key(kid)
	if len(found) == 0 {
		return jose.JSONWebKey{}, false
	}
	return found[0], true
}

func (v *Verifier) load(ctx context.Context) (jose.JSONWebKeySet, error) {
	var discovery struct {
		JWKSURI string `json:"jwks_uri"`
	}
	if err := v.get(ctx, v.cfg.issuer()+"/.well-known/openid-configuration", &discovery); err != nil {
		return jose.JSONWebKeySet{}, err
	}
	if !strings.HasPrefix(discovery.JWKSURI, "https://") {
		return jose.JSONWebKeySet{}, fmt.Errorf("jwks_uri %q is not https", discovery.JWKSURI)
	}
	var keys jose.JSONWebKeySet
	return keys, v.get(ctx, discovery.JWKSURI, &keys)
}

func (v *Verifier) get(ctx context.Context, target string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return err
	}
	resp, err := v.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, resp.Body) // drain so the connection is reused
		return fmt.Errorf("%s answered %d", target, resp.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(out)
}
