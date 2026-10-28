package harness

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"

	point "github.com/phodal/pero/harness/go/runtime"
)

func (r *SubagentRegistry) RegisterProvider(run *point.Run, provider SubagentProvider) (point.Dispose, error) {
	if r == nil || provider == nil || run == nil || !run.Active() || run.Scope == nil || run.Scope.Runtime() != r.runtime {
		return nil, errors.New("harness: subagent provider requires an active run")
	}
	name := strings.TrimSpace(provider.Name())
	if name == "" {
		return nil, errors.New("harness: subagent provider name must not be empty")
	}
	r.mu.Lock()
	if r.disposed {
		r.mu.Unlock()
		return nil, errors.New("harness: subagent registry is disposed")
	}
	for _, entry := range r.providers {
		if entry.scope == run.Scope && entry.provider.Name() == name {
			r.mu.Unlock()
			return nil, &subagentActivationError{fmt.Sprintf("harness: subagent provider %q already registered in this scope", name), "DUPLICATE_PROVIDER"}
		}
	}
	r.nextID++
	entry := subagentProviderEntry{id: r.nextID, scope: run.Scope, provider: provider}
	r.providers = append(r.providers, entry)
	r.mu.Unlock()
	var once sync.Once
	dispose := point.Dispose(func(context.Context) error {
		removed := false
		once.Do(func() {
			r.mu.Lock()
			for index := range r.providers {
				if r.providers[index].id == entry.id {
					r.providers = append(r.providers[:index], r.providers[index+1:]...)
					removed = true
					break
				}
			}
			r.mu.Unlock()
		})
		if removed {
			r.notifyProviderWatchers()
		}
		return nil
	})
	if err := run.Defer("subagents:provider:"+name, dispose); err != nil {
		_ = dispose(context.Background())
		return nil, err
	}
	r.notifyProviderWatchers()
	return dispose, nil
}

func (r *SubagentRegistry) Depth(agent *Agent) int {
	if r == nil || agent == nil {
		return 0
	}
	r.mu.RLock()
	record := r.records[agent.ID()]
	r.mu.RUnlock()
	if record == nil {
		// Runtime-root reopening changes ownership, not the durable recursion budget.
		return agent.Session().Header().DelegationDepth
	}
	return record.snapshot.Depth
}

// Activity refines a continuable registry row through the live Agent driver.
// Ready is reserved for a durable record that is not currently resident.
func (r *SubagentRegistry) Activity(id SessionID) (SubagentActivity, bool) {
	if r == nil {
		return "", false
	}
	r.mu.RLock()
	record := r.records[id]
	agents := r.agents
	r.mu.RUnlock()
	if record == nil || !record.snapshot.Continuable {
		return "", false
	}
	if agents == nil {
		return SubagentActivityReady, true
	}
	agent, live := agents.Get(id)
	if !live || agent == nil {
		return SubagentActivityReady, true
	}
	if agent.Status() == AgentRunning {
		return SubagentActivityRunning, true
	}
	return SubagentActivityIdle, true
}

func (r *SubagentRegistry) ListChildren(parent *Agent, recursive bool) []SubagentSnapshot {
	if r == nil || parent == nil {
		return nil
	}
	r.mu.RLock()
	records := make([]SubagentSnapshot, 0, len(r.records))
	for _, record := range r.records {
		records = append(records, record.snapshot)
	}
	r.mu.RUnlock()
	children := make(map[SessionID][]SubagentSnapshot)
	for _, snapshot := range records {
		children[snapshot.Parent] = append(children[snapshot.Parent], snapshot)
	}
	for id := range children {
		sort.Slice(children[id], func(left, right int) bool {
			if children[id][left].StartedAt.Equal(children[id][right].StartedAt) {
				return children[id][left].ID < children[id][right].ID
			}
			return children[id][left].StartedAt.Before(children[id][right].StartedAt)
		})
	}
	result := make([]SubagentSnapshot, 0)
	visited := map[SessionID]struct{}{parent.ID(): {}}
	var appendChildren func(SessionID)
	appendChildren = func(parentID SessionID) {
		for _, snapshot := range children[parentID] {
			if _, seen := visited[snapshot.ID]; seen {
				continue
			}
			visited[snapshot.ID] = struct{}{}
			result = append(result, snapshot)
			if recursive {
				appendChildren(snapshot.ID)
			}
		}
	}
	appendChildren(parent.ID())
	return result
}

