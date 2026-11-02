package plugins

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const maxConfigurationBytes = 1 << 20
const maxComponents = 2048

type marketplaceEntry struct {
	Name    string          `json:"name"`
	Version string          `json:"version"`
	Source  json.RawMessage `json:"source"`
}

// Inspect reads a local plugin or local marketplace. Relative component paths
// are opened under os.Root; neither process environment nor executables are read.
func Inspect(ctx context.Context, path string) (Report, error) {
	report := Report{SchemaVersion: 1, InspectionOnly: true, Plugins: []Plugin{}, Diagnostics: []Diagnostic{}}
	root, err := os.OpenRoot(path)
	if err != nil {
		return report, fmt.Errorf("plugins: open inspection directory: %w", err)
	}
	defer root.Close()
	if err := ctx.Err(); err != nil {
		return report, err
	}
	content, err := readConfiguration(root, ".claude-plugin/marketplace.json")
	if errors.Is(err, os.ErrNotExist) {
		absolute, err := filepath.Abs(path)
		if err != nil {
			return report, err
		}
		plugin, diagnostics := inspectPlugin(ctx, root, filepath.Base(absolute), ".")
		report.Plugins = append(report.Plugins, plugin)
		report.Diagnostics = append(report.Diagnostics, diagnostics...)
	} else if err != nil {
		report.Diagnostics = append(report.Diagnostics, readDiagnostic(".claude-plugin/marketplace.json"))
	} else {
		inspectMarketplace(ctx, root, content, &report)
	}
	if err := ctx.Err(); err != nil {
		return report, err
	}
	sort.SliceStable(report.Diagnostics, func(i, j int) bool {
		a, b := report.Diagnostics[i], report.Diagnostics[j]
		if a.Path != b.Path {
			return a.Path < b.Path
		}
		if a.Field != b.Field {
			return a.Field < b.Field
		}
		return a.Code < b.Code
	})
	return report, nil
}

func inspectMarketplace(ctx context.Context, root *os.Root, content []byte, report *Report) {
	const path = ".claude-plugin/marketplace.json"
	var input struct {
		Name  string `json:"name"`
		Owner struct {
			Name string `json:"name"`
		} `json:"owner"`
		Plugins []json.RawMessage `json:"plugins"`
	}
	if json.Unmarshal(content, &input) != nil || input.Name == "" || input.Owner.Name == "" || input.Plugins == nil {
		report.Diagnostics = append(report.Diagnostics, Diagnostic{SeverityError, "INVALID_MARKETPLACE", path, "", "Expected a marketplace object with name, owner.name and plugins."})
		return
	}
	seen := make(map[string]bool)
	for i, rawEntry := range input.Plugins {
		if ctx.Err() != nil {
			return
		}
		field := fmt.Sprintf("plugins[%d]", i)
		var entry marketplaceEntry
		var fields map[string]json.RawMessage
		if json.Unmarshal(rawEntry, &fields) != nil || fields == nil || json.Unmarshal(rawEntry, &entry) != nil {
			report.Diagnostics = append(report.Diagnostics, Diagnostic{SeverityError, "INVALID_MARKETPLACE_ENTRY", path, field, "Expected an entry object with correctly typed fields."})
			continue
		}
		// Entry metadata uses the same decoder as plugin.json. Entry-owned
		// execution declarations need strict/manifest precedence, not omission.
		manifestFields := make(map[string]json.RawMessage)
		for key, value := range fields {
			switch key {
			case "source", "strict", "category", "tags", "relevance", "headers", "headersHelper":
			default:
				manifestFields[key] = value
			}
		}
		metadata, _ := json.Marshal(manifestFields)
		_, entryDiagnostics := parseManifest(path, entry.Name, metadata)
		for _, d := range entryDiagnostics {
			d.Field = field + "." + d.Field
			report.Diagnostics = append(report.Diagnostics, d)
		}
		for _, key := range []string{"commands", "agents", "skills", "hooks", "outputStyles", "themes", "mcpServers", "lspServers", "userConfig", "channels", "headersHelper"} {
			if _, present := fields[key]; present {
				report.Diagnostics = append(report.Diagnostics, Diagnostic{SeverityError, "UNSUPPORTED_MARKETPLACE_COMPONENT", path, field + "." + key, "Entry-owned components are not yet inspected; declare components in plugin.json or inspect their files explicitly."})
			}
		}
		if !pluginNamePattern.MatchString(entry.Name) || seen[entry.Name] {
			report.Diagnostics = append(report.Diagnostics, Diagnostic{SeverityError, "INVALID_MARKETPLACE_ENTRY", path, field + ".name", "Entry names must be valid and unique within the marketplace."})
			continue
		}
		seen[entry.Name] = true
		var source string
		if json.Unmarshal(entry.Source, &source) != nil || (!strings.HasPrefix(source, "./") && source != ".") || !localPath(source) {
			report.Diagnostics = append(report.Diagnostics, Diagnostic{SeverityError, "UNSUPPORTED_MARKETPLACE_SOURCE", path, field + ".source", "Inspection requires a local ./ path contained in the marketplace; remote sources must be acquired separately."})
			continue
		}
		child, err := root.OpenRoot(filepath.FromSlash(source))
		if err != nil {
			report.Diagnostics = append(report.Diagnostics, Diagnostic{SeverityError, "UNREADABLE_PLUGIN", path, field + ".source", "Plugin directory is missing, unreadable or outside the marketplace."})
			continue
		}
		plugin, diagnostics := inspectPlugin(ctx, child, entry.Name, filepath.ToSlash(filepath.Clean(source)))
		_ = child.Close()
		plugin.MarketplaceVersion = entry.Version
		plugin.InstallName = entry.Name
		if plugin.Version != "" && entry.Version != "" && plugin.Version != entry.Version {
			diagnostics = append(diagnostics, Diagnostic{SeverityWarning, "VERSION_DRIFT", path, field + ".version", "Marketplace version differs from the plugin manifest version."})
		}
		report.Plugins = append(report.Plugins, plugin)
		report.Diagnostics = append(report.Diagnostics, diagnostics...)
	}
}

