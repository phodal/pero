package harness

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"

	harnesstool "github.com/phodal/pero/harness/go/tool"

	point "github.com/phodal/pero/harness/go/runtime"
)

func (r *ToolRegistry) Schemas(scope *point.Scope) []ToolSchema {
	r.mu.RLock()
	result := make([]ToolSchema, 0, len(r.entries))
	for _, entries := range r.entries {
		entry, ok := nearestToolEntry(entries, scope)
		if !ok {
			continue
		}
		schema := cloneToolSchema(entry.tool.Schema)
		result = append(result, schema)
	}
	r.mu.RUnlock()
	sort.Slice(result, func(left, right int) bool { return result[left].Name < result[right].Name })
	return result
}

type resolvedToolView struct {
	scope      *point.Scope
	generation string
	tool       Tool
}

type resolvedSchemaView struct {
	scope      *point.Scope
	generation string
	schema     ToolSchema
}

// SchemasForAgent resolves the exact catalog that may execute for one Agent.
// Dynamic definitions replace only their paired global generation at the same
// scope; every other same-scope collision fails before the model request.
func (r *ToolRegistry) SchemasForAgent(ctx context.Context, agent *Agent) ([]ToolSchema, error) {
	if agent == nil {
		return nil, errors.New("harness: tool schema assembly requires an agent")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	r.mu.RLock()
	restrictions := visibleToolRestrictions(r.restrictions, agent)
	catalogs := make([]toolCatalogEntry, 0, len(r.catalogs))
	for _, catalog := range r.catalogs {
		if catalog.scope.Contains(agent.Scope()) {
			catalogs = append(catalogs, catalog)
		}
	}
	authoritative, authoritativeErr := authoritativeCatalog(catalogs)
	if authoritativeErr != nil {
		r.mu.RUnlock()
		return nil, authoritativeErr
	}
	if authoritative != nil {
		provider := authoritative.provider
		generation := authoritative.generation
		originScope := authoritative.scope
		ordinaryOrigins := make(map[string]*point.Scope, len(r.entries))
		for name, entries := range r.entries {
			if entry, ok := nearestToolEntry(entries, agent.Scope()); ok {
				ordinaryOrigins[name] = entry.scope
			}
		}
		r.mu.RUnlock()
		schemas, err := provider.Schemas(ctx, agent)
		if err != nil {
			return nil, fmt.Errorf("harness: resolve authoritative tool catalog %q: %w", generation, err)
		}
		validated, err := validateCatalogSchemas(generation, schemas)
		if err != nil {
			return nil, err
		}
		result := validated[:0]
		for _, schema := range validated {
			origin := originScope
			if ordinary := ordinaryOrigins[schema.Name]; ordinary != nil {
				origin = ordinary
			}
			if toolRestrictionsAdmit(restrictions, schema.Name, origin) {
				result = append(result, schema)
			}
		}
		return result, nil
	}
	if len(catalogs) == 0 {
		result := make([]ToolSchema, 0, len(r.entries))
		for _, entries := range r.entries {
			entry, ok := nearestToolEntry(entries, agent.Scope())
			if ok && toolRestrictionsAdmit(restrictions, entry.tool.Schema.Name, entry.scope) {
				result = append(result, cloneToolSchema(entry.tool.Schema))
			}
		}
		r.mu.RUnlock()
		sort.Slice(result, func(left, right int) bool { return result[left].Name < result[right].Name })
		return result, nil
	}
	views := make(map[string]resolvedSchemaView, len(r.entries))
	for name, entries := range r.entries {
		entry, ok := nearestToolEntry(entries, agent.Scope())
		if !ok {
			continue
		}
		views[name] = resolvedSchemaView{scope: entry.scope, generation: entry.generation, schema: cloneToolSchema(entry.tool.Schema)}
	}
	r.mu.RUnlock()

	for _, catalog := range catalogs {
		// The provider is the complete Agent view of its generation. Remove the
		// startup/global proxies first so scoped restrict() can make a tool absent.
		for name, current := range views {
			if current.scope == catalog.scope && current.generation == catalog.generation {
				delete(views, name)
			}
		}
		schemas, err := catalog.provider.Schemas(ctx, agent)
		if err != nil {
			return nil, fmt.Errorf("harness: resolve tool catalog %q: %w", catalog.generation, err)
		}
		seen := make(map[string]struct{}, len(schemas))
		for _, schema := range schemas {
			if schema.Name == "" {
				return nil, fmt.Errorf("harness: tool catalog %q returned an unnamed schema", catalog.generation)
			}
			if _, duplicate := seen[schema.Name]; duplicate {
				return nil, fmt.Errorf("harness: tool catalog %q returned duplicate name %q", catalog.generation, schema.Name)
			}
			seen[schema.Name] = struct{}{}
			if _, err := compileToolInputSchema(schema.Name, schema.InputSchema); err != nil {
				return nil, err
			}
			current, found := views[schema.Name]
			replace, mergeErr := mergeToolView(schema.Name, current.scope, current.generation, catalog.scope, catalog.generation, found)
			if mergeErr != nil {
				return nil, mergeErr
			}
			if replace {
				views[schema.Name] = resolvedSchemaView{scope: catalog.scope, generation: catalog.generation, schema: cloneToolSchema(schema)}
			}
		}
	}
	result := make([]ToolSchema, 0, len(views))
	for _, view := range views {
		if toolRestrictionsAdmit(restrictions, view.schema.Name, view.scope) {
			result = append(result, cloneToolSchema(view.schema))
		}
	}
	sort.Slice(result, func(left, right int) bool { return result[left].Name < result[right].Name })
	return result, nil
}

func authoritativeCatalog(catalogs []toolCatalogEntry) (*toolCatalogEntry, error) {
	var selected *toolCatalogEntry
	for index := range catalogs {
		if !catalogs[index].provider.Authoritative {
			continue
		}
		if selected == nil {
			candidate := catalogs[index]
			selected = &candidate
			continue
		}
		if selected.scope == catalogs[index].scope {
			return nil, fmt.Errorf("harness: authoritative tool catalogs %q and %q conflict at the same scope", selected.generation, catalogs[index].generation)
		}
		if selected.scope.Contains(catalogs[index].scope) {
			candidate := catalogs[index]
			selected = &candidate
			continue
		}
		if catalogs[index].scope.Contains(selected.scope) {
			continue
		}
		return nil, fmt.Errorf("harness: authoritative tool catalogs %q and %q have incomparable visible scopes", selected.generation, catalogs[index].generation)
	}
	return selected, nil
}

func validateCatalogSchemas(generation string, schemas []ToolSchema) ([]ToolSchema, error) {
	result := make([]ToolSchema, 0, len(schemas))
	seen := make(map[string]struct{}, len(schemas))
	for _, schema := range schemas {
		if schema.Name == "" {
			return nil, fmt.Errorf("harness: tool catalog %q returned an unnamed schema", generation)
		}
		if _, duplicate := seen[schema.Name]; duplicate {
			return nil, fmt.Errorf("harness: tool catalog %q returned duplicate name %q", generation, schema.Name)
		}
		seen[schema.Name] = struct{}{}
		if _, err := compileToolInputSchema(schema.Name, schema.InputSchema); err != nil {
			return nil, err
		}
		if len(schema.OutputSchema) != 0 {
			if _, err := harnesstool.CompileOutputSchema(schema.Name, schema.OutputSchema); err != nil {
				return nil, err
			}
		}
		result = append(result, cloneToolSchema(schema))
	}
	sort.Slice(result, func(left, right int) bool { return result[left].Name < result[right].Name })
	return result, nil
}

func (r *ToolRegistry) Resolve(scope *point.Scope, name string) (Tool, bool) {
	r.mu.RLock()
	entry, ok := nearestToolEntry(r.entries[name], scope)
	r.mu.RUnlock()
	if !ok {
		return Tool{}, false
	}
	return cloneTool(entry.tool), true
}

func (r *ToolRegistry) resolveForAgent(ctx context.Context, agent *Agent, name string) (Tool, bool, error) {
	if agent == nil {
		return Tool{}, false, errors.New("harness: tool resolution requires an agent")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	r.mu.RLock()
	entry, found := nearestToolEntry(r.entries[name], agent.Scope())
	restrictions := visibleToolRestrictions(r.restrictions, agent)
	catalogs := make([]toolCatalogEntry, 0, len(r.catalogs))
	for _, catalog := range r.catalogs {
		if catalog.scope.Contains(agent.Scope()) {
			catalogs = append(catalogs, catalog)
		}
	}
	r.mu.RUnlock()
	authoritative, authoritativeErr := authoritativeCatalog(catalogs)
	if authoritativeErr != nil {
		return Tool{}, false, authoritativeErr
	}
	if authoritative != nil {
		candidate, ok, err := authoritative.provider.Resolve(ctx, agent, name)
		if err != nil {
			return Tool{}, false, fmt.Errorf("harness: resolve tool %q from authoritative catalog %q: %w", name, authoritative.generation, err)
		}
		if !ok {
			return Tool{}, false, nil
		}
		candidate, err = prepareTool(candidate)
		if err != nil {
			return Tool{}, false, err
		}
		if candidate.Schema.Name != name {
			return Tool{}, false, fmt.Errorf("harness: authoritative tool catalog %q resolved %q as %q", authoritative.generation, name, candidate.Schema.Name)
		}
		origin := authoritative.scope
		if found {
			origin = entry.scope
		}
		if !toolRestrictionsAdmit(restrictions, name, origin) {
			return Tool{}, false, nil
		}
		return candidate, true, nil
	}
	if len(catalogs) == 0 {
		if !found || !toolRestrictionsAdmit(restrictions, name, entry.scope) {
			return Tool{}, false, nil
		}
		return cloneTool(entry.tool), true, nil
	}
	current := resolvedToolView{}
	if found {
		current = resolvedToolView{scope: entry.scope, generation: entry.generation, tool: entry.tool}
	}
	for _, catalog := range catalogs {
		if found && current.scope == catalog.scope && current.generation == catalog.generation {
			current = resolvedToolView{}
			found = false
		}
		candidate, ok, err := catalog.provider.Resolve(ctx, agent, name)
		if err != nil {
			return Tool{}, false, fmt.Errorf("harness: resolve tool %q from catalog %q: %w", name, catalog.generation, err)
		}
		if !ok {
			continue
		}
		candidate, err = prepareTool(candidate)
		if err != nil {
			return Tool{}, false, err
		}
		if candidate.Schema.Name != name {
			return Tool{}, false, fmt.Errorf("harness: tool catalog %q resolved %q as %q", catalog.generation, name, candidate.Schema.Name)
		}
		replace, mergeErr := mergeToolView(name, current.scope, current.generation, catalog.scope, catalog.generation, found)
		if mergeErr != nil {
			return Tool{}, false, mergeErr
		}
		if replace {
			current = resolvedToolView{scope: catalog.scope, generation: catalog.generation, tool: candidate}
			found = true
		}
	}
	if found && !toolRestrictionsAdmit(restrictions, name, current.scope) {
		return Tool{}, false, nil
	}
	return cloneTool(current.tool), found, nil
}

func (r *ToolRegistry) schemasForAgentBase(ctx context.Context, agent *Agent, excludedScope *point.Scope, excludedGeneration string) ([]ToolSchema, error) {
	if agent == nil {
		return nil, errors.New("harness: tool schema assembly requires an agent")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	r.mu.RLock()
	restrictions := visibleToolRestrictions(r.restrictions, agent)
	views := make(map[string]resolvedSchemaView, len(r.entries))
	for name, entries := range r.entries {
		entry, ok := nearestToolEntryExcluding(entries, agent.Scope(), excludedScope, excludedGeneration)
		if ok {
			views[name] = resolvedSchemaView{scope: entry.scope, generation: entry.generation, schema: cloneToolSchema(entry.tool.Schema)}
		}
	}
	catalogs := make([]toolCatalogEntry, 0, len(r.catalogs))
	for _, catalog := range r.catalogs {
		if catalog.provider.Authoritative || !catalog.scope.Contains(agent.Scope()) ||
			(catalog.scope == excludedScope && catalog.generation == excludedGeneration) {
			continue
		}
		catalogs = append(catalogs, catalog)
	}
	r.mu.RUnlock()
	for _, catalog := range catalogs {
		for name, current := range views {
			if current.scope == catalog.scope && current.generation == catalog.generation {
				delete(views, name)
			}
		}
		schemas, err := catalog.provider.Schemas(ctx, agent)
		if err != nil {
			return nil, fmt.Errorf("harness: resolve tool catalog %q: %w", catalog.generation, err)
		}
		validated, err := validateCatalogSchemas(catalog.generation, schemas)
		if err != nil {
			return nil, err
		}
		for _, schema := range validated {
			current, found := views[schema.Name]
			replace, mergeErr := mergeToolView(schema.Name, current.scope, current.generation, catalog.scope, catalog.generation, found)
			if mergeErr != nil {
				return nil, mergeErr
			}
			if replace {
				views[schema.Name] = resolvedSchemaView{scope: catalog.scope, generation: catalog.generation, schema: schema}
			}
		}
	}
	result := make([]ToolSchema, 0, len(views))
	for _, view := range views {
		if toolRestrictionsAdmit(restrictions, view.schema.Name, view.scope) {
			result = append(result, cloneToolSchema(view.schema))
		}
	}
	sort.Slice(result, func(left, right int) bool { return result[left].Name < result[right].Name })
	return result, nil
}

func (r *ToolRegistry) resolveForAgentBase(ctx context.Context, agent *Agent, name string, excludedScope *point.Scope, excludedGeneration string) (Tool, bool, error) {
	if agent == nil {
		return Tool{}, false, errors.New("harness: tool resolution requires an agent")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	r.mu.RLock()
	entry, found := nearestToolEntryExcluding(r.entries[name], agent.Scope(), excludedScope, excludedGeneration)
	restrictions := visibleToolRestrictions(r.restrictions, agent)
	catalogs := make([]toolCatalogEntry, 0, len(r.catalogs))
	for _, catalog := range r.catalogs {
		if catalog.provider.Authoritative || !catalog.scope.Contains(agent.Scope()) ||
			(catalog.scope == excludedScope && catalog.generation == excludedGeneration) {
			continue
		}
		catalogs = append(catalogs, catalog)
	}
	selection := r.finalContentSelectionLocked(agent, name, excludedScope, excludedGeneration, true)
	r.mu.RUnlock()
	current := resolvedToolView{}
	if found {
		current = resolvedToolView{scope: entry.scope, generation: entry.generation, tool: entry.tool}
	}
	for _, catalog := range catalogs {
		if found && current.scope == catalog.scope && current.generation == catalog.generation {
			current = resolvedToolView{}
			found = false
		}
		candidate, ok, err := catalog.provider.Resolve(ctx, agent, name)
		if err != nil {
			return Tool{}, false, fmt.Errorf("harness: resolve tool %q from catalog %q: %w", name, catalog.generation, err)
		}
		if !ok {
			continue
		}
		candidate, err = prepareTool(candidate)
		if err != nil {
			return Tool{}, false, err
		}
		if candidate.Schema.Name != name {
			return Tool{}, false, fmt.Errorf("harness: tool catalog %q resolved %q as %q", catalog.generation, name, candidate.Schema.Name)
		}
		replace, mergeErr := mergeToolView(name, current.scope, current.generation, catalog.scope, catalog.generation, found)
		if mergeErr != nil {
			return Tool{}, false, mergeErr
		}
		if replace {
			current = resolvedToolView{scope: catalog.scope, generation: catalog.generation, tool: candidate}
			found = true
		}
	}
	if found && !toolRestrictionsAdmit(restrictions, name, current.scope) {
		return Tool{}, false, nil
	}
	selected := cloneTool(current.tool)
	selected.nativeFinalOrigin = current.scope
	selected.nativeFinalSelection = selection
	return selected, found, nil
}

func mergeToolView(name string, currentScope *point.Scope, currentGeneration string, nextScope *point.Scope, nextGeneration string, found bool) (bool, error) {
	if !found {
		return true, nil
	}
	if currentScope == nextScope {
		if currentGeneration != "" && currentGeneration == nextGeneration {
			return true, nil
		}
		return false, fmt.Errorf("harness: dynamic tool %q conflicts at the same scope", name)
	}
	if currentScope.Contains(nextScope) {
		return true, nil
	}
	if nextScope.Contains(currentScope) {
		return false, nil
	}
	return false, fmt.Errorf("harness: dynamic tool %q has incomparable visible scopes", name)
}

func cloneToolSchema(schema ToolSchema) ToolSchema {
	schema.InputSchema = append(json.RawMessage(nil), schema.InputSchema...)
	schema.OutputSchema = append(json.RawMessage(nil), schema.OutputSchema...)
	schema.OutputProjectionConfig = append(json.RawMessage(nil), schema.OutputProjectionConfig...)
	return schema
}

func cloneTool(tool Tool) Tool {
	tool.Schema = cloneToolSchema(tool.Schema)
	return tool
}

func nearestToolEntry(entries []toolEntry, scope *point.Scope) (toolEntry, bool) {
	return nearestToolEntryExcluding(entries, scope, nil, "")
}

func nearestToolEntryExcluding(entries []toolEntry, scope, excludedScope *point.Scope, excludedGeneration string) (toolEntry, bool) {
	var selected toolEntry
	found := false
	for _, entry := range entries {
		if entry.tool.profileLease != nil && !entry.tool.profileLease.active() {
			continue
		}
		if entry.owner != nil && entry.owner.admissionError() != nil {
			continue
		}
		if entry.scope == excludedScope && entry.generation == excludedGeneration {
			continue
		}
		if !entry.scope.Contains(scope) {
			continue
		}
		if !found || selected.scope.Contains(entry.scope) {
			selected = entry
			found = true
		}
	}
	return selected, found
}
