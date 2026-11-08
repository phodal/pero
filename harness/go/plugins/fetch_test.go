package plugins

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestFetchSnapshotsAndUpdates(t *testing.T) {
	git := func(root string, args ...string) string {
		t.Helper()
		command := exec.Command("git", append([]string{"-C", root}, args...)...)
		command.Env = append(os.Environ(), "GIT_AUTHOR_NAME=Fixture", "GIT_AUTHOR_EMAIL=fixture@example.invalid", "GIT_COMMITTER_NAME=Fixture", "GIT_COMMITTER_EMAIL=fixture@example.invalid")
		out, err := command.CombinedOutput()
		if err != nil {
			t.Fatalf("git: %v %s", err, out)
		}
		return strings.TrimSpace(string(out))
	}
	dependency := t.TempDir()
	writePluginFiles(t, dependency, map[string]string{"nested/commands/hello.md": "Hello one.", "commands/standalone.md": "Standalone."})
	git(dependency, "init", "-q")
	git(dependency, "add", ".")
	git(dependency, "commit", "-qm", "initial")
	pinned := git(dependency, "rev-parse", "HEAD")
	// Publishing must also release the root when no marketplace was present.
	standalone, err := Fetch(t.Context(), dependency, t.TempDir(), "")
	if err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(filepath.Join(standalone.Directory, "commands", "standalone.md"))
	if err != nil || string(content) != "Standalone." {
		t.Fatalf("standalone snapshot: content=%q err=%v", content, err)
	}
	repo := t.TempDir()
	source, _ := json.Marshal(dependency)
	writePluginFiles(t, repo, map[string]string{".claude-plugin/marketplace.json": `{"name":"catalog","owner":{"name":"Fixture"},"plugins":[{"name":"remote","source":{"source":"git-subdir","url":` + string(source) + `,"path":"nested"}}]}`})
	git(repo, "init", "-q")
	git(repo, "add", ".")
	git(repo, "commit", "-qm", "initial")
	cache := t.TempDir()
	first, err := Fetch(t.Context(), repo, cache, "")
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := LoadPackages(t.Context(), []string{first.Directory})
	if err != nil || len(loaded) != 1 || loaded[0].Definition.Components[0].Content != "Hello one." {
		t.Fatalf("packages=%+v err=%v", loaded, err)
	}
	writePluginFiles(t, dependency, map[string]string{"nested/commands/hello.md": "Hello two."})
	git(dependency, "add", ".")
	git(dependency, "commit", "-qm", "update")
	second, err := Fetch(t.Context(), repo, cache, "")
	if err != nil {
		t.Fatal(err)
	}
	if first.Directory == second.Directory || first.Plugins[0].Revision == second.Plugins[0].Revision {
		t.Fatal("update overwrote prior snapshot")
	}
	old, _ := LoadPackages(t.Context(), []string{first.Directory})
	fresh, _ := LoadPackages(t.Context(), []string{second.Directory})
	if old[0].Definition.Components[0].Content != "Hello one." || fresh[0].Definition.Components[0].Content != "Hello two." {
		t.Fatal("snapshot contents drifted")
	}
	if _, err := Fetch(t.Context(), repo, cache, "missing-ref"); err == nil {
		t.Fatal("invalid ref succeeded")
	}
	pinPath := filepath.Join(t.TempDir(), "pin")
	actual, err := fetchGit(t.Context(), dependency, pinPath, "", pinned)
	if err != nil || actual != pinned {
		t.Fatalf("pin=%s err=%v", actual, err)
	}
	entries, _ := os.ReadDir(cache)
	if len(entries) != 2 {
		t.Fatalf("failed fetch leaked staging paths: %d", len(entries))
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := Fetch(ctx, repo, cache, ""); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation: %v", err)
	}
}

func TestFetchRejectsEscapingConfiguration(t *testing.T) {
	for _, source := range []string{"-option", "ext::private-canary", "https://user:private-canary@example.invalid/repo", "https://example.invalid/repo?secret=private-canary"} {
		if _, err := fetchGit(t.Context(), source, filepath.Join(t.TempDir(), "target"), "", ""); err == nil || strings.Contains(err.Error(), "private-canary") {
			t.Fatalf("source validation: %v", err)
		}
	}
}
