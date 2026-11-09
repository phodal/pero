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
	} else if !strings.Contains(err.Error(), "Git fetch failed") || !strings.Contains(err.Error(), "revision") {
		t.Fatalf("missing ref should identify its stage and actionable cause: %v", err)
	}
	pinPath := filepath.Join(t.TempDir(), "pin")
	actual, err := fetchGit(t.Context(), dependency, pinPath, "", pinned)
	if err != nil || actual != pinned {
		t.Fatalf("pin=%s err=%v", actual, err)
	}
	// A filter-capable source sends only objects needed by the chosen subtree.
	writePluginFiles(t, dependency, map[string]string{"unselected/large.txt": strings.Repeat("not-selected", 10000)})
	git(dependency, "add", ".")
	git(dependency, "commit", "-qm", "unselected payload")
	git(dependency, "config", "uploadpack.allowFilter", "true")
	git(dependency, "config", "uploadpack.allowAnySHA1InWant", "true")
	selection := filepath.Join(t.TempDir(), "selection")
	if _, err := fetchGit(t.Context(), dependency, selection, "", git(dependency, "rev-parse", "HEAD"), "nested"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(selection, "unselected/large.txt")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("unselected file was checked out")
	}
	large := git(dependency, "rev-parse", "HEAD:unselected/large.txt")
	if _, err := os.Stat(filepath.Join(selection, ".git/objects", large[:2], large[2:])); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("unselected blob was downloaded despite source filtering support")
	}
	indexes, err := filepath.Glob(filepath.Join(selection, ".git/objects/pack/*.idx"))
	if err != nil {
		t.Fatalf("selected source packs: %v", err)
	}
	for _, index := range indexes {
		if strings.Contains(git(selection, "verify-pack", "-v", index), large) {
			t.Fatal("unselected blob was downloaded despite source filtering support")
		}
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

func TestGitFailureReasons(t *testing.T) {
	for _, test := range []struct{ stderr, want string }{
		{"fatal: cannot create object: No space left on device private-canary", "insufficient disk space"},
		{"fatal: write error: Disk quota exceeded private-canary", "insufficient disk space"},
		{"error: unable to create file: Filename too long private-canary", "filesystem path"},
		{"fatal: couldn't find remote ref private-canary", "selected revision"},
		{"fatal: Authentication failed for https://private-canary@example.invalid/repo", "repository access denied"},
		{"error: RPC failed; curl 56 connection reset private-canary", "network request failed"},
		{"fatal: Permission denied private-canary", "filesystem access denied"},
		{"fatal: private-canary unexpected failure", "could not complete this stage"},
	} {
		t.Run(test.want+test.stderr[:5], func(t *testing.T) {
			actual := gitFailureReason(test.stderr)
			if !strings.Contains(actual, test.want) || strings.Contains(actual, "private-canary") {
				t.Fatalf("Git failure should be actionable without reflecting secrets: %s", actual)
			}
		})
	}
}
