//go:build linux || darwin

package pluginruntime

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/plugins"
	"github.com/phodal/pero/harness/go/subagents"
)

func TestBackgroundAgentCompletionNotifiesAndForegroundDoesNot(t *testing.T) {
	root := t.TempDir()
	hook := scriptHook(t, root, "Notification", `cat > "$CLAUDE_PLUGIN_ROOT/notice.json"`)
	hook.Matcher = "agent_completed"
	adapter := harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		if request.Agent.Parent() == nil {
			t.Fatal("parent model ran")
		}
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "child done"}}}}, nil
	})
	h, err := harness.Boot(t.Context(), harness.Options{EnableSubagents: true, Adapter: adapter, AdapterProviders: []string{"fixture"}})
	if err != nil {
		t.Fatal(err)
	}
	app, err := MountHooks(t.Context(), h, []plugins.Package{{Root: root, Definition: plugins.Plugin{Name: "sample"}, Hooks: []claudehooks.Hook{hook}}}, HookOptions{StateDirectory: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()); _ = app.Close() }()
	agents, err := subagents.MountClaude(t.Context(), h, []subagents.AgentDefinition{{Name: "sample:worker", Description: "work", Instructions: "Finish the task."}}, subagents.ClaudeOptions{})
	if err != nil {
		t.Fatal(err)
	}
	parent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "notice-parent", CWD: root, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := agents.Invoke(t.Context(), parent, subagents.ClaudeInvocation{Definition: "sample:worker", Prompt: "foreground"}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "notice.json")); !os.IsNotExist(err) {
		t.Fatalf("foreground completion notified: %v", err)
	}
	if _, err := agents.Invoke(t.Context(), parent, subagents.ClaudeInvocation{Definition: "sample:worker", Prompt: "background", Background: true}); err != nil {
		t.Fatal(err)
	}
	payload, err := os.ReadFile(filepath.Join(root, "notice.json"))
	if err != nil || !strings.Contains(string(payload), `"notification_type":"agent_completed"`) || !strings.Contains(string(payload), "Background agent") {
		t.Fatalf("notice=%s err=%v", payload, err)
	}
}
