package lsp

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/phodal/pero/harness/go/fstools"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/nativetools"
	point "github.com/phodal/pero/harness/go/runtime"
)

type Selection struct {
	Server     Server
	PluginRoot string
	PluginData string
}
type Options struct {
	Workspace   string
	Servers     []Selection
	Environment []string
}
type workspaceFolder struct {
	URI  string `json:"uri"`
	Name string `json:"name"`
}
type instanceKey struct {
	agent       *harness.Agent
	server, cwd string
}
type diagnosticKey struct {
	agent  *harness.Agent
	source *instance
	uri    string
}
type diagnosticCursor struct {
	version, generation int
}
type instance struct {
	gate                         chan struct{}
	selected                     Selection
	cwd                          string
	conn                         *connection
	capabilities                 capabilities
	launches                     int
	version                      int
	save, saveText               bool
	closed                       bool
	observedFile, observedDigest string
}
type App struct {
	mu            sync.Mutex
	files         *fstools.Workspace
	selections    []Selection
	environment   []string
	instances     map[instanceKey]*instance
	delivered     map[diagnosticKey]diagnosticCursor
	owner         context.Context
	cancel        context.CancelFunc
	closed        bool
	instanceOwner *point.Instance
}

type capabilities struct{ definition, references, implementation, hover, documentSymbol, workspaceSymbol, callHierarchy bool }

func capability(raw json.RawMessage) bool {
	trimmed := strings.TrimSpace(string(raw))
	return trimmed == "true" || strings.HasPrefix(trimmed, "{")
}
func (caps capabilities) supports(operation Operation) bool {
	switch operation {
	case collectDiagnostics:
		return true
	case Definition:
		return caps.definition
	case References:
		return caps.references
	case Implementation:
		return caps.implementation
	case Hover:
		return caps.hover
	case DocumentSymbol:
		return caps.documentSymbol
	case WorkspaceSymbol:
		return caps.workspaceSymbol
	default:
		return caps.callHierarchy
	}
}

func prepare(selection Selection, cwd string, ambient []string) (*exec.Cmd, error) {
	lookup := map[string]string{}
	for _, entry := range ambient {
		key, value, ok := strings.Cut(entry, "=")
		if ok && key != "" && !strings.ContainsAny(key+value, "\x00") {
			lookup[key] = value
		}
	}
	lookup["CLAUDE_PROJECT_DIR"], lookup["CLAUDE_PLUGIN_ROOT"] = cwd, selection.PluginRoot
	if selection.PluginData != "" {
		lookup["CLAUDE_PLUGIN_DATA"] = selection.PluginData
	}
	expand := func(value string) (string, error) {
		var invalid bool
		result := regexp.MustCompile(`\$\{([^}]+)\}`).ReplaceAllStringFunc(value, func(token string) string {
			key := token[2 : len(token)-1]
			replacement, found := lookup[key]
			if !found || (key == "CLAUDE_PLUGIN_ROOT" && replacement == "") {
				invalid = true
			}
			return replacement
		})
		if invalid || strings.ContainsRune(result, 0) {
			return "", errors.New("lsp: configuration references an unavailable environment binding")
		}
		return result, nil
	}
	env := map[string]string{}
	for _, name := range []string{"PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL"} {
		if value, ok := lookup[name]; ok {
			env[name] = value
		}
	}
	env["CLAUDE_PROJECT_DIR"] = cwd
	if selection.PluginRoot != "" {
		env["CLAUDE_PLUGIN_ROOT"] = selection.PluginRoot
	}
	if selection.PluginData != "" {
		env["CLAUDE_PLUGIN_DATA"] = selection.PluginData
	}
	for _, entry := range selection.Server.Config.Env {
		value, err := expand(entry.Value)
		if err != nil {
			return nil, err
		}
		env[entry.Name] = value
		lookup[entry.Name] = value
	}
	config := selection.Server.Config
	program, err := expand(config.Command)
	if err != nil {
		return nil, err
	}
	if !filepath.IsAbs(program) {
		if strings.ContainsRune(program, filepath.Separator) {
			program = filepath.Join(cwd, program)
		} else {
			found := ""
			for _, directory := range filepath.SplitList(env["PATH"]) {
				if !filepath.IsAbs(directory) {
					continue
				}
				candidate := filepath.Join(directory, program)
				info, err := os.Stat(candidate)
				if err == nil && info.Mode().IsRegular() && info.Mode().Perm()&0111 != 0 {
					found = candidate
					break
				}
			}
			if found == "" {
				return nil, errors.New("lsp: selected language server executable is unavailable")
			}
			program = found
		}
	}
	info, err := os.Stat(program)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0111 == 0 {
		return nil, errors.New("lsp: selected language server executable is unavailable")
	}
	if config.WorkspaceFolder != "" {
		folder, err := expand(config.WorkspaceFolder)
		if err != nil {
			return nil, err
		}
		if !filepath.IsAbs(folder) {
			folder = filepath.Join(cwd, folder)
		}
		folder, err = filepath.EvalSymlinks(folder)
		if err != nil || folder != cwd {
			return nil, errors.New("lsp: workspaceFolder must equal the querying session working directory")
		}
	}
	args := make([]string, len(config.Args))
	for i, arg := range config.Args {
		args[i], err = expand(arg)
		if err != nil {
			return nil, err
		}
	}
	command := exec.Command(program, args...)
	command.Dir = cwd
	keys := make([]string, 0, len(env))
	for key := range env {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		command.Env = append(command.Env, key+"="+env[key])
	}
	if command.Env == nil {
		command.Env = []string{}
	}
	return command, nil
}

