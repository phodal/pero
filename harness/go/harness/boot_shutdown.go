package harness

import (
	"context"
	"errors"
)

var ErrHarnessDisposalInProgress = errors.New("harness: shutdown is in progress")

// Dispose requests one terminal shutdown transaction. Admission is revoked
// synchronously; callback callers receive pending rather than waiting for
// themselves. Drain, called from an outer lifecycle, is the final receipt.
func (h *Harness) Dispose(ctx context.Context) error {
	if h == nil || h.application == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	h.disposeMu.Lock()
	if h.disposeDone != nil {
		done := h.disposeDone
		h.disposeMu.Unlock()
		select {
		case <-done:
			return h.Drain(ctx)
		default:
			return ErrHarnessDisposalInProgress
		}
	}
	h.disposeDone = make(chan struct{})
	h.disposeMu.Unlock()
	pending := h.agents.sealAdmission()
	if h.tools.sealAdmission() {
		pending = true
	}
	if h.commands.sealAdmission() {
		pending = true
	}
	if h.subagents != nil {
		_, subagentPending := h.subagents.requestDisposal()
		pending = pending || subagentPending
	}
	go func() {
		var subagentErr, agentErr error
		if h.subagents != nil {
			subagentErr = h.subagents.Drain(context.Background())
		}
		if h.agents != nil {
			_ = h.agents.Dispose(context.Background())
			agentErr = h.agents.Drain(context.Background())
		}
		applicationErr := h.application.Dispose(context.Background())
		h.disposeMu.Lock()
		h.disposeErr = errors.Join(subagentErr, agentErr, applicationErr)
		close(h.disposeDone)
		h.disposeMu.Unlock()
	}()
	if pending {
		return ErrHarnessDisposalInProgress
	}
	return h.Drain(ctx)
}

// Drain joins a previously requested shutdown independently of its caller's
// canceled wait. Never call it from a callback whose return cleanup requires.
func (h *Harness) Drain(ctx context.Context) error {
	if h == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	h.disposeMu.Lock()
	done := h.disposeDone
	h.disposeMu.Unlock()
	if done == nil {
		return nil
	}
	select {
	case <-done:
	case <-ctx.Done():
		return ctx.Err()
	}
	h.disposeMu.Lock()
	defer h.disposeMu.Unlock()
	return h.disposeErr
}

// DisposalWouldBlock conservatively detects Harness-owned admission, callback,
// and cleanup operations. Embedders must also account for their own callbacks.
func (h *Harness) DisposalWouldBlock() bool {
	if h == nil {
		return false
	}
	h.disposeMu.Lock()
	done := h.disposeDone
	h.disposeMu.Unlock()
	if done != nil {
		select {
		case <-done:
		default:
			return true
		}
	}
	if h.tools != nil && h.tools.callbacks.Load() != 0 {
		return true
	}
	if h.commands != nil && h.commands.callbacks.Load() != 0 {
		return true
	}
	if h.agents.DisposalWouldBlock() {
		return true
	}
	r := h.subagents
	if r == nil {
		return false
	}
	if r.callbacks.Load() != 0 || r.activationReceipts.Load() != 0 {
		return true
	}
	r.mu.RLock()
	if r.disposeDone != nil {
		select {
		case <-r.disposeDone:
		default:
			r.mu.RUnlock()
			return true
		}
	}
	records := make([]*subagentRecord, 0, len(r.records))
	for _, record := range r.records {
		records = append(records, record)
	}
	r.mu.RUnlock()
	for _, record := range records {
		if record.disposal != nil && record.disposal.inProgress() {
			return true
		}
		if agentDisposalMaySelfWait(record.child) || agentDisposalMaySelfWait(record.parent) {
			return true
		}
	}
	return false
}
