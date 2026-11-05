//go:build linux || darwin

package pluginruntime

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/plugins"
)

func TestSessionStartWatchPathsObserveAFileOutsideTheMatcher(t *testing.T) {
	root := t.TempDir()
	workspace := filepath.Join(root, "workspace")
	if err := os.Mkdir(workspace, 0o700); err != nil {
		t.Fatal(err)
	}
	watched := filepath.Join(workspace, "secret.env")
	if err := os.WriteFile(watched, []byte("one"), 0o600); err != nil {
		t.Fatal(err)
	}
	start := scriptHook(t, root, "SessionStart", `printf '%s' '{"hookSpecificOutput":{"hookEventName":"SessionStart","watchPaths":["`+watched+`"]}}'`)
	changed := scriptHook(t, root, "FileChanged", `cat > "$CLAUDE_PLUGIN_ROOT/changed.json"`)
	h, _ := testHookHarness(t, harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "ready"}}}}, nil
	}), plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{start, changed}}, 0)
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "watch-paths", CWD: workspace, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	if err := prompt(t, agent, "start"); err != nil {
		t.Fatal(err)
	}
	time.Sleep(250 * time.Millisecond)
	ignored := filepath.Join(workspace, "ignored.txt")
	if err := os.WriteFile(ignored, []byte("noise"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(watched, []byte("two"), 0o600); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	var body []byte
	for {
		body, err = os.ReadFile(filepath.Join(root, "changed.json"))
		if err == nil && strings.Contains(string(body), watched) && strings.Contains(string(body), `"hook_event_name":"FileChanged"`) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("watched file change = %s %v", body, err)
		}
		time.Sleep(20 * time.Millisecond)
	}
	if strings.Contains(string(body), "ignored.txt") {
		t.Fatalf("unlisted file was watched: %s", body)
	}
}