func fileURI(path string) string {
	return (&url.URL{Scheme: "file", Path: filepath.ToSlash(path)}).String()
}

func (app *App) Query(ctx context.Context, agent *harness.Agent, query Query) (Result, error) {
	if agent == nil || agent.Session() == nil {
		return Result{}, errors.New("lsp: query requires an owning agent")
	}
	ctx, cancel := context.WithCancel(ctx)
	stop := context.AfterFunc(app.owner, cancel)
	defer func() { stop(); cancel() }()
	cwd, err := filepath.EvalSymlinks(agent.Session().WorkingDirectory())
	if err != nil {
		return Result{}, errors.New("lsp: session working directory is unavailable")
	}
	files := nativetools.WorkspaceForAgent(agent, app.files)
	if files == nil {
		return Result{}, errors.New("lsp: session working directory is outside the selected workspace")
	}
	relativeCWD, err := filepath.Rel(files.Path(), cwd)
	if err != nil || (relativeCWD != "." && !filepath.IsLocal(relativeCWD)) {
		return Result{}, errors.New("lsp: session working directory is outside the selected workspace")
	}
	selectedFiles := nativetools.WorkspaceForPath(agent, app.files, query.FilePath)
	if selectedFiles != files {
		// An explicit added-directory grant gets its own server root.
		files, cwd = selectedFiles, selectedFiles.Path()
	}
	file := query.FilePath
	if !filepath.IsAbs(file) {
		file = filepath.Join(cwd, file)
	}
	relative, err := filepath.Rel(files.Path(), file)
	if err != nil || !filepath.IsLocal(relative) {
		return Result{}, errors.New("lsp: source file is outside the selected workspace")
	}
	source, err := files.Read(ctx, filepath.ToSlash(relative))
	if err != nil {
		return Result{}, err
	}
	position, symbol, err := query.position(source.Text)
	if err != nil {
		return Result{}, err
	}
	app.mu.Lock()
	if app.closed {
		app.mu.Unlock()
		return Result{}, errors.New("lsp: contribution is closed")
	}
	selected := app.selectionFor(file)
	if selected == nil {
		app.mu.Unlock()
		return Result{}, errors.New("lsp: no selected language server maps this source extension")
	}
	key := instanceKey{agent: agent, server: selected.Server.Name, cwd: cwd}
	session := app.instances[key]
	if session == nil {
		if len(app.instances) >= 32 {
			app.mu.Unlock()
			return Result{}, errors.New("lsp: active workspace/server limit reached")
		}
		session = &instance{selected: *selected, cwd: cwd, gate: make(chan struct{}, 1)}
		session.gate <- struct{}{}
		app.instances[key] = session
	}
	app.mu.Unlock()
	select {
	case <-ctx.Done():
		return Result{}, ctx.Err()
	case <-session.gate:
	}
	defer func() { session.gate <- struct{}{} }()
	if session.closed {
		return Result{}, errors.New("lsp: owning agent is closed")
	}
	if err := ctx.Err(); err != nil {
		return Result{}, err
	}
	if err := session.ensure(ctx, app.environment); err != nil {
		return Result{}, err
	}
	language := ""
	longest := 0
	for _, mapping := range session.selected.Server.Config.ExtensionToLanguage {
		if strings.HasSuffix(file, mapping.Extension) && len(mapping.Extension) > longest {
			language = mapping.Language
			longest = len(mapping.Extension)
		}
	}
	if !session.capabilities.supports(query.Operation) && !session.conn.dynamicallySupports(query.Operation, file, language) {
		return Result{}, errors.New("lsp: initialized server does not support this operation for the selected document")
	}
	uri := fileURI(filepath.Join(files.Path(), relative))
	requestCtx, requestCancel := context.WithTimeout(ctx, session.selected.Server.Config.RequestTimeout)
	defer requestCancel()
	if session.selected.Server.Config.Diagnostics {
		session.observedFile, session.observedDigest = file, source.Digest
	}
	session.version++
	retainDocument := query.Operation == collectDiagnostics
	if previous := session.conn.diagnosticURI(); previous != "" {
		cleanup, done := context.WithTimeout(context.Background(), session.selected.Server.Config.ShutdownTimeout)
		session.conn.closeOpenDocument(cleanup)
		done()
	}
	session.conn.openDiagnostics(uri, session.version)
	closed := false
	closeDocument := func() {
		if closed {
			return
		}
		closed = true
		cleanup, done := context.WithTimeout(context.Background(), session.selected.Server.Config.ShutdownTimeout)
		defer done()
		session.conn.closeOpenDocument(cleanup)
	}
	if !retainDocument {
		defer closeDocument()
	}
	if err := session.conn.notify(requestCtx, "textDocument/didOpen", struct {
		Document struct {
			URI        string `json:"uri"`
			LanguageID string `json:"languageId"`
			Version    int    `json:"version"`
			Text       string `json:"text"`
		} `json:"textDocument"`
	}{Document: struct {
		URI        string `json:"uri"`
		LanguageID string `json:"languageId"`
		Version    int    `json:"version"`
		Text       string `json:"text"`
	}{uri, language, session.version, source.Text}}); err != nil {
		closeDocument()
		return Result{}, err
	}
	defer func() {
		if !session.conn.live() {
			session.conn.close(session.selected.Server.Config.ShutdownTimeout)
		}
	}()
	requestCancel()
	if query.Operation == collectDiagnostics && session.save {
		params := struct {
			Document textDocument `json:"textDocument"`
			Text     *string      `json:"text,omitempty"`
		}{Document: textDocument{URI: uri}}
		if session.saveText {
			params.Text = &source.Text
		}
		if err := session.conn.notify(ctx, "textDocument/didSave", params); err != nil {
			closeDocument()
			return Result{}, err
		}
	}
	result, err := session.query(ctx, query.Operation, uri, position, symbol)
	result.Diagnostics = session.conn.peekDiagnostics()
	result.diagnosticSource = session
	if retainDocument && err == nil {
		return result, nil
	}
	closeDocument()
	return result, err
}
func longestExtension(selection Selection, file string) int {
	longest := 0
	for _, mapping := range selection.Server.Config.ExtensionToLanguage {
		if strings.HasSuffix(file, mapping.Extension) {
			longest = max(longest, len(mapping.Extension))
		}
	}
	return longest
}

