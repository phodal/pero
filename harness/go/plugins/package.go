package plugins

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/lsp"
)

// Package is a compiled local package, not permission to run it. Connection and
// hook payloads remain private even when its non-secret definition is encoded.
type Package struct {
	Root       string                `json:"-"`
	Definition Plugin                `json:"definition"`
	Resources  []string              `json:"resources"`
	Hooks      []claudehooks.Hook    `json:"-"`
	MCP        []MCPServerDefinition `json:"-"`
	LSP        []lsp.Server          `json:"-"`
}

type MCPServerDefinition struct {
	Name                string            `json:"name"`
	Transport           string            `json:"transport"`
	Command             string            `json:"-"`
	Args                []string          `json:"-"`
	Env                 map[string]string `json:"-"`
	URL                 string            `json:"-"`
	Headers             map[string]string `json:"-"`
	HeadersHelper       string            `json:"-"`
	TimeoutMilliseconds int               `json:"timeoutMilliseconds,omitempty"`
}

// LoadPackages compiles local directories or local marketplace entries without
// expanding environment variables, running hooks, or connecting MCP servers.
func LoadPackages(ctx context.Context, directories []string) ([]Package, error) {
	packages := make([]Package, 0)
	seenRoots, seenNames := make(map[string]bool), make(map[string]bool)
	for _, directory := range directories {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if strings.TrimSpace(directory) == "" {
			return nil, errors.New("plugins: an explicit package directory is required")
		}
		absolute, err := filepath.Abs(directory)
		if err != nil {
			return nil, errors.New("plugins: package directory cannot be resolved")
		}
		base, err := filepath.EvalSymlinks(absolute)
		if err != nil {
			return nil, errors.New("plugins: package directory is unavailable")
		}
		report, err := Inspect(ctx, base)
		if err != nil {
			return nil, err
		}
		if err := packageDiagnostics(report.Diagnostics); err != nil {
			return nil, err
		}
		for _, definition := range report.Plugins {
			rootPath, err := filepath.EvalSymlinks(filepath.Join(base, filepath.FromSlash(definition.Path)))
			if err != nil {
				return nil, errors.New("plugins: selected package directory is unavailable")
			}
			relative, err := filepath.Rel(base, rootPath)
			if err != nil || (relative != "." && !filepath.IsLocal(relative)) {
				return nil, errors.New("plugins: package directory is outside the selected source")
			}
			if seenRoots[rootPath] || seenNames[definition.Name] {
				return nil, errors.New("plugins: duplicate package directory or namespace")
			}
			seenRoots[rootPath], seenNames[definition.Name] = true, true
			for i := range definition.Components {
				path, err := filepath.Rel(filepath.FromSlash(definition.Path), filepath.FromSlash(definition.Components[i].Path))
				if err != nil || !filepath.IsLocal(path) {
					return nil, errors.New("plugins: component is outside its package directory")
				}
				definition.Components[i].Path = filepath.ToSlash(path)
			}
			definition.Path = "."
			value, err := compilePackage(ctx, rootPath, definition)
			if err != nil {
				return nil, err
			}
			packages = append(packages, value)
		}
	}
	return packages, nil
}

func packageDiagnostics(diagnostics []Diagnostic) error {
	for _, diagnostic := range diagnostics {
		if diagnostic.Severity == SeverityWarning && diagnostic.Code == "UNSUPPORTED_COMPONENT_FIELD" && diagnostic.Field == "whenToUse" {
			continue // Claude ignores this nonstandard descriptive field.
		}
		unsupported := strings.HasPrefix(diagnostic.Code, "UNSUPPORTED_") || strings.HasPrefix(diagnostic.Code, "UNKNOWN_HOOK_") || strings.HasPrefix(diagnostic.Code, "UNKNOWN_MCP_")
		if diagnostic.Severity == SeverityError || unsupported {
			return fmt.Errorf("plugins: %s at %s (%s): %s", diagnostic.Code, diagnostic.Path, diagnostic.Field, diagnostic.Message)
		}
	}
	return nil
}

