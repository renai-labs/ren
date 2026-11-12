package proxy

import (
	"crypto/tls"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/ironsh/iron-proxy/internal/ren"
	"github.com/ironsh/iron-proxy/internal/transform"
)

// Ren: fork change 14. The identity entry takes the credential requests that
// a sandbox's forwarder sends with X-Ren-Target. E2B adds X-Ren-Identity
// outside the sandbox: a token that names the sandbox execution.
const (
	identityHeader = "X-Ren-Identity"
	targetHeader   = "X-Ren-Target"
)

// handleIdentity checks the token, removes both headers before any other
// step, and serves the request as if it came through a tunnel to its target.
func (p *Proxy) handleIdentity(w http.ResponseWriter, r *http.Request) {
	identities := r.Header.Values(identityHeader)
	targets := r.Header.Values(targetHeader)
	r.Header.Del(identityHeader)
	r.Header.Del(targetHeader)

	// E2B replaces a header that the sandbox sends, so two values come only
	// from a bug or a change at E2B.
	if len(identities) != 1 || !strings.HasPrefix(identities[0], "Bearer ") {
		p.writeResponse(w, ren.Deny("unknown_workload", ""))
		return
	}
	identity, err := p.verifier.Verify(r.Context(), strings.TrimPrefix(identities[0], "Bearer "))
	if err != nil {
		p.logger.Warn("ren identity refused", slog.String("remote_addr", r.RemoteAddr), slog.String("error", err.Error()))
		p.writeResponse(w, ren.Deny("unknown_workload", ""))
		return
	}

	if len(targets) != 1 {
		http.Error(w, "one X-Ren-Target is required", http.StatusBadRequest)
		return
	}
	target, err := url.Parse(targets[0])
	if err != nil || (target.Scheme != "https" && target.Scheme != "http") || target.Hostname() == "" || target.User != nil {
		http.Error(w, "X-Ren-Target is not an http or https URL", http.StatusBadRequest)
		return
	}
	port := target.Port()
	if port == "" {
		port = map[string]string{"https": "443", "http": "80"}[target.Scheme]
	}

	r.Host = target.Host
	r.URL = &url.URL{Path: target.Path, RawPath: target.RawPath, RawQuery: target.RawQuery}
	// handleHTTP takes the scheme and the SNI from the TLS state: here they
	// are the target's, not the entry's.
	r.TLS = nil
	if target.Scheme == "https" {
		r.TLS = &tls.ConnectionState{ServerName: target.Hostname()}
	}
	p.handleHTTP(w, r, &transform.TunnelInfo{
		Target:      net.JoinHostPort(target.Hostname(), port),
		SandboxID:   identity.SandboxID,
		ExecutionID: identity.ExecutionID,
	})
}