func (instance *instance) ensure(ctx context.Context, environment []string) error {
	if instance.conn != nil && instance.conn.live() {
		return nil
	}
	config := instance.selected.Server.Config
	if instance.conn != nil {
		instance.conn.close(config.ShutdownTimeout)
	}
	if instance.launches > 0 && (!config.RestartOnCrash || instance.launches > config.MaxRestarts) {
		return errors.New("lsp: language server restart policy exhausted")
	}
	command, err := prepare(instance.selected, instance.cwd, environment)
	if err != nil {
		return err
	}
	instance.launches++
	uri := fileURI(instance.cwd)
	conn, err := startConnection(command, config.Settings, uri)
	if err != nil {
		return err
	}
	instance.conn = conn
	startup, cancel := context.WithTimeout(ctx, config.StartupTimeout)
	defer cancel()
	params := struct {
		ProcessID             int               `json:"processId"`
		RootURI               string            `json:"rootUri"`
		Folders               []workspaceFolder `json:"workspaceFolders"`
		InitializationOptions JSONValue         `json:"initializationOptions"`
		Capabilities          struct {
			TextDocument struct {
				dynamicDocumentCapabilities
				Synchronization struct {
					DidSave bool `json:"didSave"`
				} `json:"synchronization"`
				PublishDiagnostics struct {
					VersionSupport bool `json:"versionSupport"`
				} `json:"publishDiagnostics"`
			} `json:"textDocument"`
			General struct {
				PositionEncodings []string `json:"positionEncodings"`
			} `json:"general"`
			Workspace struct {
				Symbol           dynamicRegistrationSupport `json:"symbol"`
				Configuration    bool                       `json:"configuration"`
				WorkspaceFolders bool                       `json:"workspaceFolders"`
			} `json:"workspace"`
		} `json:"capabilities"`
	}{ProcessID: os.Getpid(), RootURI: uri, Folders: []workspaceFolder{{URI: uri, Name: filepath.Base(instance.cwd)}}, InitializationOptions: config.InitializationOptions}
	enabled := dynamicRegistrationSupport{Dynamic: true}
	params.Capabilities.TextDocument.dynamicDocumentCapabilities = dynamicDocumentCapabilities{enabled, enabled, enabled, enabled, enabled, enabled}
	params.Capabilities.Workspace.Symbol = enabled
	params.Capabilities.General.PositionEncodings = []string{"utf-16"}
	params.Capabilities.TextDocument.PublishDiagnostics.VersionSupport = true
	params.Capabilities.TextDocument.Synchronization.DidSave = true
	params.Capabilities.Workspace.Configuration = true
	params.Capabilities.Workspace.WorkspaceFolders = true
	raw, err := conn.request(startup, "initialize", params)
	if err != nil {
		conn.close(config.ShutdownTimeout)
		return err
	}
	var response struct {
		Capabilities struct {
			PositionEncoding string          `json:"positionEncoding"`
			Sync             json.RawMessage `json:"textDocumentSync"`
			Definition       json.RawMessage `json:"definitionProvider"`
			References       json.RawMessage `json:"referencesProvider"`
			Implementation   json.RawMessage `json:"implementationProvider"`
			Hover            json.RawMessage `json:"hoverProvider"`
			DocumentSymbol   json.RawMessage `json:"documentSymbolProvider"`
			WorkspaceSymbol  json.RawMessage `json:"workspaceSymbolProvider"`
			CallHierarchy    json.RawMessage `json:"callHierarchyProvider"`
		} `json:"capabilities"`
	}
	if json.Unmarshal(raw, &response) != nil {
		conn.close(config.ShutdownTimeout)
		return errors.New("lsp: invalid initialize response")
	}
	caps := response.Capabilities
	if caps.PositionEncoding != "" && caps.PositionEncoding != "utf-16" {
		conn.close(config.ShutdownTimeout)
		return errors.New("lsp: server did not negotiate UTF-16 positions")
	}
	var syncKind int
	var syncOptions struct {
		OpenClose bool            `json:"openClose"`
		Save      json.RawMessage `json:"save"`
	}
	if !(json.Unmarshal(caps.Sync, &syncKind) == nil && (syncKind == 1 || syncKind == 2)) && !(json.Unmarshal(caps.Sync, &syncOptions) == nil && syncOptions.OpenClose) {
		conn.close(config.ShutdownTimeout)
		return errors.New("lsp: server does not support transient didOpen/didClose documents")
	}
	// Numeric sync kinds describe change handling; save options are object-only.
	_ = json.Unmarshal(caps.Sync, &syncOptions)
	instance.save = capability(syncOptions.Save)
	var saveOptions struct {
		IncludeText bool `json:"includeText"`
	}
	_ = json.Unmarshal(syncOptions.Save, &saveOptions)
	instance.saveText = saveOptions.IncludeText
	instance.capabilities = capabilities{capability(caps.Definition), capability(caps.References), capability(caps.Implementation), capability(caps.Hover), capability(caps.DocumentSymbol), capability(caps.WorkspaceSymbol), capability(caps.CallHierarchy)}
	if err := conn.notify(startup, "initialized", struct{}{}); err != nil {
		conn.close(config.ShutdownTimeout)
		return err
	}
	if err := conn.notify(startup, "workspace/didChangeConfiguration", struct {
		Settings JSONValue `json:"settings"`
	}{config.Settings}); err != nil {
		conn.close(config.ShutdownTimeout)
		return err
	}
	return nil
}

