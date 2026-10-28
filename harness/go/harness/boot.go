package harness

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	harnessconfig "github.com/phodal/pero/harness/go/config"
	point "github.com/phodal/pero/harness/go/runtime"
	harnesssession "github.com/phodal/pero/harness/go/session"
	harnessstorage "github.com/phodal/pero/harness/go/storage"
	harnesstool "github.com/phodal/pero/harness/go/tool"
)

var (
	AdapterKey                = point.NewKey[Adapter]("harness.llm")
	ProviderRegistryKey       = point.NewKey[*ProviderRegistry]("harness.providers")
	SettingsProviderKey       = harnessconfig.SettingsProviderKey
	CredentialProviderKey     = harnessconfig.CredentialProviderKey
	AttachmentStoreKey        = point.NewKey[AttachmentStore]("harness.attachments")
	SessionStoreKey           = harnesssession.StoreKey
	SessionProjectionKey      = harnesssession.ProjectionRegistryKey
	PromptRegistryKey         = point.NewKey[*PromptRegistry]("harness.system-prompt")
	ApprovalBrokerKey         = point.NewKey[*ApprovalBroker]("harness.approval")
	SpillRegistryKey          = point.NewKey[*SpillRegistry]("harness.spills")
	ToolRegistryKey           = point.NewKey[*ToolRegistry]("harness.tools")
	CommandRegistryKey        = point.NewKey[*CommandRegistry]("harness.commands")
	AgentHooksKey             = point.NewKey[*AgentHooks]("harness.agent-hooks")
	AgentLoopConfigKey        = point.NewKey[*AgentLoopConfig]("harness.agent-loop.config")
	RetryExecutionPolicyKey   = point.NewKey[*RetryExecutionPolicy]("harness.llm-retry.policy")
	ToolResultPrunerPolicyKey = harnesstool.ResultPrunerPolicyKey
	CheckpointPolicyKey       = harnesssession.CheckpointPolicyKey
	SubagentRegistryKey       = point.NewKey[*SubagentRegistry]("harness.subagents")
	AgentManagerKey           = point.NewKey[*AgentManager]("harness.agents")
)

type Options struct {
	// EnableSubagents explicitly installs the native subagent lifecycle service.
	EnableSubagents bool

	Runtime *point.Runtime
	// Adapter preserves the first-version fallback seam. New applications
	// should also name AdapterProviders so unknown routes fail closed.
	Adapter          Adapter
	AdapterProviders []string
	ModelInfo        ModelInfoResolver
	SettingsBackend  SettingsBackend
	Credentials      CredentialProvider
	Attachments      AttachmentStore
	ApprovalPolicy   ApprovalPolicy
	Storage          harnessstorage.CoreOptions
}

type Harness struct {
	subagents *SubagentRegistry

	disposeMu        sync.Mutex
	disposeDone      chan struct{}
	disposeErr       error
	runtime          *point.Runtime
	application      *point.Application
	sessions         *SessionStore
	projections      *SessionProjectionRegistry
	prompts          *PromptRegistry
	approvals        *ApprovalBroker
	spills           *SpillRegistry
	tools            *ToolRegistry
	commands         *CommandRegistry
	hooks            *AgentHooks
	agentLoop        *AgentLoopConfig
	retryPolicy      *RetryExecutionPolicy
	toolResultPruner *ToolResultPrunerPolicy
	checkpointPolicy *CheckpointPolicy
	agents           *AgentManager
	providers        *ProviderRegistry
	settings         *SettingsProvider
	storage          *harnessstorage.BackendRegistry
	domains          *harnessstorage.DomainFacility
	credentials      CredentialProvider
	attachments      AttachmentStore
	commandRemote    *CommandRemoteAdapter
}