func compilePackage(ctx context.Context, path string, definition Plugin) (Package, error) {
	value := Package{Root: path, Definition: definition, Resources: []string{}, Hooks: []claudehooks.Hook{}, MCP: []MCPServerDefinition{}}
	root, err := os.OpenRoot(path)
	if err != nil {
		return Package{}, errors.New("plugins: cannot open package directory")
	}
	defer root.Close()
	manifest, err := readConfiguration(root, ".claude-plugin/plugin.json")
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return Package{}, errors.New("plugins: cannot read package manifest")
	}
	if errors.Is(err, os.ErrNotExist) {
		manifest = nil
	}
	if string(manifest) != definition.manifestSource {
		return Package{}, errors.New("plugins: manifest changed during package compilation")
	}
	parsed := definition.manifest
	var diagnostics []Diagnostic
	excluded := make(map[string]bool)
	value.LSP = append([]lsp.Server(nil), definition.lsp.servers...)
	for _, source := range definition.lsp.sources {
		excluded[source] = true
	}
	var compileErr error
	loadIntegration(root, "", "hooks/hooks.json", parsed.Hooks, func(path string, raw []byte) {
		excluded[path] = true
		if compileErr != nil {
			return
		}
		hooks, err := compileHooks(path, raw)
		if err != nil {
			compileErr = err
			return
		}
		value.Hooks = append(value.Hooks, hooks...)
	}, &diagnostics)
	if parsed.EntryHooks != nil {
		hooks, err := compileHooks(".claude-plugin/marketplace.json", parsed.EntryHooks)
		if err != nil {
			return Package{}, err
		}
		value.Hooks = replaceHookEvents(value.Hooks, hooks, parsed.EntryEvents, func(h claudehooks.Hook) string { return h.Event })
	}
	positions := make(map[string]int)
	loadIntegration(root, "", ".mcp.json", parsed.MCP, func(path string, raw []byte) {
		excluded[path] = true
		if compileErr != nil {
			return
		}
		servers, err := compileMCP(path, raw)
		if err != nil {
			compileErr = err
			return
		}
		for _, server := range servers {
			if position, exists := positions[server.Name]; exists {
				value.MCP[position] = server
			} else {
				positions[server.Name] = len(value.MCP)
				value.MCP = append(value.MCP, server)
			}
		}
	}, &diagnostics)
	if compileErr != nil {
		return Package{}, compileErr
	}
	if err := packageDiagnostics(diagnostics); err != nil {
		return Package{}, err
	}
	resources, err := packageResources(ctx, root, excluded)
	if err != nil {
		return Package{}, err
	}
	value.Resources = resources
	return value, nil
}

// hookTimeoutSeconds is the external hook timeout in either JSON or YAML.
type hookTimeoutSeconds float64

func (seconds hookTimeoutSeconds) duration() (time.Duration, error) {
	nanoseconds := float64(seconds) * float64(time.Second)
	if math.IsNaN(nanoseconds) || nanoseconds < 1 || nanoseconds >= float64(math.MaxInt64) {
		return 0, errors.New("plugins: hook timeout is outside the supported duration range")
	}
	return time.Duration(nanoseconds), nil
}

