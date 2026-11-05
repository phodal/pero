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

func TestMessageDisplayReplacesShownTextAndKeepsTheOriginalOnFailure(t *testing.T) {
	root := t.TempDir()
	replace := scriptHook(t, root, "MessageDisplay", `cat > "$CLAUDE_PLUGIN_ROOT/display.json"; printf '%s' '{"displayContent":"shown"}'`)
	idle := harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		return harness.Completion{}, nil
	})
	h, app := testHookHarness(t, idle, plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{replace}}, 0)
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "display", CWD: root, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	if got := app.RenderAssistantText(t.Context(), agent, "SECRET_MODEL_TEXT"); got != "shown" {
		t.Fatalf("shown = %q", got)
	}
	payload, err := os.ReadFile(filepath.Join(root, "display.json"))
	if err != nil || !strings.Contains(string(payload), `"delta":"SECRET_MODEL_TEXT"`) || !strings.Contains(string(payload), `"final":true`) || !strings.Contains(string(payload), `"hook_event_name":"MessageDisplay"`) {
		t.Fatalf("display input=%s %v", payload, err)
	}
	broken := scriptHook(t, root, "MessageDisplay", `printf '%s' 'not-json'`)
	h, app = testHookHarness(t, idle, plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{broken}}, 0)
	agent, err = h.Agents().Create(t.Context(), harness.AgentOptions{ID: "display-fallback", CWD: root, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	if got := app.RenderAssistantText(t.Context(), agent, "SECRET_MODEL_TEXT"); got != "SECRET_MODEL_TEXT" {
		t.Fatalf("fallback = %q", got)
	}
}
