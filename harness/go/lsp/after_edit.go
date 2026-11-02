package lsp

import (
	"context"
	"encoding/json"
	"path/filepath"
	"time"

	"github.com/phodal/pero/harness/go/fstools"
	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

// Internal operation, never exposed in the model's LSP schema.
const collectDiagnostics Operation = "collectDiagnostics"

func (app *App) selectionFor(file string) *Selection {
	var selected *Selection
	for i := range app.selections {
		candidate := &app.selections[i]
		if longestExtension(*candidate, file) > 0 && (selected == nil || longestExtension(*candidate, file) > longestExtension(*selected, file)) {
			selected = candidate
		}
	}
	return selected
}

func (app *App) registerDiagnostics(run *point.Run, h *harness.Harness) error {
	_, err := h.Tools().After.Use(run, func(ctx context.Context, outcome harness.ToolOutcome, next point.Next[harness.ToolOutcome]) (harness.ToolOutcome, error) {
		if !outcome.Result.IsError && outcome.Request.Agent != nil {
			switch outcome.Request.Name {
			case "Write", "Edit", "write_file", "edit_file":
				// Use the successful filesystem effect receipt rather than reinterpreting
				// model arguments (native paths are relative to the selected workspace).
				raw := outcome.Result.Value
				if len(raw) == 0 && len(outcome.Result.Content) == 1 {
					raw = json.RawMessage(outcome.Result.Content[0].Text)
				}
				var receipt fstools.ScopedTextReceipt
				if json.Unmarshal(raw, &receipt) == nil && receipt.State == "applied" && filepath.IsLocal(receipt.Path) {
					file := filepath.Join(app.files.Path(), receipt.Path)
					selected := app.selectionFor(file)
					if selected != nil && selected.Server.Config.Diagnostics {
						wait, cancel := context.WithTimeout(ctx, 2*time.Second)
						result, diagnosticErr := app.Query(wait, outcome.Request.Agent, Query{Operation: collectDiagnostics, FilePath: file, Line: 1, Character: 1})
						cancel()
						text := "LSP diagnostics unavailable for the saved file; the successful file operation is unchanged. No clean diagnostic result was observed."
						if diagnosticErr == nil && result.Diagnostics != nil {
							text, _ = result.Format()
						}
						outcome.Result.AdditionalContexts = append(outcome.Result.AdditionalContexts, harness.DeferredContext{Role: harness.RoleUser, Source: json.RawMessage(`{"kind":"lsp-diagnostics"}`), Content: []harness.ContentBlock{{Type: harness.BlockText, Text: text}}})
					}
				}
			}
		}
		return next(outcome)
	})
	return err
}
