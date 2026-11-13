// Package forward is the forwarder that runs in a sandbox (Ren fork
// change 15). nf_tables sends the sandbox's outbound TCP to it. It sends each
// credential request (one with a ren: placeholder) to the egress's identity
// entry, and every other request and connection to its target
// (specs/runtime/credentials/egress-split.md §3.1).
package forward

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/ironsh/iron-proxy/internal/certcache"
	"github.com/ironsh/iron-proxy/internal/proxy"
	"github.com/ironsh/iron-proxy/internal/ren"
	"golang.org/x/net/http2"
)

// Config configures a forwarder.
type Config struct {
	// Egress is the URL of the egress's identity entry. The sandbox's
	// provider adds the sandbox's identity to the requests to its host.
	Egress *url.URL
	// Certs signs the certificates the forwarder shows to programs, with a CA
	// that only this sandbox trusts.
	Certs *certcache.Cache
	// Bundle is the trust bundle for targets and the egress. The provider can
	// add its own CA to it at a start and at each resume.
	Bundle string
	// Target says where a redirected connection was going (SO_ORIGINAL_DST).
	Target func(net.Conn) (string, error)
	Logger *slog.Logger
}

// Forwarder decides per request where it goes.
type Forwarder struct {
	cfg    Config
	trust  *trust
	egress *transports
}

const peekTimeout = 10 * time.Second

// New builds a forwarder.
func New(cfg Config) *Forwarder {
	t := &trust{path: cfg.Bundle}
	return &Forwarder{
		cfg:   cfg,
		trust: t,
		egress: &transports{trust: t, build: func(pool *x509.CertPool) *http.Transport {
			return &http.Transport{
				TLSClientConfig:     &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12},
				ForceAttemptHTTP2:   true,
				MaxIdleConnsPerHost: 32,
				IdleConnTimeout:     90 * time.Second,
			}
		}},
	}
}

// Serve takes connections until ln closes.
func (f *Forwarder) Serve(ln net.Listener) error {
	for {
		conn, err := ln.Accept()
		if err != nil {
			return err
		}
		go f.handle(conn)
	}
}

func (f *Forwarder) handle(conn net.Conn) {
	defer conn.Close()
	target, err := f.cfg.Target(conn)
	// A connection to the forwarder's own address was not redirected: a
	// program, or a caller from outside the sandbox, dialed it.
	if err != nil || target == conn.LocalAddr().String() {
		return
	}
	reader := bufio.NewReader(conn)
	_ = conn.SetReadDeadline(time.Now().Add(peekTimeout)) // a failed deadline only makes the peek wait longer
	first, err := reader.Peek(1)
	_ = conn.SetReadDeadline(time.Time{})
	if err != nil {
		return
	}
	peeked := &peekedConn{Conn: conn, r: reader}
	switch {
	case first[0] == 0x16:
		sni, hello, err := proxy.PeekSNI(peeked, peekTimeout)
		replay := &peekedConn{Conn: conn, r: bufio.NewReader(io.MultiReader(bytes.NewReader(hello), reader))}
		if err != nil || sni == "" {
			f.pipe(replay, target)
			return
		}
		cert, err := f.cfg.Certs.GetOrCreate(sni)
		if err != nil {
			f.cfg.Logger.Warn("forward: no certificate", slog.String("sni", sni), slog.String("error", err.Error()))
			return
		}
		f.serveHTTP(tls.Server(replay, &tls.Config{Certificates: []tls.Certificate{*cert}, NextProtos: []string{"h2", "http/1.1"}}), "https", target)
	case first[0] >= 'A' && first[0] <= 'Z':
		f.serveHTTP(peeked, "http", target)
	default:
		f.pipe(peeked, target)
	}
}

// pipe copies bytes both ways between conn and its target.
func (f *Forwarder) pipe(conn net.Conn, target string) {
	upstream, err := net.DialTimeout("tcp", target, 30*time.Second)
	if err != nil {
		return
	}
	defer upstream.Close()
	done := make(chan struct{}, 2)
	go func() {
		_, _ = io.Copy(upstream, conn) // either side may close first
		closeWrite(upstream)
		done <- struct{}{}
	}()
	go func() {
		_, _ = io.Copy(conn, upstream) // as above
		closeWrite(conn)
		done <- struct{}{}
	}()
	<-done
	<-done
}

func closeWrite(conn net.Conn) {
	if tcp, ok := conn.(interface{ CloseWrite() error }); ok {
		_ = tcp.CloseWrite() // the peer may be gone
	}
}