func Boot(ctx context.Context, options Options) (*Harness, error) {
	if options.Adapter == nil && len(options.AdapterProviders) != 0 {
		return nil, errors.New("harness: adapter providers require an adapter")
	}
	if options.ApprovalPolicy != "" {
		if err := validateApprovalPolicy(options.ApprovalPolicy); err != nil {
			return nil, err
		}
	}
	runtime := options.Runtime
	if runtime == nil {
		runtime = point.New()
	}
	catalog := point.NewDefinitionCatalog()
	definitions := coreDefinitions(options)
	if err := catalog.Register(definitions...); err != nil {
		return nil, err
	}
	application := point.NewApplication(runtime, catalog)
	entries := make([]point.EntrySpec, 0, len(definitions))
	for _, definition := range definitions {
		descriptor := definition.Descriptor()
		entries = append(entries, point.EntrySpec{ID: descriptor.ID, Definition: descriptor.ID})
	}
	if err := application.Apply(ctx, entries); err != nil {
		_ = application.Dispose(context.Background())
		return nil, err
	}
	if err := waitForHarnessServices(ctx, application, options.Credentials != nil, options.Attachments != nil, options.EnableSubagents); err != nil {
		_ = application.Dispose(context.Background())
		return nil, err
	}
	harness := &Harness{runtime: runtime, application: application}
	fail := func(err error) (*Harness, error) {
		return nil, errors.Join(err, application.Dispose(context.Background()))
	}
	var ok bool
	if harness.providers, ok = point.Lookup(runtime, runtime.Root(), ProviderRegistryKey); !ok {
		return fail(errors.New("harness: provider registry failed to publish"))
	}
	if harness.settings, ok = point.Lookup(runtime, runtime.Root(), SettingsProviderKey); !ok {
		return fail(errors.New("harness: settings provider failed to publish"))
	}
	if harness.storage, ok = point.Lookup(runtime, runtime.Root(), harnessstorage.BackendRegistryKey); !ok {
		return fail(errors.New("harness: storage backend registry failed to publish"))
	}
	if harness.domains, ok = point.Lookup(runtime, runtime.Root(), harnessstorage.DomainFacilityKey); !ok {
		return fail(errors.New("harness: storage domain facility failed to publish"))
	}
	if options.Credentials != nil {
		if harness.credentials, ok = point.Lookup(runtime, runtime.Root(), CredentialProviderKey); !ok {
			return fail(errors.New("harness: credential provider failed to publish"))
		}
	}
	if options.Attachments != nil {
		if harness.attachments, ok = point.Lookup(runtime, runtime.Root(), AttachmentStoreKey); !ok {
			return fail(errors.New("harness: attachment store failed to publish"))
		}
	}
	if harness.sessions, ok = point.Lookup(runtime, runtime.Root(), SessionStoreKey); !ok {
		return fail(errors.New("harness: session store failed to publish"))
	}
	if harness.projections, ok = point.Lookup(runtime, runtime.Root(), SessionProjectionKey); !ok {
		return fail(errors.New("harness: session projection registry failed to publish"))
	}
	if harness.prompts, ok = point.Lookup(runtime, runtime.Root(), PromptRegistryKey); !ok {
		return fail(errors.New("harness: prompt registry failed to publish"))
	}
	if harness.approvals, ok = point.Lookup(runtime, runtime.Root(), ApprovalBrokerKey); !ok {
		return fail(errors.New("harness: approval broker failed to publish"))
	}
	if harness.spills, ok = point.Lookup(runtime, runtime.Root(), SpillRegistryKey); !ok {
		return fail(errors.New("harness: spill registry failed to publish"))
	}
	if harness.tools, ok = point.Lookup(runtime, runtime.Root(), ToolRegistryKey); !ok {
		return fail(errors.New("harness: tool registry failed to publish"))
	}
	if harness.commands, ok = point.Lookup(runtime, runtime.Root(), CommandRegistryKey); !ok {
		return fail(errors.New("harness: command registry failed to publish"))
	}
	if harness.hooks, ok = point.Lookup(runtime, runtime.Root(), AgentHooksKey); !ok {
		return fail(errors.New("harness: agent hooks failed to publish"))
	}
	if harness.agentLoop, ok = point.Lookup(runtime, runtime.Root(), AgentLoopConfigKey); !ok {
		return fail(errors.New("harness: agent-loop config failed to publish"))
	}
	if harness.toolResultPruner, ok = point.Lookup(runtime, runtime.Root(), ToolResultPrunerPolicyKey); !ok {
		return fail(errors.New("harness: tool-result pruner policy failed to publish"))
	}
	if harness.retryPolicy, ok = point.Lookup(runtime, runtime.Root(), RetryExecutionPolicyKey); !ok {
		return fail(errors.New("harness: llm retry execution policy failed to publish"))
	}
	if harness.checkpointPolicy, ok = point.Lookup(runtime, runtime.Root(), CheckpointPolicyKey); !ok {
		return fail(errors.New("harness: session checkpoint policy failed to publish"))
	}
	if harness.agents, ok = point.Lookup(runtime, runtime.Root(), AgentManagerKey); !ok {
		return fail(errors.New("harness: agent manager failed to publish"))
	}
	if options.EnableSubagents {
		if harness.subagents, ok = point.Lookup(runtime, runtime.Root(), SubagentRegistryKey); !ok {
			return fail(errors.New("harness: subagent registry failed to publish"))
		}
		harness.subagents.attachAgents(harness.agents)
	}

	commandRemote, err := NewCommandRemoteAdapter(harness.agents, harness.commands)
	if err != nil {
		return fail(err)
	}
	harness.commandRemote = commandRemote
	return harness, nil
}