func compileHooks(path string, raw []byte) ([]claudehooks.Hook, error) {
	_, diagnostics := ParseHooks(path, raw)
	if err := packageDiagnostics(diagnostics); err != nil {
		return nil, err
	}
	var root map[string]json.RawMessage
	if json.Unmarshal(raw, &root) != nil {
		return nil, errors.New("plugins: invalid runtime hook declaration")
	}
	encoded := root["hooks"]
	if encoded == nil {
		if bare, ok := bareHookEvents(root); ok {
			rawBare, err := json.Marshal(bare)
			if err != nil {
				return nil, err
			}
			encoded = rawBare
		}
	}
	var wire struct {
		Hooks map[string][]struct {
			Matcher string `json:"matcher"`
			Hooks   []struct {
				Type            string            `json:"type"`
				Command         string            `json:"command"`
				Args            *[]string         `json:"args"`
				Timeout         *float64          `json:"timeout"`
				Async           bool              `json:"async"`
				AsyncRewake     bool              `json:"asyncRewake"`
				If              string            `json:"if"`
				Once            bool              `json:"once"`
				OnFailure       string            `json:"onFailure"`
				Shell           string            `json:"shell"`
				StatusMessage   string            `json:"statusMessage"`
				URL             string            `json:"url"`
				Headers         map[string]string `json:"headers"`
				AllowedEnvVars  []string          `json:"allowedEnvVars"`
				Prompt          string            `json:"prompt"`
				Model           string            `json:"model"`
				ContinueOnBlock bool              `json:"continueOnBlock"`
				Server          string            `json:"server"`
				Tool            string            `json:"tool"`
				Input           json.RawMessage   `json:"input"`
			} `json:"hooks"`
		} `json:"hooks"`
	}
	if encoded != nil {
		if json.Unmarshal(encoded, &wire.Hooks) != nil && json.Unmarshal(raw, &wire) != nil {
			return nil, errors.New("plugins: invalid runtime hook declaration")
		}
	}
	var events []string
	for event := range wire.Hooks {
		events = append(events, event)
	}
	sort.Strings(events)
	var hooks []claudehooks.Hook
	for _, event := range events {
		for _, group := range wire.Hooks[event] {
			for _, handler := range group.Hooks {
				if handler.OnFailure != "" && handler.OnFailure != "continue" && handler.OnFailure != "block" {
					return nil, errors.New("plugins: hook onFailure must be continue or block")
				}
				if handler.Shell != "" && handler.Shell != "bash" && handler.Shell != "powershell" {
					return nil, errors.New("plugins: hook shell must be bash or powershell")
				}
				if handler.Type == "http" && !validHookURL(handler.URL) {
					return nil, errors.New("plugins: HTTP hook requires an http or https URL")
				}
				if (handler.Type == "prompt" || handler.Type == "agent") && strings.TrimSpace(handler.Prompt) == "" {
					return nil, errors.New("plugins: prompt hook requires a nonempty prompt")
				}
				if handler.Type == "mcp_tool" && (strings.TrimSpace(handler.Server) == "" || strings.TrimSpace(handler.Tool) == "") {
					return nil, errors.New("plugins: MCP tool hook requires a server and tool")
				}
				// Settings hooks ignore once. Skill and agent frontmatter honor it.
				if len(handler.StatusMessage) > 256 {
					return nil, errors.New("plugins: hook statusMessage must be at most 256 bytes")
				}
				hook := claudehooks.Hook{Event: event, Matcher: group.Matcher, Command: handler.Command, Async: handler.Async, AsyncRewake: handler.AsyncRewake, If: handler.If, Shell: handler.Shell, StatusMessage: handler.StatusMessage, OnFailure: handler.OnFailure, URL: handler.URL, Headers: handler.Headers, AllowedEnvVars: append([]string(nil), handler.AllowedEnvVars...), Prompt: handler.Prompt, Model: handler.Model, ContinueOnBlock: handler.ContinueOnBlock, Agent: handler.Type == "agent", MCPServer: handler.Server, MCPTool: handler.Tool, MCPInput: append(json.RawMessage(nil), handler.Input...)}
				if event == "Stop" {
					hook.Matcher = ""
				}
				if handler.Args != nil && !(len(*handler.Args) == 0 && len(strings.Fields(handler.Command)) > 1) {
					hook.ExecForm = true
					hook.Args = append([]string{}, (*handler.Args)...)
				}
				if handler.Timeout != nil {
					duration, err := hookTimeoutSeconds(*handler.Timeout).duration()
					if err != nil {
						return nil, err
					}
					hook.Timeout = duration
				}
				hooks = append(hooks, hook)
			}
		}
	}
	return hooks, nil
}

