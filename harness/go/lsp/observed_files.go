package lsp

import (
	"context"
	"path/filepath"
	"sort"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/nativetools"
)

// Check the last observed document of each existing server on the next step.
// This sees shell/editor writes without scanning unobserved workspace files or
// starting new servers. Content digests also detect same-size/mtime edits.
func (app *App) refreshObserved(ctx context.Context, agent *harness.Agent) []string {
	if agent == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	app.mu.Lock()
	var instances []*instance
	for key, value := range app.instances {
		if key.agent == agent {
			instances = append(instances, value)
		}
	}
	app.mu.Unlock()
	sort.Slice(instances, func(i, j int) bool { return instances[i].selected.Server.Name < instances[j].selected.Server.Name })
	var notes []string
	for _, instance := range instances {
		if ctx.Err() != nil {
			break
		}
		select {
		case <-instance.gate:
		default:
			continue
		}
		file, digest := instance.observedFile, instance.observedDigest
		if file == "" || instance.closed {
			instance.gate <- struct{}{}
			continue
		}
		files := nativetools.WorkspaceForPath(agent, app.files, file)
		relative, err := filepath.Rel(files.Path(), file)
		current := "unavailable"
		if err == nil && filepath.IsLocal(relative) {
			if content, readErr := files.Read(ctx, filepath.ToSlash(relative)); readErr == nil {
				current = content.Digest
			}
		}
		if current == digest {
			instance.gate <- struct{}{}
			continue
		}
		instance.observedDigest = current
		// A publication for the prior contents is stale even when the new file is
		// missing or unreadable. Close it before collecting any replacement.
		if instance.conn != nil {
			instance.conn.closeOpenDocument(ctx)
		}
		instance.gate <- struct{}{}
		if current == "unavailable" {
			notes = append(notes, "LSP diagnostics unavailable: a previously observed file was removed or is no longer readable. Prior diagnostics no longer describe current contents.")
			continue
		}
		result, err := app.Query(ctx, agent, Query{Operation: collectDiagnostics, FilePath: file, Line: 1, Character: 1})
		if err != nil || result.Diagnostics == nil {
			notes = append(notes, "LSP diagnostics unavailable after an observed external file change. No clean diagnostic result was observed.")
			continue
		}
		if app.noteDiagnosticDelivery(agent, result.diagnosticSource, result.Diagnostics) {
			text, _ := result.Format()
			notes = append(notes, text)
		}
	}
	return notes
}
