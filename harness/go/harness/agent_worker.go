package harness

import (
	"context"
	"encoding/json"
	"errors"
	"sync"

	harnessmodel "github.com/phodal/pero/harness/go/model"
)

type MaintenanceLease struct {
	Context context.Context
	once    sync.Once
	finish  func()
}

func (l *MaintenanceLease) Close() {
	if l == nil {
		return
	}
	l.once.Do(func() {
		if l.finish != nil {
			l.finish()
		}
	})
}

// BeginMaintenance reserves the exact externally-idle Agent phase. Prompt
// admission remains open but queued work cannot start until the lease closes.
func (a *Agent) BeginMaintenance(ctx context.Context) (*MaintenanceLease, error) {
	if err := a.mutationAdmissionError(); err != nil {
		return nil, err
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	a.admissionMu.Lock()
	if err := a.mutationAdmissionError(); err != nil {
		a.admissionMu.Unlock()
		return nil, err
	}
	if a.pendingPrompts.Load() != 0 || !a.activityMu.TryLock() {
		a.admissionMu.Unlock()
		return nil, newManualCompactionError(ManualCompactionBusy, "maintenance requires an idle agent", nil)
	}
	a.mu.Lock()
	if a.status != AgentIdle || a.maintenance || a.workerCtx == nil {
		a.mu.Unlock()
		a.activityMu.Unlock()
		a.admissionMu.Unlock()
		return nil, newManualCompactionError(ManualCompactionBusy, "maintenance requires an idle agent", nil)
	}
	operationContext, cancel := context.WithCancelCause(a.workerCtx)
	a.maintenance = true
	a.idle = make(chan struct{})
	a.turnCancel = cancel
	a.activityCtx = operationContext
	a.mu.Unlock()
	a.admissionMu.Unlock()
	stopCallerCancel := context.AfterFunc(ctx, func() { cancel(ctx.Err()) })
	return &MaintenanceLease{Context: operationContext, finish: func() {
		stopCallerCancel()
		cancel(nil)
		a.mu.Lock()
		a.maintenance = false
		a.turnCancel = nil
		a.activityCtx = nil
		becameRunning := false
		if a.pendingPrompts.Load() == 0 || a.inboxParked {
			close(a.idle)
		} else if a.status != AgentRunning {
			a.status = AgentRunning
			becameRunning = true
		}
		a.mu.Unlock()
		if becameRunning {
			a.publishStatus(AgentRunning)
		}
		a.activityMu.Unlock()
	}}, nil
}

// runMaintenance reserves an externally idle agent for one non-turn operation.
// Prompts admitted after the reservation remain queued behind activityMu.
func (a *Agent) runMaintenance(
	ctx context.Context,
	job func(context.Context) (*CompactionResult, error),
) (*CompactionResult, error) {
	lease, err := a.BeginMaintenance(ctx)
	if err != nil {
		if classified := (*ManualCompactionError)(nil); errors.As(err, &classified) {
			return nil, newManualCompactionError(ManualCompactionBusy, "manual compaction requires an idle agent", classified)
		}
		return nil, err
	}
	defer lease.Close()
	result, err := job(lease.Context)
	if ctxErr := ctx.Err(); ctxErr != nil {
		return nil, ctxErr
	}
	return result, err
}

func (a *Agent) WhenIdle(ctx context.Context) error {
	if ctx == nil {
		ctx = context.Background()
	}
	for {
		a.mu.Lock()
		idle := a.idle
		status := a.status
		maintenance := a.maintenance
		a.mu.Unlock()
		if status == AgentIdle && !maintenance {
			return nil
		}
		select {
		case <-idle:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

func (a *Agent) worker(ctx context.Context) error {
	defer close(a.done)
	defer a.setIdle()
	a.mu.Lock()
	a.workerCtx = ctx
	a.mu.Unlock()
	close(a.ready)
	for {
		select {
		case <-ctx.Done():
			a.Cancel(context.Cause(ctx))
			a.failQueued(context.Cause(ctx))
			return nil
		case request := <-a.inbox:
			wakeConsumed := false
			if request.admitted != nil {
				<-request.admitted
			}
		retryRequest:
			a.activityMu.Lock()
			a.admissionMu.Lock()
			a.inboxClaimMu.Lock()
			if request.owned != nil {
				candidate, queued := a.pendingRequests[request.message.ID]
				if !queued || candidate.owned != request.owned {
					// Exact withdrawal leaves the channel token inert. It must
					// not wake unrelated quiet inputs or a later independent turn.
					a.inboxClaimMu.Unlock()
					a.admissionMu.Unlock()
					a.activityMu.Unlock()
					continue
				}
			}
			if barrier := a.inboxAdmissionBarrierLocked(InboxNextTurn); barrier != nil {
				a.inboxClaimMu.Unlock()
				a.admissionMu.Unlock()
				a.activityMu.Unlock()
				select {
				case <-barrier:
					goto retryRequest
				case <-ctx.Done():
					a.failQueued(context.Cause(ctx))
					return nil
				}
			}
			if request.durableWake && !wakeConsumed {
				wakeConsumed = true
				a.durableWake = false
				a.pendingPrompts.Add(-1)
			}
			a.mu.Lock()
			parked := a.inboxParked
			becameIdle := parked && a.status != AgentIdle
			if becameIdle {
				a.status = AgentIdle
				close(a.idle)
			}
			a.mu.Unlock()
			if parked {
				a.inboxClaimMu.Unlock()
				a.admissionMu.Unlock()
				a.activityMu.Unlock()
				if becameIdle {
					a.publishStatus(AgentIdle)
				}
				continue
			}

			type pendingSettlement struct {
				request promptRequest
				err     error
			}
			var settlements []pendingSettlement
			pending := a.durableInbox.Pending(InboxNextTurn)
			pendingIDs := make(map[string]struct{}, len(pending))
			for _, message := range pending {
				pendingIDs[message.ID] = struct{}{}
			}
			// Claim/cleanup and selected retirement share the exact owner fence.
			// No callback, queue mutation or wait occurs under that fence; release
			// every Agent lock before waiting on a reversible reservation.
			var ownerBarrier <-chan struct{}
			for id, candidate := range a.pendingRequests {
				_, stillPending := pendingIDs[id]
				selected := len(pending) != 0 && pending[0].ID == id
				if candidate.owned != nil && (selected || !stillPending || candidate.ctx.Err() != nil) {
					if ownerBarrier = candidate.owned.claim(); ownerBarrier != nil {
						break
					}
				}
			}
			if ownerBarrier != nil {
				a.inboxClaimMu.Unlock()
				a.admissionMu.Unlock()
				a.activityMu.Unlock()
				select {
				case <-ownerBarrier:
					goto retryRequest
				case <-ctx.Done():
					a.failQueued(context.Cause(ctx))
					return nil
				}
			}
			for id, candidate := range a.pendingRequests {
				_, stillPending := pendingIDs[id]
				candidateErr := candidate.ctx.Err()
				if stillPending && candidateErr == nil {
					continue
				}
				if candidateErr == nil {
					candidateErr = context.Canceled
				}
				if stillPending {
					mutation, _, removeErr := a.durableInbox.Remove(id)
					if removeErr != nil {
						candidate.owned.recordCleanup(removeErr)
						candidateErr = removeErr
					} else if len(mutation.Removed) != 0 {
						a.publishInboxDiscarded(candidate.message, candidate.userAuthored)
					}
				}
				if candidate.owned != nil {
					// A moved/replaced exact item must not retain guarded authority
					// after its original pending request has been settled.
					a.abandonFollowupAdmission(candidate.message)
				}
				delete(a.pendingRequests, id)
				a.pendingPrompts.Add(-1)
				settlements = append(settlements, pendingSettlement{request: candidate, err: candidateErr})
			}

			pending = a.durableInbox.Pending(InboxNextTurn)
			// Removing a canceled head can expose a different owned head. Fence
			// that exact request too, before removing its pending-request binding.
			if len(pending) != 0 {
				candidate := a.pendingRequests[pending[0].ID]
				if barrier := candidate.owned.claim(); barrier != nil {
					a.inboxClaimMu.Unlock()
					a.admissionMu.Unlock()
					a.activityMu.Unlock()
					for _, settlement := range settlements {
						settlement.request.result <- promptResult{err: settlement.err}
						settlement.request.owned.settle(TurnOutcome{Err: settlement.err})
					}
					select {
					case <-barrier:
						goto retryRequest
					case <-ctx.Done():
						a.failQueued(context.Cause(ctx))
						return nil
					}
				}
			}
			claimNextTurn := len(pending) != 0
			work := promptRequest{ctx: context.Background(), result: make(chan promptResult, 1), durableWake: true}
			hasWork := claimNextTurn || a.durableInbox.HasNextStep()
			hasWaiter := false
			if len(pending) != 0 {
				if candidate, ok := a.pendingRequests[pending[0].ID]; ok {
					work = candidate
					hasWaiter = true
					delete(a.pendingRequests, pending[0].ID)
				} else {
					work.message = pending[0]
					work.userAuthored = messageHasUserSource(pending[0])
				}
			}
			if len(pending) == 0 {
				for _, message := range a.durableInbox.Pending(InboxNextStep) {
					if messageHasUserSource(message) {
						work.userAuthored = true
						break
					}
				}
			}
			if !request.durableWake && (!hasWaiter || request.message.ID != work.message.ID) {
				if _, queued := a.pendingRequests[request.message.ID]; queued {
					a.inbox <- request
				}
			}
			remaining := a.pendingPrompts.Load()
			var turnContext context.Context
			var cancel context.CancelCauseFunc
			var stopRequestCancel func() bool
			becameRunning := false
			if hasWork {
				// The worker owns the turn lifetime. Copy only the tracing identity from
				// the queued caller context when transferring execution ownership.
				workContext := WithPromptReceiptID(ctx, promptReceiptID(work.ctx))
				if work.owned != nil {
					workContext = context.WithValue(workContext, ownedFollowupExecutionKey{}, work.owned)
				}
				turnContext, cancel = context.WithCancelCause(workContext)
				stopRequestCancel = context.AfterFunc(work.ctx, func() { cancel(work.ctx.Err()) })
				a.mu.Lock()
				a.turnHuman = work.userAuthored
				a.turnCancel = cancel
				a.activityCtx = turnContext
				if a.inboxParked {
					cancel(context.Canceled)
				}
				if a.status == AgentIdle {
					a.status = AgentRunning
					a.idle = make(chan struct{})
					becameRunning = true
				}
				a.mu.Unlock()
			}
			a.admissionMu.Unlock()
			for _, settlement := range settlements {
				settlement.request.result <- promptResult{err: settlement.err}
			}
			if !hasWork {
				a.inboxClaimMu.Unlock()
				a.activityMu.Unlock()
				if remaining == 0 {
					a.setIdle()
				}
				for _, settlement := range settlements {
					settlement.request.owned.settle(TurnOutcome{Err: settlement.err})
				}
				continue
			}

			for _, settlement := range settlements {
				settlement.request.owned.settle(TurnOutcome{Err: settlement.err})
			}
			if becameRunning {
				a.publishStatus(AgentRunning)
			}
			claimBoundaryOpen := true
			turn, err := a.runTurn(turnContext, nil, claimNextTurn, func([]Message) {
				if claimBoundaryOpen {
					claimBoundaryOpen = false
					a.inboxClaimMu.Unlock()
				}
			})
			if claimBoundaryOpen {
				claimBoundaryOpen = false
				a.inboxClaimMu.Unlock()
			}
			stopRequestCancel()
			cancel(nil)
			a.admissionMu.Lock()
			remaining = a.pendingPrompts.Load()
			if hasWaiter {
				remaining = a.pendingPrompts.Add(-1)
			}
			a.mu.Lock()
			a.turnCancel = nil
			a.activityCtx = nil
			a.turnHuman = false
			parked = a.inboxParked
			a.mu.Unlock()
			// Parked request tokens may have been drained. The durable inbox, not
			// those transient tokens, owns the remaining FIFO work after a wake.
			if !parked {
				if a.durableInbox.HasNextTurn() {
					a.requestDurableWakeForLocked(InboxNextTurn)
				} else if a.durableInbox.HasNextStep() {
					a.requestDurableWakeForLocked(InboxNextStep)
				}
			}
			a.mu.Lock()
			becameIdle = (a.inboxParked || a.pendingPrompts.Load() == 0) && a.status != AgentIdle
			if becameIdle {
				a.status = AgentIdle
				close(a.idle)
			}
			a.mu.Unlock()
			a.activityMu.Unlock()
			a.admissionMu.Unlock()
			if becameIdle {
				a.publishStatus(AgentIdle)
			}
			if hasWaiter {
				work.result <- promptResult{turn: turn, err: err}
				work.owned.settle(TurnOutcome{Turn: turn, Err: err})
			}
		}
	}
}

func (a *Agent) setRunning() {
	a.mu.Lock()
	changed := false
	if a.status == AgentIdle {
		a.status = AgentRunning
		a.idle = make(chan struct{})
		changed = true
	}
	a.mu.Unlock()
	if changed {
		a.publishStatus(AgentRunning)
	}
}

func (a *Agent) setIdle() {
	a.mu.Lock()
	changed := false
	if a.status != AgentIdle {
		a.status = AgentIdle
		close(a.idle)
		changed = true
	}
	a.mu.Unlock()
	if changed {
		a.publishStatus(AgentIdle)
	}
}

func (a *Agent) publishStatus(status AgentStatus) {
	if a == nil || a.hooks == nil || a.hooks.Status == nil {
		return
	}
	// Status is a contained notification. A transition has already committed,
	// so observers cannot veto it or replace the worker's result.
	_ = a.hooks.Status.EmitAll(context.Background(), AgentStatusInput{Agent: a, Status: status})
}

func (a *Agent) failQueued(err error) {
	if err == nil {
		err = context.Canceled
	}
	a.admissionMu.Lock()
	a.inboxEpoch++
	queued := make([]promptRequest, 0, len(a.pendingRequests))
	for id, request := range a.pendingRequests {
		request.owned.finalizing()
		if request.owned != nil {
			a.abandonFollowupAdmission(request.message)
		}
		queued = append(queued, request)
		delete(a.pendingRequests, id)
		a.pendingPrompts.Add(-1)
	}
	for draining := true; draining; {
		select {
		case request := <-a.inbox:
			if request.admitted != nil {
				<-request.admitted
			}
			if request.durableWake {
				a.durableWake = false
				a.pendingPrompts.Add(-1)
			}
		default:
			draining = false
		}
	}
	remaining := a.pendingPrompts.Load()
	a.admissionMu.Unlock()
	for _, request := range queued {
		request.result <- promptResult{err: err}
	}
	a.discardInjected()
	if remaining == 0 {
		a.setIdle()
	}
	for _, request := range queued {
		request.owned.settle(TurnOutcome{Err: err})
	}
}

func messageHasUserSource(message Message) bool {
	var source struct {
		Kind string `json:"kind"`
	}
	return json.Unmarshal(message.Source, &source) == nil && source.Kind == "user"
}

func cloneMessage(message Message) Message {
	return harnessmodel.CloneMessage(message)
}

func cloneMessages(messages []Message) []Message {
	return harnessmodel.CloneMessages(messages)
}
