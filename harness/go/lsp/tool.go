package lsp

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/phodal/pero/harness/go/fstools"
	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

func Mount(ctx context.Context, h *harness.Harness, options Options) (*App, error) {
	if len(options.Servers) == 0 {
		return nil, nil
	}
	if !processSupported() {
		return nil, errors.New("lsp: managed stdio language servers are unsupported on this platform")
	}
	if h == nil {
		return nil, errors.New("lsp: a running harness is required")
	}
	files, err := fstools.OpenWorkspace(options.Workspace)
	if err != nil {
		return nil, err
	}
	app := &App{files: files, environment: append([]string(nil), options.Environment...), instances: map[string]*instance{}}
	names, extensions := map[string]bool{}, map[string]bool{}
	for _, selection := range options.Servers {
		if names[selection.Server.Name] {
			files.Close()
			return nil, errors.New("lsp: duplicate selected server name")
		}
		names[selection.Server.Name] = true
		copied := selection
		copied.Server.Config.Args = append([]string(nil), selection.Server.Config.Args...)
		copied.Server.Config.Env = append([]EnvironmentVariable(nil), selection.Server.Config.Env...)
		copied.Server.Config.ExtensionToLanguage = append([]LanguageMapping(nil), selection.Server.Config.ExtensionToLanguage...)
		for _, mapping := range copied.Server.Config.ExtensionToLanguage {
			if extensions[mapping.Extension] {
				files.Close()
				return nil, errors.New("lsp: multiple selected servers map the same extension; select one configuration")
			}
			extensions[mapping.Extension] = true
		}
		if _, err := prepare(copied, files.Path(), app.environment); err != nil {
			files.Close()
			return nil, err
		}
		app.selections = append(app.selections, copied)
	}
	definition := point.Define(point.Descriptor{ID: "harness/contribution/claude-lsp", Requires: []point.Requirement{point.Require(harness.ToolRegistryKey)}}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
		app.owner, app.cancel = context.WithCancel(run.Context)
		if err := run.Defer("lsp/servers", func(context.Context) error { return app.shutdown() }); err != nil {
			return nil, err
		}
		if err := app.registerDiagnostics(run, h); err != nil {
			return nil, err
		}
		_, err := h.Tools().Register(run, harness.Tool{Schema: harness.ToolSchema{Name: "LSP", Description: "Query a selected, initialized language server. operation: goToDefinition, findReferences, hover, documentSymbol, workspaceSymbol, goToImplementation, prepareCallHierarchy, incomingCalls, outgoingCalls. filePath is a workspace file; line and character are positive one-based UTF-16 cursor coordinates. workspaceSymbol searches the identifier at that cursor. Call hierarchy queries prepare the item at the cursor before querying edges. findReferences includes the declaration. Unsupported server capabilities return errors. This tool does not edit files or execute server commands.", InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{"operation":{"type":"string","enum":["goToDefinition","findReferences","hover","documentSymbol","workspaceSymbol","goToImplementation","prepareCallHierarchy","incomingCalls","outgoingCalls"]},"filePath":{"type":"string","minLength":1},"line":{"type":"integer","minimum":1},"character":{"type":"integer","minimum":1}},"required":["operation","filePath","line","character"]}`)}, IsConcurrencySafe: func(context.Context, harness.ToolRequest) bool { return true }, ExecuteRequest: func(ctx context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
			var input Query
			if err := json.Unmarshal(request.Arguments, &input); err != nil {
				return harness.ToolResult{}, err
			}
			result, err := app.Query(ctx, request.Agent, input)
			if err != nil {
				return harness.ToolResult{}, err
			}
			text, truncated := result.Format()
			meta, _ := json.Marshal(struct {
				Operation Operation `json:"operation"`
				Truncated bool      `json:"truncated"`
			}{input.Operation, truncated})
			return harness.ToolResult{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: text}}, Meta: meta}, nil
		}})
		return nil, err
	})
	app.instanceOwner, err = h.Runtime().Mount(nil, "claude-lsp", definition, nil)
	if err == nil {
		err = app.instanceOwner.WaitStable(ctx)
	}
	if err == nil && app.instanceOwner.Snapshot().State == point.Failed {
		err = errors.New("lsp: contribution activation failed")
	}
	if err != nil {
		if app.instanceOwner != nil {
			_ = app.instanceOwner.Dispose(context.Background())
		} else {
			files.Close()
		}
		return nil, err
	}
	return app, nil
}

func (app *App) shutdown() error {
	app.mu.Lock()
	app.closed = true
	if app.cancel != nil {
		app.cancel()
	}
	instances := make([]*instance, 0, len(app.instances))
	for _, instance := range app.instances {
		instances = append(instances, instance)
	}
	app.mu.Unlock()
	var wait sync.WaitGroup
	for _, server := range instances {
		wait.Add(1)
		go func() {
			defer wait.Done()
			<-server.gate
			if server.conn != nil {
				server.conn.close(server.selected.Server.Config.ShutdownTimeout)
			}
		}()
	}
	wait.Wait()
	return app.files.Close()
}

func (app *App) Close() error {
	if app == nil || app.instanceOwner == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return app.instanceOwner.Dispose(ctx)
}
