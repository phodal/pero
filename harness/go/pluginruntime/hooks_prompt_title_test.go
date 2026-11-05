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
)

func TestUserPromptSubmitNamesTheSessionAndHidesTheBlockedPrompt(t *testing.T) {
	root := t.TempDir()
	hook := scriptHook(t, root, "UserPromptSubmit", `cat > "$CLAUDE_PLUGIN_ROOT/prompt.json"; printf '%s' '{"decision":"block","reason":"no","hookSpecificOutput":{"hookEventName":"UserPromptSubmit","sessionTitle":"from-hook","suppressOriginalPrompt":true}}'`)
	h, _ := testHookHarness(t, harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		t.Fatal("blocked prompt reached the model")
		return harness.Completion{}, nil
	}), plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{hook}}, 0)
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "prompt-title", CWD: root, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := agent.Session().Append("session/title", map[string]string{"title": "kept"}); err != nil {
		t.Fatal(err)
	}
	err = prompt(t, agent, "secret task")
	if err == nil || !strings.Contains(err.Error(), "no") || strings.Contains(err.Error(), "Original prompt:") || strings.Contains(err.Error(), "secret task") {
		t.Fatalf("block message = %v", err)
	}
	body, err := os.ReadFile(filepath.Join(root, "prompt.json"))
	if err != nil || !strings.Contains(string(body), `"session_title":"kept"`) || !strings.Contains(string(body), "secret task") {
		t.Fatalf("hook input = %s %v", body, err)
	}
	if customSessionTitle(agent) != "from-hook" {
		t.Fatalf("title = %q", customSessionTitle(agent))
	}
	shown := blockedPromptReason(claudehooks.Decision{Block: true, Reason: "no"}, "secret task")
	if shown != "no\nOriginal prompt: secret task" {
		t.Fatalf("default block message = %q", shown)
	}
}
