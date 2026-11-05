package harness

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"

	point "github.com/phodal/pero/harness/go/runtime"
)

var ErrAgentManagerDisposed = errors.New("harness: agent manager is disposed")

type AgentOptions struct {
	// ModelSelection is an optional entrypoint-owned, synchronous read policy.
	// It must not mutate the Session or drive model/tool work. Generic Agents
	// without this policy retain their explicitly configured route.
	ModelSelection func(*Session) AgentModelSelection
	// InitialAgentPreset is an ordinary preset composition chosen for this runtime.
	// It does not grant permissions or replace immutable delegation provenance.
	InitialAgentPreset string
	ManagedCWD         bool
	ID                 SessionID
	CWD                string
	Provider           string
	Model              string
	ReasoningEffort    ReasoningEffort
	// MaxSteps uses DefaultMaxSteps when zero; UnlimitedMaxSteps removes only
	// the step ceiling, preserving cancellation and provider budget ownership.
	MaxSteps  int
	MaxTokens int
	// MaxParallelToolCalls caps the rolling pool of calls whose live classifier
	// returned parallel. Zero uses the DSH default of 10.
	MaxParallelToolCalls int
	// Delegated marks an agent whose prompts originate from another agent.
	// Policy tools use it to deny authority that only top-level humans own.
	Delegated bool
	// Parent identifies the live delegating Agent. Scoped plugin hosts use it
	// to inherit the parent's exact capability generation instead of resolving
	// a potentially edited preset by name.
	Parent          *Agent
	DelegationDepth int
	Compaction      *BasicCompactionConfig
	// DisableCompaction overrides both explicit Compaction and an entrypoint's
	// creation-time defaults. It does not change already-created Agents.
	DisableCompaction bool
	ToolResultPruner  *ToolResultPruneConfig
	// Configure composes session-local contributions before the Agent is
	// published by the manager. Registrations made with run are effect-owned.
	Configure func(context.Context, *point.Run, *Agent) error
	// CommitComposition records durable setup after Activated composition hooks
	// succeed, before Create/Resume returns. Activated hooks retain their existing
	// manager visibility; failure retires the exact Agent like activation failure.
	CommitComposition    func(context.Context, *Agent) error
	ExternalTurn         ExternalTurn
	ExternalConfigs      ExternalConfigs
	ExternalSelectConfig ExternalSelectConfig
	ExternalModels       ExternalModels
	ExternalSelectModel  ExternalSelectModel
}

type managedAgent struct {
	agent      *Agent
	instance   *point.Instance
	retirement *agentRetirement
	resources  []*agentCleanupResource
}

type AgentManager struct {
	runtime     *point.Runtime
	sessions    *SessionStore
	adapter     Adapter
	modelInfo   ModelInfoResolver
	attachments AttachmentStore
	prompts     *PromptRegistry
	tools       *ToolRegistry
	commands    *CommandRegistry
	hooks       *AgentHooks
	agentLoop   *AgentLoopConfig

	mu               sync.RWMutex
	disposed         bool
	closing          bool
	retiring         map[*Agent]*agentRetirement
	lifecycleChanged chan struct{}
	disposeDone      chan struct{}
	disposeErr       error
	terminalErr      error
	agents           map[SessionID]managedAgent
	activating       map[SessionID]*agentActivation
}

func NewAgentManager(runtime *point.Runtime, sessions *SessionStore, adapter Adapter, modelInfo ModelInfoResolver, prompts *PromptRegistry, tools *ToolRegistry, hooks *AgentHooks) *AgentManager {
	manager := &AgentManager{
		runtime: runtime, sessions: sessions, adapter: adapter, modelInfo: modelInfo, prompts: prompts, tools: tools, hooks: hooks,
		agents: make(map[SessionID]managedAgent),
	}
	return manager
}

func (m *AgentManager) setAttachmentStore(store AttachmentStore) {
	m.attachments = store
}

