//go:build linux || darwin

package pluginruntime

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/fstools"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/plugins"
)

func TestHookEnvironmentOwnsFreshPrivateState(t *testing.T) {
	root := t.TempDir()
	legacy := filepath.Join(root, ".pero", "claude-env", "private-env")
	if err := os.MkdirAll(filepath.Dir(legacy), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(legacy, []byte("export UNTRUSTED=1\n"), 0600); err != nil {
		t.Fatal(err)
	}
	h, app := testHookHarness(t, harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		return harness.Completion{}, nil
	}), plugins.Package{Root: root, Hooks: []claudehooks.Hook{{Event: "SessionStart", Command: ":"}}}, 0)
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "private-env", CWD: root, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	path, err := app.prepareEnvFile(agent, "SessionStart")
	if err != nil {
		t.Fatal(err)
	}
	if pathWithin(root, path) {
		t.Fatalf("executable state inside workspace: %s", path)
	}
	data, err := os.ReadFile(path)
	if err != nil || len(data) != 0 {
		t.Fatalf("reused startup content: %q, %v", data, err)
	}
	info, err := os.Stat(filepath.Dir(path))
	if err != nil || info.Mode().Perm() != 0700 {
		t.Fatalf("private directory mode: %v, %v", info, err)
	}
	// Even a broad file-tool grant to the temp parent cannot modify executable state.
	broad, err := fstools.OpenWorkspace(filepath.Dir(filepath.Dir(path)))
	if err != nil {
		t.Fatal(err)
	}
	defer broad.Close()
	relative, _ := filepath.Rel(broad.Path(), path)
	if _, err := broad.Write(t.Context(), filepath.ToSlash(relative), "export UNTRUSTED=2\n"); err == nil {
		t.Fatal("file tools could modify hook startup state")
	}
	if err := os.WriteFile(path, []byte("export TRUSTED=1\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if got := app.BashEnvironmentFile(agent); got != path {
		t.Fatalf("approved hook environment = %q", got)
	}
	if err := app.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Dir(path)); !os.IsNotExist(err) {
		t.Fatalf("owned environment survived close: %v", err)
	}
	if data, err := os.ReadFile(legacy); err != nil || string(data) != "export UNTRUSTED=1\n" {
		t.Fatalf("cleanup modified unowned file: %q %v", data, err)
	}
}
