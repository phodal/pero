//go:build linux || darwin

package pluginruntime

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/plugins"
	"github.com/phodal/pero/harness/go/subagents"
)

func TestWorktreeCreateHookReplacesGitAndKeepsTheDirectory(t *testing.T) {
	root := t.TempDir()
	created := t.TempDir()
	hook := scriptHook(t, root, "WorktreeCreate", fmt.Sprintf("printf 'banner\\n\\x1b[31mred\\x1b[0m\\n%%s\\n' %q", created))
	h, app := testHookHarness(t, idleAdapter(), plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{hook}}, 0)
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "worktree-parent", CWD: root, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	dir, cleanup, err := app.CreateIsolatedWorktree(t.Context(), agent)
	want, wantErr := filepath.EvalSymlinks(created)
	if err != nil || wantErr != nil || (dir != created && dir != want) {
		t.Fatalf("dir=%s want=%s error=%v %v", dir, want, err, wantErr)
	}
	cleanup()
	if _, err := os.Stat(created); err != nil {
		t.Fatalf("hook-created worktree was removed: %v", err)
	}
}

func TestMissingWorktreeCreateHookUsesGitDefault(t *testing.T) {
	root := t.TempDir()
	hook := scriptHook(t, root, "SessionStart", "true")
	h, app := testHookHarness(t, idleAdapter(), plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{hook}}, 0)
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "worktree-default", CWD: root, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := app.CreateIsolatedWorktree(t.Context(), agent); !errors.Is(err, subagents.ErrDefaultWorktree) {
		t.Fatalf("error=%v", err)
	}
}

func idleAdapter() harness.Adapter {
	return harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		return harness.Completion{}, nil
	})
}
