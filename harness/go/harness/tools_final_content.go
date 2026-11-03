package harness

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"slices"

	point "github.com/phodal/pero/harness/go/runtime"
)

// nativeFinalContent is a private, effect-free last-mile capability. It is not
// DSH source settlement and cannot authorize execution, change Value or grant
// success. Trusted native definitions and captured-owner proxies alone carry it.
type nativeFinalContent struct {
	prepare        func(ToolRequest) (func(ToolResult) (ToolOutputProjection, error), error)
	sourceSnapshot func(ToolRequest) (*int, error)
}

type toolFinalContentReceipt struct {
	capability *nativeFinalContent
	token      ToolExecutionToken
	agent      *Agent
	name       string
	arguments  []byte
	owner      *toolOwner
	profile    *ProfileOwnerLease
	project    func(ToolResult) (ToolOutputProjection, error)
	consumed   bool
}

func (receipt *toolFinalContentReceipt) matches(request ToolRequest, capability *nativeFinalContent) bool {
	return receipt != nil && !receipt.consumed && receipt.capability == capability && receipt.token == request.executionToken && receipt.agent == request.Agent && receipt.name == request.Name && bytes.Equal(receipt.arguments, request.Arguments) && receipt.owner == request.owner && receipt.profile == request.profileLease
}
func (receipt *toolFinalContentReceipt) release() {
	if receipt == nil {
		return
	}
	receipt.consumed = true
	receipt.project = nil
	receipt.arguments = nil
	receipt.agent = nil
	receipt.owner = nil
	receipt.profile = nil
}
func (receipt *toolFinalContentReceipt) finish(request ToolRequest, result ToolResult) (final ToolResult) {
	final = result
	if receipt == nil {
		return
	}
	defer receipt.release()
	if !receipt.matches(request, receipt.capability) {
		return toolOutputError(request, result, errors.New("native final-content receipt does not match its admitted execution"))
	}
	// Finalization follows cancellation/error normalization and cleanup, so it
	// must not invoke an owner callback or be skipped by cancelled context.
	defer func() {
		if recovered := recover(); recovered != nil {
			final = toolOutputError(request, result, fmt.Errorf("native final-content projection panicked: %v", recovered))
		}
	}()
	projection, err := receipt.project(cloneToolResult(result))
	if err != nil {
		return toolOutputError(request, result, err)
	}
	final.Content = cloneContentBlocks(projection.Content)
	final.Meta = append([]byte(nil), projection.Meta...)
	return final
}

func prepareNativeFinalContent(tool Tool, request ToolRequest) (*toolFinalContentReceipt, error) {
	if tool.nativeFinalContent == nil || tool.nativeFinalContent.prepare == nil {
		return nil, errors.New("harness: prepared tool lacks native final-content capability")
	}
	if tool.capturedAgent != nil && tool.capturedAgent != request.Agent {
		return nil, ErrToolOwnerRetired
	}
	if tool.owner != nil {
		if err := tool.owner.admissionError(); err != nil {
			return nil, err
		}
	}
	if tool.profileLease != nil && !tool.profileLease.active() {
		return nil, ErrProfileOwnerUnavailable
	}
	request.owner, request.profileLease = tool.owner, tool.profileLease
	request.Arguments = append([]byte(nil), request.Arguments...)
	var project func(ToolResult) (ToolOutputProjection, error)
	var err error
	if tool.nativeFinalTransfer != nil {
		project, err = tool.nativeFinalTransfer.claim(request, tool.nativeFinalContent)
	} else {
		project, err = tool.nativeFinalContent.prepare(request)
	}
	if err != nil {
		return nil, err
	}
	if project == nil {
		return nil, errors.New("harness: native final-content preparation returned no projector")
	}
	return &toolFinalContentReceipt{capability: tool.nativeFinalContent, token: request.executionToken, agent: request.Agent, name: request.Name, arguments: append([]byte(nil), request.Arguments...), owner: tool.owner, profile: tool.profileLease, project: project}, nil
}

type finalContentPreparation func(context.Context, *Agent, string) (Tool, bool, error)

func (r *ToolRegistry) prepareFinalContentForAgent(ctx context.Context, agent *Agent, name string) (Tool, bool, error) {
	return r.prepareFinalContentView(ctx, agent, name, nil, "", false)
}

