package nativetools

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestClaudeNotebookEditReplaceInsertDelete(t *testing.T) {
	f := newClaudeFixture(t, Options{})
	if !f.app.files.SupportsReplacement() {
		t.Skip("notebook replacement unavailable")
	}
	path := filepath.Join(f.root, "demo.ipynb")
	initial := `{
 "cells": [
  {
   "cell_type": "code",
   "execution_count": null,
   "id": "cell-a",
   "metadata": {},
   "outputs": [],
   "source": ["print(1)\n"]
  }
 ],
 "metadata": {},
 "nbformat": 4,
 "nbformat_minor": 5
}`
	if err := os.WriteFile(path, []byte(initial), 0600); err != nil {
		t.Fatal(err)
	}

	replace := f.call(t, f.allowed, "NotebookEdit", map[string]any{
		"notebook_path": path,
		"cell_id":       "cell-a",
		"new_source":    "print(2)\n",
		"edit_mode":     "replace",
	})
	if replace.IsError || !strings.Contains(replace.Content[0].Text, `"state":"applied"`) {
		t.Fatalf("replace failed: %+v", replace)
	}

	insert := f.call(t, f.allowed, "NotebookEdit", map[string]any{
		"notebook_path": path,
		"cell_id":       "cell-a",
		"new_source":    "# note\n",
		"cell_type":     "markdown",
		"edit_mode":     "insert",
	})
	if insert.IsError {
		t.Fatalf("insert failed: %+v", insert)
	}
	var inserted struct {
		CellID string `json:"cell_id"`
	}
	if err := json.Unmarshal([]byte(insert.Content[0].Text), &inserted); err != nil || inserted.CellID == "" || inserted.CellID == "cell-a" {
		t.Fatalf("insert receipt lost new cell id: %+v", insert)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var document struct {
		Cells []struct {
			ID       string   `json:"id"`
			CellType string   `json:"cell_type"`
			Source   []string `json:"source"`
		} `json:"cells"`
	}
	if err := json.Unmarshal(raw, &document); err != nil || len(document.Cells) != 2 {
		t.Fatalf("notebook cells=%d err=%v body=%s", len(document.Cells), err, raw)
	}
	if document.Cells[0].ID != "cell-a" || strings.Join(document.Cells[0].Source, "") != "print(2)\n" {
		t.Fatalf("replace did not rewrite source: %+v", document.Cells[0])
	}
	if document.Cells[1].ID != inserted.CellID || document.Cells[1].CellType != "markdown" {
		t.Fatalf("insert cell wrong: %+v", document.Cells[1])
	}

	deleteResult := f.call(t, f.allowed, "NotebookEdit", map[string]any{
		"notebook_path": path,
		"cell_id":       inserted.CellID,
		"new_source":    "",
		"edit_mode":     "delete",
	})
	if deleteResult.IsError {
		t.Fatalf("delete failed: %+v", deleteResult)
	}
	raw, err = os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &document); err != nil || len(document.Cells) != 1 || document.Cells[0].ID != "cell-a" {
		t.Fatalf("delete left unexpected cells: %s", raw)
	}

	denied := f.call(t, f.denied, "NotebookEdit", map[string]any{
		"notebook_path": path,
		"cell_id":       "cell-a",
		"new_source":    "nope\n",
	})
	if !denied.IsError {
		t.Fatal("denied NotebookEdit succeeded")
	}
	outside := filepath.Join(t.TempDir(), "outside.ipynb")
	if result := f.call(t, f.allowed, "NotebookEdit", map[string]any{
		"notebook_path": outside,
		"cell_id":       "cell-a",
		"new_source":    "x\n",
	}); !result.IsError {
		t.Fatal("NotebookEdit escaped workspace")
	}
}

