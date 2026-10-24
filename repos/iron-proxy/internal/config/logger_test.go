package config

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestNewLogger(t *testing.T) {
	tests := []struct {
		name  string
		level string
	}{
		{"debug", "debug"},
		{"info", "info"},
		{"warn", "warn"},
		{"error", "error"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := &Config{
				DNS: DNS{ProxyIP: "10.0.0.1"},
				TLS: TLS{CACert: "/tmp/ca.crt", CAKey: "/tmp/ca.key"},
				Log: Log{Level: tt.level},
			}
			logger, err := NewLogger(cfg)
			require.NoError(t, err)
			require.NotNil(t, logger)
		})
	}
}
