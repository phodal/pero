package harness

import (
	"context"
	"errors"

	point "github.com/phodal/pero/harness/go/runtime"
	harnesssession "github.com/phodal/pero/harness/go/session"
	harnessstorage "github.com/phodal/pero/harness/go/storage"
)

func coreDefinitions(options Options) []point.Definition {
	definitions := make([]point.Definition, 0, 28)
	definitions = append(definitions, harnessstorage.Definitions(options.Storage)...)
	if options.Attachments != nil {
		attachmentDefinition := point.Define(
			point.Descriptor{ID: "harness/core/attachments", Provides: []point.AnyKey{AttachmentStoreKey.Any()}},
			point.DecodeJSON[struct{}],
			func(run *point.Run, _ struct{}) (point.Dispose, error) {
				_, err := point.Provide(run, AttachmentStoreKey, options.Attachments)
				return nil, err
			},
		)
		definitions = append(definitions, attachmentDefinition)
	}
	if options.Credentials != nil {
		credentialDefinition := point.Define(
			point.Descriptor{ID: "harness/core/credentials", Provides: []point.AnyKey{CredentialProviderKey.Any()}},
			point.DecodeJSON[struct{}],
			func(run *point.Run, _ struct{}) (point.Dispose, error) {
				if _, err := point.Provide(run, CredentialProviderKey, options.Credentials); err != nil {
					return nil, err
				}
				if watcher, ok := options.Credentials.(CredentialWatchProvider); ok {
					if err := watcher.StartWatching(run); err != nil {
						if lifecycle, lifecycleOK := options.Credentials.(CredentialProviderLifecycle); lifecycleOK {
							return nil, errors.Join(err, lifecycle.Dispose(context.Background()))
						}
						return nil, err
					}
				}
				if lifecycle, ok := options.Credentials.(CredentialProviderLifecycle); ok {
					return lifecycle.Dispose, nil
				}
				return nil, nil
			},
		)
		definitions = append(definitions, credentialDefinition)
	}
	settingsDefinition := point.Define(
		point.Descriptor{ID: "harness/core/settings", Provides: []point.AnyKey{SettingsProviderKey.Any()}},
		point.DecodeJSON[struct{}],
		func(run *point.Run, _ struct{}) (point.Dispose, error) {
			provider, err := OpenSettingsProvider(run.Context, options.SettingsBackend, run.Logger())
			if err != nil {
				return nil, err
			}
			if _, err := point.Provide(run, SettingsProviderKey, provider); err != nil {
				return nil, err
			}
			if watcher, ok := options.SettingsBackend.(SettingsWatchBackend); ok {
				if err := watcher.StartWatching(run, provider); err != nil {
					return nil, err
				}
			}
			return provider.Dispose, nil
		},
	)
	adapterDefinition := point.Define(
		point.Descriptor{ID: "harness/core/llm", Provides: []point.AnyKey{AdapterKey.Any(), ProviderRegistryKey.Any()}},
		point.DecodeJSON[struct{}],
		func(run *point.Run, _ struct{}) (point.Dispose, error) {
			fallback := options.Adapter
			fallbackModelInfo := options.ModelInfo
			if len(options.AdapterProviders) != 0 {
				fallback = nil
				fallbackModelInfo = nil
			}
			registry := NewProviderRegistry(fallback, fallbackModelInfo, run.Logger())
			if len(options.AdapterProviders) != 0 {
				if _, err := registry.Register(run, options.AdapterProviders, options.Adapter); err != nil {
					return nil, err
				}
			}
			if _, err := point.Provide(run, ProviderRegistryKey, registry); err != nil {
				return nil, err
			}
			_, err := point.Provide[Adapter](run, AdapterKey, registry)
			return nil, err
		},
	)
	sessionDefinition := point.Define(
		point.Descriptor{ID: "harness/core/session", Provides: []point.AnyKey{SessionStoreKey.Any()}},
		point.DecodeJSON[struct{}],
		func(run *point.Run, _ struct{}) (point.Dispose, error) {
			store := NewSessionStore()
			if _, err := point.Provide(run, SessionStoreKey, store); err != nil {
				return nil, err
			}
			return store.Dispose, nil
		},
	)
	projectionDefinition := point.Define(
		point.Descriptor{
			ID: "harness/core/session-projection", Requires: []point.Requirement{point.Require(SessionStoreKey)},
			Provides: []point.AnyKey{SessionProjectionKey.Any()},
		},
		point.DecodeJSON[struct{}],
		func(run *point.Run, _ struct{}) (point.Dispose, error) {
			store, err := point.Resolve(run, SessionStoreKey)
			if err != nil {
				return nil, err
			}
			registry, err := NewSessionProjectionRegistry(store, run.Logger())
			if err != nil {
				return nil, err
			}
			if _, err = registry.Register(run, harnesssession.InboxProjectionDefinition()); err != nil {
				_ = registry.Dispose(context.Background())
				return nil, err
			}
			if _, err = point.Provide(run, SessionProjectionKey, registry); err != nil {
				_ = registry.Dispose(context.Background())
				return nil, err
			}
			return registry.Dispose, nil
		},
	)
	promptDefinition := point.Define(
		point.Descriptor{ID: "harness/core/system-prompt", Provides: []point.AnyKey{PromptRegistryKey.Any()}},
		point.DecodeJSON[struct{}],
		func(run *point.Run, _ struct{}) (point.Dispose, error) {
			_, err := point.Provide(run, PromptRegistryKey, NewPromptRegistry())
			return nil, err
		},
	)
	approvalDefinition := point.Define(
		point.Descriptor{
			ID: "harness/core/approval", Requires: []point.Requirement{point.Require(PromptRegistryKey)},
			Provides: []point.AnyKey{ApprovalBrokerKey.Any()},
		},
		point.DecodeJSON[struct{}],
		func(run *point.Run, _ struct{}) (point.Dispose, error) {
			broker, err := NewApprovalBrokerWithOptions(ApprovalOptions{Policy: options.ApprovalPolicy})
			if err != nil {
				return nil, err
			}
			if _, err := point.Provide(run, ApprovalBrokerKey, broker); err != nil {
				return nil, err
			}
			prompts, err := point.Resolve(run, PromptRegistryKey)
			if err != nil {
				return nil, err
			}
			_, err = prompts.Register(run, PromptSection{
				ID: "approval/policy", Order: 9_000,
				Content: func(_ context.Context, agent *Agent) (string, error) {
					policy, err := broker.EffectivePolicy(agent.Session())
					if err != nil {
						return "", err
					}
					return approvalPolicyPrompt(policy, agent.Session()), nil
				},
			})
			return nil, err
		},
	)
	spillDefinition := point.Define(
		point.Descriptor{ID: "harness/core/spills", Provides: []point.AnyKey{SpillRegistryKey.Any()}},
		point.DecodeJSON[struct{}],
		func(run *point.Run, _ struct{}) (point.Dispose, error) {
			_, err := point.Provide(run, SpillRegistryKey, NewSpillRegistry())
			return nil, err
		},
	)
	toolDefinition := point.Define(
		point.Descriptor{ID: "harness/core/tools", Requires: []point.Requirement{point.Require(ApprovalBrokerKey), point.Require(SpillRegistryKey)}, Provides: []point.AnyKey{ToolRegistryKey.Any()}},
		point.DecodeJSON[struct{}],
		func(run *point.Run, _ struct{}) (point.Dispose, error) {
			approvals, err := point.Resolve(run, ApprovalBrokerKey)
			if err != nil {
				return nil, err
			}
			spills, err := point.Resolve(run, SpillRegistryKey)
			if err != nil {
				return nil, err
			}
			_, err = point.Provide(run, ToolRegistryKey, newToolRegistryWithSpills(run.Scope.Runtime(), approvals, spills))
			return nil, err
		},
	)
	commandDefinition := point.Define(
		point.Descriptor{ID: "harness/core/commands", Provides: []point.AnyKey{CommandRegistryKey.Any()}},
		point.DecodeJSON[struct{}],
		func(run *point.Run, _ struct{}) (point.Dispose, error) {
			_, err := point.Provide(run, CommandRegistryKey, NewCommandRegistry())
			return nil, err
		},
	)
	hookDefinition := point.Define(
		point.Descriptor{ID: "harness/core/agent-hooks", Provides: []point.AnyKey{AgentHooksKey.Any()}},
		point.DecodeJSON[struct{}],
		func(run *point.Run, _ struct{}) (point.Dispose, error) {
			_, err := point.Provide(run, AgentHooksKey, NewAgentHooks(run.Scope.Runtime()))
			return nil, err
		},
	)
	retryPolicyDefinition := point.Define(
		point.Descriptor{ID: "harness/core/llm-retry-policy", Provides: []point.AnyKey{RetryExecutionPolicyKey.Any()}},
		point.DecodeJSON[struct{}],
		func(run *point.Run, _ struct{}) (point.Dispose, error) {
			_, err := point.Provide(run, RetryExecutionPolicyKey, NewRetryExecutionPolicy())
			return nil, err
		},
	)
	retryDefinition := point.Define(
		point.Descriptor{
			ID:       "harness/core/llm-retry",
			Requires: []point.Requirement{point.Require(AdapterKey), point.Require(AgentHooksKey), point.Require(RetryExecutionPolicyKey)},
		},
		point.DecodeJSON[struct{}],
		func(run *point.Run, _ struct{}) (point.Dispose, error) {
			adapter, err := point.Resolve(run, AdapterKey)
			if err != nil {
				return nil, err
			}
			policies, ok := adapter.(RetryPolicyProvider)
			if !ok {
				return nil, nil
			}
			executionPolicy, err := point.Resolve(run, RetryExecutionPolicyKey)
			if err != nil {
				return nil, err
			}
			hooks, err := point.Resolve(run, AgentHooksKey)
			if err != nil {
				return nil, err
			}
			executor := newRetryExecutor(policies, nil, run.Logger(), executionPolicy)
			_, err = hooks.RequestError.Use(run, func(ctx context.Context, input RequestErrorInput, next point.Next[RequestErrorInput]) (RequestErrorInput, error) {
				if !executor.begin() {
					return input, context.Cause(executor.lifetime)
				}
				defer executor.end()
				return executor.recover(ctx, input, next)
			})
			if err != nil {
				_ = executor.dispose(context.Background())
				return nil, err
			}
			if err := run.Defer("llm-retry:abort-and-drain", executor.dispose); err != nil {
				_ = executor.dispose(context.Background())
				return nil, err
			}
			return nil, nil
		},
	)
	toolResultPrunerDefinition := point.Define(
		point.Descriptor{ID: "harness/core/tool-result-pruner-policy", Provides: []point.AnyKey{ToolResultPrunerPolicyKey.Any()}},
		point.DecodeJSON[struct{}],
		func(run *point.Run, _ struct{}) (point.Dispose, error) {
			_, err := point.Provide(run, ToolResultPrunerPolicyKey, &ToolResultPrunerPolicy{})
			return nil, err
		},
	)
	checkpointPolicyDefinition := point.Define(
		point.Descriptor{ID: "harness/core/session-checkpoint-policy", Provides: []point.AnyKey{CheckpointPolicyKey.Any()}},
		point.DecodeJSON[struct{}],
		func(run *point.Run, _ struct{}) (point.Dispose, error) {
			_, err := point.Provide(run, CheckpointPolicyKey, NewCheckpointPolicy())
			return nil, err
		},
	)
	managerDefinition := point.Define(
		point.Descriptor{
			ID: "harness/core/agents",
			Requires: []point.Requirement{
				point.Require(AdapterKey), point.Require(SessionStoreKey), point.Require(PromptRegistryKey),
				point.Require(ToolRegistryKey), point.Require(AgentHooksKey),
				point.Require(AgentLoopConfigKey), point.Require(CommandRegistryKey),
			},
			Provides: []point.AnyKey{AgentManagerKey.Any()},
		},
		point.DecodeJSON[struct{}],
		func(run *point.Run, _ struct{}) (point.Dispose, error) {
			adapter, err := point.Resolve(run, AdapterKey)
			if err != nil {
				return nil, err
			}
			sessions, err := point.Resolve(run, SessionStoreKey)
			if err != nil {
				return nil, err
			}
			prompts, err := point.Resolve(run, PromptRegistryKey)
			if err != nil {
				return nil, err
			}
			tools, err := point.Resolve(run, ToolRegistryKey)
			if err != nil {
				return nil, err
			}
			hooks, err := point.Resolve(run, AgentHooksKey)
			if err != nil {
				return nil, err
			}
			agentLoop, err := point.Resolve(run, AgentLoopConfigKey)
			if err != nil {
				return nil, err
			}
			commands, err := point.Resolve(run, CommandRegistryKey)
			if err != nil {
				return nil, err
			}
			modelInfo, _ := adapter.(ModelInfoResolver)
			manager := NewAgentManager(run.Scope.Runtime(), sessions, adapter, modelInfo, prompts, tools, hooks)
			manager.commands = commands
			manager.setAgentLoopConfig(agentLoop)
			manager.setAttachmentStore(options.Attachments)
			if _, err := point.Provide(run, AgentManagerKey, manager); err != nil {
				return nil, err
			}
			return manager.Dispose, nil
		},
	)
	definitions = append(definitions, settingsDefinition, agentLoopSettingsDefinition(), adapterDefinition, sessionDefinition, projectionDefinition, promptDefinition, approvalDefinition, spillDefinition, toolDefinition, commandDefinition, hookDefinition, retryPolicyDefinition, retryDefinition, toolResultPrunerDefinition, checkpointPolicyDefinition, managerDefinition)
	if options.EnableSubagents {
		subagentDefinition := point.Define(
			point.Descriptor{ID: "harness/core/subagents", Requires: []point.Requirement{point.Require(AgentHooksKey), point.Require(SessionProjectionKey)}, Provides: []point.AnyKey{SubagentRegistryKey.Any()}},
			point.DecodeJSON[struct{}],
			func(run *point.Run, _ struct{}) (point.Dispose, error) {
				registry := NewSubagentRegistry(run.Scope.Runtime())
				projections, err := point.Resolve(run, SessionProjectionKey)
				if err != nil {
					return nil, err
				}
				for _, definition := range []ProjectionDefinition{SubagentCatalogProjectionDefinition(), SubagentTimingProjectionDefinition(), SubagentIdentityProjectionDefinition()} {
					if _, err := projections.Register(run, definition); err != nil {
						return nil, err
					}
				}
				hooks, err := point.Resolve(run, AgentHooksKey)
				if err != nil {
					return nil, err
				}
				if _, err := hooks.Retiring.On(run, registry.retireAgent); err != nil {
					return nil, err
				}
				if _, err := point.Provide(run, SubagentRegistryKey, registry); err != nil {
					return nil, err
				}
				return registry.Dispose, nil
			},
		)

		definitions = append(definitions, subagentDefinition)
	}
	return definitions
}
