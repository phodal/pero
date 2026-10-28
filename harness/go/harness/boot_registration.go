package harness

import (
	"context"
	"errors"
	"fmt"

	point "github.com/phodal/pero/harness/go/runtime"
	harnessstorage "github.com/phodal/pero/harness/go/storage"
)

func (h *Harness) Runtime() *point.Runtime                         { return h.runtime }
func (h *Harness) Providers() *ProviderRegistry                    { return h.providers }
func (h *Harness) Settings() *SettingsProvider                     { return h.settings }
func (h *Harness) Storage() *harnessstorage.BackendRegistry        { return h.storage }
func (h *Harness) StorageDomains() *harnessstorage.DomainFacility  { return h.domains }
func (h *Harness) AgentLoop() *AgentLoopConfig                     { return h.agentLoop }
func (h *Harness) RetryExecutionPolicy() *RetryExecutionPolicy     { return h.retryPolicy }
func (h *Harness) ToolResultPrunerPolicy() *ToolResultPrunerPolicy { return h.toolResultPruner }
func (h *Harness) CheckpointPolicy() *CheckpointPolicy             { return h.checkpointPolicy }
func (h *Harness) Credentials() CredentialProvider                 { return h.credentials }
func (h *Harness) Attachments() AttachmentStore                    { return h.attachments }
func (h *Harness) Sessions() *SessionStore                         { return h.sessions }
func (h *Harness) Projections() *SessionProjectionRegistry         { return h.projections }
func (h *Harness) Prompts() *PromptRegistry                        { return h.prompts }
func (h *Harness) Approvals() *ApprovalBroker                      { return h.approvals }
func (h *Harness) Spills() *SpillRegistry                          { return h.spills }
func (h *Harness) Tools() *ToolRegistry                            { return h.tools }
func (h *Harness) Commands() *CommandRegistry                      { return h.commands }
func (h *Harness) Hooks() *AgentHooks                              { return h.hooks }
func (h *Harness) Agents() *AgentManager                           { return h.agents }
func (h *Harness) CommandRemote() *CommandRemoteAdapter            { return h.commandRemote }

func (h *Harness) RegisterTool(ctx context.Context, entryID string, tool Tool) (*point.Instance, error) {
	return h.RegisterToolAt(ctx, nil, entryID, tool)
}

func (h *Harness) RegisterProjection(ctx context.Context, entryID string, definition ProjectionDefinition) (*point.Instance, error) {
	return h.RegisterProjectionAt(ctx, nil, entryID, definition)
}

func (h *Harness) RegisterProjectionAt(ctx context.Context, scope *point.Scope, entryID string, projection ProjectionDefinition) (*point.Instance, error) {
	if h == nil || h.projections == nil {
		return nil, errors.New("harness: projection registration requires a running harness")
	}
	if entryID == "" {
		entryID = "projection:" + projection.Key
	}
	definition := point.Define(
		point.Descriptor{ID: "harness/contribution/session-projection", Requires: []point.Requirement{point.Require(SessionProjectionKey)}},
		point.DecodeJSON[struct{}],
		func(run *point.Run, _ struct{}) (point.Dispose, error) {
			_, err := h.projections.Register(run, projection)
			return nil, err
		},
	)
	instance, err := h.runtime.Mount(scope, entryID, definition, nil)
	if err != nil {
		return nil, err
	}
	if err = instance.WaitStable(ctx); err != nil {
		_ = instance.Dispose(context.Background())
		return nil, err
	}
	if snapshot := instance.Snapshot(); snapshot.State == point.Failed {
		_ = instance.Dispose(context.Background())
		return nil, fmt.Errorf("harness: register projection: %s", snapshot.LastError)
	}
	return instance, nil
}

func (h *Harness) RegisterSpillStore(ctx context.Context, entryID string, store SpillStore, options SpillPolicyOptions) (*point.Instance, error) {
	return h.RegisterSpillStoreAt(ctx, nil, entryID, store, options)
}

func (h *Harness) RegisterSpillStoreAt(ctx context.Context, scope *point.Scope, entryID string, store SpillStore, options SpillPolicyOptions) (*point.Instance, error) {
	if h == nil || store == nil {
		return nil, errors.New("harness: register spill store requires harness and store")
	}
	if entryID == "" {
		entryID = "spill:store"
	}
	definition := point.Define(
		point.Descriptor{ID: "harness/contribution/spill", Requires: []point.Requirement{point.Require(SpillRegistryKey)}},
		point.DecodeJSON[struct{}],
		func(run *point.Run, _ struct{}) (point.Dispose, error) {
			_, err := h.spills.Register(run, store, options)
			return nil, err
		},
	)
	instance, err := h.runtime.Mount(scope, entryID, definition, nil)
	if err != nil {
		return nil, err
	}
	if err := instance.WaitStable(ctx); err != nil {
		_ = instance.Dispose(context.Background())
		return nil, err
	}
	if snapshot := instance.Snapshot(); snapshot.State == point.Failed {
		_ = instance.Dispose(context.Background())
		return nil, fmt.Errorf("harness: register spill store: %s", snapshot.LastError)
	}
	return instance, nil
}

