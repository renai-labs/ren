package ren

import (
	"bytes"
	"encoding/base64"
	"net/http"
	"net/url"
	"testing"

	"github.com/stretchr/testify/require"
)

func newRequest(t *testing.T, method, rawURL string, body []byte, contentType string) *http.Request {
	t.Helper()
	req, err := http.NewRequest(method, rawURL, bytes.NewReader(body))
	require.NoError(t, err)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	return req
}

func TestFindPlaceholders(t *testing.T) {
	basic := "Basic " + base64.StdEncoding.EncodeToString([]byte("x-access-token:ren:GITHUB"))
	cases := []struct {
		name  string
		build func(t *testing.T) *http.Request
		want  []string
	}{
		{
			name: "raw header",
			build: func(t *testing.T) *http.Request {
				req := newRequest(t, "GET", "https://api.stripe.com/v1", nil, "")
				req.Header.Set("Authorization", "Bearer ren:STRIPE_API_KEY")
				return req
			},
			want: []string{"ren:STRIPE_API_KEY"},
		},
		{
			name: "inside a Basic header",
			build: func(t *testing.T) *http.Request {
				req := newRequest(t, "GET", "https://github.com/acme/repo.git/info/refs", nil, "")
				req.Header.Set("Authorization", basic)
				return req
			},
			want: []string{"ren:GITHUB"},
		},
		{
			name: "percent-encoded query",
			build: func(t *testing.T) *http.Request {
				return newRequest(t, "GET", "https://api.example.com/v1?key=ren%3AEXAMPLE_KEY", nil, "")
			},
			want: []string{"ren:EXAMPLE_KEY"},
		},
		{
			name: "path and a field placeholder",
			build: func(t *testing.T) *http.Request {
				return newRequest(t, "GET", "https://api.telegram.org/botren:MCP_TELEGRAM.token/getMe", nil, "")
			},
			want: []string{"ren:MCP_TELEGRAM.token"},
		},
		{
			name: "never in a body",
			build: func(t *testing.T) *http.Request {
				return newRequest(t, "POST", "https://api.example.com/v1", []byte(`{"api_key":"ren:EXAMPLE_KEY"}`), "application/json")
			},
			want: nil,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			require.Equal(t, tc.want, findPlaceholders(tc.build(t)))
		})
	}
}

func TestApplyEncodesForEachLocation(t *testing.T) {
	value := `a&b/c"d`
	req := newRequest(t, "POST", "https://api.example.com/v1/ren:KEY?token=ren:KEY", nil, "")
	req.Header.Set("Authorization", "Bearer ren:KEY")
	require.NoError(t, apply(req, []Op{{Op: "replace", Placeholder: "ren:KEY", Value: value, In: []string{"header", "query", "path"}}}))

	require.Equal(t, "Bearer "+value, req.Header.Get("Authorization"))
	query, err := url.ParseQuery(req.URL.RawQuery)
	require.NoError(t, err)
	require.Equal(t, value, query.Get("token"))
	require.Equal(t, "token="+url.QueryEscape(value), req.URL.RawQuery)
	require.Equal(t, "/v1/"+value, req.URL.Path)
	require.Equal(t, "/v1/"+url.PathEscape(value), req.URL.EscapedPath())
	require.Empty(t, findPlaceholders(req))
}

func TestApplyReEncodesBasic(t *testing.T) {
	req := newRequest(t, "GET", "https://github.com/acme/repo.git", nil, "")
	req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte("x-access-token:ren:GITHUB")))
	require.NoError(t, apply(req, []Op{{Op: "replace", Placeholder: "ren:GITHUB", Value: "ghs_real", In: []string{"header"}}}))
	require.Equal(t, "Basic "+base64.StdEncoding.EncodeToString([]byte("x-access-token:ghs_real")), req.Header.Get("Authorization"))
}

func TestSetHeaderAndStripRenHeaders(t *testing.T) {
	req := newRequest(t, "GET", "https://mcp.linear.app/mcp", nil, "")
	req.Header.Set("X-Ren-Revision", "3")
	stripRenHeaders(req)
	require.NoError(t, apply(req, []Op{{Op: "setHeader", Name: "Authorization", Value: "Bearer lin_real"}}))
	require.Equal(t, "Bearer lin_real", req.Header.Get("Authorization"))
	require.Empty(t, req.Header.Get("X-Ren-Revision"))
}

func TestRoute(t *testing.T) {
	req := newRequest(t, "POST", "https://ren.internal/host/pull?x=1", nil, "")
	target, err := routeTarget(req, "http://ren-server:4000/base")
	require.NoError(t, err)
	require.Equal(t, "http://ren-server:4000/base/host/pull?x=1", target.String())
}

func TestRouteRemovesItsPlaceholder(t *testing.T) {
	cases := []struct{ name, url string }{
		{"raw", "https://backend.composio.dev/ren:MCP_GMAIL/v3/mcp/abc?x=1"},
		{"encoded", "https://backend.composio.dev/ren%3AMCP_GMAIL/v3/mcp/abc?x=1"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := newRequest(t, "POST", tc.url, nil, "")
			require.NoError(t, apply(req, []Op{{Op: "route", Upstream: "https://backend.composio.dev/tool_router/trs_1/mcp", Placeholder: "ren:MCP_GMAIL"}}))
			require.Empty(t, findPlaceholders(req))
			target, err := routeTarget(req, "https://backend.composio.dev/tool_router/trs_1/mcp")
			require.NoError(t, err)
			require.Equal(t, "https://backend.composio.dev/tool_router/trs_1/mcp/v3/mcp/abc?x=1", target.String())
		})
	}
}