type textDocument struct {
	URI string `json:"uri"`
}
type documentParams struct {
	Document textDocument `json:"textDocument"`
}
type positionParams struct {
	Document textDocument `json:"textDocument"`
	Position Position     `json:"position"`
	Context  *struct {
		IncludeDeclaration bool `json:"includeDeclaration"`
	} `json:"context,omitempty"`
}

func (instance *instance) query(ctx context.Context, operation Operation, uri string, position Position, symbol string) (Result, error) {
	result := Result{Operation: operation}
	if operation == collectDiagnostics {
		wait, cancel := context.WithTimeout(ctx, min(instance.selected.Server.Config.RequestTimeout, 2*time.Second))
		defer cancel()
		return result, instance.conn.awaitDiagnostics(wait)
	}
	params := positionParams{Document: textDocument{URI: uri}, Position: position}
	method := ""
	switch operation {
	case Definition:
		method = "textDocument/definition"
	case References:
		method = "textDocument/references"
		params.Context = &struct {
			IncludeDeclaration bool `json:"includeDeclaration"`
		}{true}
	case Implementation:
		method = "textDocument/implementation"
	case Hover:
		method = "textDocument/hover"
	case PrepareCallHierarchy, IncomingCalls, OutgoingCalls:
		method = "textDocument/prepareCallHierarchy"
	}
	var raw json.RawMessage
	var err error
	switch operation {
	case DocumentSymbol:
		raw, err = instance.call(ctx, "textDocument/documentSymbol", documentParams{Document: textDocument{URI: uri}})
	case WorkspaceSymbol:
		if symbol == "" {
			return result, errors.New("lsp: workspaceSymbol requires an identifier at the source cursor")
		}
		raw, err = instance.call(ctx, "workspace/symbol", struct {
			Query string `json:"query"`
		}{symbol})
	default:
		raw, err = instance.call(ctx, method, params)
	}
	if err != nil {
		return result, err
	}
	switch operation {
	case Hover:
		result.Hover, err = decodeHover(raw)
	case DocumentSymbol, WorkspaceSymbol:
		result.Symbols, err = decodeSymbols(raw, uri)
	case PrepareCallHierarchy, IncomingCalls, OutgoingCalls:
		var items []hierarchyItem
		items, err = decodeHierarchy(raw)
		if err != nil {
			return result, err
		}
		for i, item := range items {
			if i == 100 {
				result.Truncated = true
				break
			}
			if operation == PrepareCallHierarchy {
				result.Symbols = append(result.Symbols, symbolFromHierarchy(item))
				continue
			}
			method := "callHierarchy/outgoingCalls"
			if operation == IncomingCalls {
				method = "callHierarchy/incomingCalls"
			}
			edges, callErr := instance.call(ctx, method, struct {
				Item hierarchyItem `json:"item"`
			}{item})
			if callErr != nil {
				return result, callErr
			}
			calls, callErr := decodeCalls(edges, operation == IncomingCalls, item.URI)
			if callErr != nil {
				return result, callErr
			}
			result.Calls = append(result.Calls, calls...)
		}
	default:
		result.Locations, err = decodeLocations(raw)
	}
	return result, err
}

func (instance *instance) call(ctx context.Context, method string, value any) (json.RawMessage, error) {
	bounded, cancel := context.WithTimeout(ctx, instance.selected.Server.Config.RequestTimeout)
	defer cancel()
	return instance.conn.request(bounded, method, value)
}
