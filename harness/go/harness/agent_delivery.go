package harness

import (
	"context"
	"errors"
	"fmt"
)

// Inject queues a plugin-authored user message for the next model step. It is
// consumed by the same single Agent worker as ordinary prompts, so policy and
// runtime notices cannot race a request surface append.
func (a *Agent) Inject(message Message) error {
	message, err := validatePluginMessage(a, message)
	if err != nil {
		return err
	}
	entry := injectedMessage{message: cloneMessage(message), admitted: make(chan struct{})}
	a.injectMu.Lock()
	if err := a.mutationAdmissionError(); err != nil {
		a.injectMu.Unlock()
		return err
	}
	a.injected = append(a.injected, entry)
	a.injectMu.Unlock()
	a.publishInboxInserted(message, InboxNextStep, false)
	close(entry.admitted)
	return nil
}

// Deliver injects a plugin-authored notice into the active turn. If the turn
// has already crossed its final-step boundary, wake starts a follow-up turn;
// quiet delivery remains queued until some later turn.
func (a *Agent) Deliver(message Message, wake bool) error {
	message, err := validatePluginMessage(a, message)
	if err != nil {
		return err
	}
	a.injectMu.Lock()
	if err := a.mutationAdmissionError(); err != nil {
		a.injectMu.Unlock()
		return err
	}
	if a.acceptingInject {
		entry := injectedMessage{message: cloneMessage(message), admitted: make(chan struct{})}
		a.injected = append(a.injected, entry)
		a.injectMu.Unlock()
		a.publishInboxInserted(message, InboxNextStep, false)
		close(entry.admitted)
		return nil
	}
	a.injectMu.Unlock()
	if wake {
		return a.Followup(message)
	}
	return a.Inject(message)
}

// DeliverDurable commits one source-identified plugin message before it can
// become model-visible. Wakeup messages own FIFO turns; quiet messages wait at
// the next-step boundary. A resumed Agent replays the same pending queues.
func (a *Agent) DeliverDurable(ctx context.Context, message Message, wake bool) error {
	return a.deliverInboxNotice(ctx, message, wake, true)
}

// DeliverBackgroundNotice commits a source-identified completion notice to the
// existing inbox before scheduling it. It never clears the user interrupt latch.
func (a *Agent) DeliverBackgroundNotice(ctx context.Context, message Message) error {
	return a.deliverInboxNotice(ctx, message, true, false)
}

// deliverInboxNotice retains stable source identities in the existing inbox.
// The internal wake respects interruption; unlike explicit WakeDurable it does
// not unpark work that the user stopped. In-memory Sessions remain in-memory.
func (a *Agent) deliverInboxNotice(ctx context.Context, message Message, wake, requirePersistence bool) error {
	if err := a.mutationAdmissionError(); err != nil {
		return err
	}
	if a == nil || a.durableInbox == nil {
		return errors.New("harness: Agent inbox is unavailable")
	}
	if requirePersistence && !a.session.DurabilityAttached() {
		return errors.New("harness: durable Agent delivery requires attached session persistence")
	}
	target := InboxNextStep
	if wake {
		target = InboxNextTurn
	}
	a.inboxClaimMu.Lock()
	if err := a.mutationAdmissionError(); err != nil {
		a.inboxClaimMu.Unlock()
		return err
	}
	inserted, err := a.durableInbox.Append(target, message)
	if err != nil {
		a.inboxClaimMu.Unlock()
		return err
	}
	if a.session.DurabilityAttached() {
		if err := a.session.Flush(ctx); err != nil {
			a.inboxClaimMu.Unlock()
			return err
		}
	}
	a.inboxClaimMu.Unlock()
	if inserted {
		a.publishInboxInserted(message, target, false)
	}
	if wake {
		a.requestDurableWake()
	}
	return nil
}

