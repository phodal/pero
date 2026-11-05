package subagents

import (
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/nativetools"
)

func TestAgentWorktreeIsolationWritesOutsideParentCheckout(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "seed.txt"), []byte("seed\n"), 0600); err != nil {
		t.Fatal(err)
	}
	git := func(args ...string) {
		t.Helper()
		command := exec.Command("git", append([]string{"-C", root}, args...)...)
		command.Env = append(os.Environ(), "GIT_AUTHOR_NAME=fixture", "GIT_AUTHOR_EMAIL=fixture@example.com", "GIT_COMMITTER_NAME=fixture", "GIT_COMMITTER_EMAIL=fixture@example.com")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("git %s: %v %s", strings.Join(args, " "), err, output)
		}
	}
	git("init", "-b", "master", "--template=")
	git("add", "seed.txt")
	git("commit", "-m", "seed")
	var calls atomic.Int32
	var isolated atomic.Bool
	f := newClaudeHTTPFixture(t, root, func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Messages json.RawMessage `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		switch calls.Add(1) {
		case 1:
			args, _ := json.Marshal(map[string]string{"command": "printf 'isolated-worktree-marker\\n' > feature.txt"})
			quoted, _ := json.Marshal(string(args))
			claudeHTTPAnswer(w, `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"isolated-bash","type":"function","function":{"name":"Bash","arguments":`+string(quoted)+`}}]},"finish_reason":"tool_calls"}]}`)
		default:
			if _, err := os.Stat(filepath.Join(root, "feature.txt")); !os.IsNotExist(err) {
				t.Error("worktree command landed in the parent checkout")
			}
			list, err := exec.Command("git", "-C", root, "worktree", "list", "--porcelain").Output()
			if err != nil {
				t.Error(err)
			}
			for _, line := range strings.Split(string(list), "\n") {
				path, ok := strings.CutPrefix(line, "worktree ")
				if !ok || path == root {
					continue
				}
				if body, err := os.ReadFile(filepath.Join(path, "feature.txt")); err == nil && string(body) == "isolated-worktree-marker\n" {
					isolated.Store(true)
				}
			}
			claudeTextAnswer(w, "isolated-result")
		}
	}, true, nil, ClaudeOptions{}, nativetools.Options{Workspace: root, ClaudeTools: true, EnableShell: true})
	if _, err := harness.SetPermissionMode(f.parent.Session(), harness.PermissionAutoReview); err != nil {
		t.Fatal(err)
	}
	result := f.call(t, f.parent, "Agent", `{"description":"isolated edit","prompt":"Write feature.txt in the isolated checkout.","isolation":"worktree"}`)
	if result.IsError || !strings.Contains(fmtResult(result), "isolated-result") || !isolated.Load() {
		t.Fatalf("worktree child failed: isolated=%v result=%+v", isolated.Load(), result)
	}
	if _, err := os.Stat(filepath.Join(root, "feature.txt")); !os.IsNotExist(err) {
		t.Fatal("parent checkout kept the isolated file")
	}
	list, err := exec.Command("git", "-C", root, "worktree", "list", "--porcelain").Output()
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(string(list), "worktree ") != 1 {
		t.Fatalf("detached worktree was not removed: %s", list)
	}
}

func TestAgentWorktreeRequiresGitCheckout(t *testing.T) {
	root := t.TempDir()
	f := newClaudeHTTPFixture(t, root, func(w http.ResponseWriter, r *http.Request) {
		t.Error("model was called without a Git checkout")
		w.WriteHeader(400)
	}, true, nil, ClaudeOptions{})
	out, err := f.h.Tools().Execute(f.ctx, harness.ToolRequest{Agent: f.parent, Name: "Agent", CallID: "missing-worktree", Arguments: json.RawMessage(`{"description":"isolated edit","prompt":"Write feature.txt.","isolation":"worktree"}`)})
	text := fmtResult(out.Result)
	if err == nil && !strings.Contains(text, "Git checkout") {
		t.Fatalf("missing checkout was accepted: err=%v result=%s", err, text)
	}
	if err != nil && !strings.Contains(err.Error(), "Git checkout") {
		t.Fatalf("unexpected worktree error: %v", err)
	}
}

func fmtResult(result harness.ToolResult) string {
	var text string
	for _, block := range result.Content {
		text += block.Text
	}
	return text
}
