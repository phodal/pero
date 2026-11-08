package nativetools

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/shell"
)

func initializeWorktreeRepository(t *testing.T, root string) {
	t.Helper()
	for _, args := range [][]string{{"init"}, {"config", "user.name", "Fixture"}, {"config", "user.email", "fixture@example.invalid"}} {
		if _, err := rootGitLine(t.Context(), root, args...); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "tracked.txt"), []byte("committed\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".gitignore"), []byte(".pero/\n"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{{"add", "tracked.txt", ".gitignore"}, {"commit", "-m", "fixture base"}} {
		if _, err := rootGitLine(t.Context(), root, args...); err != nil {
			t.Fatal(err)
		}
	}
}

func TestRootWorktreeSwitchesRealFilesAndShellWithoutDiscardingChanges(t *testing.T) {
	f := newClaudeFixture(t, Options{EnableShell: runtime.GOOS != "windows"})
	initializeWorktreeRepository(t, f.root)
	if err := os.WriteFile(filepath.Join(f.root, "tracked.txt"), []byte("original dirty\n"), 0600); err != nil {
		t.Fatal(err)
	}
	denied := f.call(t, f.denied, "EnterWorktree", map[string]any{"name": "denied"})
	if !denied.IsError {
		t.Fatal("unapproved worktree creation")
	}
	if _, err := os.Stat(filepath.Join(f.root, ".pero", "worktrees")); !os.IsNotExist(err) {
		t.Fatal("denied enter created worktree storage")
	}
	entered := f.call(t, f.allowed, "EnterWorktree", map[string]any{"name": "feature"})
	var receipt rootWorktreeReceipt
	if entered.IsError || json.Unmarshal([]byte(entered.Content[0].Text), &receipt) != nil || receipt.State != "active" {
		t.Fatal(entered)
	}
	worktree := receipt.Worktree
	if f.allowed.Session().WorkingDirectory() != worktree || f.allowed.Session().Header().CWD != f.root {
		t.Fatal("session execution cwd/header contract changed")
	}
	read := f.call(t, f.allowed, "Read", map[string]any{"file_path": "tracked.txt"})
	if read.IsError || !strings.Contains(read.Content[0].Text, "committed") || strings.Contains(read.Content[0].Text, "original dirty") {
		t.Fatal(read)
	}
	write := f.call(t, f.allowed, "Write", map[string]any{"file_path": "retained.txt", "content": "retained user changes"})
	if write.IsError {
		t.Fatal(write)
	}
	if runtime.GOOS == "windows" {
		// Unsandboxed Windows shell has no process-group owner. File-only
		// worktrees remain supported; do not substitute an unowned shell.
		if executor, err := shell.NewLocalExecutor(shell.LocalOptions{CWD: worktree}); executor != nil || err == nil || !strings.Contains(err.Error(), "process-group ownership is unsupported") {
			t.Fatalf("unsandboxed Windows shell accepted: %v %v", executor, err)
		}
	} else {
		// A prior Bash cwd must not override the root transition.
		f.app.background.mu.Lock()
		f.app.background.shellCWD[f.allowed.ID()] = f.root
		f.app.background.mu.Unlock()
		if _, err := f.allowed.Session().Append("working-directory/change", rootWorktreeTransition{CWD: f.root}); err != nil {
			t.Fatal(err)
		}
		lease, err := readRootWorktree(f.allowed.Session().Events())
		if err != nil {
			t.Fatal(err)
		}
		owner := rootWorktrees{app: f.app}
		if err := owner.transition(t.Context(), f.allowed, *lease); err != nil {
			t.Fatal(err)
		}
		bash := f.call(t, f.allowed, "Bash", map[string]any{"command": "printf shell-worktree > shell-marker"})
		if bash.IsError {
			t.Fatal(bash)
		}
		if data, err := os.ReadFile(filepath.Join(worktree, "shell-marker")); err != nil || string(data) != "shell-worktree" {
			t.Fatalf("shell did not follow current cwd: %q %v", data, err)
		}
		if _, err := os.Stat(filepath.Join(f.root, "shell-marker")); !os.IsNotExist(err) {
			t.Fatal("shell used stale original cwd")
		}
	}
	child, err := f.harness.Agents().Create(t.Context(), harness.AgentOptions{Parent: f.allowed, CWD: worktree})
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"EnterWorktree", "ExitWorktree"} {
		out, err := f.harness.Tools().Execute(t.Context(), harness.ToolRequest{Agent: child, Name: name, Arguments: json.RawMessage(`{}`)})
		if err != nil || !out.Result.IsError {
			t.Fatalf("child control %s: %+v %v", name, out, err)
		}
	}
	exited := f.call(t, f.allowed, "ExitWorktree", map[string]any{})
	if exited.IsError || f.allowed.Session().WorkingDirectory() != f.app.files.Path() {
		t.Fatal(exited)
	}
	for _, item := range []struct{ path, text string }{{filepath.Join(f.root, "tracked.txt"), "original dirty\n"}, {filepath.Join(worktree, "retained.txt"), "retained user changes"}} {
		if data, err := os.ReadFile(item.path); err != nil || string(data) != item.text {
			t.Fatalf("exit lost work: %q %v", data, err)
		}
	}
	if err := f.harness.Dispose(t.Context()); err != nil && !errors.Is(err, harness.ErrHarnessDisposalInProgress) {
		t.Fatal(err)
	}
	if err := f.harness.Drain(t.Context()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(worktree, "retained.txt")); err != nil {
		t.Fatal("shutdown removed retained worktree")
	}
	lease, err := readRootWorktree(f.allowed.Session().Events())
	if err != nil {
		t.Fatal(err)
	}
	if err := verifyRootWorktree(t.Context(), *lease); err != nil {
		t.Fatalf("worktree registration lost: %v", err)
	}
}

