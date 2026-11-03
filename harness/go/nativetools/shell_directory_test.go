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
		command, output  string
		anchored, failed bool
	}{
		{"cd other", "", false, false},
		{"sh test.sh", "other-check", false, false},
		{"sh test.sh", "root-check", true, true},
		{"cd third; printf anchored", "anchored", true, false},
		{"sh test.sh", "other-check", false, false},
	} {
		ctx := t.Context()
		if row.anchored {
			ctx = WithSessionWorkingDirectory(ctx)
		}
		args, err := json.Marshal(struct {
			Command string `json:"command"`
		}{row.command})
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
	}
}
