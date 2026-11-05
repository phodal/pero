//go:build linux || darwin

package pluginruntime

import (
	"context"
	"encoding/json"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/plugins"
)

func TestPostToolUseHookReplacesToolOutput(t *testing.T) {
	root := t.TempDir()
	hook := scriptHook(t, root, "PostToolUse", `printf '%s' '{"hookSpecificOutput":{"hookEventName":"PostToolUse","updatedToolOutput":{"stdout":"[redacted]","stderr":""}}}'`)
	hook.Matcher = "Bash"
	var calls atomic.Int32
	var followed string
	adapter := harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		if calls.Add(1) == 1 {
			return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, Name: "Bash", ToolCallID: "bash", Arguments: json.RawMessage(`{"command":"printf secret"}`)}}}}, nil
		}
		raw, _ := json.Marshal(request.Messages)
		followed = string(raw)
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}}, nil
	})
	h, _ := testHookHarness(t, adapter, plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{hook}}, 0)
	if _, err := h.RegisterTool(t.Context(), "fixture-bash", harness.Tool{Schema: harness.ToolSchema{Name: "Bash", InputSchema: json.RawMessage(`{"type":"object","properties":{"command":{"type":"string"}},"required":["command"]}`)}, Execute: func(context.Context, json.RawMessage) (harness.ToolResult, error) {
		return harness.ToolResult{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "secret-output"}}}, nil
	}}); err != nil {
		t.Fatal(err)
	}
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "replace-output", CWD: root, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	if err := prompt(t, agent, "run"); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 || !strings.Contains(followed, "[redacted]") || strings.Contains(followed, "secret-output") {
		t.Fatalf("calls=%d followed=%s", calls.Load(), followed)
	}
}