// Preparation is opt-in. Legacy catalogs are never eagerly resolved. A mixed
// view is prepared only when its selected definition can be proven without
// asking an unprepared dynamic provider to resolve twice.
func (r *ToolRegistry) prepareFinalContentView(ctx context.Context, agent *Agent, name string, excludedScope *point.Scope, excludedGeneration string, base bool) (Tool, bool, error) {
	if agent == nil {
		return Tool{}, false, nil
	}
	r.mu.RLock()
	entry, found := nearestToolEntry(r.entries[name], agent.Scope())
	if base {
		entry, found = nearestToolEntryExcluding(r.entries[name], agent.Scope(), excludedScope, excludedGeneration)
	}
	catalogs := make([]toolCatalogEntry, 0, len(r.catalogs))
	for _, catalog := range r.catalogs {
		if !catalog.scope.Contains(agent.Scope()) || base && (catalog.provider.Authoritative || catalog.scope == excludedScope && catalog.generation == excludedGeneration) {
			continue
		}
		catalogs = append(catalogs, catalog)
	}
	selection := r.finalContentSelectionLocked(agent, name, excludedScope, excludedGeneration, base)
	r.mu.RUnlock()
	authoritative, err := authoritativeCatalog(catalogs)
	if err != nil {
		return Tool{}, false, err
	}
	validate := func(candidate Tool, generation string) (Tool, error) {
		if candidate.Schema.Name != name {
			return Tool{}, fmt.Errorf("harness: final-content catalog %q resolved %q as %q", generation, name, candidate.Schema.Name)
		}
		if candidate.nativeFinalContent == nil {
			return Tool{}, errors.New("harness: final-content catalog returned an unprepared definition")
		}
		return prepareTool(candidate)
	}
	if authoritative != nil {
		if authoritative.provider.PrepareFinalContent == nil {
			return Tool{}, false, nil
		}
		candidate, prepared, err := authoritative.provider.PrepareFinalContent(ctx, agent, name)
		if err != nil || !prepared {
			return Tool{}, false, err
		}
		candidate, err = validate(candidate, authoritative.generation)
		if err != nil {
			return Tool{}, false, err
		}
		origin := authoritative.scope
		if found {
			origin = entry.scope
		}
		candidate.nativeFinalOrigin = origin
		candidate.nativeFinalSelection = selection
		return candidate, true, nil
	}
	if len(catalogs) == 0 {
		if !found || entry.tool.nativeFinalContent == nil {
			return Tool{}, false, nil
		}
		candidate := cloneTool(entry.tool)
		candidate.nativeFinalOrigin = entry.scope
		candidate.nativeFinalSelection = selection
		return candidate, true, nil
	}
	current := resolvedToolView{}
	selected := false
	if found && entry.tool.nativeFinalContent != nil {
		current = resolvedToolView{scope: entry.scope, generation: entry.generation, tool: entry.tool}
		selected = true
	}
	unknown := make([]toolCatalogEntry, 0)
	opted := false
	for _, catalog := range catalogs {
		if selected && current.scope == catalog.scope && current.generation == catalog.generation {
			selected = false
			current = resolvedToolView{}
		}
		if catalog.provider.PrepareFinalContent == nil {
			unknown = append(unknown, catalog)
			continue
		}
		candidate, prepared, err := catalog.provider.PrepareFinalContent(ctx, agent, name)
		if err != nil {
			return Tool{}, false, err
		}
		if !prepared {
			unknown = append(unknown, catalog)
			continue
		}
		opted = true
		candidate, err = validate(candidate, catalog.generation)
		if err != nil {
			return Tool{}, false, err
		}
		replace, err := mergeToolView(name, current.scope, current.generation, catalog.scope, catalog.generation, selected)
		if err != nil {
			return Tool{}, false, err
		}
		if replace {
			current = resolvedToolView{scope: catalog.scope, generation: catalog.generation, tool: candidate}
			selected = true
		}
	}
	if !selected {
		return Tool{}, false, nil
	}
	// Also preserve collisions with an ordinary non-finalizable entry.
	if found && entry.tool.nativeFinalContent == nil {
		_, err := mergeToolView(name, entry.scope, entry.generation, current.scope, current.generation, true)
		if err != nil {
			return Tool{}, false, err
		}
		if entry.scope != current.scope && current.scope.Contains(entry.scope) {
			return Tool{}, false, nil
		}
	}
	for _, catalog := range unknown {
		if catalog.scope == current.scope || current.scope.Contains(catalog.scope) {
			if opted {
				return Tool{}, false, errors.New("harness: ambiguous dynamic final-content preparation")
			}
			// A possibly shadowing legacy tool must retain its original route. If
			// ordinary resolution later selects a finalizer, dispatch fails closed.
			return Tool{}, false, nil
		}
	}
	candidate := cloneTool(current.tool)
	candidate.nativeFinalOrigin = current.scope
	candidate.nativeFinalSelection = selection
	return candidate, true, nil
}

// Pinned selection is not pinned authorization. Before may install or remove
// restrictions, so use the live view without resolving the provider again.
func (r *ToolRegistry) preparedFinalContentAdmitted(agent *Agent, selected Tool) bool {
	if agent == nil || selected.nativeFinalOrigin == nil {
		return false
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	previous := selected.nativeFinalSelection
	if previous == nil {
		return false
	}
	current := r.finalContentSelectionLocked(agent, selected.Schema.Name, previous.excludedScope, previous.excludedGeneration, previous.base)
	return slices.Equal(previous.entries, current.entries) && slices.Equal(previous.catalogs, current.catalogs) && toolRestrictionsAdmit(visibleToolRestrictions(r.restrictions, agent), selected.Schema.Name, selected.nativeFinalOrigin)
}

// Registration IDs are monotonically unique. Only this name and this visible
// catalog topology participate; sibling scopes and other names cannot revoke it.
type finalContentSelection struct {
	entries, catalogs  []uint64
	excludedScope      *point.Scope
	excludedGeneration string
	base               bool
}

func (r *ToolRegistry) finalContentSelectionLocked(agent *Agent, name string, excludedScope *point.Scope, excludedGeneration string, base bool) *finalContentSelection {
	selection := &finalContentSelection{excludedScope: excludedScope, excludedGeneration: excludedGeneration, base: base}
	for _, entry := range r.entries[name] {
		if entry.scope.Contains(agent.Scope()) && !(base && entry.scope == excludedScope && entry.generation == excludedGeneration) {
			selection.entries = append(selection.entries, entry.id)
		}
	}
	for _, catalog := range r.catalogs {
		if !catalog.scope.Contains(agent.Scope()) || base && (catalog.provider.Authoritative || catalog.scope == excludedScope && catalog.generation == excludedGeneration) {
			continue
		}
		selection.catalogs = append(selection.catalogs, catalog.id)
	}
	return selection
}
