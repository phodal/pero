//go:build linux || darwin

package pluginruntime

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
	harnessmcp "github.com/phodal/pero/harness/go/mcp"
	"github.com/phodal/pero/harness/go/plugins"
)

func TestMCPToolHookDeniesAWriteAndSkipsLaunchSessionStart(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	var mu sync.Mutex
	var calls []string
	var path string
	server := sdk.NewServer(&sdk.Implementation{Name: "fixture", Version: "1"}, nil)
	server.AddTool(&sdk.Tool{Name: "startup", InputSchema: json.RawMessage(`{"type":"object"}`)}, func(context.Context, *sdk.CallToolRequest) (*sdk.CallToolResult, error) {
		mu.Lock()
		calls = append(calls, "startup")
		mu.Unlock()
		return &sdk.CallToolResult{Content: []sdk.Content{&sdk.TextContent{Text: "{}"}}}, nil
	})
	server.AddTool(&sdk.Tool{Name: "guard", InputSchema: json.RawMessage(`{"type":"object"}`)}, func(_ context.Context, request *sdk.CallToolRequest) (*sdk.CallToolResult, error) {
		encoded, _ := json.Marshal(request.Params.Arguments)
		var fields struct {
			Path string `json:"path"`
		}
		_ = json.Unmarshal(encoded, &fields)
		mu.Lock()
		calls = append(calls, "guard")
		path = fields.Path
		mu.Unlock()
		return &sdk.CallToolResult{Content: []sdk.Content{&sdk.TextContent{Text: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"mcp gate"}}`}}}, nil
	})
	endpoint := httptest.NewServer(sdk.NewStreamableHTTPHandler(func(*http.Request) *sdk.Server { return server }, nil))
	root := t.TempDir()
	var bodies atomic.Int32
	h, err := harness.Boot(ctx, harness.Options{AdapterProviders: []string{"fixture"}, Adapter: harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		for _, message := range request.Messages {
			if message.Role == harness.RoleAssistant {
				return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}}, nil
			}
		}
		return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, Name: "Write", ToolCallID: "write-1", Arguments: json.RawMessage(`{"file_path":"original.md","content":"original"}`)}}}}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	pkg := plugins.Package{Root: root, Definition: plugins.Plugin{Name: "sample"}, MCP: []plugins.MCPServerDefinition{{Name: "memory", Transport: "http", URL: endpoint.URL}}, Hooks: []claudehooks.Hook{
		{Event: "SessionStart", MCPServer: "plugin:sample:memory", MCPTool: "startup"},
		{Event: "PreToolUse", Matcher: "Write", MCPServer: "memory", MCPTool: "guard", MCPInput: json.RawMessage(`{"path":"${tool_input.file_path}"}`)},
	}}
	if _, err := MountMCP(ctx, h, []plugins.Package{pkg}, nil, nil); err != nil {
		t.Fatal(err)
	}
	app, err := MountHooks(ctx, h, []plugins.Package{pkg}, HookOptions{Shell: "/bin/sh", StateDirectory: root})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		_ = h.Dispose(cleanup)
		_ = h.Drain(cleanup)
		_ = app.Close()
		endpoint.Close()
	})
	if _, err := h.RegisterTool(ctx, "fixture-write", harness.Tool{Schema: harness.ToolSchema{Name: "Write", InputSchema: json.RawMessage(`{"type":"object","properties":{"file_path":{"type":"string"},"content":{"type":"string"}},"required":["file_path","content"],"additionalProperties":false}`)}, Execute: func(context.Context, json.RawMessage) (harness.ToolResult, error) {
		bodies.Add(1)
		return harness.ToolResult{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "wrote"}}}, nil
	}}); err != nil {
		t.Fatal(err)
	}
	agent, err := h.Agents().Create(ctx, harness.AgentOptions{ID: "mcp-hook", CWD: root, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	if err := prompt(t, agent, "write"); err != nil || bodies.Load() != 0 {
		t.Fatalf("body=%d err=%v", bodies.Load(), err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(calls) != 1 || calls[0] != "guard" || path != "original.md" {
		t.Fatalf("calls=%v path=%q", calls, path)
	}
}

func TestMCPHookTimeoutBoundsTheToolCall(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	root := t.TempDir()
	hook := claudehooks.Hook{Event: "PreToolUse", Matcher: "Write", MCPServer: "memory", MCPTool: "guard", Timeout: 10 * time.Millisecond}
	h, err := harness.Boot(ctx, harness.Options{AdapterProviders: []string{"fixture"}, Adapter: harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		return harness.Completion{}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	app, err := MountHooks(ctx, h, []plugins.Package{{Root: root, Definition: plugins.Plugin{Name: "sample"}, Hooks: []claudehooks.Hook{hook}}}, HookOptions{StateDirectory: root})
	if err != nil || app == nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		_ = h.Dispose(cleanup)
		_ = h.Drain(cleanup)
		_ = app.Close()
	})
	name := harnessmcp.PublicMCPToolName(pluginMCPName("sample", "memory"), "guard")
	var deadline time.Time
	var hasDeadline bool
	if _, err := h.RegisterTool(ctx, "fixture-mcp-hook", harness.Tool{Schema: harness.ToolSchema{Name: name, InputSchema: json.RawMessage(`{"type":"object"}`)}, Execute: func(callCtx context.Context, _ json.RawMessage) (harness.ToolResult, error) {
		deadline, hasDeadline = callCtx.Deadline()
		<-callCtx.Done()
		return harness.ToolResult{}, callCtx.Err()
	}}); err != nil {
		t.Fatal(err)
	}
	agent, err := h.Agents().Create(ctx, harness.AgentOptions{ID: "mcp-timeout", CWD: root, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	parent, stop := context.WithTimeout(context.Background(), 5*time.Second)
	defer stop()
	started := time.Now()
	_, err = app.runMCPHook(parent, agent, "sample", hook, claudehooks.Input{Event: "PreToolUse"})
	elapsed := time.Since(started)
	if elapsed > time.Second {
		t.Fatalf("MCP hook waited %s for a 10ms timeout: %v", elapsed, err)
	}
	if !hasDeadline || deadline.Sub(started) > time.Second {
		t.Fatalf("tool deadline offset=%s has=%v err=%v", deadline.Sub(started), hasDeadline, err)
	}
}
