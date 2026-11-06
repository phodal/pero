package acp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/phodal/pero/harness/go/harness"
)

func TestMCPSessionAccessUsesOwnedHTTPConnection(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	var connections, calls atomic.Int32
	started := make(chan struct{}, 1)
	fixture := sdk.NewServer(&sdk.Implementation{Name: "session-app", Version: "1"}, &sdk.ServerOptions{InitializedHandler: func(context.Context, *sdk.InitializedRequest) { connections.Add(1) }})
	for _, name := range []string{"show", "wait"} {
		fixture.AddTool(&sdk.Tool{Name: name, InputSchema: map[string]any{"type": "object"}, Meta: sdk.Meta{"ui": map[string]any{"resourceUri": "ui://app/view"}}}, func(ctx context.Context, request *sdk.CallToolRequest) (*sdk.CallToolResult, error) {
			calls.Add(1)
			if request.Params.Name == "wait" {
				started <- struct{}{}
				<-ctx.Done()
				return nil, ctx.Err()
			}
			return &sdk.CallToolResult{Content: []sdk.Content{&sdk.TextContent{Text: "visible result"}}}, nil
		})
	}
	fixture.AddResource(&sdk.Resource{URI: "ui://app/view", Name: "App", MIMEType: "text/html;profile=mcp-app"}, func(context.Context, *sdk.ReadResourceRequest) (*sdk.ReadResourceResult, error) {
		return &sdk.ReadResourceResult{Contents: []*sdk.ResourceContents{{URI: "ui://app/view", MIMEType: "text/html;profile=mcp-app", Text: "<p>App</p>"}}}, nil
	})
	endpoint := httptest.NewServer(sdk.NewStreamableHTTPHandler(func(*http.Request) *sdk.Server { return fixture }, nil))
	defer endpoint.Close()
	h, err := harness.Boot(ctx, harness.Options{AdapterProviders: []string{"fixture"}, Adapter: harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		t.Error("model called")
		return harness.Completion{}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) }()
	disk, err := harness.NewJSONLSessionPersistence(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server, err := NewServer(Options{Harness: h, Persistence: disk, Provider: "fixture", Model: "fixture"})
	if err != nil {
		t.Fatal(err)
	}
	defer server.closeAll(context.Background())
	command := func(session harness.SessionID, action harness.MCPSessionRequest) (json.RawMessage, *rpcError) {
		raw, _ := json.Marshal(struct {
			SessionID harness.SessionID `json:"sessionId"`
			harness.MCPSessionRequest
		}{session, action})
		result, rpcErr := server.handle(ctx, request{Method: MCPSessionMethod, Params: raw})
		if rpcErr != nil {
			return nil, rpcErr
		}
		return result.(json.RawMessage), nil
	}
	if _, rpcErr := command("unknown", harness.MCPSessionRequest{Action: "list"}); rpcErr == nil {
		t.Fatal("unnegotiated extension accepted")
	}
	if _, rpcErr := server.handle(ctx, request{Method: "initialize", Params: json.RawMessage(`{"clientCapabilities":{"_meta":{"pero.mcpSession":1}}}`)}); rpcErr != nil {
		t.Fatal(rpcErr)
	}
	raw, _ := json.Marshal(map[string]any{"name": "User Docs", "type": "http", "url": endpoint.URL, "headers": []any{}})
	id, err := server.newSession(ctx, NewSessionParams{CWD: t.TempDir(), MCPServers: []json.RawMessage{raw}})
	if err != nil {
		t.Fatal(err)
	}
	other, err := server.newSession(ctx, NewSessionParams{CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	list, rpcErr := command(id, harness.MCPSessionRequest{Action: "list"})
	if rpcErr != nil || !strings.Contains(string(list), `"name":"User Docs"`) {
		t.Fatalf("%s %v", list, rpcErr)
	}
	for _, action := range []string{"resources", "read"} {
		if _, rpcErr := command(id, harness.MCPSessionRequest{Action: action, Server: "User Docs", Generation: 1, URI: "ui://app/view"}); rpcErr != nil {
			t.Fatal(rpcErr)
		}
	}
	if _, rpcErr := command(id, harness.MCPSessionRequest{Action: "read", Server: "User_Docs", Generation: 1, URI: "ui://app/view"}); rpcErr == nil {
		t.Fatal("nonexact server identity accepted")
	}
	opened, rpcErr := command(id, harness.MCPSessionRequest{Action: "prepare", Server: "User Docs", Generation: 1, Name: "show"})
	if rpcErr != nil {
		t.Fatal(rpcErr)
	}
	var view struct {
		Binding string `json:"binding"`
	}
	if json.Unmarshal(opened, &view) != nil || view.Binding == "" {
		t.Fatalf("%s", opened)
	}
	if _, rpcErr := command(other, harness.MCPSessionRequest{Action: "tool", Binding: view.Binding, Name: "show"}); rpcErr == nil {
		t.Fatal("cross-session binding accepted")
	}
	if calls.Load() != 0 {
		t.Fatal("prepare executed business tool")
	}
	if _, rpcErr := command(id, harness.MCPSessionRequest{Action: "tool", Binding: view.Binding, Name: "show"}); rpcErr != nil {
		t.Fatal(rpcErr)
	}
	if connections.Load() != 1 || calls.Load() != 1 {
		t.Fatalf("connections=%d calls=%d", connections.Load(), calls.Load())
	}
	finished := make(chan *rpcError, 1)
	go func() {
		_, rpcErr := command(id, harness.MCPSessionRequest{Action: "tool", Binding: view.Binding, Name: "wait"})
		finished <- rpcErr
	}()
	select {
	case <-started:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	cancelled, _ := json.Marshal(SessionParams{SessionID: string(id)})
	server.handleNotification(request{Method: "session/cancel", Params: cancelled})
	select {
	case rpcErr := <-finished:
		if rpcErr == nil {
			t.Fatal("cancelled call succeeded")
		}
	case <-ctx.Done():
		t.Fatal("MCP call was not cancelled")
	}
	if err := server.closeSession(ctx, id); err != nil {
		t.Fatal(err)
	}
	if _, rpcErr := command(id, harness.MCPSessionRequest{Action: "list"}); rpcErr == nil {
		t.Fatal("closed session accepted")
	}
	if connections.Load() != 1 || calls.Load() != 2 {
		t.Fatalf("unexpected replay or connection: connections=%d calls=%d", connections.Load(), calls.Load())
	}
}