func (m *AgentManager) setAgentLoopConfig(config *AgentLoopConfig) {
	m.agentLoop = config
}

func (m *AgentManager) Create(ctx context.Context, options AgentOptions) (*Agent, error) {
	if m == nil || m.runtime == nil || m.adapter == nil {
		return nil, errors.New("harness: agent manager is not initialized")
	}
	if options.Parent != nil {
		m.mu.RLock()
		managed, ok := m.agents[options.Parent.ID()]
		m.mu.RUnlock()
		if !ok || managed.agent != options.Parent {
			return nil, errors.New("harness: delegated agent requires the exact live parent")
		}
	}
	if options.Provider == "" && options.Model == "" {
		if defaults, ok := point.Lookup(m.runtime, m.runtime.Root(), AgentDefaultModelKey); ok {
			selection := defaults.CurrentSelection()
			options.Provider = selection.Provider
			options.Model = selection.Model
			if options.ReasoningEffort == "" {
				options.ReasoningEffort = selection.ReasoningEffort
			}
		}
	}
	// Configure immutable lineage before publishing to SessionStore observers.
	// Projection/bridge observers may append their initial events immediately.
	session := NewSession(options.ID, options.CWD)
	if options.ManagedCWD || (options.Parent != nil && options.Parent.Session().Header().ManagedCWD) {
		if err := session.ConfigureManagedCWD(); err != nil {
			return nil, err
		}
	}
	if options.Parent != nil {
		if err := session.ConfigureDelegation(options.Parent.ID(), options.DelegationDepth); err != nil {
			return nil, err
		}
	}
	if err := m.reserveAgentActivation(session.Header().ID, options.Parent); err != nil {
		return nil, err
	}
	defer m.releaseAgentActivation(session.Header().ID)
	if err := m.sessions.Add(session); err != nil {
		return nil, err
	}
	return m.mount(ctx, session, options, true, true)
}

func (m *AgentManager) Resume(ctx context.Context, session *Session, options AgentOptions) (*Agent, error) {
	return m.resume(ctx, session, options)
}

func (m *AgentManager) resume(ctx context.Context, session *Session, options AgentOptions) (*Agent, error) {
	if m == nil || m.runtime == nil || m.adapter == nil {
		return nil, errors.New("harness: agent manager is not initialized")
	}
	if session == nil {
		return nil, errors.New("harness: resume session is nil")
	}
	header := session.Header()
	if options.ID != "" && options.ID != header.ID {
		return nil, errors.New("harness: resume session id mismatch")
	}
	if options.Parent != nil {
		m.mu.RLock()
		managed, ok := m.agents[options.Parent.ID()]
		m.mu.RUnlock()
		if !ok || managed.agent != options.Parent {
			return nil, errors.New("harness: delegated resume requires the exact live parent")
		}
		if header.ParentSession != options.Parent.ID() {
			return nil, errors.New("harness: delegated resume parent does not match persisted session")
		}
		if header.Origin != "subagent" {
			return nil, errors.New("harness: delegated resume requires a persisted subagent origin")
		}
		if header.DelegationDepth <= 0 {
			return nil, errors.New("harness: delegated resume requires persisted delegation depth")
		}
	} else if header.Origin == "subagent" {
		return nil, errors.New("harness: delegated session resume requires its live parent")
	}
	if err := m.reserveAgentActivation(header.ID, options.Parent); err != nil {
		return nil, err
	}
	defer m.releaseAgentActivation(header.ID)
	if err := session.RepairInterruptedTurn(); err != nil {
		return nil, fmt.Errorf("harness: repair interrupted session: %w", err)
	}
	options.ID = header.ID
	options.CWD = header.CWD
	session.MarkRestored()
	// A disposed Agent may leave its immutable session available for local
	// inspection. Persistence resume replaces that inactive materialization.
	if previous, exists := m.sessions.Get(header.ID); exists {
		m.sessions.RemoveExact(previous)
	}
	if err := m.sessions.Add(session); err != nil {
		return nil, err
	}
	return m.mount(ctx, session, options, true, false)
}

