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
	if _, err := h.Hooks().PreStep.Use(run, func(_ context.Context, input harness.StepInput, next point.Next[harness.StepInput]) (harness.StepInput, error) {
		for _, text := range app.pendingDiagnostics() {
			input.Messages = append(input.Messages, harness.Message{Role: harness.RoleUser, Source: json.RawMessage(`{"kind":"lsp-diagnostics"}`), Content: []harness.ContentBlock{{Type: harness.BlockText, Text: text}}})
		}
		return next(input)
	}); err != nil {
		return err
	}
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
							app.noteDiagnosticDelivery(result.Diagnostics)
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

func (app *App) noteDiagnosticDelivery(report *DiagnosticReport) {
	if report == nil || report.URI == "" || report.Generation < 1 {
		return
	}
	app.mu.Lock()
	defer app.mu.Unlock()
	if app.delivered == nil {
		app.delivered = map[string]int{}
	}
	if report.Generation > app.delivered[report.URI] {
		app.delivered[report.URI] = report.Generation
	}
}

func (app *App) pendingDiagnostics() []string {
	app.mu.Lock()
	instances := make([]*instance, 0, len(app.instances))
	for _, instance := range app.instances {
		instances = append(instances, instance)
	}
	app.mu.Unlock()
	var texts []string
	for _, instance := range instances {
		if instance.conn == nil {
			continue
		}
		report := instance.conn.peekDiagnostics()
		if report == nil || report.Generation < 1 {
			continue
		}
		app.mu.Lock()
		seen := 0
		if app.delivered != nil {
			seen = app.delivered[report.URI]
		}
		fresh := report.Generation > seen
		if fresh {
			if app.delivered == nil {
				app.delivered = map[string]int{}
			}
			app.delivered[report.URI] = report.Generation
		}
		app.mu.Unlock()
		if !fresh {
			continue
		}
		text, _ := (Result{Operation: collectDiagnostics, Diagnostics: report}).Format()
		texts = append(texts, text)
	}
	return texts
}
