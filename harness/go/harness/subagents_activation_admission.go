// Adapted from subagents_activation.go: declarations split by responsibility without behavior changes.
package harness

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// SendMessage admits a model-authored message only along one exact live
// direct-parent edge. The Host constructs attribution and steers the active
// turn; an idle direct child wakes without changing that authorization boundary.
func (r *SubagentRegistry) SendMessage(ctx context.Context, sender *Agent, targetID SessionID, content []ContentBlock) (string, error) {
	return r.sendMessage(ctx, sender, targetID, content, subagentMessageAdjacent)
}

// SendMessageDSH permits live managed members of the same tree to exchange
// messages. Cold delivery still uses the existing direct-parent resume path.
func (r *SubagentRegistry) SendMessageDSH(ctx context.Context, sender *Agent, targetID SessionID, content []ContentBlock) (string, error) {
	return r.sendMessage(ctx, sender, targetID, content, subagentMessageDSH)
}

type subagentMessageMode uint8

const (
	subagentMessageAdjacent subagentMessageMode = iota
	subagentMessageDSH
	// Native DSH control can find a cold target through its live creator.
	subagentMessageNativeDSH
)

func (r *SubagentRegistry) sendMessage(ctx context.Context, sender *Agent, targetID SessionID, content []ContentBlock, mode subagentMessageMode) (string, error) {
	dsh := mode != subagentMessageAdjacent
	if r == nil || !r.beginSubagentCallback() {
		return "", errors.New("harness: subagent registry is disposed")
	}
	defer r.endSubagentCallback()
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	// Explicitly shadow an inherited receipt, including nested ordinary calls
	// made by a provider using this context. This changes diagnostics only.
	var invocation *dshSubagentSendInvocation
	if dsh {
		preparation, _ := ctx.Value(subagentPreparationContextKey{}).(*subagentPreparation)
		invocation = &dshSubagentSendInvocation{registry: r, sender: sender, target: targetID, preparation: preparation}
	}
	ctx = context.WithValue(ctx, dshSubagentSendContextKey{}, invocation)
	if sender == nil || (!dsh && targetID == "") || len(content) == 0 {
		return "", errors.New("harness: adjacent-agent message requires sender, target, and content")
	}
	if err := r.requireLiveParent(sender); err != nil {
		// This exact origin's UNAUTHORIZED result means the sender is stale.
		// Draining and other admission failures keep their original contract.
		if known, ok := err.(*subagentActivationError); ok && known.code == "UNAUTHORIZED" {
			err = r.ClassifyDSHSendFailure(ctx, sender, targetID, SubagentSendSenderNotLive, err)
		}
		return "", err
	}
	if dsh && targetID == "" {
		return "", r.ClassifyDSHSendFailure(ctx, sender, targetID, SubagentSendTargetUnavailable, errors.New("harness: adjacent-agent message requires sender, target, and content"))
	}
	messageID, err := newMessageID()
	if err != nil {
		return "", err
	}
	source, _ := json.Marshal(map[string]any{"kind": "agent-message", "form": "relay", "senderSessionId": sender.ID()})
	message := Message{ID: messageID, Role: RoleUser, Source: source, Content: append([]ContentBlock{{Type: BlockText, Text: fmt.Sprintf("Agent %s sent a message: ", sender.ID())}}, cloneContentBlocks(content)...)}
	if dsh {
		if target, live := r.agents.Get(targetID); live {
			if err := r.sendToLiveTreeMember(ctx, sender, target, message); err != nil {
				return "", err
			}
			return messageID, nil
		}
	}
	r.mu.RLock()
	senderRecord := r.records[sender.ID()]
	r.mu.RUnlock()
	if sender.Session().Header().ParentSession == targetID {
		r.mu.RLock()
		allowed := senderRecord != nil && r.records[sender.ID()] == senderRecord && senderRecord.child == sender && senderRecord.snapshot.Continuable && senderRecord.activation != nil && senderRecord.parent != nil && senderRecord.parent.ID() == targetID && r.parentAdmitsLocked(senderRecord.parent) && r.activationAcceptsInput(senderRecord)
		if facade, _ := ctx.Value(subagentFacadeContextKey{}).(*SubagentFacade); facade != nil && subagentRecordFacade(senderRecord) != facade {
			allowed = false
		}
		var parent *Agent
		if allowed {
			parent = senderRecord.parent
		}
		parentRecord := r.records[targetID]
		r.mu.RUnlock()
		if !allowed {
			return "", &subagentActivationError{"harness: adjacent-agent parent delivery is unauthorized", "UNAUTHORIZED"}
		}
		if parentRecord != nil && parentRecord.child == parent && parentRecord.snapshot.Continuable {
			if err := r.steerActivationMessage(ctx, parentRecord, sender, senderRecord, message); err != nil {
				return "", err
			}
		} else if err := r.deliverSubagentMessage(parent, message, true); err != nil {
			return "", err
		}
		return messageID, nil
	}
	creator := sender
	if mode == subagentMessageNativeDSH {
		var err error
		creator, err = r.resolveColdDSHCreator(ctx, sender, targetID)
		if err != nil {
			return "", err
		}
	}
	preparationCtx, releasePreparation, err := r.reserveSubagentPreparation(ctx, creator)
	if err != nil {
		return "", err
	}
	defer releasePreparation()
	if invocation != nil {
		preparation, _ := preparationCtx.Value(subagentPreparationContextKey{}).(*subagentPreparation)
		preparationCtx = context.WithValue(preparationCtx, dshSubagentSendContextKey{}, &dshSubagentSendInvocation{registry: r, sender: sender, target: targetID, preparation: preparation})
	}
	record, created, err := r.continuableRecordMode(preparationCtx, creator, targetID, true)
	if err != nil {
		return "", err
	}
	if created {
		defer record.activation.finishInitial()
	}
	if mode == subagentMessageNativeDSH {
		if err := r.sendToLiveTreeMember(ctx, sender, record.child, message); err != nil {
			if created {
				// Do not clean up an activation another admitted send already owns.
				r.mu.Lock()
				unused := !record.activation.started.Load()
				if unused {
					record.activation.closing.Store(true)
				}
				r.mu.Unlock()
				if unused {
					r.beginActivationCleanup(record)
				}
			}
			return "", err
		}
		return messageID, nil
	}
	if err := r.steerActivationMessage(ctx, record, sender, nil, message); err != nil {
		return "", err
	}
	return messageID, nil
}

