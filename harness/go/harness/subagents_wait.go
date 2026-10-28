package harness

import "context"

// WaitForChildren joins progressing descendants and preparations. An idle
// local child with parked input remains resident; the caller owns waking it.
func (r *SubagentRegistry) WaitForChildren(ctx context.Context, parent *Agent) (bool, error) {
	return r.waitForChildren(ctx, parent, nil)
}

func (r *SubagentRegistry) waitForChildren(ctx context.Context, parent *Agent, facade *SubagentFacade) (bool, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if parent == nil {
		return false, nil
	}
	roots := map[*Agent]struct{}{parent: {}}
	observed := false
	for {
		if err := ctx.Err(); err != nil {
			return observed, err
		}
		r.mu.Lock()
		if r.ownershipChanged == nil {
			r.ownershipChanged = make(chan struct{})
		}
		generation := r.ownershipChanged
		records := scopedSubagentRecords(r.descendantRecordsLocked(roots), facade)
		tokens := scopedSubagentPreparations(r.descendantPreparationsLocked(roots, false), facade)
		r.mu.Unlock()
		waited := false
		for _, token := range tokens {
			observed = true
			waited = true
			select {
			case <-token.published:
			case <-ctx.Done():
				return observed, ctx.Err()
			}
			r.mu.RLock()
			bound := token.bound
			r.mu.RUnlock()
			if bound == nil {
				select {
				case <-token.settled:
				case <-ctx.Done():
					return observed, ctx.Err()
				}
			}
		}
		for _, record := range records {
			state := record.activation
			if state == nil {
				continue
			}
			if record.child != nil && record.child.Status() != AgentIdle {
				observed = true
				waited = true
				if err := record.child.WhenIdle(ctx); err != nil {
					return observed, err
				}
			}
			r.mu.RLock()
			changed := state.changed
			owned := state.preparing != 0 || len(state.owned) != 0
			r.mu.RUnlock()
			if record.child != nil && !state.closing.Load() {
				child := record.child
				child.injectMu.Lock()
				parked := child.pendingPrompts.Load() != 0 || len(child.injected) != 0 || child.durableInbox.HasNextTurn() || child.durableInbox.HasNextStep()
				child.injectMu.Unlock()
				state.mu.Lock()
				failed := state.failure != nil
				state.mu.Unlock()
				if parked && !failed {
					continue
				}
				if owned {
					continue
				}
			}
			observed = true
			waited = true
			if record.child == nil || state.closing.Load() {
				select {
				case <-state.done:
				case <-ctx.Done():
					return observed, ctx.Err()
				}
			} else {
				select {
				case <-state.done:
				case <-changed:
				case <-ctx.Done():
					return observed, ctx.Err()
				}
			}
		}
		if waited {
			continue
		}
		r.mu.RLock()
		same := generation == r.ownershipChanged
		r.mu.RUnlock()
		if same {
			return observed, nil
		}
	}
}

func (f *SubagentFacade) WaitForChildren(ctx context.Context, parent *Agent) (bool, error) {
	return f.registry.waitForChildren(ctx, parent, f)
}
