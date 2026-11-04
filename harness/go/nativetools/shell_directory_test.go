//go:build linux || darwin

package nativetools

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
)

func TestSessionWorkingDirectoryKeepsCheckAndInteractiveDirectoriesSeparate(t *testing.T) {
	f := newClaudeFixture(t, Options{EnableShell: true})
	for _, dir := range []string{"other", "third"} {
		if err := os.Mkdir(filepath.Join(f.root, dir), 0700); err != nil {
			t.Fatal(err)
		}
	}
	for name, script := range map[string]string{
		"test.sh":       "printf root-check; exit 1\n",
		"other/test.sh": "printf other-check; exit 0\n",
		"third/test.sh": "printf third-check; exit 0\n",
	} {
		if err := os.WriteFile(filepath.Join(f.root, name), []byte(script), 0600); err != nil {
			t.Fatal(err)
		}
	}
	for _, row := range []struct {
		command, output, workdir string
		anchored, failed         bool
	}{
		{"cd other", "", "", false, false},
		{"sh test.sh", "other-check", "", false, false},
		{"sh test.sh", "root-check", "", true, true},
		{"sh test.sh", "third-check", "third", false, false},
		{"sh test.sh", "third-check", "third", false, false},
		{"cd ../third; sh test.sh", "third-check", "other", false, false},
		{"sh test.sh", "third-check", filepath.Join(f.root, "third"), false, false},
		{"sh test.sh", "root-check", "other", true, true},
		{"cd third; printf anchored", "anchored", "", true, false},
		{"sh test.sh", "other-check", "", false, false},
		{"printf must-not-run", "workdir", "missing", false, true},
		{"printf must-not-run", "outside", filepath.Dir(f.root), false, true},
	} {
		ctx := t.Context()
		if row.anchored {
			ctx = WithSessionWorkingDirectory(ctx)
		}
		args, err := json.Marshal(struct {
			Command string `json:"command"`
			Workdir string `json:"workdir,omitempty"`
		}{row.command, row.workdir})
		if err != nil {
			t.Fatal(err)
		}
		outcome, err := f.harness.Tools().Execute(ctx, harness.ToolRequest{Agent: f.allowed, Name: "Bash", CallID: harness.ToolCallID(fmt.Sprintf("directory-call-%d", f.calls.Add(1))), Arguments: args})
		if err != nil {
			t.Fatal(err)
		}
		if outcome.Result.IsError != row.failed || len(outcome.Result.Content) != 1 || !strings.Contains(outcome.Result.Content[0].Text, row.output) {
			t.Fatalf("command=%q anchored=%t: %+v", row.command, row.anchored, outcome.Result)
		}
		if row.failed && strings.Contains(outcome.Result.Content[0].Text, "must-not-run") {
			t.Fatal("invalid workdir executed command")
		}
	}
}
