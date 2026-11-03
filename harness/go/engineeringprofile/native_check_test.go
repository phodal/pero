//go:build linux || darwin

package engineeringprofile

import (
	"context"
	"encoding/json"
	"os"
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
