package proxy

import (
	"crypto/tls"
	"crypto/x509"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
	"github.com/ironsh/iron-proxy/internal/certcache"
	"github.com/ironsh/iron-proxy/internal/ren"
	"github.com/ironsh/iron-proxy/internal/ren/rentest"
	"github.com/ironsh/iron-proxy/internal/transform"
	"github.com/stretchr/testify/require"
)

// startIdentityEntry starts a proxy with the identity entry (fork change
// 14) and returns the entry's address and a client that trusts it.
func startIdentityEntry(t *testing.T, issuer *rentest.Issuer) (string, *http.Client) {
	t.Helper()
	caCert, caKey := generateTestCA(t)
	cache, err := certcache.NewFromCA(caCert, caKey, 100, 72*time.Hour)
	require.NoError(t, err)
	cert, err := cache.GetOrCreate("egress.ren.test")
	require.NoError(t, err)
	p := New(Options{
		HTTPAddr:     "127.0.0.1:0",
		HTTPSAddr:    "127.0.0.1:0",
		CertCache:    cache,
		Pipeline:     transform.NewPipelineHolder(transform.NewPipeline(nil, transform.BodyLimits{}, testLogger())),
		Logger:       testLogger(),
		IdentityAddr: "127.0.0.1:0",
		IdentityCert: *cert,
		Verifier:     ren.NewVerifier(ren.IdentityConfig{Issuer: issuer.Server.URL, Audience: rentest.Audience, Project: rentest.Project}, issuer.Server.Client()),
	})
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	go func() { _ = p.identityServer.ServeTLS(ln, "", "") }()
	t.Cleanup(func() { _ = p.identityServer.Close() })
	pool := x509.NewCertPool()
	pool.AddCert(caCert)
	client := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool, ServerName: "egress.ren.test"}}}
	return ln.Addr().String(), client
}

func TestIdentityEntrySendsTheRequestToItsTargetWithoutRenHeaders(t *testing.T) {
	received := make(chan *http.Request, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body) // a short read fails the body assertion below
		r.Body = io.NopCloser(strings.NewReader(string(body)))
		received <- r
		_, _ = w.Write([]byte("ok")) // the test reads the answer
	}))
	defer upstream.Close()
	key := rentest.NewKey(t, "k1")
	issuer := rentest.NewIssuer(t, key)
	addr, client := startIdentityEntry(t, issuer)

	req, err := http.NewRequest("POST", "https://"+addr+"/ignored", strings.NewReader("payload"))
	require.NoError(t, err)
	req.Header.Set("X-Ren-Identity", "Bearer "+rentest.Sign(t, key, jose.ES256, issuer.Claims(time.Now())))
	req.Header.Set("X-Ren-Target", upstream.URL+"/v1/items?page=2")
	req.Header.Set("X-Other", "kept")
	resp, err := client.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	answer, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Equal(t, "ok", string(answer))

	got := <-received
	require.Equal(t, "/v1/items?page=2", got.URL.RequestURI())
	require.Equal(t, strings.TrimPrefix(upstream.URL, "http://"), got.Host)
	require.Equal(t, "kept", got.Header.Get("X-Other"))
	require.Empty(t, got.Header.Values("X-Ren-Identity"), "the token never reaches an upstream")
	require.Empty(t, got.Header.Values("X-Ren-Target"))
	body, err := io.ReadAll(got.Body)
	require.NoError(t, err)
	require.Equal(t, "payload", string(body))
}

func TestIdentityEntryRefuses(t *testing.T) {
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1) }))
	defer upstream.Close()
	key := rentest.NewKey(t, "k1")
	issuer := rentest.NewIssuer(t, key)
	addr, client := startIdentityEntry(t, issuer)
	valid := "Bearer " + rentest.Sign(t, key, jose.ES256, issuer.Claims(time.Now()))
	otherAudience := issuer.Claims(time.Now())
	otherAudience.Audience = jwt.Audience{"https://prod.ren"}
	target := upstream.URL + "/v1"

	for name, c := range map[string]struct {
		identities []string
		targets    []string
		status     int
	}{
		"no identity":                {nil, []string{target}, http.StatusForbidden},
		"two identities":             {[]string{valid, valid}, []string{target}, http.StatusForbidden},
		"an identity without Bearer": {[]string{strings.TrimPrefix(valid, "Bearer ")}, []string{target}, http.StatusForbidden},
		"a token of another egress":  {[]string{"Bearer " + rentest.Sign(t, key, jose.ES256, otherAudience)}, []string{target}, http.StatusForbidden},
		"no target":                  {[]string{valid}, nil, http.StatusBadRequest},
		"two targets":                {[]string{valid}, []string{target, target}, http.StatusBadRequest},
		"a target that is not HTTP":  {[]string{valid}, []string{"ftp://example.com/file"}, http.StatusBadRequest},
		"a target with a login":      {[]string{valid}, []string{"https://user:pass@example.com/"}, http.StatusBadRequest},
	} {
		t.Run(name, func(t *testing.T) {
			req, err := http.NewRequest("GET", "https://"+addr+"/", nil)
			require.NoError(t, err)
			for _, value := range c.identities {
				req.Header.Add("X-Ren-Identity", value)
			}
			for _, value := range c.targets {
				req.Header.Add("X-Ren-Target", value)
			}
			resp, err := client.Do(req)
			require.NoError(t, err)
			_ = resp.Body.Close() // only the status matters
			require.Equal(t, c.status, resp.StatusCode)
			if c.status == http.StatusForbidden {
				require.Equal(t, "unknown_workload", resp.Header.Get("X-Ren-Egress"))
			}
		})
	}
	require.Equal(t, int32(0), calls.Load(), "a refused request never reaches its target")
}
