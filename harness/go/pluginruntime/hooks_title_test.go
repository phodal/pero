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

func TestSessionStartReadsAndStoresACustomTitle(t *testing.T) {
	root := t.TempDir()
	hook := scriptHook(t, root, "SessionStart", `cat > "$CLAUDE_PLUGIN_ROOT/start.json"; printf '%s' '{"hookSpecificOutput":{"hookEventName":"SessionStart","sessionTitle":"from-hook","additionalContext":"named"}}'`)
	h, app := testHookHarness(t, harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "ready"}}}}, nil
	}), plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{hook}}, 0)
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "titled", CWD: root, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := agent.Session().Append("session/title", map[string]string{"title": "kept"}); err != nil {
		t.Fatal(err)
	}
	if err := prompt(t, agent, "start"); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(filepath.Join(root, "start.json"))
	if err != nil || !strings.Contains(string(body), `"session_title":"kept"`) || !strings.Contains(string(body), `"model":"scripted"`) {
		t.Fatalf("hook input = %s %v", body, err)
	}
	if title := customSessionTitle(agent); title != "from-hook" {
		t.Fatalf("stored title = %q", title)
	}
	if app == nil {
		t.Fatal("hooks were not mounted")
	}
}
