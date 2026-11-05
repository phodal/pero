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
	"time"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/plugins"
)

func TestAsyncRewakeWakesAnIdleAgentOnExitTwo(t *testing.T) {
	root := t.TempDir()
	hook := scriptHook(t, root, "PostToolUse", `while [ ! -f "$CLAUDE_PLUGIN_ROOT/release-rewake" ]; do sleep 0.02; done
printf wake-now >&2
exit 2`)
	hook.AsyncRewake = true
	hook.Matcher = "Write"
	var saw atomic.Bool
	adapter := harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		encoded, _ := json.Marshal(request.Messages)
		if strings.Contains(string(encoded), "wake-now") {
			saw.Store(true)
			return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "awake"}}}}, nil
		}
		for _, message := range request.Messages {
			if message.Role == harness.RoleAssistant {
				return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}}, nil
			}
		}
		return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, Name: "Write", ToolCallID: "write-1", Arguments: json.RawMessage(`{"file_path":"note.md","content":"x"}`)}}}}, nil
	})
	h, _ := testHookHarness(t, adapter, plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{hook}}, 0)
	if _, err := h.RegisterTool(t.Context(), "fixture-write", harness.Tool{Schema: harness.ToolSchema{Name: "Write", InputSchema: json.RawMessage(`{"type":"object","properties":{"file_path":{"type":"string"},"content":{"type":"string"}},"required":["file_path","content"],"additionalProperties":false}`)}, Execute: func(context.Context, json.RawMessage) (harness.ToolResult, error) {
		return harness.ToolResult{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "wrote"}}}, nil
	}}); err != nil {
		t.Fatal(err)
	}
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "rewake", CWD: root, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	if err := prompt(t, agent, "write"); err != nil || saw.Load() {
		t.Fatalf("idle turn err=%v woke=%v", err, saw.Load())
	}
	if err := os.WriteFile(filepath.Join(root, "release-rewake"), []byte("go"), 0600); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for !saw.Load() && time.Now().Before(deadline) {
		time.Sleep(15 * time.Millisecond)
	}
	if !saw.Load() {
		t.Fatal("exit 2 did not wake the idle agent")
	}
}
