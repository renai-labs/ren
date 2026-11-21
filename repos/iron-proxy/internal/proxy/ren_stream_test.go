package proxy

import (
	"bufio"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// Ren: a response of unknown length that is not SSE, such as an RPC stream,
// reaches the client as the upstream writes it (fork change 13).
func TestHTTPProxy_UnknownLengthStreamIsFlushed(t *testing.T) {
	release := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = fmt.Fprint(w, "{\"type\":\"ping\"}\n") // a write error ends the test's read, which the test reports
		w.(http.Flusher).Flush()
		<-release
		_, _ = fmt.Fprint(w, "{\"type\":\"exit\"}\n") // as above
	}))
	defer upstream.Close()
	defer close(release)

	_, httpAddr, _, _ := startProxy(t)

	req, err := http.NewRequest("POST", fmt.Sprintf("http://%s/v1/rpc", httpAddr), nil)
	require.NoError(t, err)
	req.Host = upstream.Listener.Addr().String()

	// Without a flush the headers wait in the proxy too, so the request is
	// inside the timed part.
	line := make(chan string, 1)
	go func() {
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			line <- err.Error()
			return
		}
		defer resp.Body.Close()
		read, _ := bufio.NewReader(resp.Body).ReadString('\n') // an error leaves the line empty, which the test reports
		line <- read
	}()
	select {
	case got := <-line:
		require.Equal(t, "{\"type\":\"ping\"}\n", got)
	case <-time.After(2 * time.Second):
		t.Fatal("the first line did not reach the client while the stream stayed open")
	}
}
