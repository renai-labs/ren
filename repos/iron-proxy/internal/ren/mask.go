package ren

import (
	"bytes"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// minMaskLength keeps short values, which also occur in ordinary text, out of
// the masks.
const minMaskLength = 8

type mask struct {
	value string
	shown string
}

// masksOf lists each injected value with the text shown in its place: the
// placeholder of a replace op, or "ren:MASKED" for a header Ren set. A
// header value such as "Bearer <token>" is masked whole and by its token.
func masksOf(ops []Op) []mask {
	var out []mask
	add := func(value, shown string) {
		if len(value) < minMaskLength {
			return
		}
		for _, form := range []string{value, url.QueryEscape(value), url.PathEscape(value), jsonEscaped(value)} {
			out = append(out, mask{value: form, shown: shown})
		}
	}
	for _, op := range ops {
		switch op.Op {
		case "replace":
			add(op.Value, op.Placeholder)
		case "setHeader":
			add(op.Value, "ren:MASKED")
			if _, token, ok := strings.Cut(op.Value, " "); ok {
				add(token, "ren:MASKED")
			}
		}
	}
	return out
}

func (a *Applied) replace(text string) string {
	for _, m := range a.masks {
		text = strings.ReplaceAll(text, m.value, m.shown)
	}
	return text
}

// Mask hides each injected value that comes back in the response headers
// and in a body of at most maxBodyBytes. A stream (server-sent events) or a
// larger or encoded body passes unchanged (README §6.3 rule 11).
func (a *Applied) Mask(resp *http.Response) {
	if a == nil || len(a.masks) == 0 {
		return
	}
	for name, values := range resp.Header {
		for i, value := range values {
			resp.Header[name][i] = a.replace(value)
		}
	}
	encoded := resp.Header.Get("Content-Encoding") != "" && !strings.EqualFold(resp.Header.Get("Content-Encoding"), "identity")
	if resp.Body == nil || encoded || strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") || resp.ContentLength > maxBodyBytes {
		return
	}
	prefix, err := io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes+1))
	if err != nil || len(prefix) > maxBodyBytes {
		resp.Body = struct {
			io.Reader
			io.Closer
		}{io.MultiReader(bytes.NewReader(prefix), resp.Body), resp.Body}
		return
	}
	masked := []byte(a.replace(string(prefix)))
	resp.Body = io.NopCloser(bytes.NewReader(masked))
	resp.ContentLength = int64(len(masked))
	resp.Header.Set("Content-Length", strconv.Itoa(len(masked)))
}