// RegisterProvider mounts one effect-owned adapter route set. The returned
// registration can atomically replace its complete route set or dispose it.
func (h *Harness) RegisterProvider(ctx context.Context, entryID string, providers []string, adapter Adapter) (*ProviderRegistration, error) {
	if h == nil || h.runtime == nil {
		return nil, errors.New("harness: provider registration requires a running harness")
	}
	if len(providers) == 0 {
		return nil, NewProviderError("an adapter must register at least one provider", InvalidAdapterCode, nil)
	}
	providers = append([]string(nil), providers...)
	if entryID == "" {
		entryID = "provider:" + providers[0]
	}
	registered := make(chan *ProviderRegistration, 1)
	definition := point.Define(
		point.Descriptor{ID: "harness/contribution/provider/" + entryID, Requires: []point.Requirement{point.Require(ProviderRegistryKey)}},
		point.DecodeJSON[struct{}],
		func(run *point.Run, _ struct{}) (point.Dispose, error) {
			registry, err := point.Resolve(run, ProviderRegistryKey)
			if err != nil {
				return nil, err
			}
			registration, err := registry.Register(run, providers, adapter)
			if err != nil {
				return nil, err
			}
			registered <- registration
			return nil, nil
		},
	)
	instance, err := h.runtime.Mount(nil, entryID, definition, nil)
	if err != nil {
		return nil, err
	}
	if err := instance.WaitStable(ctx); err != nil {
		_ = instance.Dispose(context.Background())
		return nil, err
	}
	if snapshot := instance.Snapshot(); snapshot.State == point.Failed {
		_ = instance.Dispose(context.Background())
		return nil, fmt.Errorf("harness: register provider: %s", snapshot.LastError)
	}
	select {
	case registration := <-registered:
		registration.instance = instance
		return registration, nil
	default:
		_ = instance.Dispose(context.Background())
		return nil, errors.New("harness: provider registration did not activate")
	}
}

func (h *Harness) RegisterToolAt(ctx context.Context, scope *point.Scope, entryID string, tool Tool) (*point.Instance, error) {
	if entryID == "" {
		entryID = "tool:" + tool.Schema.Name
	}
	definition := point.Define(
		point.Descriptor{ID: "harness/contribution/tool/" + tool.Schema.Name, Requires: []point.Requirement{point.Require(ToolRegistryKey)}},
		point.DecodeJSON[struct{}],
		func(run *point.Run, _ struct{}) (point.Dispose, error) {
			registry, err := point.Resolve(run, ToolRegistryKey)
			if err != nil {
				return nil, err
			}
			_, err = registry.Register(run, tool)
			return nil, err
		},
	)
	instance, err := h.runtime.Mount(scope, entryID, definition, nil)
	if err != nil {
		return nil, err
	}
	if err := instance.WaitStable(ctx); err != nil {
		_ = instance.Dispose(context.Background())
		return nil, err
	}
	if snapshot := instance.Snapshot(); snapshot.State == point.Failed {
		_ = instance.Dispose(context.Background())
		return nil, fmt.Errorf("harness: register tool: %s", snapshot.LastError)
	}
	return instance, nil
}

// RegisterToolRestrictionAt mounts an effect-owned inherited-tool mask in the
// exact Agent scope. Lifecycle plugins use it when a root-only capability must
// not leak through a delegated child's scope ancestry.
func (h *Harness) RegisterToolRestrictionAt(ctx context.Context, agent *Agent, entryID string, restriction ToolRestriction) (*point.Instance, error) {
	if h == nil || agent == nil {
		return nil, errors.New("harness: register tool restriction requires harness and agent")
	}
	if entryID == "" {
		entryID = "tool-restriction:" + string(agent.ID())
	}
	definition := point.Define(
		point.Descriptor{ID: "harness/contribution/tool-restriction", Requires: []point.Requirement{point.Require(ToolRegistryKey)}},
		point.DecodeJSON[struct{}],
		func(run *point.Run, _ struct{}) (point.Dispose, error) {
			registry, err := point.Resolve(run, ToolRegistryKey)
			if err != nil {
				return nil, err
			}
			_, err = registry.Restrict(ctx, run, agent, restriction)
			return nil, err
		},
	)
	instance, err := h.runtime.Mount(agent.Scope(), entryID, definition, nil)
	if err != nil {
		return nil, err
	}
	if err := instance.WaitStable(ctx); err != nil {
		_ = instance.Dispose(context.Background())
		return nil, err
	}
	if snapshot := instance.Snapshot(); snapshot.State == point.Failed {
		_ = instance.Dispose(context.Background())
		return nil, fmt.Errorf("harness: register tool restriction: %s", snapshot.LastError)
	}
	return instance, nil
}

