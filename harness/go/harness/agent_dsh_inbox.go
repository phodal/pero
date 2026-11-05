package harness

import (
	"context"
	"errors"
)

// InterruptDSH aborts the current phase and parks accepted inbox work until a
// later waking admission. Cancel retains its Host contract: ordinary accepted
// prompts continue after cancellation. No admission/claim lock is acquired here
// because source-append and inbox observers may interrupt synchronously.
func (a *Agent) InterruptDSH(cause error) error {
	if a == nil {
		return errors.New("harness: cannot interrupt a nil agent")
	}
	if cause == nil {
		cause = context.Canceled
	}
	a.mu.Lock()
	a.inboxInterrupt++
	// Maintenance already latches wakes behind its lease; keep those wakes.
	if !a.maintenance {
		a.inboxParked = true
	}
	cancel := a.turnCancel
	becameIdle := a.activityCtx == nil && !a.maintenance && a.status != AgentIdle
	if becameIdle {
		a.status = AgentIdle
		close(a.idle)
	}
	// Abort before releasing the phase lock: a following admission must classify
	// steering against the canceled phase, even while the adapter winds down.
	if cancel != nil {
		cancel(cause)
	}
	a.mu.Unlock()
	if becameIdle {
		a.publishStatus(AgentIdle)
	}
	return nil
}

// AdmitDSHMessage commits source-aware DSH queue/steer input. ctx bounds the
// pre-commit admission; accepted messages and queue settlements belong to the
// Agent, independently of the requesting RPC. Steering stays in the durable
// next-step inbox unless it arrived while an active phase was already aborted.
// Next-step delivery has no distinct turn settlement and returns a nil channel.
func (a *Agent) AdmitDSHMessage(ctx context.Context, message Message, target InboxTarget) (<-chan TurnOutcome, error) {
	return a.admitDSHMessage(ctx, message, target, nil)
}

// committed is an internal memory-only reservation/generation transition. It
// runs at durable acceptance under the established Agent -> registry lock order.
func (a *Agent) admitDSHMessage(ctx context.Context, message Message, target InboxTarget, committed func()) (<-chan TurnOutcome, error) {
	if a == nil {
		return nil, errors.New("harness: cannot admit to a nil agent")
	}
	if target != InboxNextTurn && target != InboxNextStep {
		return nil, errors.New("harness: invalid DSH inbox target")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	operation, err := a.beginOperation(ctx)
	if err != nil {
		return nil, err
	}
	defer operation.release()
	ctx = operation.context
	message, err = validateInboxMessage(a, message)
	if err != nil {
		return nil, err
	}
	message, err = a.prepareQueuedMessage(ctx, message, messageHasUserSource(message))
	if err != nil {
		return nil, err
	}
	a.mu.Lock()
	interrupt := a.inboxInterrupt
	if a.activityCtx != nil && a.activityCtx.Err() != nil {
		target = InboxNextTurn
	}
	a.mu.Unlock()
	request := promptRequest{ctx: context.Background(), message: message, result: make(chan promptResult, 1), admitted: make(chan struct{}), userAuthored: messageHasUserSource(message)}
	a.admissionMu.Lock()
	a.inboxClaimMu.Lock()
	if err = a.operationAdmissionError(); err == nil {
		err = ctx.Err()
	}
	if err != nil {
		a.inboxClaimMu.Unlock()
		a.admissionMu.Unlock()
		return nil, err
	}
	// The commit is the acceptance boundary. A listener may retire this exact
	// Agent or cancel the RPC, but neither can turn that accepted fact into a
	// rejection. As with Followup, acceptance records source input, not a
	// successful fsync. The worker checkpoints its claim before model visibility
	// and reports checkpoint failure through the accepted settlement/Error hook.
	// A failed post-Splice flush cannot undo that committed source event.
	mutation, err := a.durableInbox.Splice(target, len(a.durableInbox.Pending(target)), 0, []Message{message})
	if err != nil {
		a.inboxClaimMu.Unlock()
		a.admissionMu.Unlock()
		return nil, err
	}
	request.message = mutation.Inserted[0]
	request.inboxEpoch = a.inboxEpoch
	if a.inboxAdmissions == nil {
		a.inboxAdmissions = make(map[string]chan struct{})
	}
	a.inboxAdmissions[request.message.ID] = request.admitted
	if target == InboxNextTurn {
		a.pendingRequests[request.message.ID] = request
		a.pendingPrompts.Add(1)
	}
	if committed != nil {
		committed()
	}
	a.inboxClaimMu.Unlock()
	a.admissionMu.Unlock()
	// Observers run outside both mutation locks. The claim barrier keeps an old
	// driver wake from consuming the newly committed message before notification.
	a.publishInboxInserted(request.message, target, request.userAuthored)
	close(request.admitted)
	a.inboxClaimMu.Lock()
	delete(a.inboxAdmissions, request.message.ID)
	a.inboxClaimMu.Unlock()
	hasPending := a.durableInbox.HasNextTurn() || a.durableInbox.HasNextStep()
	a.mu.Lock()
	if a.inboxInterrupt == interrupt {
		a.inboxParked = false
	}
	wake := hasPending && !a.inboxParked && !a.retired.Load()
	becameRunning := wake && a.status == AgentIdle && !a.maintenance
	if becameRunning {
		a.status = AgentRunning
		a.idle = make(chan struct{})
	}
	a.mu.Unlock()
	if becameRunning {
		a.publishStatus(AgentRunning)
	}
	if wake {
		a.requestDurableWakeFor(target)
	}
	if target != InboxNextTurn {
		return nil, nil
	}
	return a.promptOutcome(request), nil
}

func (a *Agent) promptOutcome(request promptRequest) <-chan TurnOutcome {
	result := make(chan TurnOutcome, 1)
	go func() {
		select {
		case settled := <-request.result:
			result <- TurnOutcome{Turn: settled.turn, Err: settled.err}
		case <-a.done:
			result <- TurnOutcome{Err: errors.New("harness: agent is disposed")}
		}
		close(result)
	}()
	return result
}

// inboxAdmissionBarrierLocked returns the first publication barrier within the
// next claim. It is guarded by inboxClaimMu, and never waited with locks held.
func (a *Agent) inboxAdmissionBarrierLocked(target InboxTarget) <-chan struct{} {
	pending := a.durableInbox.Pending(InboxNextStep)
	if target == InboxNextTurn {
		queued := a.durableInbox.Pending(InboxNextTurn)
		if len(queued) != 0 {
			pending = append(pending, queued[0])
		}
	}
	for _, message := range pending {
		if ready := a.inboxAdmissions[message.ID]; ready != nil {
			select {
			case <-ready:
				delete(a.inboxAdmissions, message.ID)
			default:
				return ready
			}
		}
	}
	return nil
}