// Only native DSH control opts into cross-level reconstruction. Catalog facts
// identify the creation edge; they never give the sender the creator's authority.
func (r *SubagentRegistry) resolveColdDSHCreator(ctx context.Context, sender *Agent, target SessionID) (*Agent, error) {
	root, err := r.LiveTreeRoot(sender)
	if err != nil {
		return nil, err
	}
	r.mu.RLock()
	source := r.records[sender.ID()]
	managed := sender == root || source != nil && source.snapshot.Continuable && source.activation != nil && source.activation.bindingReady.Load()
	r.mu.RUnlock()
	if !managed {
		return sender, nil // Keep the direct-parent path's original capability checks.
	}
	read, query, release, err := r.beginCatalogRead(ctx, sender)
	if err != nil {
		return nil, err
	}
	defer release()
	rows, err := listSubagentDescendants(read, query, root.ID())
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		if row.ID != target || row.Kind != "child" || row.Mode != "continuable" {
			continue
		}
		if row.ParentID == sender.ID() {
			return sender, nil
		}
		if creator, found := r.agents.Get(row.ParentID); found {
			creatorRoot, err := r.LiveTreeRoot(creator)
			if err == nil && creatorRoot == root {
				return creator, nil
			}
		}
		return nil, &subagentActivationError{"cold target's creator is not live in this agent tree", "NOT_RESUMABLE"}
	}
	return sender, nil // Preserve direct-parent behavior and provider diagnostics.
}

// Admission reserves the exact destination without holding a lock across
// observers, including simultaneous messages in opposite directions.
func (r *SubagentRegistry) steerActivationMessage(ctx context.Context, record *subagentRecord, sender *Agent, sourceRecord *subagentRecord, message Message) error {
	return r.admitActivationMessage(ctx, record, sender, sourceRecord, message, "steer")
}

func (r *SubagentRegistry) admitActivationMessage(ctx context.Context, record *subagentRecord, sender *Agent, sourceRecord *subagentRecord, message Message, delivery string) error {
	return r.admitActivationMessageMode(ctx, record, sender, sourceRecord, message, delivery, nil)
}

