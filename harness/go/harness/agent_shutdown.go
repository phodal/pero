package harness

import (
	"context"
	"errors"
	"fmt"
	"sync"

	point "github.com/phodal/pero/harness/go/runtime"
)

var ErrAgentDisposalInProgress = errors.New("harness: agent disposal is in progress")

type agentActivation struct {
	candidate      *Agent
	parent         *Agent
	retired        bool
	done           chan struct{}
	cleanupErr     error
	cleanupStarted bool // guarded by manager.mu
}

type agentRetirement struct {
	owner        *AgentManager
	scopeDone    chan struct{}
	scopeErr     error
	preparations []*agentActivation
	descendants  []*agentRetirement
	done         chan struct{}
	err          error
}

func (m *AgentManager) signalLifecycleLocked() {
	if m.lifecycleChanged != nil {
		close(m.lifecycleChanged)
	}
	m.lifecycleChanged = make(chan struct{})
}

// trackActivationCandidate runs before any Configure/Published callback can
// receive this pointer. Sealing and candidate exposure share the manager lock.
func (m *AgentManager) trackActivationCandidate(id SessionID, agent *Agent) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	activation := m.activating[id]
	if activation == nil || activation.retired || m.closing || m.disposed {
		agent.retired.Store(true)
		return ErrAgentManagerDisposed
	}
	activation.candidate = agent
	return nil
}

func (m *AgentManager) disposeUnpublished(agent *Agent, instance *point.Instance) error {
	agent.retired.Store(true)
	agent.cancelOperations(ErrAgentRetired)
	var failedErr error
	if instance.Snapshot().State == point.Failed {
		failedErr = withoutActivationRejection(instance.LastError())
	}
	err := errors.Join(failedErr, invokeAgentCleanup(func() error { return instance.Dispose(context.Background()) }))
	m.mu.Lock()
	if activation := m.activating[agent.ID()]; activation != nil && activation.candidate == agent {
		activation.cleanupErr = errors.Join(activation.cleanupErr, err)
	} else if m.closing {
		m.terminalErr = errors.Join(m.terminalErr, err)
	}
	m.mu.Unlock()
	return err
}

func (m *AgentManager) finishRetirement(managed managedAgent, err error) {
	m.mu.Lock()
	receipt := m.retiring[managed.agent]
	if receipt != nil && receipt == managed.retirement {
		receipt.err = err
		if m.closing {
			m.terminalErr = errors.Join(m.terminalErr, err)
		}
		delete(m.retiring, managed.agent)
		close(receipt.done)
		m.signalLifecycleLocked()
	}
	m.mu.Unlock()
}