// SpliceDurableInbox exposes DSH's durable Inbox mutation boundary to Host
// adapters. Inbox mutations never wake an Agent by themselves.
func (a *Agent) SpliceDurableInbox(ctx context.Context, target InboxTarget, start, deleteCount int, inserted []Message) (InboxMutation, error) {
	if err := a.mutationAdmissionError(); err != nil {
		return InboxMutation{}, err
	}
	if a == nil || a.durableInbox == nil {
		return InboxMutation{}, errors.New("harness: durable Agent inbox is unavailable")
	}
	a.inboxClaimMu.Lock()
	if err := a.mutationAdmissionError(); err != nil {
		a.inboxClaimMu.Unlock()
		return InboxMutation{}, err
	}
	mutation, err := a.durableInbox.Splice(target, start, deleteCount, inserted)
	if err != nil {
		a.inboxClaimMu.Unlock()
		return InboxMutation{}, err
	}
	if a.session.DurabilityAttached() {
		if err := a.session.Flush(ctx); err != nil {
			a.inboxClaimMu.Unlock()
			return mutation, err
		}
	}
	a.inboxClaimMu.Unlock()
	for _, message := range mutation.Removed {
		a.publishInboxDiscarded(message, false)
	}
	for _, message := range mutation.Inserted {
		a.publishInboxInserted(message, target, false)
	}
	return mutation, nil
}

func (a *Agent) PendingDurableInbox(target InboxTarget) []Message {
	if a == nil || a.durableInbox == nil {
		return nil
	}
	return a.durableInbox.Pending(target)
}

// ResumeDurableInbox re-arms persisted wakeup work after the caller has
// attached Session persistence. Hosts call it at the end of resume activation;
// scheduling earlier could claim a message into an unattached Session.
func (a *Agent) ResumeDurableInbox() error {
	if err := a.mutationAdmissionError(); err != nil {
		return err
	}
	if a == nil || a.durableInbox == nil || !a.durableInbox.HasNextTurn() {
		return nil
	}
	if !a.session.DurabilityAttached() {
		return errors.New("harness: resume durable inbox requires attached session persistence")
	}
	a.requestDurableWake()
	return nil
}

func (a *Agent) requestDurableWake() {
	a.requestDurableWakeFor(InboxNextTurn)
}

// WakeDurable schedules a turn for an already committed Inbox message. A
// single coalesced wake covers both targets; if the active turn claims the
// message first, the worker drops the now-empty wake without opening a turn.
func (a *Agent) WakeDurable(target InboxTarget) error {
	if err := a.mutationAdmissionError(); err != nil {
		return err
	}
	if a == nil || a.durableInbox == nil {
		return errors.New("harness: durable Agent inbox is unavailable")
	}
	if target != InboxNextTurn && target != InboxNextStep {
		return fmt.Errorf("harness: invalid durable inbox target %q", target)
	}
	if len(a.durableInbox.Pending(target)) == 0 {
		return nil
	}
	a.mu.Lock()
	// WakeDurable is an explicit waking request, unlike internal driver
	// continuation, which must leave an interrupted inbox parked.
	a.inboxParked = false
	activeStep := target == InboxNextStep && a.status == AgentRunning && !a.maintenance &&
		a.activityCtx != nil && a.activityCtx.Err() == nil
	a.mu.Unlock()
	if activeStep {
		return nil
	}
	if a.admissionMu.TryLock() {
		a.requestDurableWakeForLocked(target)
		a.admissionMu.Unlock()
	} else {
		// Agent hooks are synchronous and may request a wake while their Go
		// admission boundary is still publishing. The durable splice is already
		// committed, so defer only the driver latch instead of deadlocking the
		// reentrant listener.
		go a.requestDurableWakeFor(target)
	}
	return nil
}

func (a *Agent) requestDurableWakeFor(target InboxTarget) {
	if a == nil {
		return
	}
	a.admissionMu.Lock()
	a.requestDurableWakeForLocked(target)
	a.admissionMu.Unlock()
}

func (a *Agent) requestDurableWakeForLocked(target InboxTarget) {
	a.mu.Lock()
	parked := a.inboxParked
	a.mu.Unlock()
	if parked {
		return
	}
	if a.mutationAdmissionError() != nil {
		return
	}
	if a == nil || a.durableInbox == nil {
		return
	}
	if target == InboxNextTurn && !a.durableInbox.HasNextTurn() {
		return
	}
	if target == InboxNextStep && !a.durableInbox.HasNextStep() {
		return
	}
	request := promptRequest{
		ctx: context.Background(), result: make(chan promptResult, 1), durableWake: true, inboxEpoch: a.inboxEpoch,
	}
	if a.durableWake {
		return
	}
	select {
	case <-a.done:
		return
	default:
	}
	a.durableWake = true
	a.mu.Lock()
	becameRunning := false
	if a.status == AgentIdle && !a.maintenance {
		a.status = AgentRunning
		a.idle = make(chan struct{})
		becameRunning = true
	}
	a.pendingPrompts.Add(1)
	a.mu.Unlock()
	if becameRunning {
		a.publishStatus(AgentRunning)
	}
	select {
	case a.inbox <- request:
	case <-a.done:
		a.durableWake = false
		a.pendingPrompts.Add(-1)
	default:
		// Existing tokens already guarantee driver entry; never hold the
		// admission lock waiting for the same worker to free channel capacity.
		a.durableWake = false
		a.pendingPrompts.Add(-1)
	}
}

