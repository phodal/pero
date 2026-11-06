package acp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/phodal/pero/harness/go/harness"
)

func TestMCPPolicyAdmission(t *testing.T) {
	for _, row := range []struct {
		name, policy      string
		negotiated, valid bool
	}{
		{"legacy", "", false, true},
		{"negotiated", `{"default":"deny","tools":{"read":"allow"}}`, true, true},
		{"unnegotiated", `{"default":"deny"}`, false, false},
		{"null", `null`, true, false},
		{"unknown field", `{"default":"deny","allowAll":true}`, true, false},
		{"wrong type", `{"default":42}`, true, false},
	} {
		t.Run(row.name, func(t *testing.T) {
			s := &Server{mcpToolPolicy: row.negotiated}
			raw := `{"type":"http","name":"fixture","url":"http://127.0.0.1"`
			if row.policy != "" {
				raw += `,"_meta":{"pero.mcpToolPolicy":` + row.policy + `}`
			}
			raw += `}`
			servers, err := s.decodeSessionMCPServers([]json.RawMessage{json.RawMessage(raw)}, t.TempDir())
			if (err == nil) != row.valid {
				t.Fatalf("servers=%+v err=%v", servers, err)
			}
		})
	}
}

// Real loopback tools/call verifies policy survives ACP session/new. No model
// or second probing connection participates in this fixture.
func TestMCPPolicySessionDispatch(t *testing.T) {
	var calls, connections atomic.Int32
	fixture := sdk.NewServer(&sdk.Implementation{Name: "policy", Version: "1"}, &sdk.ServerOptions{InitializedHandler: func(context.Context, *sdk.InitializedRequest) { connections.Add(1) }})
	fixture.AddTool(&sdk.Tool{Name: "write", InputSchema: map[string]any{"type": "object"}, Annotations: &sdk.ToolAnnotations{ReadOnlyHint: true}}, func(context.Context, *sdk.CallToolRequest) (*sdk.CallToolResult, error) {
		calls.Add(1)
		return &sdk.CallToolResult{Content: []sdk.Content{&sdk.TextContent{Text: "done"}}}, nil
	})
	endpoint := httptest.NewServer(sdk.NewStreamableHTTPHandler(func(*http.Request) *sdk.Server { return fixture }, nil))
	defer endpoint.Close()
	h, err := harness.Boot(t.Context(), harness.Options{AdapterProviders: []string{"fixture"}, Adapter: harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
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
	s, err := NewServer(Options{Harness: h, Persistence: disk, Provider: "fixture", Model: "fixture"})
	if err != nil {
		t.Fatal(err)
	}
	defer s.closeAll(context.Background())
	initialized, rpcErr := s.handle(t.Context(), request{Method: "initialize", Params: json.RawMessage(`{"clientCapabilities":{"_meta":{"pero.mcpToolPolicy":1}}}`)})
	if rpcErr != nil {
		t.Fatal(rpcErr)
	}
	encoded, _ := json.Marshal(initialized)
	var response struct {
		Capabilities struct {
			Meta map[string]int `json:"_meta"`
		} `json:"agentCapabilities"`
	}
	if json.Unmarshal(encoded, &response) != nil || response.Capabilities.Meta[MCPToolPolicyCapability] != 1 {
		t.Fatalf("capabilities=%s", encoded)
	}
	for _, decision := range []string{"deny", "allow"} {
		raw, _ := json.Marshal(map[string]any{"type": "http", "name": "fixture", "url": endpoint.URL, "_meta": map[string]any{MCPToolPolicyCapability: map[string]any{"default": decision}}})
		cwd := t.TempDir()
		id, err := s.newSession(t.Context(), NewSessionParams{CWD: cwd, MCPServers: []json.RawMessage{raw}})
		if err != nil {
			t.Fatal(err)
		}
		agent, ok := h.Agents().Get(id)
		if !ok {
			t.Fatal("missing agent")
		}
		out, err := h.Tools().Execute(t.Context(), harness.ToolRequest{Agent: agent, CallID: "policy-call", Name: harness.PublicMCPToolName("fixture", "write"), Arguments: json.RawMessage(`{}`)})
		if err != nil || out.Result.IsError != (decision == "deny") {
			t.Fatalf("%s: %+v %v", decision, out, err)
		}
		want := int32(0)
		if decision == "allow" {
			want = 1
		}
		if calls.Load() != want {
			t.Fatalf("server calls=%d want=%d", calls.Load(), want)
		}
		if decision == "deny" {
			if err := s.closeSession(t.Context(), id); err != nil {
				t.Fatal(err)
			}
			if err := s.resumeSession(t.Context(), ResumeSessionParams{SessionID: string(id), CWD: cwd, MCPServers: []json.RawMessage{raw}}); err != nil {
				t.Fatal(err)
			}
			agent, ok = h.Agents().Get(id)
			if !ok {
				t.Fatal("missing resumed agent")
			}
			out, err = h.Tools().Execute(t.Context(), harness.ToolRequest{Agent: agent, CallID: "resumed-call", Name: harness.PublicMCPToolName("fixture", "write"), Arguments: json.RawMessage(`{}`)})
			if err != nil || !out.Result.IsError || calls.Load() != 0 {
				t.Fatalf("resumed denial: %+v %v calls=%d", out, err, calls.Load())
			}
		}

	}
	for _, policy := range []any{map[string]any{}, map[string]any{"default": "auto"}, map[string]any{"default": "deny", "tools": map[string]string{"write": "auto"}}} {
		raw, _ := json.Marshal(map[string]any{"type": "http", "name": "invalid", "url": endpoint.URL, "_meta": map[string]any{MCPToolPolicyCapability: policy}})
		if _, err := s.newSession(t.Context(), NewSessionParams{CWD: t.TempDir(), MCPServers: []json.RawMessage{raw}}); err == nil {
			t.Fatal("invalid policy admitted")
		}
	}
	if connections.Load() != 3 {
		t.Fatalf("connections=%d", connections.Load())
	}
}

func TestMCPPolicyStdioDispatch(t *testing.T) {
	h, err := harness.Boot(t.Context(), harness.Options{AdapterProviders: []string{"fixture"}, Adapter: harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
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
	s, err := NewServer(Options{Harness: h, Persistence: disk, Provider: "fixture", Model: "fixture"})
	if err != nil {
		t.Fatal(err)
	}
	defer s.closeAll(context.Background())
	if _, rpcErr := s.handle(t.Context(), request{Method: "initialize", Params: json.RawMessage(`{"clientCapabilities":{"_meta":{"pero.mcpToolPolicy":1}}}`)}); rpcErr != nil {
		t.Fatal(rpcErr)
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, decision := range []string{"deny", "allow"} {
		receipt := filepath.Join(t.TempDir(), "stdio")
		raw, _ := json.Marshal(map[string]any{"name": "fixture", "command": executable, "args": []string{"-test.run=^TestMCPRuntimeStdioFixture$"}, "env": []any{map[string]string{"name": "MCP_RUNTIME_FIXTURE_RECEIPT", "value": receipt}}, "_meta": map[string]any{MCPToolPolicyCapability: map[string]any{"default": decision}}})
		id, err := s.newSession(t.Context(), NewSessionParams{CWD: t.TempDir(), MCPServers: []json.RawMessage{raw}})
		if err != nil {
			t.Fatal(err)
		}
		agent, ok := h.Agents().Get(id)
		if !ok {
			t.Fatal("missing agent")
		}
		out, err := h.Tools().Execute(t.Context(), harness.ToolRequest{Agent: agent, CallID: "stdio-call", Name: harness.PublicMCPToolName("fixture", "alpha"), Arguments: json.RawMessage(`{}`)})
		if err != nil || out.Result.IsError != (decision == "deny") {
			t.Fatalf("%s: %+v %v", decision, out, err)
		}
		_, statErr := os.Stat(receipt + ".called")
		if decision == "deny" && !os.IsNotExist(statErr) || decision == "allow" && statErr != nil {
			t.Fatalf("%s call receipt: %v", decision, statErr)
		}
		if err := s.closeSession(t.Context(), id); err != nil {
			t.Fatal(err)
		}
		starts, err := os.ReadFile(receipt + ".started")
		if err != nil || string(starts) != "started\n" {
			t.Fatalf("stdio startups %q %v", starts, err)
		}
		if _, err := os.Stat(receipt + ".closed"); err != nil {
			t.Fatalf("stdio child not closed: %v", err)
		}

	}
}
