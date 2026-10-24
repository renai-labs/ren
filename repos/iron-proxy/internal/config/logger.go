package config

import (
	"fmt"
	"log/slog"
	"os"
)

// NewLogger creates a structured JSON logger writing to stderr at the level
// specified in the config.
func NewLogger(cfg *Config) (*slog.Logger, error) {
	level, err := parseLogLevel(cfg.Log.Level)
	if err != nil {
		return nil, err
	}

	handler := slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{
		Level: level,
	})

	return slog.New(handler), nil
}

func parseLogLevel(s string) (slog.Level, error) {
	switch s {
	case "debug":
		return slog.LevelDebug, nil
	case "info":
		return slog.LevelInfo, nil
	case "warn":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	default:
		return 0, fmt.Errorf("unknown log level: %q", s)
	}
}