func inspectPlugin(ctx context.Context, root *os.Root, fallback, prefix string) (Plugin, []Diagnostic) {
	p := Plugin{Name: fallback, Path: prefix, Components: []Component{}, Hooks: HooksDefinition{InspectionOnly: true, Hooks: []HookSummary{}}, MCP: MCPDefinition{InspectionOnly: true, Servers: []MCPServerSummary{}}}
	manifestPath := joined(prefix, ".claude-plugin/plugin.json")
	content, err := readConfiguration(root, ".claude-plugin/plugin.json")
	var diagnostics []Diagnostic
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return p, []Diagnostic{readDiagnostic(manifestPath)}
	}
	p.ManifestPresent = err == nil
	definition, ds := parseManifest(manifestPath, fallback, content)
	diagnostics = append(diagnostics, ds...)
	p.Name, p.Version = definition.Name, definition.Version
	seenFiles := make(map[string]bool)
	for _, selection := range definition.Components {
		for _, path := range selection.Paths {
			discoverComponents(ctx, root, &p, &diagnostics, seenFiles, selection, path, prefix)
		}
	}
	// Runtime handler declarations are summarized, never passed to exec or MCP.
	loadIntegration(root, prefix, "hooks/hooks.json", definition.Hooks, func(path string, raw []byte) {
		value, ds := ParseHooks(path, raw)
		p.Hooks.Hooks = append(p.Hooks.Hooks, value.Hooks...)
		diagnostics = append(diagnostics, ds...)
	}, &diagnostics)
	loadIntegration(root, prefix, ".mcp.json", definition.MCP, func(path string, raw []byte) {
		value, ds := ParseMCP(path, raw)
		p.MCP = p.MCP.Merge(value)
		diagnostics = append(diagnostics, ds...)
	}, &diagnostics)
	p.inspectLSP(root, prefix, definition.LSP, &diagnostics)
	sort.Slice(p.Components, func(i, j int) bool {
		a, b := p.Components[i], p.Components[j]
		if a.Kind != b.Kind {
			return a.Kind < b.Kind
		}
		return a.QualifiedName < b.QualifiedName
	})
	seenNames := make(map[string]ComponentKind)
	for _, c := range p.Components {
		if c.Name == "" {
			continue // A malformed definition already carries its own diagnostic.
		}
		// Commands and skills share an invocation namespace; agents do not.
		domain := c.QualifiedName
		if c.Kind == ComponentAgent {
			domain = "agent/" + domain
		}
		if previous, ok := seenNames[domain]; ok {
			severity := SeverityError
			code := "DUPLICATE_COMPONENT"
			if previous != c.Kind {
				severity = SeverityWarning
				code = "INVOCATION_COLLISION"
			}
			diagnostics = append(diagnostics, Diagnostic{severity, code, c.Path, "name", "Multiple components share this identity; invocation precedence must be resolved before runtime activation."})
		}
		seenNames[domain] = c.Kind
	}
	return p, diagnostics
}

