//go:build linux || darwin

package pluginruntime

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"

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
	preview := skillPreview(t, got.Content)
	if err != nil || string(data) != want || !strings.Contains(got.Content, "output_file: "+path) || !strings.Contains(got.Content, "output_file_truncated: false") || !strings.HasPrefix(preview, "BEGIN\n") || strings.Contains(preview, "END") || utf8.RuneCountInString(preview) != 2000 {
		t.Fatalf("file or bounded projection lost output: bytes=%d preview=%d error=%v", len(data), utf8.RuneCountInString(preview), err)
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

func TestSkillOutputUsesClaudeCharacterBudgets(t *testing.T) {
	h, agent, definition, options, _ := expansionFixture(t)
	definition.Content = "!`head -c 30000 /dev/zero | tr '\\000' x`"
	got, err := ExpandSkill(t.Context(), h, agent, definition, "", options)
	if err != nil || got.Content != strings.Repeat("x", 30000) {
		t.Fatalf("inline budget changed: bytes=%d error=%v", len(got.Content), err)
	}
	assertNoSkillOutputs(t, agent.Session().Header().CWD)
	definition.Content = "!`head -c 30001 /dev/zero | tr '\\000' y`"
	got, err = ExpandSkill(t.Context(), h, agent, definition, "", options)
	preview := skillPreview(t, got.Content)
	if err != nil || utf8.RuneCountInString(preview) != 2000 || strings.Trim(preview, "y") != "" {
		t.Fatalf("overflow preview=%d error=%v", utf8.RuneCountInString(preview), err)
	}
	files, err := os.ReadDir(filepath.Join(agent.Session().Header().CWD, ".pero", "plugin-output"))
	if err != nil || len(files) != 1 {
		t.Fatalf("artifact=%v error=%v", files, err)
	}
}

func TestSkillCommandFailureUsesReadbackExcerpt(t *testing.T) {
	h, agent, definition, options, _ := expansionFixture(t)
	definition.Content = "!`head -c 30000 /dev/zero | tr '\\000' A; exit 3`"
	_, err := ExpandSkill(t.Context(), h, agent, definition, "", options)
	if err == nil || !strings.Contains(err.Error(), "\n...\n") || !strings.Contains(err.Error(), "AAAA") {
		t.Fatalf("failure excerpt=%v", err)
	}
	assertNoSkillOutputs(t, agent.Session().Header().CWD)
}

func TestSkillOutputRejectsInvalidReadbackBeforeExecution(t *testing.T) {
	h, agent, definition, options, _ := expansionFixture(t)
	options.Environment = append(options.Environment, "BASH_MAX_OUTPUT_LENGTH=nope")
	definition.Content = "!`touch executed`"
	if _, err := ExpandSkill(t.Context(), h, agent, definition, "", options); err == nil || !strings.Contains(err.Error(), "BASH_MAX_OUTPUT_LENGTH") {
		t.Fatalf("invalid readback was accepted: %v", err)
	}
	if _, err := os.Stat(filepath.Join(agent.Session().Header().CWD, "executed")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("command ran before the output budget was rejected")
	}
}

func skillPreview(t *testing.T, content string) string {
	t.Helper()
	marker := "output_file_truncated: false\n"
	index := strings.Index(content, marker)
	if index < 0 {
		t.Fatalf("missing output preview: %q", content)
	}
	preview := content[index+len(marker):]
	return strings.TrimSuffix(preview, " after")
}

func TestLaterSkillCommandFailureDiscardsCaptures(t *testing.T) {
	for _, test := range []struct {
		name, content string
	}{
		{"later command fails", "!`head -c 70000 /dev/zero` !`exit 7`"},
	} {
		t.Run(test.name, func(t *testing.T) {
			h, agent, definition, options, _ := expansionFixture(t)
			definition.Content = test.content
			got, err := ExpandSkill(t.Context(), h, agent, definition, "", options)
			if err == nil || got.Content != "" {
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
