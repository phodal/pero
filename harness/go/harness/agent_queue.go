package harness

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
)

// ErrAgentRetired rejects new mutation admission after a generation has
// surrendered its manager authority. Cleanup and cancellation remain allowed.
var ErrAgentRetired = errors.New("harness: agent generation is retired")

func (a *Agent) mutationAdmissionError() error {
	if a == nil || a.retired.Load() {
		return ErrAgentRetired
	}
	return nil
}

func (a *Agent) Prompt(ctx context.Context, message Message) (TurnResult, error) {
	return a.promptContext(ctx, message, true)
}

// PromptFollowup runs an attributed host/plugin follow-up with the caller's
// execution lifetime. Unlike asynchronous FollowupResultContext, cancellation
// also prevents a queued turn from starting. It never records a human claim.
func (a *Agent) PromptFollowup(ctx context.Context, message Message) (TurnResult, error) {
	message, err := validatePluginMessage(a, message)
	if err != nil {
		return TurnResult{}, err
	}
	return a.promptContext(ctx, message, false)
}

func (a *Agent) promptContext(ctx context.Context, message Message, userAuthored bool) (TurnResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if message.Role == "" {
		message.Role = RoleUser
	}
	if message.Role != RoleUser {
		return TurnResult{}, errors.New("harness: prompt message must have user role")
	}
	request, err := a.enqueuePrompt(ctx, message, userAuthored)
	if err != nil {
		return TurnResult{}, err
	}
	select {
	case result := <-request.result:
		return result.turn, result.err
	case <-a.done:
		return TurnResult{}, errors.New("harness: agent is disposed")
	case <-ctx.Done():
		return TurnResult{}, ctx.Err()
	}
}

func (a *Agent) enqueuePrompt(ctx context.Context, message Message, userAuthored bool) (promptRequest, error) {
	return a.enqueuePromptContexts(ctx, ctx, message, userAuthored)
}

func (a *Agent) prepareQueuedMessage(ctx context.Context, message Message, userAuthored bool) (Message, error) {
	if err := a.mutationAdmissionError(); err != nil {
		return Message{}, err
	}
	if a.externalTurn != nil {
		for _, block := range message.Content {
			if block.Type != BlockText {
				return Message{}, errors.New("external Harness currently accepts text only")
			}
		}
	}
	if ctx == nil {
		ctx = context.Background()
	}
	content, err := materializeContentImages(ctx, a.attachments, message.Content)
	if err != nil {
		return Message{}, fmt.Errorf("harness: admit prompt attachments: %w", err)
	}
	if err := a.mutationAdmissionError(); err != nil {
		return Message{}, err
	}
	message.Content = content
	if message.ID == "" {
		message.ID, err = newMessageID()
		if err != nil {
			return Message{}, fmt.Errorf("harness: create prompt message identity: %w", err)
		}
	}
	if len(message.Source) == 0 {
		if userAuthored {
			message.Source = json.RawMessage(`{"kind":"user"}`)
		} else {
			message.Source = json.RawMessage(`{"kind":"plugin","plugin":"point"}`)
		}
	}
	return validateDurableMessage(message)
}

func newMessageID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	value[6] = value[6]&0x0f | 0x40
	value[8] = value[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", value[:4], value[4:6], value[6:8], value[8:10], value[10:]), nil
}