func (m *AgentManager) mount(ctx context.Context, session *Session, options AgentOptions, removeSessionOnFailure, freshSession bool) (*Agent, error) {
	header := session.Header()
	m.mu.RLock()
	var admissionErr error
	if m.disposed {
		admissionErr = ErrAgentManagerDisposed
	} else {
		admissionErr = m.activationSourcesErrorLocked(session, options.Parent)
	}
	m.mu.RUnlock()
	if admissionErr != nil {
		if removeSessionOnFailure {
			m.sessions.RemoveExact(session)
		}
		return nil, admissionErr
	}
	if options.MaxParallelToolCalls < 0 {
		if removeSessionOnFailure {
			m.sessions.RemoveExact(session)
		}
		return nil, errors.New("harness: maxParallelToolCalls must be a positive integer")
	}
	scopeParent := m.runtime.Root()
	if options.Parent != nil {
		// A delegated Agent joins its parent's composition plane so scoped
		// prompt/tool plugins remain inheritable. Session state, approvals, and
		// execution ownership stay child-local.
		scopeParent = options.Parent.Scope()
	}
	compaction := sampleBasicCompactionConfig(m.runtime, scopeParent, options.Compaction, options.DisableCompaction)
	scope := scopeParent.Child()
	lastTurn, err := session.LastTurn()
	if err != nil {
		if removeSessionOnFailure {
			m.sessions.RemoveExact(session)
		}
		return nil, err
	}
	durableInbox, err := NewDurableInbox(session)
	if err != nil {
		if removeSessionOnFailure {
			m.sessions.RemoveExact(session)
		}
		return nil, err
	}
	agent := newAgent(session, scope, m.adapter, m.modelInfo, m.attachments, m.prompts, m.tools, m.hooks, options.Provider, options.Model, options.ReasoningEffort, options.MaxSteps, options.MaxTokens, options.MaxParallelToolCalls, options.Delegated, options.Parent, freshSession)
	agent.initialAgentPreset = options.InitialAgentPreset
	agent.modelSelection = options.ModelSelection
	if err := m.trackActivationCandidate(header.ID, agent); err != nil {
		if removeSessionOnFailure {
			m.sessions.RemoveExact(session)
		}
		return nil, err
	}
	agent.durableInbox = durableInbox
	agent.externalTurn = options.ExternalTurn
	agent.externalConfigs = options.ExternalConfigs
	agent.externalSelectConfig = options.ExternalSelectConfig
	agent.externalModels = options.ExternalModels
	agent.externalSelectModel = options.ExternalSelectModel
	agent.agentLoopConfig = m.agentLoop
	agent.turn = lastTurn
	definition := point.Define(
		point.Descriptor{ID: "harness/agent-loop"},
		point.DecodeJSON[struct{}],
		func(run *point.Run, _ struct{}) (point.Dispose, error) {
			if err := run.BeforeCleanup("agent-admitted-operations", func(context.Context) error { return m.drainAgentOperationsBeforeCleanup(agent) }); err != nil {
				return nil, err
			}
			if err := agent.bindOperationRun(run); err != nil {
				return nil, err
			}
			if options.ToolResultPruner != nil {
				if err := MountToolResultPruner(run, agent, *options.ToolResultPruner); err != nil {
					return nil, err
				}
			}
			if compaction != nil {
				if err := MountBasicCompaction(run, agent, *compaction); err != nil {
					return nil, err
				}
			}
			if err := MountImageOffload(run, agent); err != nil {
				return nil, err
			}
			if options.Configure != nil {
				if err := options.Configure(ctx, run, agent); err != nil {
					return nil, err
				}
			}
			m.mu.RLock()
			sourcesErr := m.activationSourcesErrorLocked(session, options.Parent)
			m.mu.RUnlock()
			if sourcesErr != nil {
				return nil, sourcesErr
			}
			if err := m.hooks.Published.Emit(ctx, agent); err != nil {
				return nil, fmt.Errorf("harness: publish agent: %w", err)
			}
			return nil, run.Go("agent-loop", agent.worker)
		},
	)
	instance, err := m.runtime.Mount(scope, "agent:"+string(header.ID), definition, nil)
	if err != nil {
		agent.retired.Store(true)
		if removeSessionOnFailure {
			m.sessions.RemoveExact(session)
		}
		return nil, err
	}
	if err := instance.WaitStable(ctx); err != nil {
		agent.retired.Store(true)
		_ = m.disposeUnpublished(agent, instance)
		if removeSessionOnFailure {
			m.sessions.RemoveExact(session)
		}
		return nil, err
	}
	if snapshot := instance.Snapshot(); snapshot.State == point.Failed {
		agent.retired.Store(true)
		_ = m.disposeUnpublished(agent, instance)
		if removeSessionOnFailure {
			m.sessions.RemoveExact(session)
		}
		return nil, fmt.Errorf("harness: start agent: %w", instance.LastError())
	}
	select {
	case <-agent.ready:
	case <-agent.done:
		agent.retired.Store(true)
		_ = m.disposeUnpublished(agent, instance)
		if removeSessionOnFailure {
			m.sessions.RemoveExact(session)
		}
		return nil, errors.New("harness: agent worker stopped during startup")
	case <-ctx.Done():
		agent.retired.Store(true)
		_ = m.disposeUnpublished(agent, instance)
		if removeSessionOnFailure {
			m.sessions.RemoveExact(session)
		}
		return nil, ctx.Err()
	}
	m.mu.Lock()
	if m.disposed {
		m.mu.Unlock()
		agent.retired.Store(true)
		_ = m.disposeUnpublished(agent, instance)
		if removeSessionOnFailure {
			m.sessions.RemoveExact(session)
		}
		return nil, ErrAgentManagerDisposed
	}
	if _, exists := m.agents[agent.id]; exists {
		m.mu.Unlock()
		agent.retired.Store(true)
		_ = m.disposeUnpublished(agent, instance)
		if removeSessionOnFailure {
			m.sessions.RemoveExact(session)
		}
		return nil, fmt.Errorf("harness: agent %q already exists", agent.id)
	}
	admissionErr = agent.operationAdmissionError()
	if admissionErr == nil {
		admissionErr = m.activationSourcesErrorLocked(session, options.Parent)
	}
	if err := admissionErr; err != nil {
		m.mu.Unlock()
		agent.retired.Store(true)
		_ = m.disposeUnpublished(agent, instance)
		if removeSessionOnFailure {
			m.sessions.RemoveExact(session)
		}
		return nil, err
	}
	m.agents[agent.id] = managedAgent{agent: agent, instance: instance}
	m.mu.Unlock()
	activationErr := m.hooks.Activated.Emit(ctx, agent)
	validateActivation := func() error {
		m.mu.RLock()
		defer m.mu.RUnlock()
		current, live := m.agents[agent.ID()]
		if !live || current.agent != agent {
			return errors.New("agent was retired during activation")
		}
		if err := agent.operationAdmissionError(); err != nil {
			return err
		}
		return m.activationSourcesErrorLocked(session, options.Parent)
	}
	if activationErr == nil {
		activationErr = validateActivation()
	}
	if activationErr == nil && options.CommitComposition != nil {
		activationErr = options.CommitComposition(ctx, agent)
		if activationErr == nil {
			activationErr = validateActivation()
		}
	}
	if activationErr != nil {
		_ = m.RemoveExact(context.Background(), agent)
		if removeSessionOnFailure {
			m.sessions.RemoveExact(session)
		}
		return nil, fmt.Errorf("harness: activate agent: %w", activationErr)
	}
	return agent, nil
}

