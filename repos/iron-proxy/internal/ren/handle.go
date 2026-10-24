package ren

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// Deny is the response for every refusal: 403, the reason in x-ren-egress,
// and a JSON body that names the label, so the agent can call ren_connect
// (README C42).
func Deny(reason, label string) *http.Response {
	body := map[string]string{"error": "ren_" + reason}
	if label != "" {
		body["label"] = label
		body["hint"] = "call ren_connect"
	}
	encoded, _ := json.Marshal(body) // a string map always encodes
	return &http.Response{
		StatusCode:    http.StatusForbidden,
		Status:        "403 Forbidden",
		Proto:         "HTTP/1.1",
		ProtoMajor:    1,
		ProtoMinor:    1,
		Header:        http.Header{"Content-Type": {"application/json"}, "X-Ren-Egress": {reason}},
		Body:          io.NopCloser(bytes.NewReader(encoded)),
		ContentLength: int64(len(encoded)),
	}
}

// Handle runs Ren's step for one request of an authenticated login. It
// returns a response to send instead of forwarding, or the upstream URL of
// a route op, or neither. A request that still holds a placeholder after the
// ops is never forwarded (README C42).
func (c *Client) Handle(ctx context.Context, req *http.Request, login string) (*http.Response, *url.URL) {
	stripRenHeaders(req)
	body, err := readBody(req)
	if err != nil {
		return Deny("bad_request", ""), nil
	}
	host, portText, err := net.SplitHostPort(req.Host)
	if err != nil {
		host = req.Host
		portText = "443"
		if req.TLS == nil {
			portText = "80"
		}
	}
	port, _ := strconv.Atoi(portText) // a host:port from net/http has a numeric port
	placeholders := findPlaceholders(req, body)
	reply, err := c.Resolve(ctx, Request{
		Login:        login,
		Host:         host,
		Port:         port,
		Method:       req.Method,
		Path:         req.URL.Path,
		Placeholders: placeholders,
	})
	if errors.Is(err, ErrUnavailable) {
		c.logger.Warn("ren is unavailable", slog.String("host", host), slog.String("error", err.Error()))
		return Deny("unavailable", ""), nil
	}
	if !reply.Allow {
		c.logger.Info("ren denied a request", slog.String("host", host), slog.String("reason", reply.Reason), slog.String("label", reply.Label))
		return Deny(reply.Reason, reply.Label), nil
	}
	body, err = apply(req, body, reply.Inject)
	if err != nil {
		c.logger.Warn("ren op could not apply", slog.String("host", host), slog.String("error", err.Error()))
		return Deny("credential_missing", ""), nil
	}
	if left := findPlaceholders(req, body); len(left) > 0 {
		return Deny("credential_missing", left[0][len("ren:"):]), nil
	}
	var upstream *url.URL
	for _, op := range reply.Inject {
		if op.Op == "route" {
			upstream, err = routeTarget(req, op.Upstream)
			if err != nil {
				return Deny("credential_missing", ""), nil
			}
		}
	}
	return nil, upstream
}

// ServeControl serves Ren's calls to this egress over mTLS: invalidate and
// health. It returns when ctx ends.
func (c *Client) ServeControl(ctx context.Context) error {
	pool, err := loadPool(c.cfg.CACert)
	if err != nil {
		return err
	}
	certFile, keyFile := c.cfg.ControlCert, c.cfg.ControlKey
	if certFile == "" {
		certFile, keyFile = c.cfg.Cert, c.cfg.Key
	}
	cert, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		return fmt.Errorf("ren: load control certificate: %w", err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /egress/v1/invalidate", func(w http.ResponseWriter, r *http.Request) {
		var selector Selector
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&selector); err != nil {
			http.Error(w, "bad selector", http.StatusBadRequest)
			return
		}
		dropped := c.Invalidate(selector)
		c.logger.Info("ren invalidated answers", slog.Int("dropped", dropped), slog.String("label", selector.Label), slog.String("workload", selector.Workload))
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /egress/v1/health", func(w http.ResponseWriter, r *http.Request) {
		if err := c.Health(r.Context()); err != nil {
			http.Error(w, err.Error(), http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write([]byte("ok")) // the caller may have gone
	})
	server := &http.Server{
		Addr:              c.cfg.ControlListen,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		TLSConfig: &tls.Config{
			Certificates: []tls.Certificate{cert},
			ClientCAs:    pool,
			ClientAuth:   tls.RequireAndVerifyClientCert,
			MinVersion:   tls.VersionTLS12,
		},
	}
	errc := make(chan error, 1)
	go func() { errc <- server.ListenAndServeTLS("", "") }()
	select {
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return server.Shutdown(shutdown)
	case err := <-errc:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}
