package main

import (
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"os"
	"time"

	"github.com/ironsh/iron-proxy/internal/certcache"
	"github.com/ironsh/iron-proxy/internal/forward"
)

// runForward runs the forwarder in an E2B sandbox (Ren fork change 15).
func runForward(args []string) {
	fs := flag.NewFlagSet("forward", flag.ExitOnError)
	listen := fs.String("listen", "0.0.0.0:15001", "address that iptables redirects outbound TCP to")
	egress := fs.String("egress", "", "URL of the egress's identity entry, for example https://egress.example.com")
	caCert := fs.String("ca-cert", "", "CA certificate that the sandbox's programs trust")
	caKey := fs.String("ca-key", "", "key of that CA")
	bundle := fs.String("bundle", "/etc/ssl/certs/ca-certificates.crt", "trust bundle for targets and the egress")
	if err := fs.Parse(args); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
	logger := slog.New(slog.NewJSONHandler(os.Stderr, nil))
	egressURL, err := url.Parse(*egress)
	if err != nil || egressURL.Scheme != "https" || egressURL.Host == "" {
		logger.Error("forward: -egress must be an https URL", slog.String("egress", *egress))
		os.Exit(1)
	}
	certs, err := certcache.New(*caCert, *caKey, 1000, 72*time.Hour)
	if err != nil {
		logger.Error("forward: load CA", slog.String("error", err.Error()))
		os.Exit(1)
	}
	ln, err := net.Listen("tcp", *listen)
	if err != nil {
		logger.Error("forward: listen", slog.String("error", err.Error()))
		os.Exit(1)
	}
	logger.Info("forward starting", slog.String("listen", ln.Addr().String()), slog.String("egress", egressURL.Host))
	f := forward.New(forward.Config{Egress: egressURL, Certs: certs, Bundle: *bundle, Target: forward.OriginalDst, Logger: logger})
	if err := f.Serve(ln); err != nil {
		logger.Error("forward stopped", slog.String("error", err.Error()))
		os.Exit(1)
	}
}
