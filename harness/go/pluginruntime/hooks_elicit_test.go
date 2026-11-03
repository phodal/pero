//go:build linux || darwin

package pluginruntime

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
	harnessmcp "github.com/phodal/pero/harness/go/mcp"
	"github.com/phodal/pero/harness/go/plugins"
)

func TestElicitationHookAnswersAndSkipsTheResultHook(t *testing.T) {
	root := t.TempDir()
	reply := runElicitation(t, root,
		scriptHook(t, root, "Elicitation", `printf '%s' '{"hookSpecificOutput":{"hookEventName":"Elicitation","action":"accept","content":{"project_key":"DOCS"}}}'`),
		scriptHook(t, root, "ElicitationResult", `printf ran > "$CLAUDE_PLUGIN_ROOT/result"`), nil)
	if !strings.Contains(reply, `"action":"accept"`) || !strings.Contains(reply, `"project_key":"DOCS"`) {
		t.Fatalf("server received %s", reply)
	}
}

func TestElicitationResultRewritesTheDialogAnswer(t *testing.T) {
	root := t.TempDir()
	reply := runElicitation(t, root, scriptHook(t, root, "Elicitation", "true"), scriptHook(t, root, "ElicitationResult", `printf '%s' '{"hookSpecificOutput":{"hookEventName":"ElicitationResult","action":"accept","content":{"project_key":"alice@example.com"}}}'`), func(context.Context, claudehooks.Input) (claudehooks.Decision, error) {
		return claudehooks.Decision{Action: "accept", Content: json.RawMessage(`{"project_key":"alice"}`)}, nil
	})
	if !strings.Contains(reply, "alice@example.com") || strings.Contains(reply, `"alice"`) {
		t.Fatalf("server received %s", reply)
	}
}

func TestElicitationExit2Declines(t *testing.T) {
	root := t.TempDir()
	reply := runElicitation(t, root, scriptHook(t, root, "Elicitation", "exit 2"), scriptHook(t, root, "ElicitationResult", `printf ran > "$CLAUDE_PLUGIN_ROOT/result"`), func(context.Context, claudehooks.Input) (claudehooks.Decision, error) {
		t.Fatal("dialog ran after a declining elicitation hook")
		return claudehooks.Decision{}, nil
	})
	if !strings.Contains(reply, `"action":"decline"`) {
		t.Fatalf("server received %s", reply)
	}
}

func runElicitation(t *testing.T, root string, elicit, result claudehooks.Hook, answer func(context.Context, claudehooks.Input) (claudehooks.Decision, error)) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	var mu sync.Mutex
	var got string
	server := sdk.NewServer(&sdk.Implementation{Name: "fixture", Version: "1"}, nil)
	server.AddTool(&sdk.Tool{Name: "ask", InputSchema: json.RawMessage(`{"type":"object"}`)}, func(_ context.Context, request *sdk.CallToolRequest) (*sdk.CallToolResult, error) {
		if len(request.Params.InputResponses) == 0 {
			return &sdk.CallToolResult{InputRequests: sdk.InputRequestMap{"form": &sdk.ElicitParams{
				Message:         "Which project?",
				RequestedSchema: map[string]any{"type": "object", "properties": map[string]any{"project_key": map[string]any{"type": "string"}}},
			}}}, nil
		}
		encoded, _ := json.Marshal(request.Params.InputResponses)
		mu.Lock()
		got = string(encoded)
		mu.Unlock()
		return &sdk.CallToolResult{Content: []sdk.Content{&sdk.TextContent{Text: "ok"}}}, nil
	})
	endpoint := httptest.NewServer(sdk.NewStreamableHTTPHandler(func(*http.Request) *sdk.Server { return server }, nil))
	toolName := harnessmcp.PublicMCPToolName(pluginMCPName("sample", "memory"), "ask")
	h, err := harness.Boot(ctx, harness.Options{AdapterProviders: []string{"fixture"}, Adapter: harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		for _, message := range request.Messages {
			if message.Role == harness.RoleAssistant {
				return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}}, nil
			}
		}
		return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, Name: toolName, ToolCallID: "ask-1", Arguments: json.RawMessage(`{}`)}}}}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	elicit.Matcher, result.Matcher = "memory", "memory"
	pkg := plugins.Package{Root: root, Definition: plugins.Plugin{Name: "sample"}, MCP: []plugins.MCPServerDefinition{{Name: "memory", Transport: "http", URL: endpoint.URL}}, Hooks: []claudehooks.Hook{elicit, result}}
	app, err := MountHooks(ctx, h, []plugins.Package{pkg}, HookOptions{Shell: "/bin/sh", StateDirectory: root, AnswerElicitation: answer})
	if err != nil || app == nil {
		t.Fatal(err)
	}
	if _, err := MountMCP(ctx, h, []plugins.Package{pkg}, nil, app); err != nil {
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
	agent, err := h.Agents().Create(ctx, harness.AgentOptions{ID: "elicit", CWD: root, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	if err := prompt(t, agent, "ask"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "result")); err == nil {
		t.Fatal("ElicitationResult ran for a hook-answered request")
	}
	mu.Lock()
	defer mu.Unlock()
	return got
}
