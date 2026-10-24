// Package ren connects iron-proxy to Ren: it finds Ren placeholders
// (ren:<LABEL>) in a request, asks Ren what the request gets, and carries
// out the ops in Ren's reply. It knows no credential type; only the ops
// replace, setHeader and route.
package ren

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

// maxBodyBytes caps the bodies Ren reads to find and replace placeholders.
// Larger bodies and other content types stream unchanged (README C43).
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

func bodyKind(req *http.Request) string {
	mediaType, _, err := mime.ParseMediaType(req.Header.Get("Content-Type"))
	if err != nil {
		return ""
	}
	switch {
	case mediaType == "application/json" || strings.HasSuffix(mediaType, "+json"):
		return "json"
	case mediaType == "application/x-www-form-urlencoded":
		return "form"
	}
	return ""
}

// readBody returns the request body when Ren may search it: a JSON or form
// body of at most maxBodyBytes. Otherwise it returns nil and leaves the body
// to stream unchanged.
func readBody(req *http.Request) ([]byte, error) {
	if req.Body == nil || req.Body == http.NoBody || bodyKind(req) == "" || req.ContentLength > maxBodyBytes {
		return nil, nil
	}
	prefix, err := io.ReadAll(io.LimitReader(req.Body, maxBodyBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read request body: %w", err)
	}
	if len(prefix) > maxBodyBytes {
		req.Body = struct {
			io.Reader
			io.Closer
		}{io.MultiReader(bytes.NewReader(prefix), req.Body), req.Body}
		return nil, nil
	}
	setBody(req, prefix)
	return prefix, nil
}

func setBody(req *http.Request, body []byte) {
	req.Body = io.NopCloser(bytes.NewReader(body))
	req.ContentLength = int64(len(body))
	req.Header.Set("Content-Length", strconv.Itoa(len(body)))
}

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
// client encodes it: raw, percent-encoded, and inside a Basic header.
func texts(req *http.Request, body []byte) []string {
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
	if body != nil {
		out = append(out, string(body))
		if bodyKind(req) == "form" {
			if form, err := url.ParseQuery(string(body)); err == nil {
				for _, values := range form {
					out = append(out, values...)
				}
			}
		}
	}
	return out
}

// findPlaceholders returns each distinct placeholder of the request, in the
// order found.
func findPlaceholders(req *http.Request, body []byte) []string {
	seen := map[string]bool{}
	var found []string
	for _, text := range texts(req, body) {
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

func replaceIn(req *http.Request, body []byte, op Op) []byte {
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
		case "body":
			if body == nil {
				continue
			}
			switch bodyKind(req) {
			case "json":
				body = bytes.ReplaceAll(body, []byte(op.Placeholder), []byte(jsonEscaped(op.Value)))
			case "form":
				if replaced, ok := replaceQuery(string(body), op.Placeholder, op.Value); ok {
					body = []byte(replaced)
				}
			}
		}
	}
	return body
}

// apply carries out Ren's ops on the request and returns the new body.
// The route op is applied by the caller through routeTarget.
func apply(req *http.Request, body []byte, ops []Op) ([]byte, error) {
	for _, op := range ops {
		switch op.Op {
		case "replace":
			body = replaceIn(req, body, op)
		case "setHeader":
			if strings.ContainsAny(op.Value, "\r\n") {
				return body, fmt.Errorf("header %s: value holds a line break", op.Name)
			}
			req.Header.Set(op.Name, op.Value)
		case "route":
		default:
			return body, fmt.Errorf("unknown op %q", op.Op)
		}
	}
	if body != nil {
		setBody(req, body)
	}
	return body, nil
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
	target.RawQuery = req.URL.RawQuery
	return &target, nil
}