func compileMCP(path string, raw []byte) ([]MCPServerDefinition, error) {
	_, diagnostics := ParseMCP(path, raw)
	if err := packageDiagnostics(diagnostics); err != nil {
		return nil, err
	}
	servers, _ := integrationObject(raw)
	if wrapped, exists := servers["mcpServers"]; exists {
		servers, _ = integrationObject(wrapped)
	}
	var result []MCPServerDefinition
	for _, name := range sortedIntegrationKeys(servers) {
		var wire struct {
			Transport     string            `json:"type"`
			Command       string            `json:"command"`
			Args          []string          `json:"args"`
			Env           map[string]string `json:"env"`
			URL           string            `json:"url"`
			Headers       map[string]string `json:"headers"`
			HeadersHelper string            `json:"headersHelper"`
			Timeout       *float64          `json:"timeout"`
		}
		if json.Unmarshal(servers[name], &wire) != nil {
			return nil, errors.New("plugins: invalid runtime MCP declaration")
		}
		if wire.Transport == "" {
			wire.Transport = "stdio"
			if wire.URL != "" {
				wire.Transport = "http"
			}
		}
		server := MCPServerDefinition{Name: name, Transport: wire.Transport, Command: wire.Command, Args: wire.Args, Env: wire.Env, URL: wire.URL, Headers: wire.Headers, HeadersHelper: wire.HeadersHelper}
		if wire.Timeout != nil {
			if math.Trunc(*wire.Timeout) != *wire.Timeout || *wire.Timeout >= float64(math.MaxInt) {
				return nil, errors.New("plugins: MCP timeout requires an integer millisecond value within the supported range")
			}
			server.TimeoutMilliseconds = int(*wire.Timeout)
		}
		result = append(result, server)
	}
	return result, nil
}

func packageResources(ctx context.Context, root *os.Root, excluded map[string]bool) ([]string, error) {
	resources := make([]string, 0)
	var visit func(string) error
	visit = func(directory string) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		file, err := root.Open(filepath.FromSlash(directory))
		if err != nil {
			return errors.New("plugins: cannot enumerate package resources")
		}
		defer file.Close()
		for {
			children, err := file.ReadDir(128)
			if err != nil && !errors.Is(err, io.EOF) {
				return errors.New("plugins: cannot enumerate package resources")
			}
			for _, child := range children {
				if err := ctx.Err(); err != nil {
					return err
				}
				name := child.Name()
				if strings.HasPrefix(name, ".") || child.Type()&os.ModeSymlink != 0 || strings.HasSuffix(strings.ToLower(name), ".env") {
					continue
				}
				path := joined(directory, name)
				if excluded[path] || path == "hooks/hooks.json" {
					continue
				}
				if child.IsDir() {
					if err := visit(path); err != nil {
						return err
					}
					continue
				}
				if !textResourceExtension(filepath.Ext(name)) {
					continue
				}
				info, statErr := root.Lstat(filepath.FromSlash(path))
				if statErr != nil {
					return errors.New("plugins: cannot inspect package resource")
				}
				if !info.Mode().IsRegular() || info.Size() > maxConfigurationBytes {
					continue
				}
				raw, readErr := readConfiguration(root, path)
				if readErr != nil {
					return errors.New("plugins: cannot read package resource")
				}
				if !utf8.Valid(raw) || bytes.IndexByte(raw, 0) >= 0 {
					continue
				}
				resources = append(resources, path)
				if len(resources) > 1024 {
					return errors.New("plugins: package exceeds the 1024 text resource limit")
				}
			}
			if errors.Is(err, io.EOF) {
				return nil
			}
		}
	}
	if err := visit("."); err != nil {
		return nil, err
	}
	sort.Strings(resources)
	return resources, nil
}

func textResourceExtension(extension string) bool {
	switch strings.ToLower(extension) {
	case ".md", ".txt", ".json", ".yaml", ".yml", ".adoc", ".py", ".js", ".mjs", ".sh", ".xml", ".svg", ".csv", ".drawio",
		".toml", ".ts", ".tsx", ".jsx", ".html", ".htm", ".css", ".sql", ".rst", ".tex", ".mermaid", ".mmd", ".puml", ".plantuml", ".ini", ".cfg", ".conf", ".dot", ".go", ".rs", ".kt", ".c", ".h", ".cpp", ".java", ".r", ".ipynb":
		return true
	}
	return false
}