func (a *Agent) enqueuePromptContexts(admissionCtx, turnCtx context.Context, message Message, userAuthored bool) (promptRequest, error) {
	message, err := a.prepareQueuedMessage(admissionCtx, message, userAuthored)
	if err != nil {
		return promptRequest{}, err
	}
	request := promptRequest{
		ctx: turnCtx, message: cloneMessage(message), result: make(chan promptResult, 1),
		admitted: make(chan struct{}), userAuthored: userAuthored,
	}
	a.admissionMu.Lock()
	if err := a.mutationAdmissionError(); err != nil {
		a.admissionMu.Unlock()
		return promptRequest{}, err
	}
	select {
	case <-a.done:
		a.admissionMu.Unlock()
		return promptRequest{}, errors.New("harness: agent is disposed")
	default:
	}
	if admissionCtx != nil {
		if err := admissionCtx.Err(); err != nil {
			a.admissionMu.Unlock()
			return promptRequest{}, err
		}
	}
	request.inboxEpoch = a.inboxEpoch
	a.mu.Lock()
	interrupt := a.inboxInterrupt
	a.mu.Unlock()
	mutation, err := a.durableInbox.Splice(
		InboxNextTurn, len(a.durableInbox.Pending(InboxNextTurn)), 0, []Message{request.message},
	)
	if err != nil {
		a.admissionMu.Unlock()
		return promptRequest{}, err
	}
	request.message = mutation.Inserted[0]
	a.pendingRequests[request.message.ID] = request
	a.publishInboxInserted(request.message, InboxNextTurn, request.userAuthored)
	a.mu.Lock()
	// Existing Host Prompt/Followup are waking admissions too. A synchronous
	// splice or inbox observer can interrupt this exact admission, so only
	// clear a park that predates it.
	if a.inboxInterrupt == interrupt {
		a.inboxParked = false
	}
	reservedTurn := !a.inboxParked && a.status == AgentIdle && !a.maintenance
	if reservedTurn {
		a.status = AgentRunning
		a.idle = make(chan struct{})
	}
	a.pendingPrompts.Add(1)
	a.mu.Unlock()
	if reservedTurn {
		a.publishStatus(AgentRunning)
	}
	select {
	case a.inbox <- request:
		close(request.admitted)
		a.admissionMu.Unlock()
	case <-a.done:
		delete(a.pendingRequests, request.message.ID)
		mutation, _, _ := a.durableInbox.Remove(request.message.ID)
		if len(mutation.Removed) != 0 {
			a.publishInboxDiscarded(request.message, request.userAuthored)
		}
		a.pendingPrompts.Add(-1)
		if reservedTurn {
			a.setIdle()
		}
		a.admissionMu.Unlock()
		return promptRequest{}, errors.New("harness: agent is disposed")
	case <-admissionCtx.Done():
		delete(a.pendingRequests, request.message.ID)
		mutation, _, _ := a.durableInbox.Remove(request.message.ID)
		if len(mutation.Removed) != 0 {
			a.publishInboxDiscarded(request.message, request.userAuthored)
		}
		a.pendingPrompts.Add(-1)
		if reservedTurn {
			a.setIdle()
		}
		a.admissionMu.Unlock()
		return promptRequest{}, admissionCtx.Err()
	}
	return request, nil
}

func (a *Agent) Cancel(cause error) {
	a.mu.Lock()
	cancel := a.turnCancel
	a.mu.Unlock()
	if cancel != nil {
		if cause == nil {
			cause = context.Canceled
		}
		cancel(cause)
	}
}

// CancelDSH applies DeepSeek Harness cancellation semantics without changing
// Cancel's Host-facing promise that later accepted prompts survive an active
// turn cancellation. Unless keepInbox is set, pending durable, injected, and
// queued work is discarded before the active phase is aborted.
func (a *Agent) CancelDSH(ctx context.Context, cause error, keepInbox bool) error {
	if a == nil {
		return errors.New("harness: cannot cancel a nil agent")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if cause == nil {
		cause = context.Canceled
	}
	if keepInbox {
		return a.InterruptDSH(cause)
	}

	a.admissionMu.Lock()
	a.inboxClaimMu.Lock()
	a.inboxEpoch++
	mutations, err := a.durableInbox.Clear()
	a.inboxClaimMu.Unlock()
	queued := make([]promptRequest, 0, len(a.pendingRequests))
	authored := make(map[string]bool, len(a.pendingRequests))
	for id, request := range a.pendingRequests {
		request.owned.finalizing()
		queued = append(queued, request)
		authored[id] = request.userAuthored
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
	a.mu.Lock()
	cancel := a.turnCancel
	maintenance := a.maintenance
	remaining := a.pendingPrompts.Load()
	a.mu.Unlock()
	a.admissionMu.Unlock()

	for _, mutation := range mutations {
		for _, message := range mutation.Removed {
			a.publishInboxDiscarded(message, authored[message.ID])
		}
	}
	a.discardInjected()
	for _, request := range queued {
		request.result <- promptResult{err: cause}
	}
	if cancel != nil {
		cancel(cause)
	}
	if err == nil && a.session.DurabilityAttached() {
		err = a.session.Flush(ctx)
	}
	if remaining == 0 && !maintenance && cancel == nil {
		a.setIdle()
	}
	for _, request := range queued {
		request.owned.recordCleanup(err)
		request.owned.settle(TurnOutcome{Err: cause})
	}
	return err
}
