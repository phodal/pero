package nativetools

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
)

func TestAddedDirectoryAuthority(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "note.txt"), []byte("private"), 0600); err != nil {
		t.Fatal(err)
	}
	owner, other := &harness.Agent{}, &harness.Agent{}
	bound, err := BindAgentWorkspace(owner, root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ReleaseAgentWorkspace(owner, bound) })
	path := filepath.Join(bound, "note.txt")
	files := workspaceContaining(owner, path)
	if files == nil {
		t.Fatal("owner has no authority")
	}
	if _, err := files.Read(t.Context(), "note.txt"); err != nil {
		t.Fatal(err)
	}
	if workspaceContaining(other, path) != nil || isolatedWorkdir(path) {
		t.Fatal("agent grant leaked to an unrelated root or the global workspace registry")
	}
	otherBound, err := BindAgentWorkspace(other, root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ReleaseAgentWorkspace(other, otherBound) })
	nested := filepath.Join(bound, "nested")
	if err := os.Mkdir(nested, 0700); err != nil {
		t.Fatal(err)
	}
	nestedBound, err := BindAgentWorkspace(owner, nested)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ReleaseAgentWorkspace(owner, nestedBound) })
	if err := os.WriteFile(filepath.Join(nestedBound, "note.txt"), []byte("nested"), 0600); err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(struct {
		Path string `json:"file_path"`
	}{filepath.Join(nestedBound, "note.txt")})
	if err != nil {
		t.Fatal(err)
	}
	selected := WorkspaceForToolRequest(harness.ToolRequest{Agent: owner, Arguments: raw}, files)
	text, err := selected.Read(t.Context(), "note.txt")
	if err != nil || text.Text != "nested" {
		t.Fatalf("nested grant did not select the receipt root: %+v %v", text, err)
	}
	ReleaseAgentWorkspace(owner, nestedBound)
	if selected := WorkspaceForPath(owner, files, filepath.Join(nestedBound, "note.txt")); selected != files {
		t.Fatal("revoking nested grant did not restore the authorized ancestor root")
	}
	ReleaseAgentWorkspace(owner, bound)
	if workspaceContaining(owner, path) != nil {
		t.Fatal("revoked owner retained authority")
	}
	if _, err := files.Read(t.Context(), "note.txt"); err == nil {
		t.Fatal("revocation left the descriptor readable")
	}
	otherFiles := workspaceContaining(other, path)
	if otherFiles == nil {
		t.Fatal("revocation removed another owner's independent grant")
	}
	if _, err := otherFiles.Read(t.Context(), "note.txt"); err != nil {
		t.Fatal(err)
	}
}

func TestAddedDirectoryDocumentReadsAreScoped(t *testing.T) {
	f := newClaudeFixture(t, Options{})
	root := t.TempDir()
	var pixels bytes.Buffer
	if err := png.Encode(&pixels, image.NewRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatal(err)
	}
	notebook := `{"nbformat":4,"cells":[{"id":"saved","cell_type":"code","source":[],"outputs":[{"data":{"image/png":"` + base64.StdEncoding.EncodeToString(pixels.Bytes()) + `"}}]}]}`
	if err := os.WriteFile(filepath.Join(root, "saved.ipynb"), []byte(notebook), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "pages.pdf"), twoPagePDF(), 0600); err != nil {
		t.Fatal(err)
	}
	bound, err := BindAgentWorkspace(f.allowed, root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ReleaseAgentWorkspace(f.allowed, bound) })
	cases := []struct{ tool, name string }{{"NotebookImage", "saved.ipynb"}}
	for _, schema := range f.harness.Tools().Schemas(f.allowed.Scope()) {
		if schema.Name == "PDFRead" {
			cases = append(cases, struct{ tool, name string }{"PDFRead", "pages.pdf"})
		}
	}
	for _, tc := range cases {
		t.Run(tc.tool, func(t *testing.T) {
			input := struct {
				Path string `json:"file_path"`
				Cell int    `json:"cell_index,omitempty"`
			}{Path: filepath.Join(bound, tc.name)}
			if tc.tool == "NotebookImage" {
				input.Cell = 1
			}
			if result := f.call(t, f.allowed, tc.tool, input); result.IsError {
				t.Fatalf("owner read failed: %+v", result)
			}
			if result := f.call(t, f.denied, tc.tool, input); !result.IsError {
				t.Fatalf("unrelated root read added directory: %+v", result)
			}
		})
	}
}