// waitRemoval keeps cleanup owned after a caller stops waiting. The receipt
// was registered under the same lock that withdrew the exact Agent map entry.
func (m *AgentManager) waitRemoval(ctx context.Context, retired []managedAgent, pending bool) error {
	if ctx == nil {
		ctx = context.Background()
	}
	for _, managed := range retired {
		if len(managed.retirement.preparations) != 0 || agentDisposalMaySelfWait(managed.agent) || m.tools.callbacksWithin(managed.agent.Scope()) {
			pending = true
		}
	}
	// A command registered by these Agents may be invoked through a retained
	// Handler with no Agent (or an unrelated Agent) in its invocation. The
	// registry-wide busy count conservatively avoids joining that body here.
	// Observe it only after the exact retirement fence has been installed.
	if m.commandCallbacksActive() {
		pending = true
	}
	done := make(chan error, 1)
	go func() { done <- m.disposeManagedAgents(context.Background(), retired) }()
	if pending {
		return ErrAgentDisposalInProgress
	}
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (m *AgentManager) finishAgentScope(managed managedAgent, err error) {
	m.mu.Lock()
	if receipt := m.retiring[managed.agent]; receipt != nil && receipt == managed.retirement {
		receipt.scopeErr = err
		close(receipt.scopeDone)
	}
	m.mu.Unlock()
}

func (m *AgentManager) waitAgentScope(ctx context.Context, agent *Agent) error {
	m.mu.RLock()
	receipt := agent.retirement.Load()
	m.mu.RUnlock()
	if receipt == nil {
		return nil
	}
	select {
	case <-receipt.scopeDone:
	case <-ctx.Done():
		return ctx.Err()
	}
	m.mu.RLock()
	err := receipt.scopeErr
	m.mu.RUnlock()
	// Accepted reentrant retirement requests are joined by the manager's final
	// receipt. They cannot make this Agent wait for its own scope completion.
	return withoutRetirementPending(err)
}

func (m *AgentManager) agentScopePending(agent *Agent) bool {
	m.mu.RLock()
	receipt := agent.retirement.Load()
	m.mu.RUnlock()
	if receipt == nil {
		return false
	}
	select {
	case <-receipt.scopeDone:
		return false
	default:
		return true
	}
}

// WaitRetired joins cleanup of one exact Agent generation after Remove or
// RemoveExact requested retirement. It must be called outside its callbacks.
func (m *AgentManager) WaitRetired(ctx context.Context, agent *Agent) error {
	if m == nil || agent == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	m.mu.RLock()
	receipt := agent.retirement.Load()
	current, live := m.agents[agent.ID()]
	m.mu.RUnlock()
	if receipt == nil {
		if live && current.agent == agent {
			return errors.New("harness: Agent retirement has not been requested")
		}
		return nil
	}
	if receipt.owner != m {
		return errors.New("harness: Agent retirement belongs to another manager")
	}
	select {
	case <-receipt.done:
	case <-ctx.Done():
		return ctx.Err()
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	return receipt.err
}

// transformLifecycleError handles both single and multi-cause wrappers. Matching
// errors.Is at a parent node would discard unrelated joined cleanup failures.
func transformLifecycleError(err error, leaf func(error) (error, bool)) (error, bool) {
	if err == nil {
		return nil, false
	}
	if result, changed := leaf(err); changed {
		return result, true
	}
	if group, ok := err.(interface{ Unwrap() []error }); ok {
		var result error
		changed := false
		for _, part := range group.Unwrap() {
			mapped, altered := transformLifecycleError(part, leaf)
			result = errors.Join(result, mapped)
			changed = changed || altered
		}
		if changed {
			return result, true
		}
	} else if wrapper, ok := err.(interface{ Unwrap() error }); ok {
		mapped, changed := transformLifecycleError(wrapper.Unwrap(), leaf)
		if changed {
			if mapped == nil {
				return nil, true
			}
			return &resolvedLifecycleError{message: err.Error(), cause: mapped}, true
		}
	}
	return err, false
}

type resolvedLifecycleError struct {
	message string
	cause   error
}

func (e *resolvedLifecycleError) Error() string { return e.message }
func (e *resolvedLifecycleError) Unwrap() error { return e.cause }

// Embedding owners can expose their own typed pending marker via Is while
// retaining a separate final Drain receipt. Match only leaves, never wrappers
// that might also contain unrelated cleanup failures.
func isRetirementPendingLeaf(err error, targets ...error) bool {
	if _, ok := err.(interface{ Unwrap() []error }); ok {
		return false
	}
	if _, ok := err.(interface{ Unwrap() error }); ok {
		return false
	}
	for _, target := range targets {
		if errors.Is(err, target) {
			return true
		}
	}
	return false
}

func withoutRetirementPending(err error) error {
	result, _ := transformLifecycleError(err, func(current error) (error, bool) {
		if isRetirementPendingLeaf(current, ErrAgentDisposalInProgress, ErrSubagentDisposalInProgress, ErrHarnessDisposalInProgress) {
			return nil, true
		}
		if _, ok := current.(*subagentDisposalPending); ok {
			return nil, true
		}
		return current, false
	})
	return result
}

func resolveRetirementError(ctx context.Context, err error) error {
	result, _ := transformLifecycleError(err, func(current error) (error, bool) {
		if pending, ok := current.(*subagentDisposalPending); ok {
			return pending.claim.wait(ctx), true
		}
		if isRetirementPendingLeaf(current, ErrAgentDisposalInProgress, ErrHarnessDisposalInProgress) {
			return nil, true
		}
		return current, false
	})
	return result
}

// sealAdmission revokes new and retained-pointer authority without running a
// callback. Raw map ownership remains available for provider/manager teardown.
func (m *AgentManager) sealAdmission() bool {
	if m == nil {
		return false
	}
	m.mu.Lock()
	m.closing = true
	pending := len(m.activating) != 0 || len(m.retiring) != 0
	agents := make([]*Agent, 0, len(m.agents))
	for _, managed := range m.agents {
		managed.agent.retired.Store(true)
		agents = append(agents, managed.agent)
	}
	for _, activation := range m.activating {
		if activation.candidate != nil {
			activation.candidate.retired.Store(true)
			agents = append(agents, activation.candidate)
		}
	}
	m.mu.Unlock()
	for _, agent := range agents {
		agent.cancelOperations(ErrAgentRetired)
		if agentDisposalMaySelfWait(agent) || m.tools.callbacksWithin(agent.Scope()) {
			pending = true
		}
	}
	return pending || m.commandCallbacksActive()
}

// Dispose initiates terminal retirement once. A caller that may be on a
// callback/admission stack receives an explicit pending receipt; Drain joins
// the same cleanup after that callback unwinds.
func (m *AgentManager) Dispose(ctx context.Context) error {
	if m == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	pending := m.sealAdmission()
	m.mu.Lock()
	if m.disposed {
		done := m.disposeDone
		m.mu.Unlock()
		if done == nil {
			return nil
		}
		select {
		case <-done:
			return m.Drain(ctx)
		default:
			return ErrAgentDisposalInProgress
		}
	}
	m.disposed = true
	m.disposeDone = make(chan struct{})
	retired := m.retireTreeLocked(nil)
	m.mu.Unlock()
	go func() {
		_ = m.disposeManagedAgents(context.Background(), retired)
		// A Configure operation and a Remove started before the seal still own
		// their scopes. Their exact completion, not map absence, certifies cleanup.
		m.mu.Lock()
		for len(m.activating) != 0 || len(m.retiring) != 0 {
			if m.lifecycleChanged == nil {
				m.lifecycleChanged = make(chan struct{})
			}
			changed := m.lifecycleChanged
			m.mu.Unlock()
			<-changed
			m.mu.Lock()
		}
		m.disposeErr = m.terminalErr
		close(m.disposeDone)
		m.mu.Unlock()
	}()
	if pending {
		return ErrAgentDisposalInProgress
	}
	return m.Drain(ctx)
}

// Drain joins requested terminal disposal, including activations and removals
// that were already in flight. It must be called outside their callbacks.
func (m *AgentManager) Drain(ctx context.Context) error {
	if m == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	m.mu.RLock()
	done := m.disposeDone
	m.mu.RUnlock()
	if done == nil {
		return nil
	}
	select {
	case <-done:
	case <-ctx.Done():
		return ctx.Err()
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.disposeErr
}

func invokeAgentCleanup(callback func() error) (err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("harness: agent cleanup panicked: %v", recovered)
		}
	}()
	return callback()
}

// DisposalWouldBlock is a conservative observation of this manager's callback
// and lifecycle gates. It does not certify that an embedding service's own
// callbacks or wait groups are safe to join.
func (m *AgentManager) DisposalWouldBlock() bool {
	if m == nil {
		return false
	}
	if m.commandCallbacksActive() {
		return true
	}
	m.mu.RLock()
	if len(m.activating) != 0 || len(m.retiring) != 0 {
		m.mu.RUnlock()
		return true
	}
	agents := make([]*Agent, 0, len(m.agents))
	for _, managed := range m.agents {
		agents = append(agents, managed.agent)
	}
	m.mu.RUnlock()
	for _, agent := range agents {
		if agentDisposalMaySelfWait(agent) || m.tools.callbacksWithin(agent.Scope()) {
			return true
		}
	}
	return false
}

// Failed startup already ran its effect cleanup. Preserve that cleanup's error
// while excluding the expected authority rejection that triggered rollback.
func withoutActivationRejection(err error) error {
	result, _ := transformLifecycleError(err, func(current error) (error, bool) {
		if current == ErrAgentManagerDisposed || current == ErrAgentRetired {
			return nil, true
		}
		return current, false
	})
	return result
}

// agentCleanupResource is transferred with its exact Agent into retirement.
// Closing ready publishes all resource fields captured by cleanup.
type agentCleanupResource struct {
	ready   chan struct{}
	cleanup func(context.Context) error
}

// RegisterCleanup reserves exact-Agent resource ownership before an external
// attachment or scope creation can expose callbacks. The returned prepared
// function must run on every success/failure path after all resource fields are
// final. It never waits. Retirement rejects further dispatch immediately but
// waits for preparation and then invokes cleanup once, after the worker stops
// and before Deactivated/scope completion. Cleanup must not join this Agent's
// own WaitRetired receipt.
func (m *AgentManager) RegisterCleanup(agent *Agent, cleanup func(context.Context) error) (prepared func(), err error) {
	if m == nil || agent == nil || cleanup == nil {
		return nil, errors.New("harness: exact Agent and cleanup are required")
	}
	m.mu.Lock()
	managed, live := m.agents[agent.ID()]
	if m.closing || m.disposed || !live || managed.agent != agent || agent.retired.Load() {
		m.mu.Unlock()
		return nil, ErrAgentRetired
	}
	resource := &agentCleanupResource{ready: make(chan struct{}), cleanup: cleanup}
	managed.resources = append(managed.resources, resource)
	m.agents[agent.ID()] = managed
	agent.resourcePreparations.Add(1)
	m.mu.Unlock()
	var once sync.Once
	return func() { once.Do(func() { close(resource.ready); agent.resourcePreparations.Add(-1) }) }, nil
}

// commandCallbacksActive uses the retained exact registry rather than a
// live runtime lookup, which can disappear while withdrawn callbacks drain.
func (m *AgentManager) commandCallbacksActive() bool {
	return m != nil && m.commands != nil && m.commands.callbacks.Load() != 0
}