// The manager lock serializes parent retirement with child publication. The
// Session check also prevents callbacks from substituting a materialization
// after its configuration was already captured by this activation.
func (m *AgentManager) activationSourcesErrorLocked(session *Session, parent *Agent) error {
	if m.closing || m.disposed {
		return ErrAgentManagerDisposed
	}
	if parent != nil {
		current, exists := m.agents[parent.ID()]
		if !exists || current.agent != parent || parent.operationAdmissionError() != nil {
			return fmt.Errorf("harness: delegated activation requires the exact live parent: %w", ErrAgentRetired)
		}
	}
	current, exists := m.sessions.Get(session.Header().ID)
	if !exists || current != session {
		return errors.New("harness: activation Session materialization was replaced")
	}
	return nil
}

func (m *AgentManager) Get(id SessionID) (*Agent, bool) {
	m.mu.RLock()
	managed, ok := m.agents[id]
	if m.closing || (ok && managed.agent.operationAdmissionError() != nil) {
		managed, ok = managedAgent{}, false
	}
	m.mu.RUnlock()
	return managed.agent, ok
}

func (m *AgentManager) List() []*Agent {
	if m == nil {
		return nil
	}
	m.mu.RLock()
	if m.closing {
		m.mu.RUnlock()
		return nil
	}
	result := make([]*Agent, 0, len(m.agents))
	for _, managed := range m.agents {
		if managed.agent.operationAdmissionError() == nil {
			result = append(result, managed.agent)
		}
	}
	m.mu.RUnlock()
	sort.Slice(result, func(left, right int) bool { return result[left].ID() < result[right].ID() })
	return result
}

