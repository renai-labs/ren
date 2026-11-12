package forward

import (
	"bufio"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"io"
	"log/slog"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ironsh/iron-proxy/internal/certcache"
	"github.com/stretchr/testify/require"
)

// world is a forwarder between a program and two servers: the target the
// program dials and the egress's identity entry.
type world struct {
	addr     string
	target   *httptest.Server
	egress   *httptest.Server
	toTarget chan *http.Request
	toEgress chan *http.Request
	program  *http.Client
	dialed   atomic.Value
}

func newCA(t *testing.T) (*x509.Certificate, *ecdsa.PrivateKey) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "sandbox forwarder ca"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign,
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	require.NoError(t, err)
	cert, err := x509.ParseCertificate(der)
	require.NoError(t, err)
	return cert, key
}

func recorder(seen chan *http.Request, answer http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body) // a short read fails the body assertions
		r.Body = io.NopCloser(strings.NewReader(string(body)))
		seen <- r
		if answer != nil {
			answer(w, r)
			return
		}
		_, _ = w.Write([]byte("from " + r.Host)) // the test reads the answer
	}
}

// newWorld starts the servers and the forwarder. Each connection to the
// forwarder was going to dialed, as SO_ORIGINAL_DST would say.
func newWorld(t *testing.T, targetAnswer http.HandlerFunc) *world {
	t.Helper()
	w := &world{toTarget: make(chan *http.Request, 10), toEgress: make(chan *http.Request, 10)}
	w.target = httptest.NewUnstartedServer(recorder(w.toTarget, targetAnswer))
	w.target.EnableHTTP2 = true
	w.target.StartTLS()
	t.Cleanup(w.target.Close)
	w.egress = httptest.NewTLSServer(recorder(w.toEgress, nil))
	t.Cleanup(w.egress.Close)
	w.dialed.Store(w.target.Listener.Addr().String())

	// The trust bundle holds the CA of both test servers, as the sandbox's
	// system bundle holds the public CAs and E2B's CA.
	bundle := filepath.Join(t.TempDir(), "ca-certificates.crt")
	pemOf := func(s *httptest.Server) []byte {
		return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: s.Certificate().Raw})
	}
	require.NoError(t, os.WriteFile(bundle, append(pemOf(w.target), pemOf(w.egress)...), 0o600))

	caCert, caKey := newCA(t)
	certs, err := certcache.NewFromCA(caCert, caKey, 100, time.Hour)
	require.NoError(t, err)
	egressURL, err := url.Parse(w.egress.URL)
	require.NoError(t, err)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	t.Cleanup(func() { _ = ln.Close() })
	w.addr = ln.Addr().String()
	f := New(Config{
		Egress: egressURL,
		Certs:  certs,
		Bundle: bundle,
		Target: func(net.Conn) (string, error) { return w.dialed.Load().(string), nil },
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	go func() { _ = f.Serve(ln) }()

	pool := x509.NewCertPool()
	pool.AddCert(caCert)
	transport := &http.Transport{
		DialContext:       func(context.Context, string, string) (net.Conn, error) { return net.Dial("tcp", w.addr) },
		TLSClientConfig:   &tls.Config{RootCAs: pool},
		ForceAttemptHTTP2: true,
	}
	w.program = &http.Client{Transport: transport}
	return w
}

// The program dials example.com, the name in httptest's certificate.
func (w *world) url(rest string) string {
	_, port, _ := net.SplitHostPort(w.dialed.Load().(string))
	return "https://example.com:" + port + rest
}

func (w *world) do(t *testing.T, req *http.Request) (*http.Response, string) {
	t.Helper()
	resp, err := w.program.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	return resp, string(body)
}

func TestForwarderSendsAPlainRequestToItsTarget(t *testing.T) {
	w := newWorld(t, nil)
	req, err := http.NewRequest("POST", w.url("/v1/items?page=2"), strings.NewReader("payload"))
	require.NoError(t, err)
	req.Header.Set("Authorization", "Bearer real-token-of-the-program")
	req.Header.Set("X-Ren-Target", "https://evil.test/")
	resp, body := w.do(t, req)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Equal(t, 2, resp.ProtoMajor, "the program gets HTTP/2")
	require.Contains(t, body, "from example.com")

	got := <-w.toTarget
	require.Equal(t, "/v1/items?page=2", got.URL.RequestURI())
	require.Equal(t, "Bearer real-token-of-the-program", got.Header.Get("Authorization"))
	require.Empty(t, got.Header.Get("X-Ren-Target"), "a program's x-ren-* header never leaves")
	gotBody, _ := io.ReadAll(got.Body)
	require.Equal(t, "payload", string(gotBody))
	require.Empty(t, w.toEgress, "a plain request does not reach the egress")
}

func TestForwarderSendsACredentialRequestToTheEgress(t *testing.T) {
	for name, place := range map[string]func(*http.Request){
		"header": func(r *http.Request) { r.Header.Set("Authorization", "Bearer ren:GITHUB") },
		"query":  func(r *http.Request) { r.URL.RawQuery = "key=ren:GITHUB" },
		"path":   func(r *http.Request) { r.URL.Path = "/bot/ren:TELEGRAM/send" },
	} {
		t.Run(name, func(t *testing.T) {
			w := newWorld(t, nil)
			req, err := http.NewRequest("POST", w.url("/v1/items"), strings.NewReader("payload"))
			require.NoError(t, err)
			place(req)
			req.Header.Set("X-Ren-Identity", "forged")
			resp, _ := w.do(t, req)
			require.Equal(t, http.StatusOK, resp.StatusCode)

			got := <-w.toEgress
			target, err := url.Parse(got.Header.Get("X-Ren-Target"))
			require.NoError(t, err)
			require.Equal(t, "https", target.Scheme)
			require.Equal(t, strings.TrimPrefix(w.url(""), "https://"), target.Host)
			require.Equal(t, req.URL.RequestURI(), target.RequestURI())
			require.Empty(t, got.Header.Get("X-Ren-Identity"), "E2B adds the identity, never the program")
			gotBody, _ := io.ReadAll(got.Body)
			require.Equal(t, "payload", string(gotBody))
			require.Empty(t, w.toTarget, "a credential request does not reach its target directly")
		})
	}
}

func TestForwarderTreatsAPlaceholderInABodyAsText(t *testing.T) {
	w := newWorld(t, nil)
	req, err := http.NewRequest("POST", w.url("/v1/messages"), strings.NewReader(`{"text":"use ren:GITHUB"}`))
	require.NoError(t, err)
	resp, _ := w.do(t, req)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	<-w.toTarget
	require.Empty(t, w.toEgress)
}

func TestForwarderStreamsTheAnswer(t *testing.T) {
	release := make(chan struct{})
	w := newWorld(t, func(rw http.ResponseWriter, r *http.Request) {
		rw.Header().Set("Content-Type", "text/event-stream")
		_, _ = fmt.Fprint(rw, "data: 1\n\n") // a write error ends the test's read, which the test reports
		rw.(http.Flusher).Flush()
		<-release
	})
	defer close(release)
	req, err := http.NewRequest("GET", w.url("/events"), nil)
	require.NoError(t, err)
	resp, err := w.program.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	line := make(chan string, 1)
	go func() {
		read, _ := bufio.NewReader(resp.Body).ReadString('\n') // an error leaves the line empty, which the test reports
		line <- read
	}()
	select {
	case got := <-line:
		require.Equal(t, "data: 1\n", got)
	case <-time.After(2 * time.Second):
		t.Fatal("the first event did not reach the program while the stream stayed open")
	}
}

func TestForwarderCopiesBytesThatAreNotHTTP(t *testing.T) {
	w := newWorld(t, nil)
	echo, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer echo.Close()
	go func() {
		conn, err := echo.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		_, _ = io.Copy(conn, conn) // echo until the test closes
	}()
	w.dialed.Store(echo.Addr().String())
	conn, err := net.Dial("tcp", w.addr)
	require.NoError(t, err)
	defer conn.Close()
	_, err = conn.Write([]byte("\x00\x01binary"))
	require.NoError(t, err)
	got := make([]byte, 8)
	_, err = io.ReadFull(conn, got)
	require.NoError(t, err)
	require.Equal(t, "\x00\x01binary", string(got))
}

func TestForwarderClosesAConnectionThatWasNotRedirected(t *testing.T) {
	w := newWorld(t, nil)
	w.dialed.Store(w.addr)
	conn, err := net.Dial("tcp", w.addr)
	require.NoError(t, err)
	defer conn.Close()
	_, _ = conn.Write([]byte("GET / HTTP/1.1\r\nHost: example.com\r\n\r\n")) // the forwarder may close first
	require.NoError(t, conn.SetReadDeadline(time.Now().Add(2*time.Second)))
	read, err := conn.Read(make([]byte, 1))
	require.Error(t, err, "a program that dials the forwarder itself gets its connection closed")
	require.Zero(t, read)
}

func TestForwarderPassesAWebSocketUpgrade(t *testing.T) {
	w := newWorld(t, func(rw http.ResponseWriter, r *http.Request) {
		conn, buf, err := rw.(http.Hijacker).Hijack()
		if err != nil {
			return
		}
		defer conn.Close()
		_, _ = buf.WriteString("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n") // the test reads the answer
		_ = buf.Flush()
		_, _ = io.Copy(conn, buf) // echo the frames until the test closes
	})
	pool := w.program.Transport.(*http.Transport).TLSClientConfig.RootCAs
	conn, err := tls.Dial("tcp", w.addr, &tls.Config{RootCAs: pool, ServerName: "example.com", NextProtos: []string{"http/1.1"}})
	require.NoError(t, err)
	defer conn.Close()
	_, port, _ := net.SplitHostPort(w.dialed.Load().(string))
	_, err = fmt.Fprintf(conn, "GET /ws HTTP/1.1\r\nHost: example.com:%s\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n", port)
	require.NoError(t, err)
	reader := bufio.NewReader(conn)
	status, err := reader.ReadString('\n')
	require.NoError(t, err)
	require.Contains(t, status, "101")
	for line, _ := reader.ReadString('\n'); line != "\r\n"; line, _ = reader.ReadString('\n') {
	}
	_, err = conn.Write([]byte("frame"))
	require.NoError(t, err)
	got := make([]byte, 5)
	_, err = io.ReadFull(reader, got)
	require.NoError(t, err)
	require.Equal(t, "frame", string(got))
}
