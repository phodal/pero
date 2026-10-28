package harness

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"sync"
	"time"
)

// Followup admits one FIFO turn from the exact live direct parent.
func (r *SubagentRegistry) Followup(ctx context.Context, parent *Agent, childID SessionID, content []ContentBlock) (string, error) {
	return r.FollowupMessage(ctx, parent, childID, Message{Role: RoleUser, Content: append([]ContentBlock(nil), content...)})
}

// FollowupMessage admits one source-identified FIFO turn and returns the exact
// message identity accepted by the child inbox.
func (r *SubagentRegistry) FollowupMessage(ctx context.Context, parent *Agent, childID SessionID, message Message) (string, error) {
	if r == nil || parent == nil || len(message.Content) == 0 {
		return "", errors.New("harness: subagent follow-up requires parent, child, and content")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if message.Role == "" {
		message.Role = RoleUser
	}
	if message.Role != RoleUser {
		return "", errors.New("harness: subagent follow-up must be a user message")
	}
	if message.ID == "" {
		messageID, err := newMessageID()
		if err != nil {
			return "", fmt.Errorf("harness: create subagent follow-up identity: %w", err)
		}
		message.ID = messageID
	}
	if !r.beginSubagentCallback() {
		return "", errors.New("harness: subagent registry is disposed")
	}
	defer r.endSubagentCallback()
	preparationCtx, releasePreparation, err := r.reserveSubagentPreparation(ctx, parent)
	if err != nil {
		return "", err
	}
	defer releasePreparation()
	record, err := r.continuableRecord(preparationCtx, parent, childID)
	if err != nil {
		return "", err
	}

	// Compatibility callers may address a resident managed child, but they must
	// share its reservation, structured capture gate and durable commit epoch.
	if record.activation != nil {
		if err := r.admitActivationMessage(ctx, record, parent, nil, message, "queue"); err != nil {
			return "", err
		}
		return message.ID, nil
	}

	// Keep Agent inbox admission and registry epoch allocation in the same
	// order when multiple callers target one child concurrently.
	record.admissionMu.Lock()
	defer record.admissionMu.Unlock()
	r.mu.RLock()
	if r.disposed {
		r.mu.RUnlock()
		return "", errors.New("harness: subagent registry is disposed")
	}
	if r.records[childID] != record || record.parent != parent || r.agents == nil || !r.activationAcceptsInput(record) {
		r.mu.RUnlock()
		return "", &subagentActivationError{fmt.Sprintf("harness: subagent %q does not belong to this parent", childID), "UNAUTHORIZED"}
	}
	if live, ok := r.agents.Get(parent.ID()); !ok || live != parent {
		r.mu.RUnlock()
		return "", errors.New("harness: subagent follow-up requires the exact live parent")
	}
	submit := record.submit
	r.mu.RUnlock()
	r.mu.Lock()
	nextEpoch := record.epoch + 1
	r.nextID++
	runID := fmt.Sprintf("subagent-run-%d", r.nextID)
	providerName := record.snapshot.Provider
	child := record.child
	r.mu.Unlock()
	started := SubagentLifecycle{
		RunID: runID, Provider: providerName, ID: childID,
		Parent: parent, Child: child, Local: child != nil,
	}
	if err := r.emitSubagentStarted(ctx, started); err != nil {
		return "", err
	}
	if !r.activationCurrent(record) {
		return "", errors.New("harness: subagent parent retired before follow-up")
	}
	turn, err := submit(ctx, cloneMessage(message))
	if err != nil {
		_ = r.emitSubagentEnded(context.Background(), SubagentLifecycle{
			RunID: runID, Provider: providerName, ID: childID,
			Parent: parent, Child: child, Local: child != nil, StopReason: SubagentFailed,
		})
		return "", err
	}
	r.mu.Lock()
	if r.records[childID] != record {
		r.mu.Unlock()
		_ = r.emitSubagentEnded(context.Background(), SubagentLifecycle{
			RunID: runID, Provider: providerName, ID: childID,
			Parent: parent, Child: child, Local: child != nil, StopReason: SubagentFailed,
		})
		return "", errors.New("harness: continuable subagent changed during follow-up admission")
	}
	record.epoch = nextEpoch
	record.runID = runID
	epoch := nextEpoch
	record.snapshot.Status = SubagentRunning
	record.snapshot.FinishedAt = time.Time{}
	r.mu.Unlock()
	r.watchContinuation(record, epoch, runID, turn)
	return message.ID, nil
}

func (r *SubagentRegistry) continuableRecord(ctx context.Context, parent *Agent, childID SessionID) (*subagentRecord, error) {
	record, _, err := r.continuableRecordMode(ctx, parent, childID, false)
	return record, err
}

func (r *SubagentRegistry) continuableRecordMode(ctx context.Context, parent *Agent, childID SessionID, managed bool) (*subagentRecord, bool, error) {
	if err := r.requireLiveParent(parent); err != nil {
		return nil, false, err
	}
	r.mu.RLock()
	record := r.records[childID]
	r.mu.RUnlock()
	if record != nil {
		if record.parent != parent {
			return nil, false, r.ClassifyDSHSendFailure(ctx, parent, childID, SubagentSendWrongParent, &subagentActivationError{fmt.Sprintf("harness: subagent %q does not belong to this parent", childID), "UNAUTHORIZED"})
		}
		if !record.snapshot.Continuable || record.submit == nil {
			return nil, false, &subagentActivationError{fmt.Sprintf("harness: subagent %q is not continuable", childID), "NOT_RESUMABLE"}
		}
		if !r.activationAcceptsInput(record) {
			return nil, false, &subagentActivationError{"harness: subagent activation is closing", "ACTIVATION_CLOSING"}
		}
		if managed && record.activation == nil {
			return nil, false, ErrSubagentActivationModeUnsupported
		}
		if record.activation != nil && !record.activation.bindingReady.Load() {
			return nil, false, ErrSubagentActivationNotReady
		}
		if facade, _ := ctx.Value(subagentFacadeContextKey{}).(*SubagentFacade); facade != nil && subagentRecordFacade(record) != facade {
			return nil, false, &subagentActivationError{"harness: activation belongs to another subagent facade", "UNAUTHORIZED"}
		}
		return record, false, nil
	}

	r.resumeMu.Lock()
	defer r.resumeMu.Unlock()
	r.mu.RLock()
	record = r.records[childID]
	entries := append([]subagentProviderEntry(nil), r.providers...)
	disposed := r.disposed
	r.mu.RUnlock()
	if disposed {
		return nil, false, errors.New("harness: subagent registry is disposed")
	}
	if record != nil {
		if record.parent != parent {
			return nil, false, r.ClassifyDSHSendFailure(ctx, parent, childID, SubagentSendWrongParent, &subagentActivationError{fmt.Sprintf("harness: subagent %q does not belong to this parent", childID), "UNAUTHORIZED"})
		}
		if !record.snapshot.Continuable || record.submit == nil {
			return nil, false, &subagentActivationError{fmt.Sprintf("harness: subagent %q is not continuable", childID), "NOT_RESUMABLE"}
		}
		if !r.activationAcceptsInput(record) {
			return nil, false, &subagentActivationError{"harness: subagent activation is closing", "ACTIVATION_CLOSING"}
		}
		if managed && record.activation == nil {
			return nil, false, ErrSubagentActivationModeUnsupported
		}
		if record.activation != nil && !record.activation.bindingReady.Load() {
			return nil, false, ErrSubagentActivationNotReady
		}
		if facade, _ := ctx.Value(subagentFacadeContextKey{}).(*SubagentFacade); facade != nil && subagentRecordFacade(record) != facade {
			return nil, false, &subagentActivationError{"harness: activation belongs to another subagent facade", "UNAUTHORIZED"}
		}
		return record, false, nil
	}
	if err := r.requireLiveParent(parent); err != nil {
		return nil, false, err
	}
	var unavailable error
	unavailableKind := SubagentSendFailureUnknown
	unavailableClassified := true
	retainUnavailable := func(err error) {
		kind, classified := DSHSubagentSendFailure(err)
		if !classified || (unavailable != nil && kind != unavailableKind) {
			unavailableClassified = false
		}
		unavailableKind = kind
		unavailable = errors.Join(unavailable, err)
	}
	for index := len(entries) - 1; index >= 0; index-- {
		entry := entries[index]
		if !entry.scope.Contains(parent.Scope()) {
			continue
		}
		resumer, ok := entry.provider.(SubagentContinuationResumer)
		if !ok {
			continue
		}
		prepare := resumer.PrepareResume
		if managed {
			current, ok := entry.provider.(SubagentManagedResumer)
			if !ok {
				retainUnavailable(ErrSubagentActivationModeUnsupported)
				continue
			}
			prepare = current.PrepareManagedResume
		}
		if err := r.protectSubagentPreparation(ctx, parent); err != nil {
			return nil, false, err
		}
		if managed {
			if _, err := r.reserveActivationCapacity(ctx, parent); err != nil {
				return nil, false, err
			}
		}
		prepared, snapshot, resumeErr := prepare(ctx, parent, childID)
		if errors.Is(resumeErr, ErrSubagentResumeUnavailable) {
			retainUnavailable(resumeErr)
			continue
		}
		if resumeErr != nil {
			return nil, false, resumeErr
		}
		disposal := newSubagentDisposalClaim(prepared.Dispose)
		prepared.Dispose = disposal.callback()
		disposal.bindAgent(r.agents, prepared.Child)
		r.retainPreparedSubagentDisposal(ctx, disposal, prepared.Child)
		if prepared.ChildID != childID || prepared.Child == nil || prepared.Submit == nil || prepared.Dispose == nil {
			if prepared.Dispose != nil {
				r.cleanupPreparedSubagent(prepared.Dispose)
			}
			return nil, false, errors.New("harness: subagent provider returned an incomplete resumed child")
		}
		snapshot.ID = childID
		snapshot.Parent = parent.ID()
		snapshot.Provider = entry.provider.Name()
		snapshot.Continuable = true
		if snapshot.Status == "" {
			snapshot.Status = SubagentCompleted
		}
		record = &subagentRecord{
			snapshot: snapshot, parent: parent, child: prepared.Child, submit: prepared.Submit, dispose: prepared.Dispose, disposal: disposal,
			suppressParentSettlement: snapshot.SuppressParentSettlement,
		}
		if managed {
			record.activation = newSubagentActivation("parent")
			record.suppressParentSettlement = true
		}
		r.mu.Lock()
		liveChild, childExists := r.agents.Get(childID)
		if r.disposed || !r.preparationAdmitsLocked(ctx, parent) || !childExists || liveChild != prepared.Child || prepared.Child.Parent() != parent {
			r.mu.Unlock()
			r.cleanupPreparedSubagent(prepared.Dispose)
			return nil, false, errors.New("harness: subagent parent or child retired during resume")
		}
		if existing := r.records[childID]; existing != nil {
			r.mu.Unlock()
			r.cleanupPreparedSubagent(prepared.Dispose)
			if existing.parent != parent {
				return nil, false, r.ClassifyDSHSendFailure(ctx, parent, childID, SubagentSendWrongParent, &subagentActivationError{fmt.Sprintf("harness: subagent %q does not belong to this parent", childID), "UNAUTHORIZED"})
			}
			return existing, false, nil
		}
		r.records[childID] = record
		r.mu.Unlock()
		if err := r.bindActivationRecord(ctx, record); err != nil {
			r.mu.Lock()
			if r.records[record.snapshot.ID] == record {
				delete(r.records, record.snapshot.ID)
			}
			r.mu.Unlock()
			r.rollbackSubagentRecord(record)
			if record.activation != nil {
				record.activation.finishInitial()
			}
			return nil, false, err
		}
		return record, true, nil
	}
	if unavailable != nil {
		err := fmt.Errorf("harness: subagent %q is not continuable: %w", childID, unavailable)
		if unavailableClassified {
			return nil, false, r.ClassifyDSHSendFailure(ctx, parent, childID, unavailableKind, err)
		}
		return nil, false, err
	}
	return nil, false, &subagentActivationError{fmt.Sprintf("harness: subagent %q is not continuable", childID), "NOT_RESUMABLE"}
}

// Interrupt issues cancellation under exact live ancestor authority. It retains
// local pending inbox work and does not stop the target's own descendants.
func (r *SubagentRegistry) Interrupt(caller *Agent, target SessionID) error {
	return r.interruptActivation(caller, "", target, "", nil)
}

// InterruptDSH preserves the source empty-address no-op only for an exact live
// caller. Ordinary Interrupt retains its target requirement. Nonempty addresses
// keep the same lineage, activation-generation and cancellation path.
func (r *SubagentRegistry) InterruptDSH(caller *Agent, target SessionID) error {
	if target != "" {
		return r.Interrupt(caller, target)
	}
	if r == nil {
		return &subagentActivationError{"harness: subagent interrupt requires an authority and target", "UNAUTHORIZED"}
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if r.disposed || !r.liveParentLocked(caller) {
		return &subagentActivationError{"harness: interrupt requires an exact live ancestor other than the target", "UNAUTHORIZED"}
	}
	return nil
}

// InterruptByParentID is the browser's durable direct-parent authority; it does
// not require a resident parent or consult a catalog/history for authorization.
func (r *SubagentRegistry) InterruptByParentID(parentID, target SessionID) error {
	return r.interruptActivation(nil, parentID, target, "", nil)
}

// InterruptActivation pins cross-process control to the observed activation so
// a delayed wire command cannot cancel a replacement reusing the same Session.
func (r *SubagentRegistry) InterruptActivation(caller *Agent, target SessionID, runID string) error {
	return r.interruptActivation(caller, "", target, runID, nil)
}
func (r *SubagentRegistry) InterruptActivationByParentID(parentID, target SessionID, runID string) error {
	return r.interruptActivation(nil, parentID, target, runID, nil)
}

func (r *SubagentRegistry) interruptActivation(caller *Agent, parentID, target SessionID, runID string, facade *SubagentFacade) error {
	if r == nil || target == "" || (caller == nil && parentID == "") {
		return &subagentActivationError{"harness: subagent interrupt requires an authority and target", "UNAUTHORIZED"}
	}
	r.mu.RLock()
	if caller != nil {
		if !r.liveParentLocked(caller) || caller.ID() == target {
			r.mu.RUnlock()
			return &subagentActivationError{"harness: interrupt requires an exact live ancestor other than the target", "UNAUTHORIZED"}
		}
	}
	record := r.records[target]
	if record == nil || (facade != nil && subagentRecordFacade(record) != facade) || (record.activation == nil && !record.snapshot.Continuable) {
		r.mu.RUnlock()
		return nil
	}
	if runID != "" && (record.activation == nil || record.activation.runID != runID) {
		r.mu.RUnlock()
		return nil
	}
	authorized := record.parent != nil && record.parent.ID() == parentID
	if caller != nil {
		authorized = subagentWithin(record.parent, map[*Agent]struct{}{caller: {}})
	}
	if !authorized {
		r.mu.RUnlock()
		return &subagentActivationError{"harness: subagent interrupt target belongs to another ancestor or parent", "UNAUTHORIZED"}
	}
	state, child, cancel := record.activation, record.child, record.run.Cancel
	if state != nil && state.closing.Load() {
		r.mu.RUnlock()
		return nil
	}
	r.mu.RUnlock()
	cause := errors.New("subagent interrupted by ancestor")
	if caller == nil {
		cause = errors.New("subagent interrupted by direct parent address")
	}
	if child != nil {
		return child.InterruptDSH(cause)
	}
	var err error
	if cancel != nil {
		err = r.withSubagentCallback(func() error { return callSubagentCleanup(func() error { cancel(cause); return nil }) })
	}
	if state != nil {
		r.beginActivationCleanup(record)
	}
	return err
}

// DrainContinuableChildren releases selected direct continuable children
// through their provider-owned lifecycle. It is used by orchestrators whose
// plugin teardown must not leave resident children or registry ghosts behind.
func (r *SubagentRegistry) DrainContinuableChildren(ctx context.Context, parent *Agent, children []SessionID) error {
	if r == nil || parent == nil {
		return errors.New("harness: drain continuable children requires a parent")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	var joined error
	for _, childID := range children {
		if err := ctx.Err(); err != nil {
			return errors.Join(joined, err)
		}
		r.mu.RLock()
		record := r.records[childID]
		r.mu.RUnlock()
		if record == nil {
			continue
		}
		record.admissionMu.Lock()
		r.mu.Lock()
		if r.records[childID] != record {
			r.mu.Unlock()
			record.admissionMu.Unlock()
			continue
		}
		if !record.snapshot.Continuable || record.parent != parent {
			r.mu.Unlock()
			record.admissionMu.Unlock()
			joined = errors.Join(joined, fmt.Errorf("harness: subagent %q is not a direct continuable child of %q", childID, parent.ID()))
			continue
		}
		delete(r.records, childID)
		dispose := record.dispose
		r.mu.Unlock()
		if dispose != nil {
			joined = errors.Join(joined, dispose(ctx))
		}
		record.admissionMu.Unlock()
	}
	return joined
}

// ReportFrom delivers selected content from the exact live continuable child
// to its direct parent without ending the child's turn.
func (r *SubagentRegistry) ReportFrom(ctx context.Context, child *Agent, content []ContentBlock, wake bool) (string, error) {
	if r == nil || child == nil || len(content) == 0 {
		return "", errors.New("harness: subagent report requires child and content")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	r.mu.Lock()
	record := r.records[child.ID()]
	if record == nil || !record.snapshot.Continuable || record.child != child || r.agents == nil {
		r.mu.Unlock()
		return "", errors.New("harness: reporter is not the exact live continuable child")
	}
	if live, ok := r.agents.Get(child.ID()); !ok || live != child {
		r.mu.Unlock()
		return "", errors.New("harness: reporter is not live")
	}
	parent := record.parent
	if live, ok := r.agents.Get(parent.ID()); !ok || live != parent {
		r.mu.Unlock()
		return "", errors.New("harness: direct parent is not live")
	}
	r.mu.Unlock()
	messageID, err := newMessageID()
	if err != nil {
		return "", fmt.Errorf("harness: create subagent report identity: %w", err)
	}
	source, err := json.Marshal(map[string]any{
		"kind": "subagent-report", "form": "relay", "senderSessionId": child.ID(),
	})
	if err != nil {
		return "", fmt.Errorf("harness: create subagent report source: %w", err)
	}
	framed := []ContentBlock{{Type: BlockText, Text: fmt.Sprintf("Background subagent %s reported:", child.ID())}}
	framed = append(framed, content...)
	if err := r.deliverSubagentMessage(parent, Message{ID: messageID, Role: RoleUser, Content: framed, Source: source}, wake); err != nil {
		return "", err
	}
	return messageID, nil
}

func (r *SubagentRegistry) watchContinuation(record *subagentRecord, epoch uint64, runID string, turn <-chan TurnOutcome) {
	go func() {
		var outcome TurnOutcome
		var ok bool
		select {
		case outcome, ok = <-turn:
		case <-record.disposal.done:
			return
		}
		if !ok {
			outcome = TurnOutcome{Err: errors.New("continuable child closed without a turn outcome")}
		}
		defer r.settleActivationTurn(record, epoch, outcome)
		defer r.releaseSubagentOwnership(record, epoch, false)
		status := SubagentCompleted
		reason := outcome.Turn.Reason
		if reason == FinishAborted {
			status = SubagentAborted
		} else if outcome.Err != nil {
			status = SubagentFailed
			reason = FinishError
		} else if reason != FinishStop {
			status = SubagentFailed
		}
		r.mu.Lock()
		if r.records[record.snapshot.ID] != record || record.epoch != epoch {
			r.mu.Unlock()
			return
		}
		record.snapshot.Status = status
		record.snapshot.FinishedAt = time.Now().UTC()
		parent := record.parent
		child := record.child
		suppress := record.suppressParentSettlement
		provider := record.snapshot.Provider
		r.mu.Unlock()
		if record.activation != nil {
			return
		}
		_ = r.emitSubagentEnded(context.Background(), SubagentLifecycle{
			RunID: runID, Provider: provider, ID: record.snapshot.ID,
			Parent: parent, Child: child, Local: child != nil, StopReason: status,
		})
		if parent == nil || child == nil || suppress {
			return
		}
		text := fmt.Sprintf("Background subagent %s finished with status %s.", child.ID(), status)
		content := []ContentBlock{{Type: BlockText, Text: text}}
		content = append(content, lastAssistantBlocks(child.Session())...)
		messageID, idErr := newMessageID()
		source, sourceErr := json.Marshal(map[string]any{
			"kind": "subagent-settled", "form": "notice", "summary": text, "senderSessionId": child.ID(),
		})
		if idErr == nil && sourceErr == nil {
			_ = r.deliverSubagentMessage(parent, Message{ID: messageID, Role: RoleUser, Content: content, Source: source}, true)
		}
	}()
}

// WatchParentActivation is the sole consumer of a one-shot run.Result. It
// disposes the run, then posts one parent settlement notice. Continuable runs
// already notify from watchContinuation and must not be watched here.
func (r *SubagentRegistry) WatchParentActivation(run SubagentRun) { r.watchParentActivation(run) }

func (r *SubagentRegistry) watchParentActivation(run SubagentRun) <-chan struct{} {
	done := make(chan struct{})
	if r == nil || run.Result == nil {
		close(done)
		return done
	}
	r.mu.RLock()
	record := r.records[run.ID]
	valid := record != nil && record.run.Result == run.Result
	var parent *Agent
	if valid {
		parent = record.parent
	}
	r.mu.RUnlock()
	if !valid {
		close(done)
		return done
	}
	go func() {
		defer close(done)
		result, ok := <-run.Result
		if !ok {
			result = SubagentResult{ChildID: run.ID, Status: SubagentFailed, Diagnostic: "child closed without a result"}
		}
		if result.ChildID == "" {
			result.ChildID = run.ID
		}
		diagnostic := result.Diagnostic
		if run.Dispose != nil {
			if disposeErr := run.Dispose(context.Background()); disposeErr != nil {
				if diagnostic != "" {
					diagnostic += "\n"
				}
				diagnostic += "dispose failed: " + disposeErr.Error()
			}
		}
		r.mu.RLock()
		current := r.records[run.ID] == record && record.parent == parent && r.parentAdmitsLocked(parent)
		r.mu.RUnlock()
		if !current {
			return
		}
		_ = r.withSubagentCallback(func() error {
			return DeliverParentNotice(parent, result.ChildID, result.Status, result.Output, result.Structured, diagnostic)
		})
	}()
	return done
}

// DeliverParentNotice posts one managed-subagent settlement into the parent.
// Status text matches continuable settlement so callers can wait on one phrase.
func DeliverParentNotice(parent *Agent, childID SessionID, status SubagentStatus, output []ContentBlock, structured any, diagnostic string) error {
	if parent == nil || childID == "" {
		return errors.New("harness: parent notice requires a parent and child")
	}
	if status == "" {
		status = SubagentFailed
	}
	text := fmt.Sprintf("Background subagent %s finished with status %s.", childID, status)
	content := []ContentBlock{{Type: BlockText, Text: text}}
	content = append(content, output...)
	if structured != nil {
		encoded, err := json.Marshal(structured)
		if err != nil {
			return fmt.Errorf("harness: encode subagent notice: %w", err)
		}
		content = append(content, ContentBlock{Type: BlockText, Text: string(encoded)})
	}
	if diagnostic != "" {
		content = append(content, ContentBlock{Type: BlockText, Text: diagnostic})
	}
	messageID, err := newMessageID()
	if err != nil {
		return fmt.Errorf("harness: create subagent notice identity: %w", err)
	}
	source, err := json.Marshal(map[string]any{
		"kind": "subagent-settled", "form": "notice", "summary": text, "senderSessionId": childID,
	})
	if err != nil {
		return fmt.Errorf("harness: create subagent notice source: %w", err)
	}
	return parent.Deliver(Message{ID: messageID, Role: RoleUser, Content: content, Source: source}, true)
}

func lastAssistantBlocks(session *Session) []ContentBlock {
	messages, err := session.DeriveMessages()
	if err != nil {
		return nil
	}
	for index := len(messages) - 1; index >= 0; index-- {
		if messages[index].Role == RoleAssistant && len(messages[index].Content) > 0 {
			return append([]ContentBlock(nil), messages[index].Content...)
		}
	}
	return nil
}

// Dispose withdraws registry authority before any provider callback. A call made
// while an admission/notification is active returns an explicit pending receipt;
// cleanup continues independently so that observer reentry cannot self-wait.
func (r *SubagentRegistry) Dispose(ctx context.Context) error {
	_, pending := r.requestDisposal()
	if pending {
		return ErrSubagentDisposalInProgress
	}
	return r.Drain(ctx)
}

// requestDisposal revokes input authority without ever joining callbacks.
func (r *SubagentRegistry) requestDisposal() (bool, bool) {
	if r == nil {
		return false, false
	}
	r.mu.Lock()
	if r.disposed {
		done := r.disposeDone
		r.mu.Unlock()
		if done == nil {
			return false, false
		}
		select {
		case <-done:
			return false, false
		default:
			return false, true
		}
	}
	r.disposed = true
	r.disposeDone = make(chan struct{})
	records := make([]*subagentRecord, 0, len(r.records))
	for _, record := range r.records {
		records = append(records, record)
	}
	r.records = make(map[SessionID]*subagentRecord)
	r.providers = nil
	r.watchers = nil
	r.mu.Unlock()
	// A provider may call us from its Agent.Deactivated observer with a fresh
	// context. Its exact in-flight receipt identifies that possible self-wait
	// without guessing the goroutine or requiring callback context propagation.
	pending := r.callbacks.Load() != 0 || r.activationReceipts.Load() != 0
	for _, record := range records {
		if record.disposal != nil && record.disposal.inProgress() {
			pending = true
		}
		if agentDisposalMaySelfWait(record.child) || agentDisposalMaySelfWait(record.parent) {
			pending = true
		}
	}
	go func() {
		sort.Slice(records, func(i, j int) bool { return records[i].snapshot.Depth > records[j].snapshot.Depth })
		var joined error
		for _, record := range records {
			if record.child != nil {
				record.child.Cancel(errors.New("subagent registry disposed"))
			}
			if !record.snapshot.Continuable && record.run.Cancel != nil {
				joined = errors.Join(joined, callSubagentCleanup(func() error { record.run.Cancel(errors.New("subagent registry disposed")); return nil }))
			}
			if record.disposal != nil {
				err := record.disposal.invoke(context.Background())
				if errors.Is(err, ErrSubagentDisposalInProgress) {
					err = record.disposal.wait(context.Background())
				}
				joined = errors.Join(joined, err)
			} else if record.dispose != nil {
				joined = errors.Join(joined, callSubagentCleanup(func() error { return record.dispose(context.Background()) }))
			} else if record.run.Dispose != nil {
				joined = errors.Join(joined, callSubagentCleanup(func() error { return record.run.Dispose(context.Background()) }))
			}
		}
		// Admission is sealed before this Wait. Already admitted preparations
		// own their late-return cleanup and no callback may Add from zero now.
		r.callbackWG.Wait()
		r.mu.Lock()
		r.disposeErr = errors.Join(joined, r.callbackCleanupErr)
		close(r.disposeDone)
		r.mu.Unlock()
	}()
	return true, pending
}

// Drain joins a previously requested disposal. Call it outside provider and
// Agent observers, after their synchronous callback has returned.
func (r *SubagentRegistry) Drain(ctx context.Context) error {
	if r == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	r.mu.RLock()
	done := r.disposeDone
	r.mu.RUnlock()
	if done == nil {
		return nil
	}
	select {
	case <-done:
	case <-ctx.Done():
		return ctx.Err()
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.disposeErr
}

// Every queued admission and active turn owns one of these Agent gates. A
// callback may reenter disposal using any context, so conservatively report
// pending while either gate is busy rather than trying to identify a goroutine.
// Successful probes are released immediately and never span external code.
func agentDisposalMaySelfWait(agent *Agent) bool {
	// Standing parent receipts are ownership, not an executing callback.
	if agent != nil && agent.subagentReceipts.Load() != 0 {
		return true
	}
	return agentCallbackMaySelfWait(agent)
}

func agentCallbackMaySelfWait(agent *Agent) bool {
	if agent == nil {
		return false
	}
	if agent.resourcePreparations.Load() != 0 || agent.operationCount.Load() != 0 {
		return true
	}
	if !agent.admissionMu.TryLock() {
		return true
	}
	agent.admissionMu.Unlock()
	if !agent.inboxClaimMu.TryLock() {
		return true
	}
	agent.inboxClaimMu.Unlock()
	if !agent.activityMu.TryLock() {
		return true
	}
	agent.activityMu.Unlock()
	return false
}

// retireAgent withdraws exact parent-owned records before invoking providers.
// Do not match record.child: normal child-result disposal enters this hook and
// must not recursively call its own provider's once-guarded Dispose.
func (r *SubagentRegistry) retireAgent(ctx context.Context, parent *Agent) error {
	if r == nil || parent == nil {
		return nil
	}
	r.mu.Lock()
	delete(r.closedParents, parent)
	cancels := make([]context.CancelCauseFunc, 0, len(r.parentPreparations[parent]))
	for token := range r.parentPreparations[parent] {
		cancels = append(cancels, token.cancel)
	}
	records := make([]*subagentRecord, 0)
	for id, record := range r.records {
		if record.parent == parent {
			delete(r.records, id)
			records = append(records, record)
		}
	}
	r.mu.Unlock()
	for _, cancel := range cancels {
		cancel(errors.New("harness: subagent parent retired during preparation"))
	}
	sort.Slice(records, func(i, j int) bool { return records[i].snapshot.ID < records[j].snapshot.ID })
	var joined error
	for _, record := range records {
		// No admissionMu here: a Started callback may retire its own parent while
		// a continuation admission owns that mutex. Removing the exact record plus
		// manager retirement fences the continuation's later admission boundary.
		if record.child != nil {
			record.child.Cancel(errors.New("subagent parent retired"))
		}
		if record.snapshot.Continuable {
			if record.dispose != nil {
				joined = errors.Join(joined, callSubagentCleanup(func() error { return record.dispose(ctx) }))
			}
		} else {
			if record.run.Cancel != nil {
				joined = errors.Join(joined, callSubagentCleanup(func() error { record.run.Cancel(errors.New("subagent parent retired")); return nil }))
			}
			if record.run.Dispose != nil {
				joined = errors.Join(joined, callSubagentCleanup(func() error { return record.run.Dispose(ctx) }))
			}
		}
	}
	return joined
}

func (r *SubagentRegistry) liveParentLocked(parent *Agent) bool {
	if parent == nil || parent.retired.Load() || r.agents == nil {
		return false
	}
	current, live := r.agents.Get(parent.ID())
	return live && current == parent
}
func (r *SubagentRegistry) requireLiveParent(parent *Agent) error {
	r.mu.RLock()
	live := r.liveParentLocked(parent)
	admitting := !r.disposed && r.parentAdmitsLocked(parent)
	r.mu.RUnlock()
	if !live {
		return &subagentActivationError{"harness: subagent admission requires the exact live parent", "UNAUTHORIZED"}
	}
	if !admitting {
		return ErrSubagentAdmissionClosed
	}
	return nil
}
func (r *SubagentRegistry) activationCurrent(record *subagentRecord) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return !r.disposed && r.records[record.snapshot.ID] == record && r.parentAdmitsLocked(record.parent) && r.activationAcceptsInput(record)
}

func callSubagentCleanup(callback func() error) (err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("harness: subagent cleanup panicked: %v", recovered)
		}
	}()
	return callback()
}

// ErrSubagentDisposalInProgress is an explicit incomplete receipt. A provider's
// Dispose may synchronously retire another Agent whose observers reenter this
// exact disposer, even using a new background context. Waiting would deadlock.
var ErrSubagentDisposalInProgress = errors.New("harness: subagent disposal is in progress")

// guardSubagentDisposal keeps the provider callback outside every lock. The
// first caller performs cleanup; concurrent/reentrant callers receive pending,
// and calls after completion receive the original cleanup result.
type subagentDisposalClaim struct {
	mu           sync.Mutex
	started      bool
	done         chan struct{}
	result       error
	dispose      func(context.Context) error
	scopeWait    func(context.Context) error
	scopePending func() bool
}

func newSubagentDisposalClaim(dispose func(context.Context) error) *subagentDisposalClaim {
	if dispose == nil {
		return nil
	}
	return &subagentDisposalClaim{done: make(chan struct{}), dispose: dispose}
}
func (s *subagentDisposalClaim) callback() func(context.Context) error {
	if s == nil {
		return nil
	}
	return s.invoke
}
func guardSubagentDisposal(dispose func(context.Context) error) func(context.Context) error {
	return newSubagentDisposalClaim(dispose).callback()
}

type subagentDisposalPending struct{ claim *subagentDisposalClaim }

func (e *subagentDisposalPending) Error() string { return ErrSubagentDisposalInProgress.Error() }
func (e *subagentDisposalPending) Unwrap() error { return ErrSubagentDisposalInProgress }

func (s *subagentDisposalClaim) bindAgent(manager *AgentManager, agent *Agent) {
	if s == nil || manager == nil || agent == nil {
		return
	}
	s.mu.Lock()
	s.scopeWait = func(ctx context.Context) error { return manager.waitAgentScope(ctx, agent) }
	s.scopePending = func() bool { return manager.agentScopePending(agent) }
	s.mu.Unlock()
}

func (s *subagentDisposalClaim) complete(err error) {
	s.mu.Lock()
	s.result = err
	close(s.done)
	s.mu.Unlock()
}

func (s *subagentDisposalClaim) invoke(ctx context.Context) error {
	s.mu.Lock()
	if s.started {
		select {
		case <-s.done:
			err := s.result
			s.mu.Unlock()
			return err
		default:
			s.mu.Unlock()
			return &subagentDisposalPending{claim: s}
		}
	}
	s.started = true
	s.mu.Unlock()
	if ctx == nil {
		ctx = context.Background()
	}
	err := callSubagentCleanup(func() error { return s.dispose(ctx) })
	s.mu.Lock()
	scopeWait, scopePending := s.scopeWait, s.scopePending
	s.mu.Unlock()
	if scopeWait != nil && (errors.Is(err, ErrAgentDisposalInProgress) || scopePending != nil && scopePending()) {
		// The first Remove may be busy, or an ancestor may already have withdrawn
		// this child. A nil duplicate Remove is not a cleanup receipt. Settle only
		// after the exact worker/writer scope has actually stopped.
		go func() { s.complete(errors.Join(withoutRetirementPending(err), scopeWait(context.Background()))) }()
		return &subagentDisposalPending{claim: s}
	}
	s.complete(err)
	return err
}
func (s *subagentDisposalClaim) wait(ctx context.Context) error {
	select {
	case <-s.done:
	case <-ctx.Done():
		return ctx.Err()
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.result
}

func (s *subagentDisposalClaim) inProgress() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.started {
		return false
	}
	select {
	case <-s.done:
		return false
	default:
		return true
	}
}

func (r *SubagentRegistry) beginSubagentCallback() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.disposed {
		return false
	}
	r.callbacks.Add(1)
	r.callbackWG.Add(1)
	return true
}
func (r *SubagentRegistry) endSubagentCallback() {
	r.callbacks.Add(-1)
	r.callbackWG.Done()
}

// Called only while an admitted preparation owns callbackWG. Any asynchronous
// exact cleanup extends that existing receipt before its admission is released.
func (r *SubagentRegistry) cleanupPreparedSubagent(dispose func(context.Context) error) error {
	if dispose == nil {
		return nil
	}
	err := callSubagentCleanup(func() error { return dispose(context.Background()) })
	var pending *subagentDisposalPending
	if errors.As(err, &pending) {
		r.callbackWG.Add(1)
		go func() {
			defer r.callbackWG.Done()
			finalErr := pending.claim.wait(context.Background())
			r.mu.Lock()
			r.callbackCleanupErr = errors.Join(r.callbackCleanupErr, finalErr)
			r.mu.Unlock()
		}()
		return err
	}
	r.mu.Lock()
	r.callbackCleanupErr = errors.Join(r.callbackCleanupErr, err)
	r.mu.Unlock()
	return err
}

func (r *SubagentRegistry) withSubagentCallback(callback func() error) error {
	if !r.beginSubagentCallback() {
		return errors.New("harness: subagent registry is disposed")
	}
	defer r.endSubagentCallback()
	return callback()
}
func (r *SubagentRegistry) emitSubagentStarted(ctx context.Context, event SubagentLifecycle) error {
	return r.withSubagentCallback(func() error { return r.Started.Emit(ctx, event) })
}
func (r *SubagentRegistry) emitSubagentEnded(ctx context.Context, event SubagentLifecycle) error {
	return r.withSubagentCallback(func() error { return r.Ended.Emit(ctx, event) })
}
func (r *SubagentRegistry) deliverSubagentMessage(parent *Agent, message Message, wake bool) error {
	return r.withSubagentCallback(func() error { return parent.Deliver(message, wake) })
}