// serveHTTP serves the requests of one connection. A plain request goes to
// the connection's target address; a credential request goes to the egress.
func (f *Forwarder) serveHTTP(conn net.Conn, scheme, target string) {
	_, port, _ := net.SplitHostPort(target) // target comes from SO_ORIGINAL_DST, always host:port
	direct := &transports{trust: f.trust, build: func(pool *x509.CertPool) *http.Transport {
		return &http.Transport{
			DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				return (&net.Dialer{Timeout: 30 * time.Second}).DialContext(ctx, "tcp", target)
			},
			TLSClientConfig:   &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12},
			ForceAttemptHTTP2: true,
		}
	}}
	defer direct.CloseIdleConnections()
	handler := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			for name := range pr.Out.Header {
				if strings.HasPrefix(strings.ToLower(name), "x-ren-") {
					pr.Out.Header.Del(name)
				}
			}
			destination := &url.URL{Scheme: scheme, Host: withPort(pr.In.Host, scheme, port), Path: pr.In.URL.Path, RawPath: pr.In.URL.RawPath, RawQuery: pr.In.URL.RawQuery}
			if ren.HasPlaceholder(pr.In) {
				pr.Out.Header.Set("X-Ren-Target", destination.String())
				pr.Out.URL = &url.URL{Scheme: f.cfg.Egress.Scheme, Host: f.cfg.Egress.Host, Path: "/"}
				pr.Out.Host = f.cfg.Egress.Host
				return
			}
			pr.Out.URL = destination
			pr.Out.Host = pr.In.Host
		},
		Transport: roundTripper(func(req *http.Request) (*http.Response, error) {
			if req.Header.Get("X-Ren-Target") != "" {
				return f.egress.RoundTrip(req)
			}
			return direct.RoundTrip(req)
		}),
		FlushInterval: -1,
		ErrorLog:      slog.NewLogLogger(f.cfg.Logger.Handler(), slog.LevelWarn),
	}
	// A hijacked connection (a WebSocket) belongs to its handler until the
	// handler returns.
	var active sync.WaitGroup
	server := &http.Server{
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			active.Add(1)
			defer active.Done()
			handler.ServeHTTP(w, r)
		}),
		ReadHeaderTimeout: 30 * time.Second,
	}
	_ = http2.ConfigureServer(server, &http2.Server{}) // zero config never errors
	closed := make(chan struct{})
	var once sync.Once
	server.ConnState = func(_ net.Conn, state http.ConnState) {
		switch state {
		case http.StateClosed:
			once.Do(func() { close(closed) })
		case http.StateHijacked:
			go func() {
				active.Wait()
				once.Do(func() { close(closed) })
			}()
		}
	}
	ln := &oneConnListener{conn: conn, done: make(chan struct{})}
	go func() { _ = server.Serve(ln) }() // Serve ends when ln closes below
	<-closed
	_ = ln.Close()
}

// withPort keeps the Host header's host and adds the connection's port when
// the header has none and the port is not the scheme's default.
func withPort(host, scheme, port string) string {
	if _, _, err := net.SplitHostPort(host); err == nil {
		return host
	}
	if (scheme == "https" && port == "443") || (scheme == "http" && port == "80") {
		return host
	}
	return net.JoinHostPort(strings.Trim(host, "[]"), port)
}

type roundTripper func(*http.Request) (*http.Response, error)

func (r roundTripper) RoundTrip(req *http.Request) (*http.Response, error) { return r(req) }

// peekedConn reads through r, which holds the bytes already peeked.
type peekedConn struct {
	net.Conn
	r io.Reader
}

func (c *peekedConn) Read(p []byte) (int, error) { return c.r.Read(p) }

// oneConnListener gives one connection to http.Server.Serve, then blocks
// until it is closed.
type oneConnListener struct {
	conn net.Conn
	once sync.Once
	done chan struct{}
	used bool
	mu   sync.Mutex
}

func (l *oneConnListener) Accept() (net.Conn, error) {
	l.mu.Lock()
	if !l.used {
		l.used = true
		l.mu.Unlock()
		return l.conn, nil
	}
	l.mu.Unlock()
	<-l.done
	return nil, net.ErrClosed
}

func (l *oneConnListener) Close() error {
	l.once.Do(func() { close(l.done) })
	return nil
}

func (l *oneConnListener) Addr() net.Addr { return l.conn.LocalAddr() }