// Followup asynchronously admits a plugin-authored user message as a new
// turn. It uses the same serialized inbox as Prompt but does not wait for the
// model result.
func (a *Agent) Followup(message Message) error {
	_, err := a.FollowupResult(message)
	return err
}

// FollowupResult admits a plugin-authored turn and returns its eventual
// settlement without blocking admission. The Agent inbox remains the sole FIFO
// ordering authority; cancellation of the active turn does not discard later
// accepted follow-ups.
func (a *Agent) FollowupResult(message Message) (<-chan TurnOutcome, error) {
	return a.FollowupResultContext(context.Background(), message)
}

// FollowupResultContext uses ctx only to bound inbox admission. Once accepted,
// the child owns the turn independently of the caller's later cancellation.
func (a *Agent) FollowupResultContext(ctx context.Context, message Message) (<-chan TurnOutcome, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	message, err := validatePluginMessage(a, message)
	if err != nil {
		return nil, err
	}
	request, err := a.enqueuePromptContexts(ctx, context.Background(), message, false)
	if err != nil {
		return nil, err
	}
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
	return result, nil
}

// TryFollowup admits one plugin-authored turn only when the Agent is exactly
// idle with no prompt already queued. The admission lock makes a racing human
// Prompt win or lose atomically; policy drivers can yield without reordering
// an already-admitted user turn.
func (a *Agent) TryFollowup(message Message) (bool, error) {
	return a.tryFollowup(message, nil)
}

func (a *Agent) tryFollowup(message Message, admission *FollowupAdmission) (bool, error) {
	return a.tryFollowupOwned(message, admission, nil)
}

func (a *Agent) tryFollowupOwned(message Message, admission *FollowupAdmission, owned *OwnedFollowupReceipt) (accepted bool, resultErr error) {
	message, err := validatePluginMessage(a, message)
	if err != nil {
		return false, err
	}
	message, err = a.prepareQueuedMessage(context.Background(), message, false)
	if err != nil {
		return false, err
	}
	if owned != nil {
		owned.message = cloneMessage(message)
		owned.digest = followupDigest(message)
	}
	if admission != nil {
		receipt, err := a.prepareOwnedFollowupAdmission(message, *admission, owned)
		if err != nil {
			return false, err
		}
		if owned != nil {
			owned.admission = receipt
		}
		defer func() {
			if !accepted {
				a.abandonFollowupAdmission(receipt.message)
			}
		}()
	}
	request := promptRequest{
		ctx: context.Background(), message: cloneMessage(message), owned: owned,
		result: make(chan promptResult, 1), admitted: make(chan struct{}), userAuthored: false,
	}
	a.admissionMu.Lock()
	if err := a.mutationAdmissionError(); err != nil {
		a.admissionMu.Unlock()
		return false, err
	}
	request.inboxEpoch = a.inboxEpoch
	a.mu.Lock()
	if a.status != AgentIdle || a.maintenance || a.pendingPrompts.Load() != 0 {
		a.mu.Unlock()
		a.admissionMu.Unlock()
		return false, nil
	}
	interrupt := a.inboxInterrupt
	a.mu.Unlock()
	mutation, err := a.durableInbox.Splice(
		InboxNextTurn, len(a.durableInbox.Pending(InboxNextTurn)), 0, []Message{request.message},
	)
	if err != nil {
		a.admissionMu.Unlock()
		return false, err
	}
	request.message = mutation.Inserted[0]
	a.pendingRequests[request.message.ID] = request
	a.publishInboxInserted(request.message, InboxNextTurn, request.userAuthored)
	a.mu.Lock()
	if a.inboxInterrupt == interrupt {
		a.inboxParked = false
	}
	wake := !a.inboxParked
	if wake {
		a.status = AgentRunning
		a.idle = make(chan struct{})
	}
	a.pendingPrompts.Add(1)
	a.mu.Unlock()
	if wake {
		a.publishStatus(AgentRunning)
	}
	select {
	case a.inbox <- request:
		owned.publishQueued()
		close(request.admitted)
		a.admissionMu.Unlock()
		return true, nil
	case <-a.done:
		delete(a.pendingRequests, request.message.ID)
		var mutation InboxMutation
		var removeErr error
		if owned != nil {
			mutation, _, removeErr = a.durableInbox.RemoveExact(request.message)
			owned.recordCleanup(removeErr)
		} else {
			mutation, _, _ = a.durableInbox.Remove(request.message.ID)
		}
		if len(mutation.Removed) != 0 {
			a.publishInboxDiscarded(request.message, request.userAuthored)
		}
		a.pendingPrompts.Add(-1)
		a.setIdle()
		a.admissionMu.Unlock()
		disposedErr := errors.New("harness: agent is disposed")
		if removeErr != nil {
			disposedErr = errors.Join(disposedErr, removeErr)
		}
		return false, disposedErr
	}
}

