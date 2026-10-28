package subagents

import (
	"context"
	"encoding/json"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

// ApprovalNever denies approval-requiring operations, not all side effects.
// A real in-memory MCP contribution owned by the parent is inherited by its
// child, while a separate root cannot see it. No network or real actor is used.
func TestReviewChildInheritsOnlyParentScopedMCPCapability(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	var effects atomic.Int32
	remote := sdk.NewServer(&sdk.Implementation{Name: "scope-fixture", Version: "1"}, nil)
	remote.AddTool(&sdk.Tool{Name: "record_effect", InputSchema: map[string]any{"type": "object", "additionalProperties": false}}, func(context.Context, *sdk.CallToolRequest) (*sdk.CallToolResult, error) {
		effects.Add(1)
		return &sdk.CallToolResult{Content: []sdk.Content{&sdk.TextContent{Text: "inherited-mcp-effect"}}}, nil
	})
	clientTransport, serverTransport := sdk.NewInMemoryTransports()
	serverSession, err := remote.Connect(ctx, serverTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer serverSession.Close()
	toolName := harness.PublicMCPToolName("parent_only", "record_effect")
	var h *harness.Harness
	var sawChild atomic.Bool
	var sawResult atomic.Bool
	adapter := harness.AdapterFunc(func(_ context.Context, r harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		if r.Agent.Parent() != nil {
			sawChild.Store(true)
			if policy, err := h.Approvals().EffectivePolicy(r.Agent.Session()); err != nil || policy != harness.ApprovalNever {
				t.Errorf("child approval policy %s: %v", policy, err)
			}
			if r.Step == 1 {
				return harness.Completion{Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, ToolCallID: "child-mcp", Name: toolName, Arguments: json.RawMessage(`{}`)}}}, Finish: harness.FinishToolCalls}, nil
			}
			b, _ := json.Marshal(r.Messages)
			if strings.Contains(string(b), "inherited-mcp-effect") {
				sawResult.Store(true)
			}
			return answer("child-completed"), nil
		}
		if r.Step == 1 {
			return harness.Completion{Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, ToolCallID: "delegate-mcp", Name: "subagent", Arguments: json.RawMessage(`{"description":"MCP scope probe","prompt":"use inherited fixture"}`)}}}, Finish: harness.FinishToolCalls}, nil
		}
		return answer("parent-completed"), nil
	})
	h, err = harness.Boot(ctx, harness.Options{EnableSubagents: true, Adapter: adapter})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = h.Dispose(context.Background())
		if err := h.Drain(ctx); err != nil {
			t.Error(err)
		}
	}()
	if _, err = MountInProcess(ctx, h, InProcessOptions{}); err != nil {
		t.Fatal(err)
	}
	if _, err = MountTool(ctx, h, ToolOptions{Provider: "spawn", MaxDepth: 1}); err != nil {
		t.Fatal(err)
	}
	parent, err := h.Agents().Create(ctx, harness.AgentOptions{ID: "mcp-parent", CWD: t.TempDir(), MaxSteps: 4, Configure: func(ctx context.Context, run *point.Run, _ *harness.Agent) error {
		return harness.MountMCPServers(ctx, run, h.Tools(), h.Prompts(), []harness.MCPServerConfig{{Name: "parent_only", TestTransport: clientTransport, FailOnStartupError: true}})
	}})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := h.Tools().Resolve(parent.Scope(), toolName); !ok {
		t.Fatal("parent MCP capability missing")
	}
	unrelated, err := h.Agents().Create(ctx, harness.AgentOptions{ID: "unrelated-root", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := h.Tools().Resolve(unrelated.Scope(), toolName); ok {
		t.Fatal("parent MCP capability leaked to unrelated root")
	}
	if _, err = parent.Prompt(ctx, harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "delegate fixture"}}}); err != nil {
		t.Fatal(err)
	}
	if !sawChild.Load() || !sawResult.Load() || effects.Load() != 1 {
		t.Fatalf("inherited MCP call not proved: child=%v result=%v effects=%d", sawChild.Load(), sawResult.Load(), effects.Load())
	}
}
