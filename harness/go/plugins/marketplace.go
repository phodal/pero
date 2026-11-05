package plugins

import (
	"encoding/json"
	"slices"
	"sort"
)

// marketplaceSelection is the decoded entry. Paths stay relative to the plugin,
// and the installation identity does not replace a present manifest's name.
type marketplaceSelection struct {
	manifest      manifestDefinition
	strict        bool
	path, field   string
	hasComponents bool
}

func parseMarketplaceSelection(path, field string, entry marketplaceEntry, fields map[string]json.RawMessage) (marketplaceSelection, []Diagnostic) {
	manifestFields := make(map[string]json.RawMessage)
	for key, value := range fields {
		switch key {
		case "source", "strict", "category", "tags", "relevance", "headers", "headersHelper":
		default:
			manifestFields[key] = value
		}
	}
	raw, _ := json.Marshal(manifestFields)
	manifest, diagnostics := parseManifest(path, entry.Name, raw)
	selection := marketplaceSelection{manifest: manifest, strict: entry.Strict == nil || *entry.Strict, path: path, field: field}
	if value, ok := fields["strict"]; ok && string(value) == "null" {
		diagnostics = append(diagnostics, Diagnostic{SeverityError, "INVALID_MARKETPLACE_ENTRY", path, "strict", "Strict must be a boolean."})
	}
	for _, key := range []string{"commands", "agents", "skills", "hooks", "outputStyles", "themes"} {
		if _, ok := fields[key]; ok {
			selection.hasComponents = true
		}
	}
	if manifest.Hooks != nil {
		var events map[string]json.RawMessage
		if json.Unmarshal(manifest.Hooks, &events) != nil || events == nil {
			diagnostics = append(diagnostics, Diagnostic{SeverityError, "INVALID_MARKETPLACE_HOOKS", path, "hooks", "Marketplace hooks must be an inline event map."})
		} else {
			for event := range events {
				selection.manifest.EntryEvents = append(selection.manifest.EntryEvents, event)
			}
			sort.Strings(selection.manifest.EntryEvents)
			selection.manifest.EntryHooks, _ = json.Marshal(struct {
				Hooks map[string]json.RawMessage `json:"hooks"`
			}{events})
		}
	}
	if _, ok := fields["headersHelper"]; ok {
		diagnostics = append(diagnostics, Diagnostic{SeverityError, "UNSUPPORTED_MARKETPLACE_COMPONENT", path, "headersHelper", "Archive download headers are not implemented by local inspection."})
	}
	for i := range diagnostics {
		diagnostics[i].Field = field + "." + diagnostics[i].Field
	}
	return selection, diagnostics
}

func (entry marketplaceSelection) compose(manifest manifestDefinition, present bool) (manifestDefinition, []Diagnostic) {
	if !present {
		// The entry is the manifest, including MCP and LSP. Its hooks are already
		// the ordinary manifest hooks; no second replacement pass is needed.
		value := entry.manifest
		value.EntryHooks, value.EntryEvents = nil, nil
		return value, nil
	}
	if !entry.strict && entry.hasComponents {
		return manifest, []Diagnostic{{SeverityError, "CONFLICTING_MANIFESTS", entry.path, entry.field, "Strict=false conflicts with entry components when plugin.json exists."}}
	}
	for _, selection := range entry.manifest.Components {
		if selection.Explicit {
			manifest.Components = append(manifest.Components, selection)
		}
	}
	manifest.EntryHooks, manifest.EntryEvents = entry.manifest.EntryHooks, entry.manifest.EntryEvents
	return manifest, nil
}

func replaceHookEvents[T any](original, replacement []T, events []string, eventOf func(T) string) []T {
	result := make([]T, 0, len(original)+len(replacement))
	for _, hook := range original {
		replaced := slices.Contains(events, eventOf(hook))
		if !replaced {
			result = append(result, hook)
		}
	}
	return append(result, replacement...)
}
