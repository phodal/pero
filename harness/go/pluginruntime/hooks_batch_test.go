//go:build linux || darwin

package pluginruntime

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/plugins"
)

func TestPostToolBatchSeesEveryCallAndCanStop(t *testing.T) {
	root := t.TempDir()
	hook := scriptHook(t, root, "PostToolBatch", `cat > "$CLAUDE_PLUGIN_ROOT/batch.json"; printf '%s' '{"hookSpecificOutput":{"hookEventName":"PostToolBatch","additionalContext":"batch context"},"decision":"block","reason":"stop the batch"}'`)
	var calls atomic.Int32
	adapter := harness.AdapterFunc(func(_ context.Context, _ harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		if calls.Add(1) == 1 {
			return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{
				{Type: harness.BlockToolCall, Name: "Read", ToolCallID: "read", Arguments: json.RawMessage(`{"file_path":"a.go"}`)},
				{Type: harness.BlockToolCall, Name: "Grep", ToolCallID: "grep", Arguments: json.RawMessage(`{"pattern":"name"}`)},
			}}}, nil
		}
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "should not run"}}}}, nil
	})
	h, _ := testHookHarness(t, adapter, plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{hook}}, 0)
	for _, name := range []string{"Read", "Grep"} {
		toolName := name
		if _, err := h.RegisterTool(t.Context(), "fixture-"+toolName, harness.Tool{Schema: harness.ToolSchema{Name: toolName, InputSchema: json.RawMessage(`{"type":"object"}`)}, Execute: func(context.Context, json.RawMessage) (harness.ToolResult, error) {
			return harness.ToolResult{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: toolName + " done"}}}, nil
		}}); err != nil {
			t.Fatal(err)
		}
	}
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "tool-batch", CWD: root, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	if err := prompt(t, agent, "search"); err != nil {
		t.Fatal(err)
	}
	payload, err := os.ReadFile(filepath.Join(root, "batch.json"))
	if err != nil || !strings.Contains(string(payload), `"tool_name":"Read"`) || !strings.Contains(string(payload), `"tool_name":"Grep"`) || calls.Load() != 1 {
		t.Fatalf("payload=%s calls=%d error=%v", payload, calls.Load(), err)
	}
	messages, err := agent.Session().DeriveMessages()
	if err != nil {
		t.Fatal(err)
	}
	var saw bool
	for _, message := range messages {
		if strings.Contains(messageText(message), "stop the batch") && strings.Contains(messageText(message), "batch context") {
			saw = true
		}
	}
	if !saw {
		t.Fatal("batch notice was not kept in the conversation")
	}
}
