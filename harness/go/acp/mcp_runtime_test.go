package acp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/phodal/pero/harness/go/harness"
)

// The current test executable is also the stdio fixture; no installed server,
// model, credential, or non-loopback endpoint participates in these tests.
func TestMCPRuntimeStdioFixture(t *testing.T) {
	path := os.Getenv("MCP_RUNTIME_FIXTURE_RECEIPT")
	if path == "" {
		return
	}
	started, err := os.OpenFile(path+".started", os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0600)
	if err != nil {
		os.Exit(2)
	}
	if _, err := started.WriteString("started\n"); err != nil {
		os.Exit(2)
	}
	if err := started.Close(); err != nil {
		os.Exit(2)
	}
	server := sdk.NewServer(&sdk.Implementation{Name: "fixture", Version: "1"}, nil)
	server.AddTool(&sdk.Tool{Name: "alpha", InputSchema: map[string]any{"type": "object"}}, func(context.Context, *sdk.CallToolRequest) (*sdk.CallToolResult, error) {
		if err := os.WriteFile(path+".called", []byte("called"), 0600); err != nil {
			return nil, err
		}
		return &sdk.CallToolResult{Content: []sdk.Content{&sdk.TextContent{Text: "done"}}}, nil
	})
	_ = server.Run(context.Background(), &sdk.StdioTransport{})
	if err := os.WriteFile(path+".closed", []byte("closed"), 0600); err != nil {
		os.Exit(3)
	}
	os.Exit(0)
}

