package lsp

import (
	"context"
	"encoding/json"
	"path/filepath"
	"time"

	"github.com/phodal/pero/harness/go/fstools"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/nativetools"
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
	if _, err := h.Hooks().PreStep.Use(run, func(ctx context.Context, input harness.StepInput, next point.Next[harness.StepInput]) (harness.StepInput, error) {
		for _, text := range append(app.refreshObserved(ctx, input.Agent), app.pendingDiagnostics(input.Agent)...) {
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
					files := nativetools.WorkspaceForToolRequest(outcome.Request, app.files)
					file := filepath.Join(files.Path(), receipt.Path)
					selected := app.selectionFor(file)
					if selected != nil && selected.Server.Config.Diagnostics {
						wait, cancel := context.WithTimeout(ctx, 2*time.Second)
						result, diagnosticErr := app.Query(wait, outcome.Request.Agent, Query{Operation: collectDiagnostics, FilePath: file, Line: 1, Character: 1})
						cancel()
						text := "LSP diagnostics unavailable for the saved file; the successful file operation is unchanged. No clean diagnostic result was observed."
						if diagnosticErr == nil && result.Diagnostics != nil {
							text, _ = result.Format()
							app.noteDiagnosticDelivery(outcome.Request.Agent, result.diagnosticSource, result.Diagnostics)
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

// A publication belongs to one agent and one document revision. Generations
// restart at one when didOpen replaces a document, so version is part of the cursor.
func (app *App) noteDiagnosticDelivery(agent *harness.Agent, source *instance, report *DiagnosticReport) bool {
	if agent == nil || report == nil || report.URI == "" || report.Generation < 1 {
		return false
	}
	app.mu.Lock()
	defer app.mu.Unlock()
	if app.delivered == nil {
		app.delivered = map[diagnosticKey]diagnosticCursor{}
	}
	key := diagnosticKey{agent: agent, source: source, uri: report.URI}
	seen := app.delivered[key]
	if report.Version < seen.version || (report.Version == seen.version && report.Generation <= seen.generation) {
		return false
	}
	app.delivered[key] = diagnosticCursor{version: report.Version, generation: report.Generation}
	return true
}

func (app *App) pendingDiagnostics(agent *harness.Agent) []string {
	if agent == nil {
		return nil
	}
	app.mu.Lock()
	instances := make([]*instance, 0, len(app.instances))
	for key, instance := range app.instances {
		if key.agent == agent {
			instances = append(instances, instance)
		}
	}
	app.mu.Unlock()
	var texts []string
	for _, instance := range instances {
		// Query owns conn while launching/restarting it. A busy query will deliver
		// its snapshot or leave the next publication for a later step.
		select {
		case <-instance.gate:
		default:
			continue
		}
		var report *DiagnosticReport
		if instance.conn != nil {
			report = instance.conn.peekDiagnostics()
		}
		instance.gate <- struct{}{}
		if !app.noteDiagnosticDelivery(agent, instance, report) {
			continue
		}
		text, _ := (Result{Operation: collectDiagnostics, Diagnostics: report}).Format()
		texts = append(texts, text)
	}
	return texts
}
