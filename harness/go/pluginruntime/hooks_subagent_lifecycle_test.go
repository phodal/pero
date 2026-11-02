//go:build linux || darwin

package pluginruntime

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/plugins"
	"github.com/phodal/pero/harness/go/subagents"
)

func TestSubagentHooksControlTheRealChild(t *testing.T) {
	root := t.TempDir()
	start := scriptHook(t, root, "SubagentStart", `body=$(cat); printf '%s\n' "$body" >> "$CLAUDE_PLUGIN_ROOT/start.jsonl"; printf '%s' '{"continue":false,"decision":"block","hookSpecificOutput":{"additionalContext":"check the child checklist before finishing"}}'`)
	start.Matcher = "^sample:reviewer$"
	stop := scriptHook(t, root, "SubagentStop", `body=$(cat); printf '%s\n' "$body" >> "$CLAUDE_PLUGIN_ROOT/stop.jsonl"; printf 'complete child checklist' >&2; exit 2`)
	stop.Matcher = "sample:reviewer"
	unmatched := scriptHook(t, root, "SubagentStart", `printf forbidden > "$CLAUDE_PLUGIN_ROOT/unmatched"`)
	unmatched.Matcher = "^different:reviewer$"
	var calls atomic.Int32
	adapter := harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		call := calls.Add(1)
		if request.Agent.Parent() == nil {
			t.Fatal("child hooks must not run a separate parent model turn")
		}
		all := ""
		for _, message := range request.Messages {
			all += messageText(message) + "\n"
		}
		if !strings.Contains(all, "check the child checklist before finishing") || call == 2 && !strings.Contains(all, "complete child checklist") {
			t.Errorf("hook feedback did not reach child provider: %s", all)
		}
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: fmt.Sprintf("child attempt %d", call)}}}}, nil
	})
	h, err := harness.Boot(t.Context(), harness.Options{EnableSubagents: true, Adapter: adapter, AdapterProviders: []string{"fixture"}})
	if err != nil {
		t.Fatal(err)
	}
	app, err := MountHooks(t.Context(), h, []plugins.Package{{Root: root, Definition: plugins.Plugin{Name: "sample"}, Hooks: []claudehooks.Hook{start, stop, unmatched}}}, HookOptions{StateDirectory: t.TempDir(), MaxStopBlocks: 1})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()); _ = app.Close() }()
	agents, err := subagents.MountClaude(t.Context(), h, []subagents.AgentDefinition{{Name: "sample:reviewer", Description: "review", Instructions: "Review the checklist."}}, subagents.ClaudeOptions{})
	if err != nil {
		t.Fatal(err)
	}
	parent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "hook-parent", CWD: root, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	result, err := agents.Invoke(t.Context(), parent, subagents.ClaudeInvocation{Definition: "sample:reviewer", Prompt: "child task"})
	if err != nil || result.Status != harness.SubagentCompleted || calls.Load() != 2 {
		t.Fatalf("start denied creation or stop failed to continue/bound child: %+v calls=%d error=%v", result, calls.Load(), err)
	}
	if _, err := os.Stat(filepath.Join(root, "unmatched")); !os.IsNotExist(err) {
		t.Fatalf("agent type matcher did not filter start: %v", err)
	}
	for _, event := range []string{"start", "stop"} {
		data, err := os.ReadFile(filepath.Join(root, event+".jsonl"))
		if err != nil {
			t.Fatal(err)
		}
		lines := strings.Split(strings.TrimSpace(string(data)), "\n")
		if event == "start" && len(lines) != 1 || event == "stop" && len(lines) != 2 {
			t.Fatalf("unexpected %s events: %s", event, data)
		}
		for i, line := range lines {
			var input claudehooks.Input
			if err := json.Unmarshal([]byte(line), &input); err != nil {
				t.Fatal(err)
			}
			if input.SessionID != string(parent.ID()) || input.AgentID != string(result.ChildID) || input.AgentType != "sample:reviewer" {
				t.Errorf("lost root/child attribution: %+v", input)
			}
			if event == "stop" {
				child, err := os.ReadFile(input.AgentTranscriptPath)
				if err != nil || input.AgentTranscriptPath == input.TranscriptPath || !strings.Contains(input.AgentTranscriptPath, string(filepath.Separator)+"subagents"+string(filepath.Separator)) || !strings.Contains(string(child), "child task") || !strings.Contains(string(child), input.LastAssistantMessage) || input.StopHookActive != (i == 1) {
					t.Errorf("stop must see the child transcript and continuation state: %+v %s %v", input, child, err)
				}
			}
		}
	}
}
