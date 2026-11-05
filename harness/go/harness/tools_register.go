package harness

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"

	point "github.com/phodal/pero/harness/go/runtime"
	harnesstool "github.com/phodal/pero/harness/go/tool"
)

// RegisterCatalogProvider mounts one Agent-dependent catalog beside the
// generation whose global snapshot backs scope-only readers. Provider
// callbacks are never invoked under the registry mutex.
func (r *ToolRegistry) RegisterCatalogProvider(run *point.Run, generation string, provider ToolCatalogProvider) (point.Dispose, error) {
	return r.registerCatalogWithIdentity(run, generation, provider)
}

// ReleaseAgent tears down every dynamic catalog view that could have
// materialized state for agent. Provider failures are joined so one broken
// bridge cannot prevent independent catalogs from releasing their resources.
func (r *ToolRegistry) ReleaseAgent(ctx context.Context, agent *Agent) error {
	if r == nil || agent == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	r.mu.RLock()
	providers := make([]ToolCatalogProvider, 0, len(r.catalogs))
	for index := len(r.catalogs) - 1; index >= 0; index-- {
		catalog := r.catalogs[index]
		if catalog.provider.Release != nil && catalog.scope.Contains(agent.Scope()) {
			providers = append(providers, catalog.provider)
		}
	}
	r.mu.RUnlock()
	var joined error
	for _, provider := range providers {
		joined = errors.Join(joined, provider.Release(ctx, agent))
	}
	return joined
}

// Register binds callbacks to this exact activation. Its returned disposer
// only unregisters; activation cleanup separately cancels and joins callbacks.
func (r *ToolRegistry) Register(run *point.Run, tool Tool) (point.Dispose, error) {
	_, dispose, err := r.RegisterWithIdentity(run, tool)
	return dispose, err
}

// RegisterWithIdentity adds an opaque observational receipt for this exact
// registration. It grants no execution or lifecycle authority.
func (r *ToolRegistry) RegisterWithIdentity(run *point.Run, tool Tool) (ToolRegistration, point.Dispose, error) {
	if run == nil || !run.Active() {
		return ToolRegistration{}, nil, point.ErrInactiveRun
	}
	tool, err := prepareTool(tool)
	if err != nil {
		return ToolRegistration{}, nil, err
	}
	owner := newToolOwner(r, run)
	tool = owner.wrap(tool)
	if err := run.BeforeCleanup("tool-owner:"+tool.Schema.Name, owner.drain); err != nil {
		return ToolRegistration{}, nil, err
	}
	r.mu.Lock()
	if err := owner.admissionError(); err != nil {
		r.mu.Unlock()
		return ToolRegistration{}, nil, err
	}
	for _, existing := range r.entries[tool.Schema.Name] {
		if existing.scope == run.Scope {
			r.mu.Unlock()
			return ToolRegistration{}, nil, fmt.Errorf("harness: tool %q already registered in this scope", tool.Schema.Name)
		}
	}
	r.nextID++
	tool.registrationID = r.nextID
	entry := toolEntry{id: r.nextID, tool: tool, scope: run.Scope, owner: owner}
	r.entries[tool.Schema.Name] = append(r.entries[tool.Schema.Name], entry)
	r.mu.Unlock()

	dispose := r.entryDisposer(entry)
	if err := run.Defer("tool:"+tool.Schema.Name, dispose); err != nil {
		_ = dispose(context.Background())
		return ToolRegistration{}, nil, err
	}
	return ToolRegistration{registry: r, owner: owner, name: tool.Schema.Name}, dispose, nil
}

