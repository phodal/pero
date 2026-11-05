package harness

import (
	"context"
	"errors"
	"sync"
)

// SubagentBackgroundActivity retains one exact managed activation, rather than
// a session ID. Its owner must release it after finishing or cancelling work.
// Retention does not prevent turns, grant tools, or survive runtime shutdown.
type SubagentBackgroundActivity struct {
	registry *SubagentRegistry
	record   *subagentRecord
	once     sync.Once
}

func (s *subagentActivationState) hasOwnedWorkLocked() bool {
	return s.preparing != 0 || len(s.owned) != 0 || s.activities != 0
}

// RetainBackgroundActivity returns nil for roots, legacy children, and managed
// foreground runs. A selected background provider opts in per activation.
func (r *SubagentRegistry) RetainBackgroundActivity(child *Agent) (*SubagentBackgroundActivity, error) {
	if r == nil {
		return nil, nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	state := r.activationParents[child]
	if state == nil || !state.retainActivities {
		return nil, nil
	}
	record := r.records[child.ID()]
	if r.disposed || record == nil || record.child != child || record.activation != state || !r.parentAdmitsLocked(child) || !r.activationAcceptsInput(record) {
		return nil, ErrSubagentAdmissionClosed
	}
	if gate := state.structuredAdmission; gate != nil && gate.captures != 0 {
		return nil, ErrSubagentInputClosed
	}
	state.activities++
	r.signalActivationLocked(state)
	return &SubagentBackgroundActivity{registry: r, record: record}, nil
}

// Deliver steers the original child's inbox while retention still prevents
// settlement. The same admission path checks exact ownership and closed input;
// it never cold-resumes a replacement child with the same durable identity.
func (a *SubagentBackgroundActivity) Deliver(ctx context.Context, message Message) error {
	return a.registry.admitActivationMessage(ctx, a.record, a.record.parent, nil, message, "steer")
}

// Release ends ownership once. A failure to persist or deliver a completion
// becomes an activation failure instead of silently returning an older answer.
func (a *SubagentBackgroundActivity) Release(err error) {
	if a == nil {
		return
	}
	a.once.Do(func() {
		r := a.registry
		if err != nil {
			a.record.activation.mu.Lock()
			a.record.activation.activityFailure = errors.Join(a.record.activation.activityFailure, err)
			a.record.activation.mu.Unlock()
		}
		r.mu.Lock()
		state := a.record.activation
		state.activities--
		r.signalActivationLocked(state)
		r.mu.Unlock()
	})
}