// Catalog merges resident registry rows with provider-owned persisted rows.
// Live identity wins over a cold projection; one corrupt child cannot erase
// healthy siblings. Results use stable parent-first order.
func (r *SubagentRegistry) Catalog(ctx context.Context, parent *Agent, recursive bool) ([]SubagentCatalogEntry, error) {
	if r == nil || parent == nil {
		return nil, errors.New("harness: subagent catalog requires a parent")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	r.mu.RLock()
	agents := r.agents
	if agents == nil {
		r.mu.RUnlock()
		return nil, errors.New("harness: agent registry is unavailable")
	}
	if live, ok := agents.Get(parent.ID()); !ok || live != parent {
		r.mu.RUnlock()
		return nil, errors.New("harness: subagent catalog requires the exact live parent")
	}
	r.mu.RUnlock()
	return r.catalogBySessionID(ctx, parent.ID(), parent.Scope(), recursive)
}

// CatalogBySessionID reads a durable child tree without requiring the parent
// Agent to be resident. When the parent is live, its exact scope still selects
// the effective provider topology; cold reads merge every persistence-capable
// provider because no process-local scope identity survives deactivation.
func (r *SubagentRegistry) CatalogBySessionID(ctx context.Context, parentID SessionID, recursive bool) ([]SubagentCatalogEntry, error) {
	if r == nil || parentID == "" {
		return nil, errors.New("harness: subagent catalog requires a parent session id")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	r.mu.RLock()
	agents := r.agents
	r.mu.RUnlock()
	if agents == nil {
		return nil, errors.New("harness: agent registry is unavailable")
	}
	var scope *point.Scope
	if parent, ok := agents.Get(parentID); ok && parent != nil {
		scope = parent.Scope()
	}
	return r.catalogBySessionID(ctx, parentID, scope, recursive)
}

func (r *SubagentRegistry) catalogBySessionID(ctx context.Context, parentID SessionID, scope *point.Scope, recursive bool) ([]SubagentCatalogEntry, error) {
	r.mu.RLock()
	agents := r.agents
	if agents == nil {
		r.mu.RUnlock()
		return nil, errors.New("harness: agent registry is unavailable")
	}
	records := make([]*subagentRecord, 0, len(r.records))
	for _, record := range r.records {
		records = append(records, record)
	}
	providers := append([]subagentProviderEntry(nil), r.providers...)
	r.mu.RUnlock()

	entries := make(map[SessionID]SubagentCatalogEntry, len(records))
	for _, record := range records {
		mode := SubagentDescriptorOneShot
		if record.snapshot.Continuable {
			mode = SubagentDescriptorContinuable
		}
		activity := SubagentActivityReady
		if agent, ok := agents.Get(record.snapshot.ID); ok && agent != nil {
			activity = SubagentActivityIdle
			if agent.Status() == AgentRunning {
				activity = SubagentActivityRunning
			}
		}
		entries[record.snapshot.ID] = SubagentCatalogEntry{
			Kind: SubagentCatalogChild, ID: record.snapshot.ID, Parent: record.snapshot.Parent,
			Provider: record.snapshot.Provider, Label: record.snapshot.Label, Mode: mode,
			Activity: activity, Depth: record.snapshot.Depth, StartedAt: record.snapshot.StartedAt,
		}
	}

	catalogProviders := make([]subagentProviderEntry, 0, len(providers))
	if scope == nil {
		for _, candidate := range providers {
			if _, ok := candidate.provider.(SubagentCatalogProvider); ok {
				catalogProviders = append(catalogProviders, candidate)
			}
		}
	} else {
		selected := make(map[string]subagentProviderEntry)
		for _, candidate := range providers {
			if !candidate.scope.Contains(scope) {
				continue
			}
			current, exists := selected[candidate.provider.Name()]
			if !exists || current.scope.Contains(candidate.scope) {
				selected[candidate.provider.Name()] = candidate
			}
		}
		names := make([]string, 0, len(selected))
		for name := range selected {
			names = append(names, name)
		}
		sort.Strings(names)
		for _, name := range names {
			catalogProviders = append(catalogProviders, selected[name])
		}
	}
	for _, provider := range catalogProviders {
		catalog, ok := provider.provider.(SubagentCatalogProvider)
		if !ok {
			continue
		}
		persisted, err := catalog.ListPersisted(ctx)
		if err != nil {
			return nil, fmt.Errorf("harness: list persisted subagents from provider %q: %w", provider.provider.Name(), err)
		}
		for _, candidate := range persisted {
			if candidate.ID == "" || candidate.Parent == "" ||
				(candidate.Kind != SubagentCatalogChild && candidate.Kind != SubagentCatalogDiagnostic) {
				return nil, fmt.Errorf("harness: provider %q returned an invalid subagent catalog row", provider.provider.Name())
			}
			current, exists := entries[candidate.ID]
			if exists && current.Kind == SubagentCatalogChild {
				continue
			}
			if candidate.Kind == SubagentCatalogChild {
				if candidate.Mode != SubagentDescriptorOneShot && candidate.Mode != SubagentDescriptorContinuable {
					return nil, fmt.Errorf("harness: provider %q returned child %q with invalid mode", provider.provider.Name(), candidate.ID)
				}
				candidate.Activity = SubagentActivityReady
			} else if candidate.Reason != SubagentCatalogCorrupt && candidate.Reason != SubagentCatalogUnsupported && candidate.Reason != SubagentCatalogUnavailable {
				return nil, fmt.Errorf("harness: provider %q returned diagnostic %q with invalid reason", provider.provider.Name(), candidate.ID)
			}
			entries[candidate.ID] = candidate
		}
	}

	children := make(map[SessionID][]SubagentCatalogEntry)
	for _, entry := range entries {
		children[entry.Parent] = append(children[entry.Parent], entry)
	}
	for id := range children {
		sort.Slice(children[id], func(left, right int) bool {
			if children[id][left].StartedAt.Equal(children[id][right].StartedAt) {
				return children[id][left].ID < children[id][right].ID
			}
			return children[id][left].StartedAt.Before(children[id][right].StartedAt)
		})
	}
	result := make([]SubagentCatalogEntry, 0)
	visited := map[SessionID]struct{}{parentID: {}}
	var appendChildren func(SessionID)
	appendChildren = func(parentID SessionID) {
		for _, entry := range children[parentID] {
			if _, seen := visited[entry.ID]; seen {
				continue
			}
			visited[entry.ID] = struct{}{}
			result = append(result, entry)
			if recursive {
				appendChildren(entry.ID)
			}
		}
	}
	appendChildren(parentID)
	return result, nil
}

func normalizeSubagentLabel(label, prompt string) string {
	label = strings.Join(strings.Fields(label), " ")
	if label == "" {
		label = strings.Join(strings.Fields(prompt), " ")
	}
	runes := []rune(label)
	if len(runes) > 80 {
		label = string(runes[:77]) + "..."
	}
	return label
}

func (r *SubagentRegistry) resolveProvider(scope *point.Scope, name string) (SubagentProvider, error) {
	r.mu.RLock()
	entries := append([]subagentProviderEntry(nil), r.providers...)
	r.mu.RUnlock()
	var selected *subagentProviderEntry
	for index := range entries {
		entry := &entries[index]
		if entry.provider.Name() != name || !entry.scope.Contains(scope) {
			continue
		}
		if selected == nil || selected.scope.Contains(entry.scope) {
			selected = entry
		}
	}
	if selected == nil {
		return nil, &subagentActivationError{fmt.Sprintf("harness: unknown subagent provider %q", name), "NO_PROVIDER"}
	}
	return selected.provider, nil
}

func (r *SubagentRegistry) Provider(scope *point.Scope, name string) (SubagentProvider, error) {
	return r.resolveProvider(scope, name)
}

// ProviderDescriptors returns the effective providers visible from scope in
// stable registration order. A nearer scoped registration shadows an ancestor
// with the same name without exposing the implementation across the boundary.
func (r *SubagentRegistry) ProviderDescriptors(scope *point.Scope) []SubagentProviderDescriptor {
	if r == nil || scope == nil {
		return nil
	}
	r.mu.RLock()
	entries := append([]subagentProviderEntry(nil), r.providers...)
	r.mu.RUnlock()
	names := make([]string, 0, len(entries))
	seen := make(map[string]struct{}, len(entries))
	for _, entry := range entries {
		name := entry.provider.Name()
		if !entry.scope.Contains(scope) {
			continue
		}
		if _, exists := seen[name]; exists {
			continue
		}
		seen[name] = struct{}{}
		names = append(names, name)
	}
	result := make([]SubagentProviderDescriptor, 0, len(names))
	for _, name := range names {
		provider, err := r.resolveProvider(scope, name)
		if err != nil {
			continue
		}
		_, continuable := provider.(SubagentContinuationProvider)
		var route *SubagentAgentRouteDefaults
		if source, ok := provider.(SubagentProviderRouteDefaults); ok {
			if defaults := source.AgentRouteDefaults(); defaults != nil {
				copy := *defaults
				route = &copy
			}
		}
		result = append(result, SubagentProviderDescriptor{
			AgentRouteDefaults: route,
			Name:               name, Capabilities: provider.Capabilities(),
			InheritsParentContext: provider.InheritsParentContext(), Continuable: continuable,
		})
	}
	return result
}

// WatchProviderDescriptors observes the effective provider plane from one
// scope. The initial snapshot is delivered synchronously after registration;
// callbacks receive detached slices and must return promptly.
func (r *SubagentRegistry) WatchProviderDescriptors(scope *point.Scope, callback func([]SubagentProviderDescriptor)) func() {
	if r == nil || scope == nil || callback == nil {
		return func() {}
	}
	watcher := &subagentProviderWatcher{scope: scope, callback: callback, active: true, delivering: true}
	// Own the initial claim before publication. Concurrent topology changes
	// queue a later latest snapshot rather than overtaking the initial one.
	r.mu.Lock()
	if r.disposed {
		r.mu.Unlock()
		return func() {}
	}
	r.nextID++
	watcher.id = r.nextID
	r.watchers[watcher.id] = watcher
	r.mu.Unlock()
	var once sync.Once
	unsubscribe := func() {
		once.Do(func() {
			r.mu.Lock()
			if r.watchers[watcher.id] == watcher {
				delete(r.watchers, watcher.id)
			}
			watcher.mu.Lock()
			watcher.active, watcher.pending = false, false
			watcher.mu.Unlock()
			r.mu.Unlock()
		})
	}
	// A failed initial callback cannot leave an unreachable live subscription.
	func() {
		defer func() {
			if recovered := recover(); recovered != nil {
				unsubscribe()
				panic(recovered)
			}
		}()
		watcher.drain(r)
	}()
	return unsubscribe
}

func (r *SubagentRegistry) notifyProviderWatchers() {
	if r == nil {
		return
	}
	r.mu.RLock()
	watchers := make([]*subagentProviderWatcher, 0, len(r.watchers))
	for _, watcher := range r.watchers {
		watchers = append(watchers, watcher)
	}
	r.mu.RUnlock()
	for _, watcher := range watchers {
		watcher.deliver(r)
	}
}