func prepareTool(tool Tool) (Tool, error) {
	tool.dispatchCapture = nil
	if (tool.SettleOutput != nil || tool.NotifyTerminal != nil) && (tool.sourceProjectionCapture == nil || tool.capturedAgent != tool.sourceProjectionCapture.agent) {
		return Tool{}, errors.New("harness: source output settlement requires exact proxy enrollment")
	}
	if tool.Schema.Name == "" || (tool.Execute == nil && tool.ExecuteRequest == nil) {
		return Tool{}, errors.New("harness: tool requires name and executor")
	}
	if tool.Execute != nil && tool.ExecuteRequest != nil {
		return Tool{}, errors.New("harness: tool must define only one executor form")
	}
	if tool.Timeout < 0 {
		return Tool{}, fmt.Errorf("harness: tool %q timeout must be positive when set", tool.Schema.Name)
	}
	// Bound opt-in Todo schema copies before allocation. The existing
	// validator remains authoritative and runs before descriptor compilation.
	if tool.ArgumentErrorMode == ArgumentErrorsDSHAlpha3Todo || tool.dshTodoNumberCompatibility {
		if err := checkDSHTodoSchemaBytes(tool.Schema.InputSchema); err != nil {
			return Tool{}, err
		}
	}
	if tool.ArgumentErrorMode != ArgumentErrorsLegacy || tool.dshTodoNumberCompatibility {
		tool.Schema.InputSchema = append(json.RawMessage(nil), tool.Schema.InputSchema...)
	}
	validator, err := compileToolInputSchema(tool.Schema.Name, tool.Schema.InputSchema)
	if err != nil {
		return Tool{}, err
	}
	tool.inputValidator = validator
	if tool.dshTodoNumberCompatibility {
		if err := compileDSHTodoSchema(tool.Schema.InputSchema, true); err != nil {
			return Tool{}, err
		}
	}
	tool.argumentErrorProjection, err = compileArgumentErrorProjection(tool.ArgumentErrorMode, tool.Schema.InputSchema)
	if err != nil {
		return Tool{}, err
	}
	tool.outputValidator = nil
	tool.Schema.OutputSchema = append(json.RawMessage(nil), tool.Schema.OutputSchema...)
	tool.Schema.OutputProjectionConfig = append(json.RawMessage(nil), tool.Schema.OutputProjectionConfig...)
	if len(tool.Schema.OutputProjectionConfig) != 0 {
		if tool.Schema.OutputProjection == "" {
			return Tool{}, fmt.Errorf("harness: tool %q renderer config requires an output projection", tool.Schema.Name)
		}
		if err := harnesstool.ValidateNativeJSONDecoding(tool.Schema.OutputProjectionConfig); err != nil {
			return Tool{}, fmt.Errorf("harness: tool %q has invalid renderer config: %w", tool.Schema.Name, err)
		}
	}
	if len(tool.Schema.OutputSchema) != 0 {
		tool.outputValidator, err = harnesstool.CompileOutputSchema(tool.Schema.Name, tool.Schema.OutputSchema)
		if err != nil {
			return Tool{}, err
		}
	} else if tool.RenderOutput != nil {
		return Tool{}, fmt.Errorf("harness: tool %q output renderer requires an output schema", tool.Schema.Name)
	} else if tool.Schema.OutputProjection != "" {
		return Tool{}, fmt.Errorf("harness: tool %q output projection requires an output schema", tool.Schema.Name)
	} else if tool.PreserveInitialOutputPair {
		return Tool{}, fmt.Errorf("harness: tool %q initial output preservation requires an output schema", tool.Schema.Name)
	}
	if tool.ErrorOutputMode != ErrorOutputLegacy && tool.ErrorOutputMode != ErrorOutputDSHAlpha3 {
		return Tool{}, fmt.Errorf("harness: tool %q has unsupported error output mode %d", tool.Schema.Name, tool.ErrorOutputMode)
	}
	if tool.ErrorOutputMode != ErrorOutputLegacy && tool.outputValidator == nil {
		return Tool{}, fmt.Errorf("harness: tool %q error output mode requires a canonical output schema", tool.Schema.Name)
	}
	if tool.ExecutionMode == "" {
		tool.ExecutionMode = ExecutionSerial
	}
	if tool.ExecutionMode != ExecutionParallel && tool.ExecutionMode != ExecutionSerial {
		return Tool{}, fmt.Errorf("harness: tool %q has invalid execution mode %q", tool.Schema.Name, tool.ExecutionMode)
	}
	return tool, nil
}

// ExecutionMode classifies one pending call through the caller-visible tool
// generation. DSH semantics are fail-closed: invalid/unknown calls and a
// missing, panicking, or false dynamic classifier are exclusive.
func (r *ToolRegistry) ExecutionMode(ctx context.Context, request ToolRequest) (mode ExecutionMode) {
	mode = ExecutionSerial
	if request.Agent == nil {
		return mode
	}
	tool, ok, err := r.resolveForAgent(ctx, request.Agent, request.Name)
	if err != nil {
		return mode
	}
	if !ok || (tool.owner != nil && tool.owner.admissionError() != nil) || validateRegisteredToolArguments(tool, request.Arguments) != nil {
		return mode
	}
	if tool.IsConcurrencySafe == nil {
		return tool.ExecutionMode
	}
	request.Arguments = append(json.RawMessage(nil), request.Arguments...)
	defer func() {
		if recover() != nil {
			mode = ExecutionSerial
		}
	}()
	if ctx != nil && ctx.Err() != nil {
		return mode
	}
	if tool.IsConcurrencySafe(ctx, request) {
		return ExecutionParallel
	}
	return mode
}

