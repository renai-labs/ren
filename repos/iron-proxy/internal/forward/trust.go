package forward

import (
	"crypto/x509"
	"errors"
	"net/http"
	"os"
	"sync"
	"time"
)

// trust reads the trust bundle again when the file changes: E2B writes a new
// CA into the system bundle when a sandbox resumes on another node, and Go
// reads its system roots only once.
type trust struct {
	path string

	mu      sync.Mutex
	pool    *x509.CertPool
	modTime time.Time
	size    int64
}

func (t *trust) current() (*x509.CertPool, error) {
	info, err := os.Stat(t.path)
	if err != nil {
		return nil, err
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.pool != nil && info.ModTime().Equal(t.modTime) && info.Size() == t.size {
		return t.pool, nil
	}
	pem, err := os.ReadFile(t.path)
	if err != nil {
		return nil, err
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(pem) {
		return nil, errors.New("the trust bundle holds no certificate")
	}
	t.pool, t.modTime, t.size = pool, info.ModTime(), info.Size()
	return pool, nil
}

// transports keeps one transport for the current bundle, and builds a new
// one when the bundle changes.
type transports struct {
	trust *trust
	build func(*x509.CertPool) *http.Transport

	mu        sync.Mutex
	pool      *x509.CertPool
	transport *http.Transport
}

func (t *transports) RoundTrip(req *http.Request) (*http.Response, error) {
	pool, err := t.trust.current()
	if err != nil {
		return nil, err
	}
	t.mu.Lock()
	if t.pool != pool {
		if t.transport != nil {
			t.transport.CloseIdleConnections()
		}
		t.pool, t.transport = pool, t.build(pool)
	}
	transport := t.transport
	t.mu.Unlock()
	return transport.RoundTrip(req)
}

func (t *transports) CloseIdleConnections() {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.transport != nil {
		t.transport.CloseIdleConnections()
	}
}
