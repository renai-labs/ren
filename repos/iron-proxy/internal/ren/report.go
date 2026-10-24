package ren

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Refreshable is a label in Ren's answer that Ren can renew, with the
// revision Ren injected.
type Refreshable struct {
	Label    string `json:"label"`
	Revision int    `json:"revision"`
}

// reportEvery limits reports to one per label, revision and status per
// minute on this egress copy (fork change 9).
const reportEvery = 60 * time.Second

var scopePattern = regexp.MustCompile(`scope="([^"]*)"`)

type report struct {
	Login  string        `json:"login"`
	Host   string        `json:"host"`
	Status int           `json:"status"`
	Scope  string        `json:"scope,omitempty"`
	Labels []Refreshable `json:"labels"`
}

// Observe looks at the upstream's answer to a request with refreshable
// labels. On a 401 it drops this copy's kept answers for those labels and
// tells Ren in the background; on a 403 insufficient_scope it tells Ren the
// scopes the upstream asked for and keeps the answers. The workload gets the
// upstream's answer unchanged, and the egress never waits for Ren
// (fork change 9).
func (c *Client) Observe(applied *Applied, resp *http.Response) {
	if applied == nil || len(applied.refreshable) == 0 {
		return
	}
	challenge := resp.Header.Get("WWW-Authenticate")
	scope := ""
	switch {
	case resp.StatusCode == http.StatusUnauthorized:
		for _, label := range applied.refreshable {
			c.Invalidate(Selector{Label: label.Label})
		}
	case resp.StatusCode == http.StatusForbidden && strings.Contains(challenge, `error="insufficient_scope"`):
		if found := scopePattern.FindStringSubmatch(challenge); found != nil {
			scope = found[1]
		}
		c.logger.Info("upstream asked for more scopes", slog.String("host", applied.host), slog.String("scope", scope))
	default:
		return
	}
	labels := c.due(applied.refreshable, resp.StatusCode)
	if len(labels) == 0 {
		return
	}
	body := report{Login: applied.login, Host: applied.host, Status: resp.StatusCode, Scope: scope, Labels: labels}
	c.reporting.Add(1)
	go func() {
		defer c.reporting.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := c.send(ctx, "/egress/v1/unauthorized", body); err != nil {
			c.logger.Warn("ren did not take a 401 report", slog.String("host", body.Host), slog.String("error", err.Error()))
		}
	}()
}

// due returns the labels not reported with this revision and status in the
// last minute, and marks them reported.
func (c *Client) due(labels []Refreshable, status int) []Refreshable {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.now()
	var out []Refreshable
	for _, label := range labels {
		key := label.Label + "\x00" + strconv.Itoa(label.Revision) + "\x00" + strconv.Itoa(status)
		if at, ok := c.reported[key]; ok && now.Sub(at) < reportEvery {
			continue
		}
		c.reported[key] = now
		out = append(out, label)
	}
	return out
}

// send posts a body that Ren answers with 204.
func (c *Client) send(ctx context.Context, path string, body any) error {
	resp, err := c.request(ctx, path, body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("ren %s answered %d", path, resp.StatusCode)
	}
	return nil
}