func (m *AgentManager) Remove(ctx context.Context, id SessionID) error {
	m.mu.Lock()
	managed, ok := m.agents[id]
	if !ok {
		m.mu.Unlock()
		return fmt.Errorf("harness: unknown agent %q", id)
	}
	pending := len(m.retiring) != 0
	retired := m.retireTreeLocked(managed.agent)
	m.mu.Unlock()
	return m.waitRemoval(ctx, retired, pending)
}

// RemoveExact releases this runtime generation and its exact runtime descendants.
// Historical header lineage never grants ownership of an explicitly reopened root.
func (m *AgentManager) RemoveExact(ctx context.Context, agent *Agent) error {
	if agent == nil {
		return nil
	}
	m.mu.Lock()
	managed, ok := m.agents[agent.ID()]
	if !ok || managed.agent != agent {
		m.mu.Unlock()
		return nil
	}
	pending := len(m.retiring) != 0
	retired := m.retireTreeLocked(agent)
	m.mu.Unlock()
	return m.waitRemoval(ctx, retired, pending)
}

// retireTreeLocked withdraws the whole runtime subtree before any external
// callback can block. A nil root means terminal manager-wide retirement.
func (m *AgentManager) retireTreeLocked(root *Agent) []managedAgent {
	retired := make([]managedAgent, 0)
	phase := &agentRetirementPhase{hooksDone: make(chan struct{})}
	preparations := make([]*agentActivation, 0)
	for _, activation := range m.activating {
		owned := root == nil || activation.candidate == root
		for current := activation.parent; !owned && current != nil; current = current.parent {
			owned = current == root
		}
		if owned {
			activation.retired = true
			if activation.candidate != nil {
				activation.candidate.retired.Store(true)
			}
			preparations = append(preparations, activation)
		}
	}
	depth := func(agent *Agent) int {
		level := 0
		for parent := agent.parent; parent != nil; parent = parent.parent {
			level++
		}
		return level
	}
	for id, managed := range m.agents {
		owned := root == nil
		for current := managed.agent; !owned && current != nil; current = current.parent {
			owned = current == root
		}
		if !owned {
			continue
		}
		managed.agent.retired.Store(true)
		managed.agent.operationPhase.CompareAndSwap(nil, phase)
		managed.retirement = &agentRetirement{owner: m, scopeDone: make(chan struct{}), done: make(chan struct{}), preparations: preparations}
		if m.retiring == nil {
			m.retiring = make(map[*Agent]*agentRetirement)
		}
		m.retiring[managed.agent] = managed.retirement
		managed.agent.retirement.Store(managed.retirement)
		delete(m.agents, id)
		retired = append(retired, managed)
	}
	if len(retired) != 0 {
		for _, preparation := range preparations {
			if preparation.candidate != nil && !preparation.cleanupStarted {
				preparation.candidate.operationPhase.CompareAndSwap(nil, phase)
			}
		}
	}
	// Already withdrawn descendants still own resources and errors. Capture
	// exact receipt edges before leaving the manager lock, including this batch.
	for _, managed := range retired {
		for agent, receipt := range m.retiring {
			if agent == managed.agent {
				continue
			}
			for parent := agent.Parent(); parent != nil; parent = parent.Parent() {
				if parent == managed.agent {
					managed.retirement.descendants = append(managed.retirement.descendants, receipt)
					break
				}
			}
		}
	}
	sort.Slice(retired, func(i, j int) bool {
		left, right := depth(retired[i].agent), depth(retired[j].agent)
		if left != right {
			return left > right
		}
		return retired[i].agent.ID() < retired[j].agent.ID()
	})
	return retired
}