func (h *Harness) RegisterPrompt(ctx context.Context, entryID string, section PromptSection) (*point.Instance, error) {
	return h.RegisterPromptAt(ctx, nil, entryID, section)
}

func (h *Harness) RegisterPromptAt(ctx context.Context, scope *point.Scope, entryID string, section PromptSection) (*point.Instance, error) {
	if entryID == "" {
		entryID = "prompt:" + section.ID
	}
	definition := point.Define(
		point.Descriptor{ID: "harness/contribution/prompt/" + section.ID, Requires: []point.Requirement{point.Require(PromptRegistryKey)}},
		point.DecodeJSON[struct{}],
		func(run *point.Run, _ struct{}) (point.Dispose, error) {
			registry, err := point.Resolve(run, PromptRegistryKey)
			if err != nil {
				return nil, err
			}
			_, err = registry.Register(run, section)
			return nil, err
		},
	)
	instance, err := h.runtime.Mount(scope, entryID, definition, nil)
	if err != nil {
		return nil, err
	}
	if err := instance.WaitStable(ctx); err != nil {
		_ = instance.Dispose(context.Background())
		return nil, err
	}
	return instance, nil
}

func (h *Harness) RegisterCommand(ctx context.Context, entryID string, command CommandDefinition) (*point.Instance, error) {
	return h.RegisterCommandAt(ctx, nil, entryID, command)
}

func (h *Harness) RegisterCommandAt(ctx context.Context, scope *point.Scope, entryID string, command CommandDefinition) (*point.Instance, error) {
	if entryID == "" {
		entryID = "command:" + command.Name
	}
	definition := point.Define(
		point.Descriptor{ID: "harness/contribution/command/" + command.Name, Requires: []point.Requirement{point.Require(CommandRegistryKey)}},
		point.DecodeJSON[struct{}],
		func(run *point.Run, _ struct{}) (point.Dispose, error) {
			registry, err := point.Resolve(run, CommandRegistryKey)
			if err != nil {
				return nil, err
			}
			_, err = registry.Register(run, command)
			return nil, err
		},
	)
	instance, err := h.runtime.Mount(scope, entryID, definition, nil)
	if err != nil {
		return nil, err
	}
	if err := instance.WaitStable(ctx); err != nil {
		_ = instance.Dispose(context.Background())
		return nil, err
	}
	if snapshot := instance.Snapshot(); snapshot.State == point.Failed {
		_ = instance.Dispose(context.Background())
		return nil, fmt.Errorf("harness: register command: %s", snapshot.LastError)
	}
	return instance, nil
}

func (h *Harness) RegisterCommandProvider(ctx context.Context, entryID string, provider CommandProvider) (*point.Instance, error) {
	if entryID == "" {
		entryID = "command-provider"
	}
	definition := point.Define(
		point.Descriptor{ID: "harness/contribution/command-provider", Requires: []point.Requirement{point.Require(CommandRegistryKey)}},
		point.DecodeJSON[struct{}],
		func(run *point.Run, _ struct{}) (point.Dispose, error) {
			registry, err := point.Resolve(run, CommandRegistryKey)
			if err != nil {
				return nil, err
			}
			_, err = registry.RegisterProvider(run, provider)
			return nil, err
		},
	)
	instance, err := h.runtime.Mount(nil, entryID, definition, nil)
	if err != nil {
		return nil, err
	}
	if err := instance.WaitStable(ctx); err != nil {
		_ = instance.Dispose(context.Background())
		return nil, err
	}
	if snapshot := instance.Snapshot(); snapshot.State == point.Failed {
		_ = instance.Dispose(context.Background())
		return nil, fmt.Errorf("harness: register command provider: %s", snapshot.LastError)
	}
	return instance, nil
}

// Subagents returns nil unless EnableSubagents was explicitly selected.
func (h *Harness) Subagents() *SubagentRegistry { return h.subagents }