// Application.Apply may legitimately settle while entries are Pending on
// services that another entry in the same document is still publishing. A
// Harness is a closed core graph, so Boot has the stronger contract that every
// public service is ready before it returns.
func waitForHarnessServices(ctx context.Context, application *point.Application, credentials, attachments bool, subagentsEnabled ...bool) error {
	if ctx == nil {
		ctx = context.Background()
	}
	waitCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	ticker := time.NewTicker(time.Millisecond)
	defer ticker.Stop()
	ready := func() bool {
		runtime := application.Runtime()
		root := runtime.Root()
		_, providers := point.Lookup(runtime, root, ProviderRegistryKey)
		_, settings := point.Lookup(runtime, root, SettingsProviderKey)
		_, storageRegistry := point.Lookup(runtime, root, harnessstorage.BackendRegistryKey)
		_, storageDomains := point.Lookup(runtime, root, harnessstorage.DomainFacilityKey)
		_, sessions := point.Lookup(runtime, root, SessionStoreKey)
		_, projections := point.Lookup(runtime, root, SessionProjectionKey)
		_, prompts := point.Lookup(runtime, root, PromptRegistryKey)
		_, approvals := point.Lookup(runtime, root, ApprovalBrokerKey)
		_, spills := point.Lookup(runtime, root, SpillRegistryKey)
		_, tools := point.Lookup(runtime, root, ToolRegistryKey)
		_, commands := point.Lookup(runtime, root, CommandRegistryKey)
		_, hooks := point.Lookup(runtime, root, AgentHooksKey)
		_, agentLoop := point.Lookup(runtime, root, AgentLoopConfigKey)
		_, retryPolicy := point.Lookup(runtime, root, RetryExecutionPolicyKey)
		_, toolResultPruner := point.Lookup(runtime, root, ToolResultPrunerPolicyKey)
		_, checkpointPolicy := point.Lookup(runtime, root, CheckpointPolicyKey)
		_, agents := point.Lookup(runtime, root, AgentManagerKey)
		_, adapter := point.Lookup(runtime, root, AdapterKey)
		credentialReady := true
		if credentials {
			_, credentialReady = point.Lookup(runtime, root, CredentialProviderKey)
		}
		attachmentReady := true
		if attachments {
			_, attachmentReady = point.Lookup(runtime, root, AttachmentStoreKey)
		}
		subagentsReady := true
		if len(subagentsEnabled) > 0 && subagentsEnabled[0] {
			_, subagentsReady = point.Lookup(runtime, root, SubagentRegistryKey)
		}
		return subagentsReady && providers && settings && storageRegistry && storageDomains && sessions && projections && prompts && approvals && spills && tools && commands && hooks && agentLoop && retryPolicy && toolResultPruner && checkpointPolicy && agents && adapter && credentialReady && attachmentReady
	}
	for !ready() {
		select {
		case <-ticker.C:
		case <-waitCtx.Done():
			return fmt.Errorf("harness: core services did not become ready: %w", waitCtx.Err())
		}
	}
	return nil
}
