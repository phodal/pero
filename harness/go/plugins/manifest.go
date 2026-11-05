package plugins

import (
	"encoding/json"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

var pluginNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)

// These are external format types. RawMessage stays at the decoding boundary;
// no manifest values are forwarded to a runtime or included in diagnostics.
type manifestInput struct {
	Name              string          `json:"name"`
	Version           string          `json:"version"`
	DisplayName       string          `json:"displayName"`
	Description       string          `json:"description"`
	Homepage          string          `json:"homepage"`
	Repository        string          `json:"repository"`
	License           string          `json:"license"`
	Keywords          []string        `json:"keywords"`
	Schema            string          `json:"$schema"`
	Icon              string          `json:"icon"`
	DocumentationURL  string          `json:"documentationUrl"`
	SupportURL        string          `json:"supportUrl"`
	PrivacyPolicyURL  string          `json:"privacyPolicyUrl"`
	TermsOfServiceURL string          `json:"termsOfServiceUrl"`
	Metadata          json.RawMessage `json:"metadata"`
	Author            json.RawMessage `json:"author"`
	Skills            json.RawMessage `json:"skills"`
	Commands          json.RawMessage `json:"commands"`
	Agents            json.RawMessage `json:"agents"`
	Hooks             json.RawMessage `json:"hooks"`
	MCPServers        json.RawMessage `json:"mcpServers"`
	LSPServers        json.RawMessage `json:"lspServers"`
}

type componentPaths struct {
	Kind     ComponentKind
	Paths    []string
	Explicit bool
}

type manifestDefinition struct {
	Name        string
	Version     string
	Components  []componentPaths
	Hooks       json.RawMessage
	MCP         json.RawMessage
	LSP         json.RawMessage
	EntryHooks  json.RawMessage
	EntryEvents []string
}

func parseManifest(path, fallback string, content []byte) (manifestDefinition, []Diagnostic) {
	d := manifestDefinition{Name: fallback}
	if content == nil {
		d.Components = defaultComponentPaths()
		return d, nil
	}
	var fields map[string]json.RawMessage
	var input manifestInput
	if json.Unmarshal(content, &fields) != nil || fields == nil || json.Unmarshal(content, &input) != nil {
		return d, []Diagnostic{{SeverityError, "INVALID_MANIFEST", path, "", "Expected a plugin manifest object with correctly typed fields."}}
	}
	d.Name, d.Version = input.Name, input.Version
	d.Hooks, d.MCP = input.Hooks, input.MCPServers
	d.LSP = input.LSPServers
	var diagnostics []Diagnostic
	if !pluginNamePattern.MatchString(input.Name) {
		diagnostics = append(diagnostics, Diagnostic{SeverityError, "INVALID_PLUGIN_NAME", path, "name", "A manifest requires a plugin name starting with a letter or digit and containing only letters, digits, dots, underscores or hyphens."})
	}
	if input.Metadata != nil {
		var metadata map[string]json.RawMessage
		if json.Unmarshal(input.Metadata, &metadata) != nil || metadata == nil {
			diagnostics = append(diagnostics, Diagnostic{SeverityError, "INVALID_MANIFEST", path, "metadata", "Manifest metadata must be an object."})
		}
	}
	if input.Author != nil {
		var author struct {
			Name  string `json:"name"`
			Email string `json:"email"`
			URL   string `json:"url"`
		}
		if json.Unmarshal(input.Author, &author) != nil || strings.TrimSpace(author.Name) == "" {
			diagnostics = append(diagnostics, Diagnostic{SeverityError, "INVALID_AUTHOR", path, "author", "Author must be an object with a nonempty name."})
		}
	}
	for _, item := range []struct {
		kind            ComponentKind
		field, standard string
		raw             json.RawMessage
	}{
		{ComponentSkill, "skills", "skills", input.Skills},
		{ComponentCommand, "commands", "commands", input.Commands},
		{ComponentAgent, "agents", "agents", input.Agents},
	} {
		selection := componentPaths{Kind: item.kind}
		if item.raw == nil {
			selection.Paths = append(selection.Paths, item.standard)
		}
		if item.raw != nil {
			if item.kind == ComponentSkill {
				d.Components = append(d.Components, componentPaths{Kind: ComponentSkill, Paths: []string{item.standard}})
			}
			selection.Explicit = true
			paths, ok := decodePaths(item.raw)
			if !ok {
				diagnostics = append(diagnostics, Diagnostic{SeverityError, "INVALID_COMPONENT_PATHS", path, item.field, "Expected a path string or an array of path strings."})
			} else {
				for _, p := range paths {
					if (!strings.HasPrefix(p, "./") && !(item.kind == ComponentSkill && p == ".")) || !localPath(p) {
						diagnostics = append(diagnostics, Diagnostic{SeverityError, "INVALID_COMPONENT_PATH", path, item.field, "Explicit component paths must start with ./ and remain inside the plugin."})
						continue
					}
					selection.Paths = append(selection.Paths, p)
				}
			}
		}
		d.Components = append(d.Components, selection)
	}
	metadata := map[string]bool{"$schema": true, "name": true, "displayName": true, "version": true, "description": true, "author": true, "homepage": true, "repository": true, "license": true, "keywords": true, "metadata": true, "icon": true, "documentationUrl": true, "supportUrl": true, "privacyPolicyUrl": true, "termsOfServiceUrl": true}
	known := map[string]bool{"skills": true, "commands": true, "agents": true, "hooks": true, "mcpServers": true, "lspServers": true}
	var keys []string
	for key := range fields {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if metadata[key] && strings.TrimSpace(string(fields[key])) == "null" {
			diagnostics = append(diagnostics, Diagnostic{SeverityError, "INVALID_MANIFEST_FIELD", path, key, "A declared metadata field must have its documented value type, not null."})
		}
		if !metadata[key] && !known[key] {
			diagnostics = append(diagnostics, Diagnostic{SeverityWarning, "UNSUPPORTED_MANIFEST_FIELD", path, key, "This field is not interpreted by the configuration inspector; runtime support is not implied."})
		}
	}
	return d, diagnostics
}

func defaultComponentPaths() []componentPaths {
	return []componentPaths{{Kind: ComponentSkill, Paths: []string{"skills"}}, {Kind: ComponentCommand, Paths: []string{"commands"}}, {Kind: ComponentAgent, Paths: []string{"agents"}}}
}

func decodePaths(raw json.RawMessage) ([]string, bool) {
	var single string
	if json.Unmarshal(raw, &single) == nil && single != "" {
		return []string{single}, true
	}
	var multiple []string
	if string(raw) == "null" || json.Unmarshal(raw, &multiple) != nil {
		return nil, false
	}
	for _, value := range multiple {
		if value == "" {
			return nil, false
		}
	}
	return multiple, true
}

func localPath(path string) bool {
	for _, part := range strings.Split(path, "/") {
		if part == ".." {
			return false
		}
	}
	return filepath.IsLocal(filepath.FromSlash(path)) && !strings.Contains(path, "\\")
}
