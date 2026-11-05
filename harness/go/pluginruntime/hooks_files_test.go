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

func TestFileChangedHookSeesALaterWrite(t *testing.T) {
	root := t.TempDir()
	hook := scriptHook(t, root, "FileChanged", `cat > "$CLAUDE_PLUGIN_ROOT/changed.json"`)
	hook.Matcher = "notes.txt|other.txt"
	h, _ := testHookHarness(t, harness.AdapterFunc(func(_ context.Context, _ harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "ready"}}}}, nil
	}), plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{hook}}, 0)
	workspace := filepath.Join(root, "workspace")
	if err := os.Mkdir(workspace, 0700); err != nil {
		t.Fatal(err)
	}
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "file-watch", CWD: workspace, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	if err := prompt(t, agent, "start"); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(workspace, "notes.txt")
	if err := os.WriteFile(path, []byte("one"), 0600); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	var payload []byte
	for {
		payload, err = os.ReadFile(filepath.Join(root, "changed.json"))
		if err == nil && strings.Contains(string(payload), `"event":"add"`) && strings.Contains(string(payload), path) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("file change was not reported: %s %v", payload, err)
		}
		time.Sleep(20 * time.Millisecond)
	}
}