func TestRootWorktreeDiskResumeVerifiesRetainedRegistration(t *testing.T) {
	f := newClaudeFixture(t, Options{})
	initializeWorktreeRepository(t, f.root)
	gitRoot, err := rootGitLine(t.Context(), f.root, "rev-parse", "--show-toplevel")
	if err != nil || filepath.Clean(gitRoot) != f.app.files.Path() {
		t.Fatalf("Git root does not identify the native workspace: %q %v", gitRoot, err)
	}
	if runtime.GOOS == "windows" && gitRoot == f.app.files.Path() {
		t.Fatal("fixture did not exercise Git slash paths against native Windows paths")
	}
	disk, err := harness.NewJSONLSessionPersistence(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	detach, err := disk.Attach(t.Context(), f.allowed.Session())
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := detach(); err != nil {
			t.Error(err)
		}
	}()
	entered := f.call(t, f.allowed, "EnterWorktree", map[string]any{})
	var receipt rootWorktreeReceipt
	if entered.IsError || json.Unmarshal([]byte(entered.Content[0].Text), &receipt) != nil {
		t.Fatal(entered)
	}
	if err := os.WriteFile(filepath.Join(receipt.Worktree, "offline.txt"), []byte("offline retained"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := f.harness.Dispose(t.Context()); err != nil && !errors.Is(err, harness.ErrHarnessDisposalInProgress) {
		t.Fatal(err)
	}
	if err := f.harness.Drain(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err := detach(); err != nil {
		t.Fatal(err)
	}
	for _, lost := range []bool{false, true} {
		fresh, err := harness.Boot(t.Context(), harness.Options{})
		if err != nil {
			t.Fatal(err)
		}
		app, err := Mount(t.Context(), fresh, Options{Workspace: f.root, ClaudeTools: true})
		if err != nil {
			t.Fatal(err)
		}
		loaded, err := disk.Load(t.Context(), f.allowed.ID())
		if err != nil {
			t.Fatal(err)
		}
		if lost {
			if _, err := rootGitLine(t.Context(), f.root, "worktree", "remove", "--force", receipt.Worktree); err != nil {
				t.Fatal(err)
			}
		}
		resumed, resumeErr := fresh.Agents().Resume(t.Context(), loaded, harness.AgentOptions{})
		if lost {
			if resumeErr == nil {
				t.Fatal("lost worktree silently recreated")
			}
			if _, err := os.Stat(receipt.Worktree); !os.IsNotExist(err) {
				t.Fatal("resume replayed worktree creation")
			}
		} else {
			if resumeErr != nil {
				t.Fatal(resumeErr)
			}
			read, err := fresh.Tools().Execute(t.Context(), harness.ToolRequest{Agent: resumed, Name: "Read", Arguments: json.RawMessage(`{"file_path":"offline.txt"}`)})
			if err != nil || read.Result.IsError || !strings.Contains(read.Result.Content[0].Text, "offline retained") {
				t.Fatalf("resume did not restore file authority: %+v %v", read, err)
			}
		}
		_ = fresh.Dispose(context.Background())
		if err := fresh.Drain(context.Background()); err != nil {
			t.Fatal(err)
		}
		_ = app.Close()
	}
}

// A real checkout filter can keep Git's output pipe open after Git is killed.
// Cancellation must stop the group and bound the wait before another transition.
func TestRootWorktreeGitFilterCancellation(t *testing.T) {
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		t.Skip("Unix checkout filter fixture")
	}
	root := t.TempDir()
	initializeWorktreeRepository(t, root)
	if err := os.WriteFile(filepath.Join(root, ".gitattributes"), []byte("tracked.txt filter=fixture\n"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{{"add", ".gitattributes"}, {"commit", "-m", "checkout filter"}, {"config", "filter.fixture.smudge", "touch filter-ready; sleep 120 & wait"}} {
		if _, err := rootGitLine(t.Context(), root, args...); err != nil {
			t.Fatal(err)
		}
	}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	destination := filepath.Join(root, "retained")
	done := make(chan error, 1)
	go func() {
		_, err := rootGitLine(ctx, root, "worktree", "add", "--detach", destination, "HEAD")
		done <- err
	}()
	ready := time.NewTicker(10 * time.Millisecond)
	defer ready.Stop()
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	for {
		if _, err := os.Stat(filepath.Join(destination, "filter-ready")); err == nil {
			break
		}
		select {
		case err := <-done:
			t.Fatalf("checkout exited before filter readiness: %v", err)
		case <-deadline.C:
			t.Fatal("checkout filter did not become ready")
		case <-ready.C:
		}
	}
	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("cancelled checkout succeeded")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Git filter held the checkout open after cancellation")
	}
}
