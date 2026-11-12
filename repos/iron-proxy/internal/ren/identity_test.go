package ren

import (
	"context"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
	"github.com/ironsh/iron-proxy/internal/ren/rentest"
	"github.com/stretchr/testify/require"
)

func newVerifier(i *rentest.Issuer, now *time.Time) *Verifier {
	v := NewVerifier(IdentityConfig{Issuer: i.Server.URL, Audience: rentest.Audience, Project: rentest.Project}, i.Server.Client())
	v.now = func() time.Time { return *now }
	return v
}

func TestVerifierAcceptsAnE2BToken(t *testing.T) {
	key := rentest.NewKey(t, "k1")
	i := rentest.NewIssuer(t, key)
	now := time.Now()
	v := newVerifier(i, &now)

	identity, err := v.Verify(context.Background(), rentest.Sign(t, key, jose.ES256, i.Claims(now)))
	require.NoError(t, err)
	require.Equal(t, Identity{SandboxID: "sbx1", ExecutionID: "exec1"}, identity)
}

func TestVerifierRefuses(t *testing.T) {
	key := rentest.NewKey(t, "k1")
	i := rentest.NewIssuer(t, key)
	now := time.Now()
	v := newVerifier(i, &now)
	with := func(change func(*rentest.Claims)) string {
		claims := i.Claims(now)
		change(&claims)
		return rentest.Sign(t, key, jose.ES256, claims)
	}
	hmac := jose.JSONWebKey{Key: []byte("0123456789abcdef0123456789abcdef"), KeyID: "k1"}

	for name, token := range map[string]string{
		"another audience":                 with(func(c *rentest.Claims) { c.Audience = jwt.Audience{"https://prod.ren"} }),
		"another issuer":                   with(func(c *rentest.Claims) { c.Issuer = "https://evil.test" }),
		"expired":                          rentest.Sign(t, key, jose.ES256, i.Claims(now.Add(-time.Hour))),
		"not valid yet":                    rentest.Sign(t, key, jose.ES256, i.Claims(now.Add(time.Hour))),
		"another project":                  with(func(c *rentest.Claims) { c.Subject = i.Subject("project-2", "sbx1", "exec1") }),
		"claims that differ from sub":      with(func(c *rentest.Claims) { c.SandboxID = "sbx2" }),
		"no sandbox id":                    with(func(c *rentest.Claims) { c.SandboxID = "" }),
		"a key the issuer did not publish": rentest.Sign(t, rentest.NewKey(t, "k1"), jose.ES256, i.Claims(now)),
		"HS256":                            rentest.Sign(t, hmac, jose.HS256, i.Claims(now)),
		"not a token":                      "ren:GITHUB",
	} {
		t.Run(name, func(t *testing.T) {
			_, err := v.Verify(context.Background(), token)
			require.Error(t, err)
		})
	}
}

// E2B can add a key at any time. A token with an unknown key id loads the
// keys again, at most once per reload period, so tokens with made-up key ids
// do not make the egress call E2B on each request.
func TestVerifierLoadsKeysAgainForAnUnknownKeyID(t *testing.T) {
	first := rentest.NewKey(t, "k1")
	second := rentest.NewKey(t, "k2")
	i := rentest.NewIssuer(t, first)
	now := time.Now()
	v := newVerifier(i, &now)

	_, err := v.Verify(context.Background(), rentest.Sign(t, first, jose.ES256, i.Claims(now)))
	require.NoError(t, err)
	require.Equal(t, int32(1), i.Loads())

	now = now.Add(keyReload)
	i.Publish(first, second)
	_, err = v.Verify(context.Background(), rentest.Sign(t, second, jose.ES256, i.Claims(now)))
	require.NoError(t, err)
	require.Equal(t, int32(2), i.Loads())

	unknown := rentest.NewKey(t, "k3")
	for range 3 {
		_, err = v.Verify(context.Background(), rentest.Sign(t, unknown, jose.ES256, i.Claims(now)))
		require.Error(t, err)
	}
	require.Equal(t, int32(2), i.Loads())
}