func (m *AgentManager) disposeManagedAgents(ctx context.Context, retired []managedAgent) error {
	var joined error
	hookErrors := make(map[*Agent]error, len(retired))
	scopeErrors := make(map[*Agent]error, len(retired))
	// Retiring observers and provider disposal may join an admitted command.
	// Cancel the whole withdrawn subtree before invoking any such callback.
	for _, managed := range retired {
		managed.agent.cancelOperations(ErrAgentRetired)
		for _, preparation := range managed.retirement.preparations {
			if preparation.candidate != nil {
				preparation.candidate.cancelOperations(ErrAgentRetired)
			}
		}
	}
	for _, managed := range retired {
		hookErrors[managed.agent] = invokeAgentCleanup(func() error { return m.hooks.Retiring.EmitAll(ctx, managed.agent) })
	}
	if len(retired) != 0 {
		close(retired[0].agent.operationPhase.Load().hooksDone)
	}
	for _, managed := range retired {
		scopeErrors[managed.agent] = invokeAgentCleanup(func() error { return m.disposeManagedAgent(ctx, managed) })
		m.finishAgentScope(managed, scopeErrors[managed.agent])
	}
	// A provider may be awaiting its own Agent scope. All local scope receipts
	// must be published before joining any provider's final cleanup receipt.
	for _, managed := range retired {
		var preparationErr error
		for _, activation := range managed.retirement.preparations {
			<-activation.done
			m.mu.RLock()
			preparationErr = errors.Join(preparationErr, activation.cleanupErr)
			m.mu.RUnlock()
		}
		var descendantErr error
		for _, receipt := range managed.retirement.descendants {
			<-receipt.done
			m.mu.RLock()
			descendantErr = errors.Join(descendantErr, receipt.err)
			m.mu.RUnlock()
		}
		err := resolveRetirementError(ctx, errors.Join(hookErrors[managed.agent], scopeErrors[managed.agent], preparationErr, descendantErr))
		m.finishRetirement(managed, err)
		joined = errors.Join(joined, err)
	}
	return joined
}

func (m *AgentManager) disposeManagedAgent(ctx context.Context, managed managedAgent) error {
	cancelErr := managed.agent.CancelDSH(ctx, errors.New("harness: agent disposed"), false)
	instanceErr := managed.instance.Dispose(ctx)
	toolErr := m.tools.ReleaseAgent(ctx, managed.agent)
	var resourceErr error
	for index := len(managed.resources) - 1; index >= 0; index-- {
		resource := managed.resources[index]
		<-resource.ready
		resourceErr = errors.Join(resourceErr, invokeAgentCleanup(func() error { return resource.cleanup(ctx) }))
	}
	return errors.Join(cancelErr, instanceErr, toolErr, resourceErr, m.hooks.Deactivated.EmitAll(ctx, managed.agent))
}