func TestMCPRuntimeObservationLifecycle(t *testing.T) {
	for _, transport := range []string{"stdio", "http"} {
		t.Run(transport, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			defer cancel()
			var connections atomic.Int32
			fixture := sdk.NewServer(&sdk.Implementation{Name: "fixture", Version: "1"}, &sdk.ServerOptions{InitializedHandler: func(context.Context, *sdk.InitializedRequest) { connections.Add(1) }})
			fixture.AddTool(&sdk.Tool{Name: "alpha", InputSchema: map[string]any{"type": "object"}}, nil)
			receipt := filepath.Join(t.TempDir(), "process")
			var config any
			if transport == "http" {
				endpoint := httptest.NewServer(sdk.NewStreamableHTTPHandler(func(_ *http.Request) *sdk.Server { return fixture }, nil))
				defer endpoint.Close()
				config = map[string]any{"name": "User Docs", "type": "http", "url": endpoint.URL, "headers": []any{}}
			} else {
				executable, err := os.Executable()
				if err != nil {
					t.Fatal(err)
				}
				config = map[string]any{"name": "User Docs", "command": executable, "args": []string{"-test.run=^TestMCPRuntimeStdioFixture$"}, "env": []any{map[string]string{"name": "MCP_RUNTIME_FIXTURE_RECEIPT", "value": receipt}}}
			}
			raw, err := json.Marshal(config)
			if err != nil {
				t.Fatal(err)
			}
			h, err := harness.Boot(ctx, harness.Options{AdapterProviders: []string{"fixture"}, Adapter: harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
				t.Error("model was called")
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
			sink := make(updateSink, 128)
			server.writer = &wireWriter{encoder: json.NewEncoder(sink)}
			defer server.closeAll(context.Background())
			initialized, rpcErr := server.handle(ctx, request{Method: "initialize", Params: json.RawMessage(`{"clientCapabilities":{"_meta":{"pero.mcpRuntime":1}}}`)})
			if rpcErr != nil {
				t.Fatal(rpcErr)
			}
			encoded, _ := json.Marshal(initialized)
			if !strings.Contains(string(encoded), `"pero.mcpRuntime":1`) {
				t.Fatalf("missing capability: %s", encoded)
			}
			params := NewSessionParams{CWD: t.TempDir(), MCPServers: []json.RawMessage{raw}, Meta: MCPRuntimeMeta{Runtime: &MCPRuntimeRequest{Revision: 7}}}
			id, err := server.newSession(ctx, params)
			if err != nil {
				t.Fatal(err)
			}
			expectedRevision := uint64(7)
			next := func(want string) mcpRuntimeNotification {
				t.Helper()
				for {
					select {
					case raw := <-sink:
						var message request
						if err := json.Unmarshal(raw, &message); err != nil {
							t.Fatal(err)
						}
						if message.Method != "_pero/mcp/runtime" {
							continue
						}
						var observation mcpRuntimeNotification
						if err := json.Unmarshal(message.Params, &observation); err != nil {
							t.Fatal(err)
						}
						if observation.SessionID != id || observation.Revision != expectedRevision || observation.Server != "User Docs" || observation.Generation != 1 {
							t.Fatalf("wrong binding: %+v", observation)
						}
						if string(observation.Status) == want {
							return observation
						}
					case <-ctx.Done():
						t.Fatalf("waiting for %s: %v", want, ctx.Err())
					}
				}
			}
			next("connecting")
			if got := next("connected"); !reflect.DeepEqual(got.Tools, []string{"alpha"}) {
				t.Fatalf("catalog: %+v", got)
			}
			if transport == "http" {
				fixture.RemoveTools("alpha")
				fixture.AddTool(&sdk.Tool{Name: "beta", InputSchema: map[string]any{"type": "object"}}, nil)
				for {
					if got := next("connected"); reflect.DeepEqual(got.Tools, []string{"beta"}) {
						break
					}
				}
				if connections.Load() != 1 {
					t.Fatalf("duplicate connections: %d", connections.Load())
				}
			}
			if err := server.closeSession(ctx, id); err != nil {
				t.Fatal(err)
			}
			if got := next("closed"); len(got.Tools) != 0 {
				t.Fatalf("closed catalog: %+v", got)
			}
			if transport == "stdio" {
				starts, err := os.ReadFile(receipt + ".started")
				if err != nil || string(starts) != "started\n" {
					t.Fatalf("duplicate/missing stdio start: %q %v", starts, err)
				}
				if _, err := os.Stat(receipt + ".closed"); err != nil {
					t.Fatalf("child not reaped after close: %v", err)
				}
			}
			if transport == "http" {
				expectedRevision = 8
				if err := server.resumeSession(ctx, ResumeSessionParams{SessionID: string(id), CWD: params.CWD, MCPServers: params.MCPServers, Meta: MCPRuntimeMeta{Runtime: &MCPRuntimeRequest{Revision: expectedRevision}}}); err != nil {
					t.Fatal(err)
				}
				next("connecting")
				if got := next("connected"); !reflect.DeepEqual(got.Tools, []string{"beta"}) {
					t.Fatalf("resumed catalog: %+v", got)
				}
				if err := server.closeSession(ctx, id); err != nil {
					t.Fatal(err)
				}
				next("closed")
				if connections.Load() != 2 {
					t.Fatalf("resume connections: %d", connections.Load())
				}
			}
			stored, err := disk.Load(ctx, id)
			if err != nil {
				t.Fatal(err)
			}
			for _, event := range stored.Events() {
				if strings.Contains(event.Type, "mcp/runtime") {
					t.Fatalf("observation persisted: %+v", event)
				}
			}
		})
	}
}

func TestMCPRuntimeRequiresNegotiationAndRevision(t *testing.T) {
	for _, test := range []struct {
		name, capability string
		meta             MCPRuntimeMeta
		want             bool
	}{
		{name: "unnegotiated", capability: `{}`, meta: MCPRuntimeMeta{Runtime: &MCPRuntimeRequest{Revision: 1}}},
		{name: "missing revision", capability: `{"clientCapabilities":{"_meta":{"pero.mcpRuntime":1}}}`},
		{name: "unsupported", capability: `{"clientCapabilities":{"_meta":{"pero.mcpRuntime":2}}}`, meta: MCPRuntimeMeta{Runtime: &MCPRuntimeRequest{Revision: 1}}},
		{name: "negotiated", capability: `{"clientCapabilities":{"_meta":{"pero.mcpRuntime":1}}}`, meta: MCPRuntimeMeta{Runtime: &MCPRuntimeRequest{Revision: 0}}, want: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			sink := make(updateSink, 1)
			server := &Server{writer: &wireWriter{encoder: json.NewEncoder(sink)}}
			if err := server.negotiateMCPRuntime(json.RawMessage(test.capability)); err != nil {
				t.Fatal(err)
			}
			configs := []harness.MCPServerConfig{{Name: "docs"}}
			if err := server.observeMCPServers(configs, "session", test.meta); err != nil {
				t.Fatal(err)
			}
			if (configs[0].Observe != nil) != test.want {
				t.Fatalf("callback enabled = %v", configs[0].Observe != nil)
			}
		})
	}
}

func TestMCPRuntimeRevisionAdmission(t *testing.T) {
	for _, raw := range []string{`{}`, `{"revision":null}`, `{"revision":-1}`, `{"revision":9007199254740992}`} {
		var request MCPRuntimeRequest
		if err := json.Unmarshal([]byte(raw), &request); err == nil {
			t.Fatalf("accepted missing/invalid revision: %s", raw)
		}
	}
	var request MCPRuntimeRequest
	if err := json.Unmarshal([]byte(`{"revision":0}`), &request); err != nil {
		t.Fatal(err)
	}
}