func TestNotebookReplacementCellTypes(t *testing.T) {
	for _, tc := range []struct {
		name, original, requested, wantType, outputs, count, attachments string
	}{
		{"markdown to code", `"cell_type":"markdown","attachments":{"image.png":{"image/png":"aGVsbG8="}}`, "code", "code", `[]`, `null`, ""},
		{"code to markdown", `"cell_type":"code","outputs":[{"output_type":"stream","name":"stdout","text":["old\n"]}],"execution_count":3`, "markdown", "markdown", "", "", ""},
		{"code retained", `"cell_type":"code","outputs":[],"execution_count":3`, "", "code", `[]`, `3`, ""},
		{"markdown retained", `"cell_type":"markdown","attachments":{}`, "", "markdown", "", "", `{}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newClaudeFixture(t, Options{})
			if !f.app.files.SupportsReplacement() {
				t.Skip("notebook replacement unavailable")
			}
			path := filepath.Join(f.root, "replace.ipynb")
			initial := `{"nbformat":4,"nbformat_minor":5,"metadata":{},"cells":[{"id":"cell-a","metadata":{},"source":["old"],` + tc.original + `}]}`
			if err := os.WriteFile(path, []byte(initial), 0600); err != nil {
				t.Fatal(err)
			}
			input := map[string]any{
				"notebook_path": path, "cell_id": "cell-a", "new_source": "new\n",
				"edit_mode": "replace",
			}
			if tc.requested != "" {
				input["cell_type"] = tc.requested
			}
			result := f.call(t, f.allowed, "NotebookEdit", input)
			if result.IsError {
				t.Fatalf("replace failed: %+v", result)
			}
			raw, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			var document notebookDocument
			if err := json.Unmarshal(raw, &document); err != nil || len(document.Cells) != 1 {
				t.Fatalf("invalid notebook: %s, %v", raw, err)
			}
			cell := document.Cells[0]
			var source []string
			if err := json.Unmarshal(cell.Source, &source); err != nil || strings.Join(source, "") != "new\n" {
				t.Fatalf("source was not replaced: %s, %v", cell.Source, err)
			}
			if cell.ID != "cell-a" || cell.CellType != tc.wantType || string(cell.Outputs) != tc.outputs || string(cell.ExecutionCount) != tc.count || string(cell.Attachments) != tc.attachments {
				t.Fatalf("replacement left incorrect cell fields: %s", raw)
			}
		})
	}
}

func TestNotebookReadPreservesSavedCellsAndBounds(t *testing.T) {
	f := newClaudeFixture(t, Options{})
	path := filepath.Join(f.root, "saved.ipynb")
	for _, large := range []bool{false, true} {
		output := "saved-output"
		if large {
			output = strings.Repeat("x", 70000)
		}
		body, _ := json.Marshal(map[string]any{"nbformat": 4, "cells": []any{
			map[string]any{"id": "code-a", "cell_type": "code", "source": []string{"print(1)", "\n"}, "execution_count": 7, "outputs": []any{map[string]any{"output_type": "stream", "text": output}}},
			map[string]any{"id": "md-b", "cell_type": "markdown", "source": "# saved note"},
		}})
		if err := os.WriteFile(path, body, 0600); err != nil {
			t.Fatal(err)
		}
		result := f.call(t, f.denied, "NotebookRead", map[string]any{"notebook_path": path, "limit": 1})
		var read notebookReadResult
		if result.IsError || json.Unmarshal([]byte(result.Content[0].Text), &read) != nil {
			t.Fatal(result)
		}
		if read.Total != 2 || len(read.Cells) != 1 || read.Cells[0].ID != "code-a" || read.Cells[0].Index != 1 || read.Cells[0].Source != "print(1)\n" || string(read.Cells[0].ExecutionCount) != "7" || read.NextOffset == nil || *read.NextOffset != 2 {
			t.Fatalf("lost saved provenance: %+v", read)
		}
		if read.Cells[0].Truncated != large || (!large && !strings.Contains(string(read.Cells[0].Outputs), "saved-output")) || (large && len(read.Cells[0].Outputs) != 0) {
			t.Fatalf("output budget: %+v", read)
		}
		if len(result.Content[0].Text) > 64<<10 {
			t.Fatal("unbounded notebook output")
		}
		next := f.call(t, f.denied, "NotebookRead", map[string]any{"notebook_path": path, "offset": *read.NextOffset})
		if next.IsError || !strings.Contains(next.Content[0].Text, "# saved note") {
			t.Fatal(next)
		}
	}
	if escaped := f.call(t, f.denied, "NotebookRead", map[string]any{"notebook_path": filepath.Join(t.TempDir(), "outside.ipynb")}); !escaped.IsError {
		t.Fatal("escaped workspace")
	}
	if f.approvals.Load() != 0 {
		t.Fatal("read requested write approval")
	}
}