func (r *SubagentRegistry) admitActivationMessageMode(ctx context.Context, record *subagentRecord, sender *Agent, sourceRecord *subagentRecord, message Message, delivery string, tree *subagentTreeDelivery) error {
	r.mu.Lock()
	allowed := !r.disposed && r.records[record.snapshot.ID] == record && record.child != nil && r.parentAdmitsLocked(sender) && r.activationAcceptsInput(record)
	if tree != nil {
		allowed = allowed && tree.currentLocked()
	} else if sourceRecord == nil {
		allowed = allowed && record.parent == sender
	} else {
		allowed = allowed && r.records[sender.ID()] == sourceRecord && sourceRecord.child == sender && sourceRecord.parent == record.child && sourceRecord.snapshot.Continuable && r.activationAcceptsInput(sourceRecord)
	}
	if facade, _ := ctx.Value(subagentFacadeContextKey{}).(*SubagentFacade); facade != nil && subagentRecordFacade(record) != facade {
		allowed = false
	}
	if !allowed {
		closing := record.activation != nil && record.activation.closing.Load()
		r.mu.Unlock()
		if closing {
			return &subagentActivationError{"harness: activation is closing", "ACTIVATION_CLOSING"}
		}
		return &subagentActivationError{"harness: adjacent-agent delivery is unauthorized", "UNAUTHORIZED"}
	}
	if record.activation == nil {
		r.mu.Unlock()
		return ErrSubagentActivationModeUnsupported
	}
	state := record.activation
	if !state.bindingReady.Load() {
		r.mu.Unlock()
		return ErrSubagentActivationNotReady
	}
	if gate := record.structuredAdmission; gate != nil && gate.captures != 0 {
		r.mu.Unlock()
		return ErrSubagentInputClosed
	}
	first := !state.started.Load() && !state.initialStart
	if first && state.runID == "" {
		r.nextID++
		record.runID = fmt.Sprintf("subagent-run-%d", r.nextID)
		state.runID = record.runID
	}
	if first {
		state.started.Store(true)
	}
	state.inputs++
	state.busy.Add(1)
	r.mu.Unlock()
	defer state.busy.Add(-1)
	pending := true // protected by registry.mu, including commit callbacks
	var turn <-chan TurnOutcome
	var epoch uint64
	var runID string
	// The Agent serializes durable commits. Finish the reservation and allocate
	// its epoch at that boundary, before synchronous observers can reenter.
	// An observer may withdraw this exact record without revoking acceptance.
	finishLocked := func(committed bool) {
		if !pending {
			return
		}
		pending = false
		state.inputs--
		defer r.signalActivationLocked(state)
		if !committed {
			return
		}
		state.announced.Store(true)
		if r.records[record.snapshot.ID] != record || !r.activationAcceptsInput(record) {
			return
		}
		record.epoch++
		epoch = record.epoch
		r.nextID++
		record.runID = fmt.Sprintf("subagent-run-%d", r.nextID)
		runID = record.runID
		record.snapshot.Status = SubagentRunning
		record.snapshot.FinishedAt = time.Time{}
	}
	defer func() {
		r.mu.Lock()
		finishLocked(false)
		r.mu.Unlock()
	}()
	if first {
		if err := r.emitSubagentStarted(ctx, SubagentLifecycle{RunID: state.runID, Provider: record.snapshot.Provider, ID: record.snapshot.ID, Parent: record.parent, Child: record.child, Local: true, Managed: true, Facade: state.facade}); err != nil {
			_ = r.disposeActivation(context.Background(), record)
			return err
		}
		if !r.activationCurrent(record) {
			return errors.New("harness: subagent retired before message admission")
		}
	}
	err := r.withSubagentCallback(func() error {
		var err error
		target := InboxNextStep
		if delivery == "queue" {
			target = InboxNextTurn
		}
		var store *SessionStore
		var admit func() (func(), error)
		if tree != nil {
			store, admit = r.agents.sessions, tree.guard
		}
		if gate := record.structuredAdmission; gate != nil {
			turn, err = gate.admitDSHMessageGuarded(ctx, message, target, func() { finishLocked(true) }, store, admit)
		} else {
			turn, err = record.child.admitDSHMessageGuarded(ctx, message, target, func() {
				r.mu.Lock()
				finishLocked(true)
				r.mu.Unlock()
			}, store, admit)
		}
		return err
	})
	if err != nil {
		if first {
			_ = r.disposeActivation(context.Background(), record)
		}
		return err
	}
	if epoch == 0 {
		return nil
	}
	if turn != nil {
		r.watchContinuation(record, epoch, runID, turn)
	} else {
		// Durable next-step steering has no separate turn channel. Watch the
		// exact Agent's idle phase and session suffix, including cold admission;
		// pending or parked durable input keeps this activation resident.
		r.settleActivationTurn(record, epoch, TurnOutcome{})
	}
	return nil
}

