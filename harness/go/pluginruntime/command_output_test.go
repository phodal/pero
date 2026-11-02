//go:build linux || darwin

package pluginruntime

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/nativetools"
)

func assertNoSkillOutputs(t *testing.T, workspace string) {
	t.Helper()
	files, err := os.ReadDir(filepath.Join(workspace, ".pero", "plugin-output"))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		t.Fatal(err)
	}
	if len(files) != 0 {
		t.Fatalf("incomplete or inline output was retained: %v", files)
	}
}

func TestLongSkillOutputPreservesCompleteReadableFile(t *testing.T) {
	h, agent, definition, options, _ := expansionFixture(t)
	workspace := agent.Session().Header().CWD
	definition.Content = "before !`printf 'BEGIN\\n'; head -c 70000 /dev/zero | tr '\\000' a; printf '\\nEND\\n'` after"
	got, err := ExpandSkill(t.Context(), h, agent, definition, "", options)
	if err != nil {
		t.Fatal(err)
	}
	files, err := os.ReadDir(filepath.Join(workspace, ".pero", "plugin-output"))
	if err != nil || len(files) != 1 {
		t.Fatalf("complete output was not retained: %v %v", files, err)
	}
	path := filepath.Join(workspace, ".pero", "plugin-output", files[0].Name())
	data, err := os.ReadFile(path)
	want := "BEGIN\n" + strings.Repeat("a", 70000) + "\nEND\n"
	if err != nil || string(data) != want || !strings.Contains(got.Content, path) || !strings.Contains(got.Content, "BEGIN\n") || !strings.Contains(got.Content, "\nEND\n") || len(got.Content) > 5000 {
		t.Fatalf("file or bounded projection lost output: bytes=%d projectionBytes=%d error=%v", len(data), len(got.Content), err)
	}
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("output file is not private: %v %v", info, err)
	}
	app, err := nativetools.Mount(t.Context(), h, nativetools.Options{Workspace: workspace, ClaudeTools: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = app.Close() })
	read, err := h.Tools().Execute(t.Context(), harness.ToolRequest{Agent: agent, Name: "Read", CallID: "read-output", Arguments: []byte(`{"file_path":".pero/plugin-output/` + files[0].Name() + `","limit":1}`)})
	if err != nil || read.Result.IsError || len(read.Result.Content) == 0 || !strings.Contains(read.Result.Content[0].Text, "BEGIN") {
		t.Fatalf("native Read cannot retrieve retained output: %+v %v", read, err)
	}
}

func TestSkillOutputLimitAndLaterFailureDiscardCaptures(t *testing.T) {
	for _, test := range []struct {
		name, content string
		wantLimit     bool
	}{
		{"capture hard limit", "!`head -c 67108865 /dev/zero`", true},
		{"later command fails", "!`head -c 70000 /dev/zero` !`exit 7`", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			h, agent, definition, options, _ := expansionFixture(t)
			definition.Content = test.content
			got, err := ExpandSkill(t.Context(), h, agent, definition, "", options)
			if err == nil || got.Content != "" || test.wantLimit && !errors.Is(err, ErrSkillCommandOutputLimit) {
				t.Fatalf("incomplete output was accepted: %q %v", got.Content, err)
			}
			assertNoSkillOutputs(t, agent.Session().Header().CWD)
		})
	}
}

func TestSkillOutputRejectsSymlinkParentsBeforeDispatch(t *testing.T) {
	for _, parent := range []string{".pero", filepath.Join(".pero", "plugin-output")} {
		t.Run(parent, func(t *testing.T) {
			h, agent, definition, options, _ := expansionFixture(t)
			workspace, outside := agent.Session().Header().CWD, t.TempDir()
			if parent != ".pero" {
				if err := os.Mkdir(filepath.Join(workspace, ".pero"), 0700); err != nil {
					t.Fatal(err)
				}
			}
			if err := os.Symlink(outside, filepath.Join(workspace, parent)); err != nil {
				t.Fatal(err)
			}
			definition.Content = "!`touch executed`"
			if _, err := ExpandSkill(t.Context(), h, agent, definition, "", options); err == nil {
				t.Fatal("symlink output parent accepted")
			}
			if _, err := os.Stat(filepath.Join(workspace, "executed")); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("command ran before output authority was valid: %v", err)
			}
			files, err := os.ReadDir(outside)
			if err != nil || len(files) != 0 {
				t.Fatalf("capture escaped workspace: %v %v", files, err)
			}
		})
	}
}
