package proxy

import (
	"bufio"
	"crypto/x509"
	"io"
	"net"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/ironsh/iron-proxy/internal/certcache"
	"github.com/ironsh/iron-proxy/internal/transform"
)

func TestTunnel_PassthroughHosts(t *testing.T) {
	upstream, upstreamPool := startEchoTLSServer(t)
	_, upstreamPort, err := net.SplitHostPort(upstream)
	require.NoError(t, err)

	caCert, caKey := generateTestCA(t)
	cache, err := certcache.NewFromCA(caCert, caKey, 100, 72*time.Hour)
	require.NoError(t, err)
	mitmPool := x509.NewCertPool()
	mitmPool.AddCert(caCert)

	p := New(Options{
		HTTPAddr:         "127.0.0.1:0",
		HTTPSAddr:        "127.0.0.1:0",
		TunnelAddr:       "127.0.0.1:0",
		CertCache:        cache,
		Pipeline:         transform.NewPipelineHolder(transform.NewPipeline(nil, transform.BodyLimits{}, testLogger())),
		Logger:           testLogger(),
		PassthroughHosts: []string{"localhost"},
	})
	p.sniUpstreamPort = upstreamPort
	tunnelAddr := startTunnelListener(t, p)

	t.Run("a listed host gets the upstream's own certificate and bytes", func(t *testing.T) {
		tlsConn := connectAndHandshake(t, tunnelAddr, "localhost:443", "localhost", upstreamPool)

		_, err := tlsConn.Write([]byte("GET /through HTTP/1.1\r\nHost: localhost\r\n\r\n"))
		require.NoError(t, err)
		resp, err := http.ReadResponse(bufio.NewReader(tlsConn), nil)
		require.NoError(t, err)
		defer resp.Body.Close()
		body, err := io.ReadAll(resp.Body)
		require.NoError(t, err)
		require.Equal(t, "echo /through\n", string(body))
	})

	t.Run("another host is still intercepted", func(t *testing.T) {
		tlsConn := connectAndHandshake(t, tunnelAddr, "allowed.example:443", "allowed.example", mitmPool)
		require.Equal(t, caCert.Subject.CommonName, tlsConn.ConnectionState().PeerCertificates[0].Issuer.CommonName)
	})
}
