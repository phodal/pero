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
	"github.com/phodal/pero/harness/go/tasks"
)

func TestTaskCreatedHookRollsBackDeniedTask(t *testing.T) {
	root := t.TempDir()
	hook := scriptHook(t, root, "TaskCreated", `cat > "$CLAUDE_PLUGIN_ROOT/created.json"; printf 'do not create' >&2; exit 2`)
	var calls atomic.Int32
	var followed string
	adapter := harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		if calls.Add(1) == 1 {
			return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, Name: "TaskCreate", ToolCallID: "create", Arguments: json.RawMessage(`{"subject":"Ship","description":"details"}`)}}}}, nil
		}
		raw, _ := json.Marshal(request.Messages)
		followed = string(raw)
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}}, nil
	})
	h, _ := testHookHarness(t, adapter, plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{hook}}, 0)
	if _, err := tasks.Mount(t.Context(), h); err != nil {
		t.Fatal(err)
	}
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "task-create", CWD: root, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	if err := prompt(t, agent, "create"); err != nil {
		t.Fatal(err)
	}
	state, err := tasks.Current(agent.Session())
	payload, readErr := os.ReadFile(filepath.Join(root, "created.json"))
	if err != nil || len(state.List()) != 0 || readErr != nil || !strings.Contains(string(payload), `"task_subject":"Ship"`) || !strings.Contains(followed, "do not create") {
		t.Fatalf("tasks=%v payload=%s followed=%s errors=%v %v", state.List(), payload, followed, err, readErr)
	}
}

func TestTaskCompletedHookRestoresPreviousStatus(t *testing.T) {
	root := t.TempDir()
	hook := scriptHook(t, root, "TaskCompleted", `cat > "$CLAUDE_PLUGIN_ROOT/completed.json"; printf '%s' '{"continue":false,"stopReason":"keep going"}'; printf 'stay open' >&2; exit 2`)
	var calls atomic.Int32
	var followed string
	adapter := harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		switch calls.Add(1) {
		case 1:
			return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, Name: "TaskCreate", ToolCallID: "create", Arguments: json.RawMessage(`{"subject":"Ship","description":"details"}`)}}}}, nil
		case 2:
			return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, Name: "TaskUpdate", ToolCallID: "progress", Arguments: json.RawMessage(`{"taskId":"1","status":"in_progress"}`)}}}}, nil
		case 3:
			return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, Name: "TaskUpdate", ToolCallID: "done", Arguments: json.RawMessage(`{"taskId":"1","status":"completed"}`)}}}}, nil
		default:
			raw, _ := json.Marshal(request.Messages)
			followed = string(raw)
			return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}}, nil
		}
	})
	h, _ := testHookHarness(t, adapter, plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{hook}}, 0)
	if _, err := tasks.Mount(t.Context(), h); err != nil {
		t.Fatal(err)
	}
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "task-complete", CWD: root, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	if err := prompt(t, agent, "finish"); err != nil {
		t.Fatal(err)
	}
	state, err := tasks.Current(agent.Session())
	if err != nil || len(state.List()) != 1 || state.List()[0].Status != tasks.InProgress {
		t.Fatalf("status after blocked completion: %+v %v", state.List(), err)
	}
	payload, readErr := os.ReadFile(filepath.Join(root, "completed.json"))
	if readErr != nil || !strings.Contains(string(payload), `"hook_event_name":"TaskCompleted"`) || !strings.Contains(followed, "stay open") && !strings.Contains(followed, "keep going") || calls.Load() != 4 {
		t.Fatalf("payload=%s followed=%s calls=%d error=%v", payload, followed, calls.Load(), readErr)
	}
}