func validatePluginMessage(a *Agent, message Message) (Message, error) {
	if a == nil {
		return Message{}, errors.New("harness: cannot deliver to a nil agent")
	}
	if err := a.mutationAdmissionError(); err != nil {
		return Message{}, err
	}
	if message.Role == "" {
		message.Role = RoleUser
	}
	if message.Role != RoleUser || len(message.Content) == 0 {
		return Message{}, errors.New("harness: plugin message must be a non-empty user message")
	}
	select {
	case <-a.done:
		return Message{}, errors.New("harness: agent is disposed")
	default:
	}
	return message, nil
}

func (a *Agent) takeInjected(ctx context.Context, turn int) []Message {
	a.injectMu.Lock()
	entries := a.injected
	a.injected = nil
	a.injectMu.Unlock()
	messages := make([]Message, 0, len(entries))
	for _, entry := range entries {
		<-entry.admitted
		message := entry.message
		a.publishInboxClaimed(ctx, message, turn, false)
		messages = append(messages, message)
	}
	return messages
}

func (a *Agent) finishOrTakeInjected(ctx context.Context, turn int) []Message {
	a.injectMu.Lock()
	if len(a.injected) == 0 {
		a.acceptingInject = false
		a.injectMu.Unlock()
		return nil
	}
	entries := a.injected
	a.injected = nil
	a.injectMu.Unlock()
	messages := make([]Message, 0, len(entries))
	for _, entry := range entries {
		<-entry.admitted
		message := entry.message
		a.publishInboxClaimed(ctx, message, turn, false)
		messages = append(messages, message)
	}
	return messages
}

func (a *Agent) discardInjected() {
	a.injectMu.Lock()
	entries := a.injected
	a.injected = nil
	a.acceptingInject = false
	a.injectMu.Unlock()
	for _, entry := range entries {
		<-entry.admitted
		a.publishInboxDiscarded(entry.message, false)
	}
}

func (a *Agent) publishInboxInserted(message Message, target InboxTarget, userAuthored bool) {
	if a == nil || a.hooks == nil || a.hooks.InboxInserted == nil {
		return
	}
	_ = a.hooks.InboxInserted.EmitAll(context.Background(), InboxInsertedInput{
		Agent: a, Message: cloneMessage(message), Target: target, UserAuthored: userAuthored,
	})
}

func (a *Agent) publishInboxClaimed(ctx context.Context, message Message, turn int, userAuthored bool) {
	if a == nil || a.hooks == nil || a.hooks.InboxClaimed == nil {
		return
	}
	_ = a.hooks.InboxClaimed.EmitAll(ctx, InboxClaimedInput{
		Agent: a, Message: cloneMessage(message), Turn: turn, UserAuthored: userAuthored,
	})
}

func (a *Agent) publishInboxDiscarded(message Message, userAuthored bool) {
	if a != nil {
		a.followupAdmissionMu.Lock()
		receipt := a.followupAdmissions[message.ID]
		a.followupAdmissionMu.Unlock()
		if receipt != nil {
			a.abandonFollowupAdmission(message)
		}
	}
	if a == nil || a.hooks == nil || a.hooks.InboxDiscarded == nil {
		return
	}
	_ = a.hooks.InboxDiscarded.EmitAll(context.Background(), InboxDiscardedInput{
		Agent: a, Message: cloneMessage(message), UserAuthored: userAuthored,
	})
}
