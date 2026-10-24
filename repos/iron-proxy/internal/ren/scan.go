// Package ren connects iron-proxy to Ren: it finds Ren placeholders
// (ren:<LABEL>) in a request, asks Ren what the request gets, and carries
// out the ops in Ren's reply. It knows no credential type; only the ops
// replace, setHeader and route.
package ren

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// maxBodyBytes caps the response bodies the egress reads to mask injected
// values (README §6.3 rule 11).
const maxBodyBytes = 1 << 20

var placeholderPattern = regexp.MustCompile(`ren:[A-Z_][A-Z0-9_]*(?:\.[a-z][A-Za-z0-9_]*)?`)

// Op is one change Ren asks for. Value is a secret; never log it.
type Op struct {
	Op          string   `json:"op"`
	Placeholder string   `json:"placeholder,omitempty"`
	Value       string   `json:"value,omitempty"`
	In          []string `json:"in,omitempty"`
	Name        string   `json:"name,omitempty"`
	Upstream    string   `json:"upstream,omitempty"`
}

// SupportedOps are the ops this egress carries out. Ren sends no other op
// (README C41).
var SupportedOps = []string{"replace", "setHeader", "route"}

func decodeBasic(value string) (string, bool) {
	after, ok := strings.CutPrefix(value, "Basic ")
	if !ok {
		return "", false
	}
	decoded, err := base64.StdEncoding.DecodeString(after)
	if err != nil {
		return "", false
	}
	return string(decoded), true
}

// texts lists every place where a placeholder can sit, decoded the way a
// client encodes it: raw, percent-encoded, and inside a Basic header. A body
// is never searched: its text is content, such as a prompt that mentions a
// placeholder, not a request for a credential.
func texts(req *http.Request) []string {
	var out []string
	for name, values := range req.Header {
		for _, value := range values {
			out = append(out, value)
			if unescaped, err := url.QueryUnescape(value); err == nil {
				out = append(out, unescaped)
			}
			if strings.EqualFold(name, "Authorization") {
				if decoded, ok := decodeBasic(value); ok {
					out = append(out, decoded)
				}
			}
		}
	}
	out = append(out, req.URL.Path)
	if query, err := url.ParseQuery(req.URL.RawQuery); err == nil {
		for _, values := range query {
			out = append(out, values...)
		}
	}
	out = append(out, req.URL.RawQuery)
	return out
}

// findPlaceholders returns each distinct placeholder of the request, in the
// order found.
func findPlaceholders(req *http.Request) []string {
	seen := map[string]bool{}
	var found []string
	for _, text := range texts(req) {
		for _, match := range placeholderPattern.FindAllString(text, -1) {
			if !seen[match] {
				seen[match] = true
				found = append(found, match)
			}
		}
	}
	return found
}

// stripRenHeaders removes the x-ren-* headers that Ren's plugin adds for
// its own bookkeeping, so they never reach an upstream (README C52).
func stripRenHeaders(req *http.Request) {
	for name := range req.Header {
		if strings.HasPrefix(strings.ToLower(name), "x-ren-") {
			req.Header.Del(name)
		}
	}
}

func jsonEscaped(value string) string {
	encoded, _ := json.Marshal(value) // a string always encodes
	return string(encoded[1 : len(encoded)-1])
}

func replaceQuery(raw, placeholder, value string) (string, bool) {
	if raw == "" {
		return raw, false
	}
	values, err := url.ParseQuery(raw)
	if err != nil {
		return raw, false
	}
	changed := false
	for key, list := range values {
		for i, item := range list {
			if strings.Contains(item, placeholder) {
				values[key][i] = strings.ReplaceAll(item, placeholder, value)
				changed = true
			}
		}
	}
	if !changed {
		return raw, false
	}
	return values.Encode(), true
}

func replaceIn(req *http.Request, op Op) {
	for _, location := range op.In {
		switch location {
		case "header":
			for name, values := range req.Header {
				for i, value := range values {
					if decoded, ok := decodeBasic(value); ok && strings.EqualFold(name, "Authorization") && strings.Contains(decoded, op.Placeholder) {
						replaced := strings.ReplaceAll(decoded, op.Placeholder, op.Value)
						req.Header[name][i] = "Basic " + base64.StdEncoding.EncodeToString([]byte(replaced))
						continue
					}
					req.Header[name][i] = strings.ReplaceAll(value, op.Placeholder, op.Value)
				}
			}
		case "query":
			if replaced, ok := replaceQuery(req.URL.RawQuery, op.Placeholder, op.Value); ok {
				req.URL.RawQuery = replaced
			}
		case "path":
			if strings.Contains(req.URL.Path, op.Placeholder) {
				escaped := strings.ReplaceAll(req.URL.EscapedPath(), url.PathEscape(op.Placeholder), url.PathEscape(op.Value))
				escaped = strings.ReplaceAll(escaped, op.Placeholder, url.PathEscape(op.Value))
				req.URL.Path = strings.ReplaceAll(req.URL.Path, op.Placeholder, op.Value)
				req.URL.RawPath = escaped
			}
		}
	}
}

// apply carries out Ren's ops on the request. The route op is applied by the
// caller through routeTarget.
func apply(req *http.Request, ops []Op) error {
	for _, op := range ops {
		switch op.Op {
		case "replace":
			replaceIn(req, op)
		case "setHeader":
			if strings.ContainsAny(op.Value, "\r\n") {
				return fmt.Errorf("header %s: value holds a line break", op.Name)
			}
			req.Header.Set(op.Name, op.Value)
		case "route":
			removeFirstSegment(req, op.Placeholder)
		default:
			return fmt.Errorf("unknown op %q", op.Op)
		}
	}
	return nil
}

// removeFirstSegment drops the first path segment when it is the route's
// placeholder, raw or percent-encoded, so the workload can name a credential
// on the provider's real host (fork change 10).
func removeFirstSegment(req *http.Request, placeholder string) {
	if placeholder == "" {
		return
	}
	escaped := strings.TrimPrefix(req.URL.EscapedPath(), "/")
	first, rest, _ := strings.Cut(escaped, "/")
	if decoded, err := url.PathUnescape(first); err != nil || decoded != placeholder {
		return
	}
	rest = "/" + rest
	path, err := url.PathUnescape(rest)
	if err != nil {
		return
	}
	req.URL.Path = path
	req.URL.RawPath = rest
}

// routeTarget is the upstream URL of a route op: the op's upstream, with the
// request's path appended and its query kept.
func routeTarget(req *http.Request, upstream string) (*url.URL, error) {
	base, err := url.Parse(upstream)
	if err != nil {
		return nil, fmt.Errorf("parse route upstream: %w", err)
	}
	target := *base
	target.Path = strings.TrimSuffix(base.Path, "/") + req.URL.Path
	target.RawPath = ""
	if req.URL.RawPath != "" {
		target.RawPath = strings.TrimSuffix(base.EscapedPath(), "/") + req.URL.RawPath
	}
	target.RawQuery = req.URL.RawQuery
	return &target, nil
}
