//go:build linux || darwin

package pluginruntime

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/plugins"
	"github.com/phodal/pero/harness/go/skills"
)

func TestSessionStartReloadSkillsReadsASkillInstalledByTheHook(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "alpha"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "alpha", "SKILL.md"), []byte("---\nname: alpha\ndescription: First\n---\nFirst.\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	catalog, err := skills.Open(t.Context(), []string{root})
	if err != nil {
		t.Fatal(err)
	}
	hook := scriptHook(t, root, "SessionStart", `mkdir -p "$CLAUDE_PLUGIN_ROOT/beta"
printf '%s\n' '---' 'name: beta' 'description: Added.' '---' 'Added.' > "$CLAUDE_PLUGIN_ROOT/beta/SKILL.md"
printf '%s' '{"hookSpecificOutput":{"hookEventName":"SessionStart","reloadSkills":true}}'`)
	h, err := harness.Boot(t.Context(), harness.Options{Adapter: harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "ready"}}}}, nil
	}), AdapterProviders: []string{"fixture"}})
	if err != nil {
		t.Fatal(err)
	}
	app, err := MountHooks(t.Context(), h, []plugins.Package{{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{hook}}}, HookOptions{Shell: "/bin/sh", Environment: []string{"PATH=/usr/bin:/bin"}, StateDirectory: root, ReloadSkills: catalog.Rescan})
	if err != nil || app == nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx := context.Background()
		_ = h.Dispose(ctx)
		_ = h.Drain(ctx)
		_ = app.Close()
		_ = catalog.Close()
	})
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "reload-skills", CWD: root, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	if err := prompt(t, agent, "start"); err != nil {
		t.Fatal(err)
	}
	rows, err := catalog.List(t.Context())
	if err != nil || len(rows) != 2 || rows[0].Name != "alpha" || rows[1].Name != "beta" || rows[1].Description != "Added." {
		t.Fatalf("catalog after reload = %+v %v", rows, err)
	}
}
