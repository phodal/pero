//go:build linux || darwin

package engineeringprofile

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/nativetools"
	point "github.com/phodal/pero/harness/go/runtime"
)

func TestNativeBashCheckUsesDeclaredInputWorkspace(t *testing.T) {
	bash := func(id, command string) harness.Completion {
		args, err := json.Marshal(struct {
			Command string `json:"command"`
		}{command})
		if err != nil {
			t.Fatal(err)
		}
		return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, ToolCallID: harness.ToolCallID(id), Name: "Bash", Arguments: args}}}}
	}
	f := setup(t, Observe, 8, bash("change-directory", "cd other"), checkCall(), bash("ordinary-check", "sh test.sh"), answer(harness.FinishStop))
	if err := os.Mkdir(filepath.Join(f.root, "other"), 0700); err != nil {
		t.Fatal(err)
	}
	for name, script := range map[string]string{
		"test.sh":       "printf root-check; exit 1\n",
		"other/test.sh": "printf other-check; exit 0\n",
	} {
		if err := os.WriteFile(filepath.Join(f.root, name), []byte(script), 0600); err != nil {
			t.Fatal(err)
		}
	}
	mountNativeCheckFixture(t, f)
	c := testContract()
	c.Checks[0] = CheckSpec{ID: "unit", Tool: "Bash", Command: "sh test.sh", Required: true, Files: []string{"test.sh"}}
	f.prompt(t, &c)
	if got := f.assessment(t); got.Ready || got.Checks[0].Status != Failed {
		t.Fatalf("other directory's success satisfied the root check: %+v", got)
	}
	for _, event := range f.agent.Session().Events() {
		if event.Type != "tool/result" {
			continue
		}
		var block harness.ContentBlock
		if err := json.Unmarshal(event.Data, &block); err != nil {
			t.Fatal(err)
		}
		if block.ToolCallID == "ordinary-check" {
			if block.IsError || len(block.Content) != 1 || !strings.Contains(block.Content[0].Text, "other-check") {
				t.Fatalf("engineering check changed the ordinary shell directory: %+v", block)
			}
			return
		}
	}
	t.Fatal("ordinary shell result was not committed")
}

func TestNativeCheckEvidenceTracksRootWorktreeTransitions(t *testing.T) {
	call := func(id, name, args string) harness.Completion {
		return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, ToolCallID: harness.ToolCallID(id), Name: name, Arguments: json.RawMessage(args)}}}}
	}
	f := setup(t, Observe, 8,
		call("enter", "EnterWorktree", `{"name":"engineering"}`),
		call("directory", "Bash", `{"command":"cd other"}`),
		checkCall(),
		call("ordinary", "Bash", `{"command":"pwd > ordinary-cwd"}`),
		call("exit", "ExitWorktree", `{}`),
		call("original-check", "engineering_check", `{"checkId":"unit"}`),
		answer(harness.FinishStop),
	)
	if err := os.Mkdir(filepath.Join(f.root, "other"), 0700); err != nil {
		t.Fatal(err)
	}
	for name, text := range map[string]string{"test.sh": "pwd > checked-cwd; exit 0\n", "other/tracked": "keep directory\n", ".gitignore": ".pero/\n"} {
		if err := os.WriteFile(filepath.Join(f.root, name), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	for _, args := range [][]string{{"init"}, {"config", "user.name", "Fixture"}, {"config", "user.email", "fixture@example.invalid"}, {"add", "test.sh", "other/tracked", ".gitignore"}, {"commit", "-m", "engineering check fixture"}} {
		command := exec.CommandContext(f.ctx, "git", append([]string{"-c", "core.hooksPath=/dev/null", "-C", f.root}, args...)...)
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("git %s: %s: %v", args[0], output, err)
		}
	}
	mountNativeCheckFixture(t, f)
	var worktree string
	f.adapter.before = func(index int) {
		switch index {
		case 1:
			worktree = f.agent.Session().WorkingDirectory()
			if worktree == f.root {
				t.Error("EnterWorktree did not switch the execution workspace")
			}
		case 3:
			if got := f.assessment(t); !got.Ready || got.Checks[0].Status != Passed {
				t.Errorf("check in active worktree: %+v", got)
			}
		case 5:
			if got := f.assessment(t); got.Ready || got.Checks[0].Status != Stale {
				t.Errorf("worktree evidence survived a cwd change with identical input bytes: %+v", got)
			}
		}
	}
	c := testContract()
	c.Checks[0] = CheckSpec{ID: "unit", Tool: "Bash", Command: "sh test.sh", Required: true, Files: []string{"test.sh"}}
	f.prompt(t, &c)
	if got := f.assessment(t); !got.Ready || got.Checks[0].Status != Passed {
		t.Fatalf("fresh check in original workspace: %+v", got)
	}
	for path, expected := range map[string]string{
		filepath.Join(worktree, "checked-cwd"):           worktree,
		filepath.Join(worktree, "other", "ordinary-cwd"): filepath.Join(worktree, "other"),
		filepath.Join(f.root, "checked-cwd"):             f.agent.Session().WorkingDirectory(),
	} {
		data, err := os.ReadFile(path)
		if err != nil || strings.TrimSpace(string(data)) != expected {
			t.Fatalf("execution directory for %s: %q want %q, error=%v", path, data, expected, err)
		}
	}
	if _, err := os.Stat(filepath.Join(worktree, "other", "checked-cwd")); !os.IsNotExist(err) {
		t.Fatal("engineering check followed persistent Bash cwd")
	}
}

func mountNativeCheckFixture(t *testing.T, f *fixture) {
	t.Helper()
	native, err := nativetools.Mount(f.ctx, f.h, nativetools.Options{Workspace: f.root, EnableShell: true, ClaudeTools: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := native.Close(); err != nil {
			t.Error(err)
		}
	})
	definition := point.Define(point.Descriptor{ID: "fixture/approval"}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
		_, err := f.h.Approvals().Register(run, func(context.Context, harness.ApprovalRequest) (harness.ApprovalOutcome, error) {
			return harness.ApprovalAllowedOnce, nil
		})
		return nil, err
	})
	instance, err := f.h.Runtime().Mount(nil, "fixture/approval", definition, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := instance.WaitStable(f.ctx); err != nil {
		t.Fatal(err)
	}
}
