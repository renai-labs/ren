package ren

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func response(body, contentType string) *http.Response {
	return &http.Response{
		StatusCode:    http.StatusNotFound,
		Header:        http.Header{"Content-Type": {contentType}},
		Body:          io.NopCloser(strings.NewReader(body)),
		ContentLength: int64(len(body)),
	}
}

func TestMaskHidesAnInjectedValueThatComesBack(t *testing.T) {
	client, h, _ := newClient(t)
	h.answer.Store(Reply{Allow: true, Workload: "brain:brn_1:1", Inject: []Op{
		{Op: "replace", Placeholder: "ren:STRIPE_API_KEY", Value: "sk_live_secret_1", In: []string{"header"}},
		{Op: "setHeader", Name: "Authorization", Value: "Bearer tok_secret_2"},
	}})
	req := newRequest(t, "GET", "https://api.stripe.com/v1/customers/x", nil, "")
	req.Host = "api.stripe.com"
	req.Header.Set("X-Key", "ren:STRIPE_API_KEY")
	req.Header.Set("Accept-Encoding", "gzip")
	denied, applied := client.Handle(t.Context(), req, "ren-a")
	require.Nil(t, denied)
	require.Empty(t, req.Header.Get("Accept-Encoding"), "an upstream answers in plain text, so the egress can read what comes back")

	resp := response(`{"error":"No such customer: 'sk_live_secret_1'","echo":"tok_secret_2","path":"sk_live_secret_1"}`, "application/json")
	resp.Header.Set("X-Echo", "Bearer tok_secret_2")
	applied.Mask(resp)
	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	require.NotContains(t, string(body), "sk_live_secret_1")
	require.NotContains(t, string(body), "tok_secret_2")
	require.Contains(t, string(body), "ren:STRIPE_API_KEY")
	require.Equal(t, int64(len(body)), resp.ContentLength)
	require.NotContains(t, resp.Header.Get("X-Echo"), "tok_secret_2")
}

func TestMaskLeavesAStreamUnread(t *testing.T) {
	client, h, _ := newClient(t)
	h.answer.Store(Reply{Allow: true, Workload: "brain:brn_1:1", Inject: []Op{
		{Op: "replace", Placeholder: "ren:MODELS", Value: "sk-ant-secret", In: []string{"header"}},
	}})
	req := newRequest(t, "POST", "https://api.anthropic.com/v1/messages", nil, "")
	req.Host = "api.anthropic.com"
	req.Header.Set("X-Api-Key", "ren:MODELS")
	_, applied := client.Handle(t.Context(), req, "ren-a")
	resp := response("data: sk-ant-secret\n\n", "text/event-stream")
	applied.Mask(resp)
	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	require.Equal(t, "data: sk-ant-secret\n\n", string(body), "a stream is not buffered to mask it (README §6.3 rule 11)")
}

func TestMaskHidesTheAWSKeysThatComeBack(t *testing.T) {
	client, h, _ := newClient(t)
	h.answer.Store(Reply{Allow: true, Workload: "brain:brn_1:1", Inject: []Op{
		{Op: "awsSign", AccessKeyID: "ASIAREALKEY", SecretAccessKey: "real-secret-access-key", SessionToken: "real-session-token"},
	}})
	req := newRequest(t, "GET", "https://ren-drives.s3.us-east-1.amazonaws.com/?list-type=2", nil, "")
	req.Host = "ren-drives.s3.us-east-1.amazonaws.com"
	req.Header.Set("Authorization", "AWS4-HMAC-SHA256 Credential=ren:DRIVE/20261028/us-east-1/s3/aws4_request, SignedHeaders=host, Signature=0")
	req.Header.Set("X-Amz-Content-Sha256", emptySHA256)
	denied, applied := client.Handle(t.Context(), req, "ren-a")
	require.Nil(t, denied)

	resp := response(`<Error><Code>InvalidToken</Code><Token-0>real-session-token</Token-0><Key>real-secret-access-key</Key></Error>`, "application/xml")
	resp.Header.Set("X-Amz-Echo", "real-session-token")
	applied.Mask(resp)
	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	require.NotContains(t, string(body), "real-session-token")
	require.NotContains(t, string(body), "real-secret-access-key")
	require.Equal(t, "ren:MASKED", resp.Header.Get("X-Amz-Echo"))
}
