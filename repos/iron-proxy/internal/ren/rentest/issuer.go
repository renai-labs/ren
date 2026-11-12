// Package rentest holds test helpers for Ren's fork changes.
package rentest

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
	"github.com/stretchr/testify/require"
)

const (
	Project  = "project-1"
	Audience = "https://egress.ren.test"
)

// Issuer is a fake E2B identity issuer: OIDC discovery and a key set.
type Issuer struct {
	Server *httptest.Server
	keys   atomic.Pointer[jose.JSONWebKeySet]
	loads  atomic.Int32
}

// Claims are the claims of an E2B workload identity token.
type Claims struct {
	jwt.Claims
	SandboxID   string `json:"sandbox_id,omitempty"`
	ExecutionID string `json:"execution_id,omitempty"`
}

func NewKey(t *testing.T, kid string) jose.JSONWebKey {
	t.Helper()
	private, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	return jose.JSONWebKey{Key: private, KeyID: kid, Algorithm: string(jose.ES256), Use: "sig"}
}

func NewIssuer(t *testing.T, keys ...jose.JSONWebKey) *Issuer {
	t.Helper()
	i := &Issuer{}
	i.Publish(keys...)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /.well-known/openid-configuration", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"issuer": i.Server.URL, "jwks_uri": i.Server.URL + "/keys"}) // the test reads the result
	})
	mux.HandleFunc("GET /keys", func(w http.ResponseWriter, r *http.Request) {
		i.loads.Add(1)
		_ = json.NewEncoder(w).Encode(i.keys.Load()) // the test reads the result
	})
	i.Server = httptest.NewTLSServer(mux)
	t.Cleanup(i.Server.Close)
	return i
}

// Publish replaces the published keys.
func (i *Issuer) Publish(keys ...jose.JSONWebKey) {
	set := jose.JSONWebKeySet{}
	for _, key := range keys {
		set.Keys = append(set.Keys, key.Public())
	}
	i.keys.Store(&set)
}

// Loads counts the loads of the key set.
func (i *Issuer) Loads() int32 { return i.loads.Load() }

// Claims are valid claims for sandbox sbx1, execution exec1, issued at now.
func (i *Issuer) Claims(now time.Time) Claims {
	return Claims{
		Claims: jwt.Claims{
			Issuer:    i.Server.URL,
			Audience:  jwt.Audience{Audience},
			Subject:   i.Subject(Project, "sbx1", "exec1"),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			Expiry:    jwt.NewNumericDate(now.Add(15 * time.Minute)),
		},
		SandboxID:   "sbx1",
		ExecutionID: "exec1",
	}
}

// Subject is the SPIFFE id of a sandbox execution at this issuer.
func (i *Issuer) Subject(project, sandbox, execution string) string {
	return "spiffe://" + i.Server.Listener.Addr().String() + "/" + project + "/" + sandbox + "/" + execution
}

func Sign(t *testing.T, key jose.JSONWebKey, alg jose.SignatureAlgorithm, claims Claims) string {
	t.Helper()
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: alg, Key: key}, (&jose.SignerOptions{}).WithType("JWT"))
	require.NoError(t, err)
	token, err := jwt.Signed(signer).Claims(claims).Serialize()
	require.NoError(t, err)
	return token
}