// ReplaceGeneration validates every definition, then swaps one scope-owned
// generation under the registry lock. Existing Resolve snapshots remain valid;
// new readers observe either the complete old generation or the complete new one.
// It is intended for dynamic capability providers such as MCP and DSH plugin
// graphs that publish complete catalog snapshots.
func (r *ToolRegistry) ReplaceGeneration(run *point.Run, generation string, tools []Tool) (point.Dispose, error) {
	if run == nil || !run.Active() {
		return nil, point.ErrInactiveRun
	}
	if generation == "" {
		return nil, errors.New("harness: tool generation key is required")
	}
	prepared := make([]Tool, len(tools))
	names := make(map[string]struct{}, len(tools))
	for index, tool := range tools {
		candidate, err := prepareTool(tool)
		if err != nil {
			return nil, err
		}
		if _, duplicate := names[candidate.Schema.Name]; duplicate {
			return nil, fmt.Errorf("harness: tool generation %q contains duplicate name %q", generation, candidate.Schema.Name)
		}
		names[candidate.Schema.Name] = struct{}{}
		prepared[index] = candidate
	}

	r.mu.Lock()
	for _, tool := range prepared {
		for _, existing := range r.entries[tool.Schema.Name] {
			if existing.scope == run.Scope && existing.generation != generation {
				r.mu.Unlock()
				return nil, fmt.Errorf("harness: tool %q already registered in this scope", tool.Schema.Name)
			}
		}
	}
	removed := r.removeGenerationLocked(run.Scope, generation)
	inserted := make([]toolEntry, 0, len(prepared))
	for _, tool := range prepared {
		r.nextID++
		tool.registrationID = r.nextID
		entry := toolEntry{id: r.nextID, tool: tool, scope: run.Scope, generation: generation, owner: tool.owner}
		r.entries[tool.Schema.Name] = append(r.entries[tool.Schema.Name], entry)
		inserted = append(inserted, entry)
	}
	r.mu.Unlock()

	var once sync.Once
	dispose := point.Dispose(func(context.Context) error {
		once.Do(func() {
			r.mu.Lock()
			r.removeEntriesLocked(inserted)
			r.mu.Unlock()
		})
		return nil
	})
	if err := run.Defer("tool-generation:"+generation, dispose); err != nil {
		r.mu.Lock()
		r.removeEntriesLocked(inserted)
		for _, entry := range removed {
			r.entries[entry.tool.Schema.Name] = append(r.entries[entry.tool.Schema.Name], entry)
		}
		r.mu.Unlock()
		return nil, err
	}
	return dispose, nil
}

func (r *ToolRegistry) replaceGeneration(run *point.Run, generation string, tools []Tool) (point.Dispose, error) {
	return r.ReplaceGeneration(run, generation, tools)
}

func (r *ToolRegistry) entryDisposer(entry toolEntry) point.Dispose {
	var once sync.Once
	return point.Dispose(func(context.Context) error {
		once.Do(func() {
			if entry.owner != nil {
				entry.owner.unregister()
			}
			r.mu.Lock()
			r.removeEntriesLocked([]toolEntry{entry})
			r.mu.Unlock()
		})
		return nil
	})
}

func (r *ToolRegistry) removeGenerationLocked(scope *point.Scope, generation string) []toolEntry {
	removed := make([]toolEntry, 0)
	for name, entries := range r.entries {
		kept := entries[:0]
		for _, entry := range entries {
			if entry.scope == scope && entry.generation == generation {
				removed = append(removed, entry)
			} else {
				kept = append(kept, entry)
			}
		}
		if len(kept) == 0 {
			delete(r.entries, name)
		} else {
			r.entries[name] = kept
		}
	}
	return removed
}

func (r *ToolRegistry) removeEntriesLocked(removing []toolEntry) {
	ids := make(map[uint64]struct{}, len(removing))
	for _, entry := range removing {
		ids[entry.id] = struct{}{}
	}
	for name, entries := range r.entries {
		kept := entries[:0]
		for _, entry := range entries {
			if _, remove := ids[entry.id]; !remove {
				kept = append(kept, entry)
			}
		}
		if len(kept) == 0 {
			delete(r.entries, name)
		} else {
			r.entries[name] = kept
		}
	}
}
