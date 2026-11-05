package harness

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	harnessmcp "github.com/phodal/pero/harness/go/mcp"
)

func TestSSERejectsForeignMessageEndpointsAndAuthenticationFailures(t *testing.T) {
	for _, mode := range []string{"foreign endpoint", "authentication"} {
		t.Run(mode, func(t *testing.T) {
			var reached atomic.Bool
			destination := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { reached.Store(true) }))
			defer destination.Close()
			origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer fixture" {
					t.Error("selected origin did not receive its explicit credential")
				}
				if mode == "authentication" {
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				fmt.Fprintf(w, "event: endpoint\ndata: %s/message\n\n", destination.URL)
				w.(http.Flusher).Flush()
				<-r.Context().Done()
			}))
			defer origin.Close()
			transport, err := newMCPTransport(MCPServerConfig{Transport: MCPSSE, URL: origin.URL, Headers: map[string]string{"Authorization": "Bearer fixture"}})
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
			defer cancel()
			client := mcp.NewClient(&mcp.Implementation{Name: "fixture", Version: "1"}, nil)
			_, err = client.Connect(ctx, transport, nil)
			terminal := transport.(*authenticationTransport).TerminalError()
			want := errMCPForeignEndpoint
			if mode == "authentication" {
				want = harnessmcp.ErrAuthentication
			}
			if err == nil || !errors.Is(terminal, want) || reached.Load() {
				t.Fatalf("invalid SSE authority was accepted or not terminal: error=%v terminal=%v reached=%v", err, terminal, reached.Load())
			}
		})
	}
}