func discoverComponents(ctx context.Context, root *os.Root, plugin *Plugin, diagnostics *[]Diagnostic, seen map[string]bool, selection componentPaths, path, prefix string) {
	if ctx.Err() != nil {
		return
	}
	path = filepath.ToSlash(filepath.Clean(path))
	if !localPath(path) {
		*diagnostics = append(*diagnostics, Diagnostic{SeverityError, "INVALID_COMPONENT_PATH", joined(prefix, path), string(selection.Kind), "Component paths must remain inside the plugin."})
		return
	}
	info, err := root.Stat(filepath.FromSlash(path))
	if errors.Is(err, os.ErrNotExist) && !selection.Explicit {
		return
	}
	if err != nil {
		*diagnostics = append(*diagnostics, readDiagnostic(joined(prefix, path)))
		return
	}
	if !info.IsDir() {
		if selection.Kind == ComponentSkill || !strings.HasSuffix(path, ".md") {
			*diagnostics = append(*diagnostics, Diagnostic{SeverityError, "INVALID_COMPONENT_PATH", joined(prefix, path), string(selection.Kind), "Expected a Markdown component file."})
			return
		}
		readComponent(root, plugin, diagnostics, seen, selection.Kind, path, prefix)
		return
	}
	if selection.Kind == ComponentAgent && selection.Explicit {
		*diagnostics = append(*diagnostics, Diagnostic{SeverityError, "INVALID_AGENT_PATH", joined(prefix, path), "agents", "Explicit agent paths must reference Markdown files; omit the field to discover the default agents directory."})
		return
	}
	// Skills may name one skill directory or a directory of skill directories.
	if selection.Kind == ComponentSkill {
		if _, err := root.Stat(filepath.Join(path, "SKILL.md")); err == nil {
			readComponent(root, plugin, diagnostics, seen, selection.Kind, joined(path, "SKILL.md"), prefix)
			return
		}
	}
	directory, err := root.Open(filepath.FromSlash(path))
	if err != nil {
		*diagnostics = append(*diagnostics, readDiagnostic(joined(prefix, path)))
		return
	}
	children, err := directory.ReadDir(maxComponents + 1)
	_ = directory.Close()
	if err != nil && !errors.Is(err, io.EOF) {
		*diagnostics = append(*diagnostics, readDiagnostic(joined(prefix, path)))
		return
	}
	if len(children) > maxComponents {
		*diagnostics = append(*diagnostics, Diagnostic{SeverityError, "COMPONENT_LIMIT", joined(prefix, path), "", "Component directory exceeds the inspection limit."})
		return
	}
	sort.Slice(children, func(i, j int) bool { return children[i].Name() < children[j].Name() })
	for _, child := range children {
		if ctx.Err() != nil {
			return
		}
		candidate := joined(path, child.Name())
		if selection.Kind == ComponentSkill {
			if !child.IsDir() {
				continue
			}
			candidate = joined(candidate, "SKILL.md")
			if _, err := root.Stat(filepath.FromSlash(candidate)); errors.Is(err, os.ErrNotExist) {
				continue
			}
		} else {
			if child.IsDir() {
				*diagnostics = append(*diagnostics, Diagnostic{SeverityError, "UNSUPPORTED_COMPONENT_DIRECTORY", joined(prefix, candidate), string(selection.Kind), "Nested command and agent directories are not inspected; select Markdown files explicitly."})
				continue
			}
			if !strings.HasSuffix(child.Name(), ".md") {
				continue
			}
		}
		readComponent(root, plugin, diagnostics, seen, selection.Kind, candidate, prefix)
	}
}

