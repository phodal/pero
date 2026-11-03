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