func (a *Agent) steerSubagentMessage(ctx context.Context, message Message) (<-chan TurnOutcome, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	message, err := validatePluginMessage(a, message)
	if err != nil {
		return nil, err
	}
	a.injectMu.Lock()
	if err := a.mutationAdmissionError(); err != nil {
		a.injectMu.Unlock()
		return nil, err
	}
	if a.acceptingInject {
		entry := injectedMessage{message: cloneMessage(message), admitted: make(chan struct{})}
		a.injected = append(a.injected, entry)
		a.injectMu.Unlock()
		a.publishInboxInserted(message, InboxNextStep, false)
		close(entry.admitted)
		return nil, nil
	}
	a.injectMu.Unlock()
	return a.FollowupResultContext(ctx, message)
}

func (r *SubagentRegistry) rollbackSubagentRecord(record *subagentRecord) error {
	if record.activation != nil {
		r.beginActivationCleanup(record)
		return ErrSubagentActivationDisposalPending
	}
	r.mu.Lock()
	if r.records[record.snapshot.ID] == record {
		delete(r.records, record.snapshot.ID)
	}
	r.mu.Unlock()
	return r.cleanupPreparedSubagent(record.disposal.callback())
}

// The receipt is local to this one delivery. Tree lookup alone does not
// authorize a transfer or let a replacement Agent inherit it.
type subagentTreeDelivery struct {
	registry             *SubagentRegistry
	sender, target, root *Agent
	record, source       *subagentRecord
	facade               *SubagentFacade
}

func (r *SubagentRegistry) sendToLiveTreeMember(ctx context.Context, sender, target *Agent, message Message) error {
	if sender == target {
		return &subagentActivationError{"cannot send an agent message to yourself", "UNAUTHORIZED"}
	}
	r.mu.RLock()
	root, err := r.liveTreeRootLocked(sender)
	if err != nil {
		r.mu.RUnlock()
		return r.ClassifyDSHSendFailure(ctx, sender, target.ID(), SubagentSendSenderNotLive, err)
	}
	facade, _ := ctx.Value(subagentFacadeContextKey{}).(*SubagentFacade)
	delivery := &subagentTreeDelivery{registry: r, sender: sender, target: target, root: root, record: r.records[target.ID()], source: r.records[sender.ID()], facade: facade}
	allowed := delivery.currentLocked()
	r.mu.RUnlock()
	if !allowed {
		return r.ClassifyDSHSendFailure(ctx, sender, target.ID(), SubagentSendWrongParent, &subagentActivationError{"target is not a continuable member of the sender's live tree", "UNAUTHORIZED"})
	}
	if delivery.record != nil {
		return r.admitActivationMessageMode(ctx, delivery.record, sender, nil, message, "steer", delivery)
	}
	return r.withSubagentCallback(func() error {
		_, err := target.admitDSHMessageGuarded(ctx, message, InboxNextStep, nil, r.agents.sessions, delivery.guard)
		return err
	})
}

func (d *subagentTreeDelivery) currentLocked() bool {
	r := d.registry
	sourceRoot, sourceErr := r.liveTreeRootLocked(d.sender)
	targetRoot, targetErr := r.liveTreeRootLocked(d.target)
	if sourceErr != nil || targetErr != nil || sourceRoot != d.root || targetRoot != d.root {
		return false
	}
	if r.records[d.target.ID()] != d.record || r.records[d.sender.ID()] != d.source {
		return false
	}
	if d.sender != d.root && (d.source == nil || !d.source.snapshot.Continuable || d.source.activation == nil || !d.source.activation.bindingReady.Load()) {
		return false
	}
	if d.facade != nil && (d.facade.closing || d.facade.registry != r ||
		d.source != nil && subagentRecordFacade(d.source) != d.facade ||
		d.record != nil && subagentRecordFacade(d.record) != d.facade) {
		return false
	}
	if d.target == d.root {
		return d.record == nil
	}
	return d.record != nil && d.record.child == d.target && d.record.snapshot.Continuable &&
		d.record.activation != nil && d.record.activation.bindingReady.Load() && !d.record.activation.closing.Load()
}

func (d *subagentTreeDelivery) guard() (func(), error) {
	r := d.registry
	r.mu.RLock()
	rejected := &subagentActivationError{"agent tree changed before message acceptance", "UNAUTHORIZED"}
	if !d.currentLocked() {
		r.mu.RUnlock()
		return nil, rejected
	}
	// AgentManager retirement marks exact Agents and removes them under its
	// own lock, before notifying the registry. Fence that transition too.
	manager := r.agents
	manager.mu.RLock()
	for _, endpoint := range []*Agent{d.root, d.sender, d.target} {
		if manager.closing || manager.agents[endpoint.ID()].agent != endpoint || endpoint.retired.Load() {
			manager.mu.RUnlock()
			r.mu.RUnlock()
			return nil, rejected
		}
	}
	return func() {
		manager.mu.RUnlock()
		r.mu.RUnlock()
	}, nil
}