func readComponent(root *os.Root, plugin *Plugin, diagnostics *[]Diagnostic, seen map[string]bool, kind ComponentKind, path, prefix string) {
	key := string(kind) + ":" + filepath.ToSlash(filepath.Clean(path))
	if seen[key] {
		return
	}
	seen[key] = true
	if len(plugin.Components) >= maxComponents {
		*diagnostics = append(*diagnostics, Diagnostic{SeverityError, "COMPONENT_LIMIT", joined(prefix, path), "", "Plugin exceeds the component inspection limit."})
		return
	}
	raw, err := readConfiguration(root, path)
	if err != nil {
		*diagnostics = append(*diagnostics, readDiagnostic(joined(prefix, path)))
		return
	}
	component, ds := ParseComponent(plugin.Name, kind, joined(prefix, path), raw)
	plugin.Components = append(plugin.Components, component)
	*diagnostics = append(*diagnostics, ds...)
}

// Default integration files are merged with explicit declarations. The same
// file referenced explicitly is read once; summaries never contain raw values.
func loadIntegration(root *os.Root, prefix, standard string, explicit json.RawMessage, parse func(string, []byte), diagnostics *[]Diagnostic) {
	var sources []json.RawMessage
	if explicit != nil {
		trimmed := strings.TrimSpace(string(explicit))
		if strings.HasPrefix(trimmed, "[") {
			if json.Unmarshal(explicit, &sources) != nil {
				sources = []json.RawMessage{explicit}
			}
		} else {
			sources = []json.RawMessage{explicit}
		}
	}
	seen := make(map[string]bool)
	if raw, err := readConfiguration(root, standard); err == nil {
		parse(joined(prefix, standard), raw)
		seen[standard] = true
	} else if !errors.Is(err, os.ErrNotExist) {
		*diagnostics = append(*diagnostics, readDiagnostic(joined(prefix, standard)))
		seen[standard] = true
	}
	for _, source := range sources {
		var path string
		if json.Unmarshal(source, &path) == nil && path != "" {
			if !strings.HasPrefix(path, "./") || !localPath(path) {
				*diagnostics = append(*diagnostics, Diagnostic{SeverityError, "INVALID_INTEGRATION_PATH", joined(prefix, ".claude-plugin/plugin.json"), standard, "Integration paths must start with ./ and stay inside the plugin."})
				continue
			}
			path = filepath.ToSlash(filepath.Clean(path))
			if seen[path] {
				continue
			}
			seen[path] = true
			raw, err := readConfiguration(root, path)
			if err != nil {
				*diagnostics = append(*diagnostics, readDiagnostic(joined(prefix, path)))
				continue
			}
			parse(joined(prefix, path), raw)
			continue
		}
		var inline map[string]json.RawMessage
		if json.Unmarshal(source, &inline) != nil || inline == nil {
			*diagnostics = append(*diagnostics, Diagnostic{SeverityError, "INVALID_INTEGRATION", joined(prefix, ".claude-plugin/plugin.json"), standard, "Expected a path, inline object or an array containing paths and inline objects."})
			continue
		}
		key := "hooks"
		if standard == ".lsp.json" {
			parse(joined(prefix, ".claude-plugin/plugin.json"), source)
			continue
		}
		if standard == ".mcp.json" {
			key = "mcpServers"
		}
		wrapped, _ := json.Marshal(map[string]json.RawMessage{key: source})
		parse(joined(prefix, ".claude-plugin/plugin.json"), wrapped)
	}
}

func readConfiguration(root *os.Root, path string) ([]byte, error) {
	before, err := root.Stat(filepath.FromSlash(path))
	if err != nil {
		return nil, err
	}
	if !before.Mode().IsRegular() || before.Size() > maxConfigurationBytes {
		return nil, errors.New("configuration must be a regular file within the size limit")
	}
	f, err := root.Open(filepath.FromSlash(path))
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > maxConfigurationBytes {
		return nil, errors.New("configuration must be a regular file within the size limit")
	}
	content, err := io.ReadAll(io.LimitReader(f, maxConfigurationBytes+1))
	if len(content) > maxConfigurationBytes {
		return nil, errors.New("configuration exceeds the size limit")
	}
	return content, err
}

func joined(prefix, path string) string { return filepath.ToSlash(filepath.Join(prefix, path)) }
func readDiagnostic(path string) Diagnostic {
	return Diagnostic{SeverityError, "UNREADABLE_CONFIGURATION", path, "", "Configuration is missing, outside the selected root, unreadable, nonregular or exceeds 1 MiB."}
}
