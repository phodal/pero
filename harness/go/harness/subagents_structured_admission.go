package harness

import (
	"context"
	"errors"
	"sync"
)

var ErrSubagentInputClosed = &subagentActivationError{"harness: structured output has closed this activation's input; no input was accepted", "INPUT_CLOSED"}
var ErrSubagentCannotComplete = errors.New("Wait for all delegated child tasks to finish and process pending messages before submitting structured output.")

// SubagentStructuredAdmission coordinates one managed provider's capture with
// the exact child record, input admissions and descendant ownership. Providers
// opt in explicitly; this contract does not change legacy one-shot capture or
// direct Host Agent input APIs. It must never be reused by a cold activation.
// All mutable fields are protected by registry.mu, not a provider callback lock.
type SubagentStructuredAdmission struct {
	registry         *SubagentRegistry
	child            *Agent
	initialMessageID string
	record           *subagentRecord
	initialPending   bool
	inputs           int
	captures         int
}

// NewSubagentStructuredAdmission prepares a gate before the provider publishes
// its run. initialMessageID must be the request's InitialPromptMessage identity.
// The registry binds it exactly once before announcing or beginning the child.
func NewSubagentStructuredAdmission(registry *SubagentRegistry, child *Agent, initialMessageID string) (*SubagentStructuredAdmission, error) {
	if registry == nil || child == nil || initialMessageID == "" {
		return nil, errors.New("harness: structured admission requires registry, child and initial message identity")
	}
	return &SubagentStructuredAdmission{registry: registry, child: child, initialMessageID: initialMessageID}, nil
}

func (g *SubagentStructuredAdmission) bindLocked(record *subagentRecord, initialMessageID string) error {
	if g == nil || g.registry == nil || g.child != record.child || g.initialMessageID != initialMessageID || g.record != nil || record.activation == nil {
		return errors.New("harness: managed structured provider returned an invalid or reused admission gate")
	}
	g.record, g.initialPending = record, record.activation.initialStart
	record.activation.structuredAdmission = g
	return nil
}

func (g *SubagentStructuredAdmission) currentErrorLocked() error {
	if g.record == nil {
		return ErrSubagentActivationNotReady
	}
	if g.record.activation.closing.Load() {
		return &subagentActivationError{"harness: activation is closing", "ACTIVATION_CLOSING"}
	}
	if g.registry.disposed || g.registry.records[g.record.snapshot.ID] != g.record {
		return &subagentActivationError{"harness: structured activation is no longer authoritative", "UNAUTHORIZED"}
	}
	if !g.record.activation.bindingReady.Load() {
		return ErrSubagentActivationNotReady
	}
	return nil
}

// BeginCapture atomically refuses unfinished work and reserves closed input.
// The returned release is for failed/discarded capture only: retain it across a
// successful inner PTC result, and retain it permanently on committed output.
// TryLock makes synchronous inbox/source observers reject completion instead of
// waiting on the mutation whose callback they are executing.
func (g *SubagentStructuredAdmission) BeginCapture() (func(), error) {
	if g == nil {
		return nil, errors.New("harness: structured admission is unavailable")
	}
	child := g.child
	if !child.admissionMu.TryLock() {
		return nil, ErrSubagentCannotComplete
	}
	defer child.admissionMu.Unlock()
	if !child.inboxClaimMu.TryLock() {
		return nil, ErrSubagentCannotComplete
	}
	defer child.inboxClaimMu.Unlock()
	pending := child.durableInbox.HasNextTurn() || child.durableInbox.HasNextStep()
	r := g.registry
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := g.currentErrorLocked(); err != nil {
		return nil, err
	}
	state := g.record.activation
	if pending || g.initialPending || g.inputs != 0 || state.inputs != 0 || state.preparing != 0 || len(state.owned) != 0 || len(r.preparationReceipts[child]) != 0 {
		return nil, ErrSubagentCannotComplete
	}
	g.captures++
	var once sync.Once
	return func() {
		once.Do(func() {
			r.mu.Lock()
			g.captures--
			r.signalActivationLocked(state)
			r.mu.Unlock()
		})
	}, nil
}

// AdmitDSHMessage reserves an attempt before source preparation and releases it
// at the durable inbox commit, before observers or the worker can run. No gate,
// registry or capture mutex spans preparation, persistence or notifications.
func (g *SubagentStructuredAdmission) AdmitDSHMessage(ctx context.Context, message Message, target InboxTarget) (<-chan TurnOutcome, error) {
	return g.admitDSHMessage(ctx, message, target, nil)
}

// acceptedLocked is package-private and memory-only. It cannot invoke provider,
// lifecycle or persistence code and runs with registry.mu at exact durable commit.
func (g *SubagentStructuredAdmission) admitDSHMessage(ctx context.Context, message Message, target InboxTarget, acceptedLocked func()) (<-chan TurnOutcome, error) {
	if g == nil {
		return nil, errors.New("harness: structured admission is unavailable")
	}
	r := g.registry
	r.mu.Lock()
	if err := g.currentErrorLocked(); err != nil {
		r.mu.Unlock()
		return nil, err
	}
	if g.captures != 0 {
		r.mu.Unlock()
		return nil, ErrSubagentInputClosed
	}
	g.inputs++
	state := g.record.activation
	r.mu.Unlock()
	var once sync.Once
	finish := func(committed bool) {
		once.Do(func() {
			r.mu.Lock()
			g.inputs--
			if committed {
				if message.ID == g.initialMessageID {
					g.initialPending = false
				}
				if acceptedLocked != nil {
					acceptedLocked()
				}
			}
			r.signalActivationLocked(state)
			r.mu.Unlock()
		})
	}
	defer finish(false)
	return g.child.admitDSHMessage(ctx, message, target, func() { finish(true) })
}

func (r *SubagentRegistry) activationInputPendingLocked(record *subagentRecord) bool {
	g := record.structuredAdmission
	return record.activation.inputs != 0 || (g != nil && (g.inputs != 0 || g.initialPending))
}
