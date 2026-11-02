package pluginruntime

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/jsonrpc"
	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/plugins"
)

func TestSelectedSSEMCPUsesItsOwnWireAndLifecycle(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	entered, cancelled, disconnected := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var gets, posts atomic.Int32
	server := sdk.NewServer(&sdk.Implementation{Name: "legacy-fixture", Version: "1"}, nil)
	// This fixture represents a legacy server, which predates the stateless
	// server/discover handshake. A current SDK server otherwise advertises its
	// 2026 subscription protocol even on the legacy SSE transport.
	server.AddReceivingMiddleware(func(next sdk.MethodHandler) sdk.MethodHandler {
		return func(ctx context.Context, method string, request sdk.Request) (sdk.Result, error) {
			if method == "server/discover" {
				return nil, &jsonrpc.Error{Code: jsonrpc.CodeMethodNotFound, Message: "Method not found"}
			}
			return next(ctx, method, request)
		}
	})
	server.AddTool(&sdk.Tool{Name: "echo", InputSchema: json.RawMessage(`{"type":"object"}`)}, func(context.Context, *sdk.CallToolRequest) (*sdk.CallToolResult, error) {
		return &sdk.CallToolResult{Content: []sdk.Content{&sdk.TextContent{Text: "legacy SSE result"}}}, nil
	})
	server.AddTool(&sdk.Tool{Name: "wait", InputSchema: json.RawMessage(`{"type":"object"}`)}, func(ctx context.Context, _ *sdk.CallToolRequest) (*sdk.CallToolResult, error) {
		close(entered)
		<-ctx.Done()
		close(cancelled)
		return nil, ctx.Err()
	})
	handler := sdk.NewSSEHandler(func(*http.Request) *sdk.Server { return server }, nil)
	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer fixture" {
			t.Error("SSE GET or announced POST lost its explicit header")
		}
		if r.Method == http.MethodGet {
			gets.Add(1)
			defer close(disconnected)
		} else if r.Method == http.MethodPost {
			posts.Add(1)
		}
		handler.ServeHTTP(w, r)
	}))
	defer endpoint.Close()
	h, err := harness.Boot(ctx, harness.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) }()
	pkg := plugins.Package{Root: t.TempDir(), Definition: plugins.Plugin{Name: "sample"}, MCP: []plugins.MCPServerDefinition{{Name: "legacy", Transport: "sse", URL: "${ENDPOINT}", Headers: map[string]string{"Authorization": "Bearer ${TOKEN}"}}}}
	if _, err := MountMCP(ctx, h, []plugins.Package{pkg}, []string{"ENDPOINT=" + endpoint.URL, "TOKEN=fixture"}); err != nil {
		t.Fatal(err)
	}
	parent, err := h.Agents().Create(ctx, harness.AgentOptions{ID: "sse-parent", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	outcome, err := h.Tools().Execute(ctx, harness.ToolRequest{Agent: parent, Name: "mcp__plugin_sample_legacy__echo", Arguments: json.RawMessage(`{}`)})
	if err != nil || outcome.Result.IsError || !strings.Contains(string(outcome.Result.Value), "legacy SSE result") || gets.Load() != 1 || posts.Load() < 3 {
		t.Fatalf("SSE discovery/call used the wrong wire: %+v %v GET=%d POST=%d", outcome.Result, err, gets.Load(), posts.Load())
	}
	callCtx, cancelCall := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		_, _ = h.Tools().Execute(callCtx, harness.ToolRequest{Agent: parent, Name: "mcp__plugin_sample_legacy__wait", Arguments: json.RawMessage(`{}`)})
	}()
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal("SSE call never reached the server")
	}
	cancelCall()
	for _, signal := range []<-chan struct{}{cancelled, done} {
		select {
		case <-signal:
		case <-ctx.Done():
			t.Fatal("SSE cancellation did not reach both ends")
		}
	}
	if err := h.Agents().Remove(ctx, parent.ID()); err != nil {
		t.Fatal(err)
	}
	select {
	case <-disconnected:
	case <-ctx.Done():
		t.Fatal("retired owner retained its SSE stream")
	}
}
