package harness

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

func (r *SubagentRegistry) Start(ctx context.Context, providerName string, request SubagentRequest) (returned SubagentRun, returnedErr error) {
	if r == nil || request.Parent == nil || !request.hasStartPromptContent() {
		return SubagentRun{}, errors.New("harness: subagent start requires a parent and prompt")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := r.requireLiveParent(request.Parent); err != nil {
		return SubagentRun{}, err
	}
	if !r.beginSubagentCallback() {
		return SubagentRun{}, errors.New("harness: subagent registry is disposed")
	}
	defer r.endSubagentCallback()
	preparationCtx, releasePreparation, err := r.reserveSubagentPreparation(ctx, request.Parent)
	if err != nil {
		return SubagentRun{}, err
	}
	defer releasePreparation()
	ctx = preparationCtx
	if request.activation == nil {
		request.Label = normalizeSubagentLabel(request.Label, request.promptLabelText())
	}
	depth := r.Depth(request.Parent)
	if request.activation != nil || request.ProviderManagedDepth {
		childDepth, depthErr := r.resolveSubagentChildDepth(request)
		if depthErr != nil {
			return SubagentRun{}, depthErr
		}
		request.Depth = childDepth
	} else {
		if request.MaxDepth <= 0 {
			return SubagentRun{}, errors.New("harness: subagent max depth must be positive")
		}
		if depth >= request.MaxDepth {
			return SubagentRun{}, fmt.Errorf("harness: subagent depth %d reached maximum %d", depth, request.MaxDepth)
		}
		request.Depth = depth + 1
	}
	provider, err := r.resolveProvider(request.Parent.Scope(), providerName)
	if err != nil {
		return SubagentRun{}, err
	}
	capabilities := provider.Capabilities()
	if len(request.OutputSchema) != 0 {
		if err := ValidateObjectJSONSchema(request.OutputSchema); err != nil {
			return SubagentRun{}, fmt.Errorf("harness: invalid subagent output schema: %w", err)
		}
		if !capabilities.OutputSchema {
			return SubagentRun{}, &subagentActivationError{fmt.Sprintf("harness: subagent provider %q does not support structured output", provider.Name()), "UNSUPPORTED_CAPABILITY"}
		}
		request.OutputSchema = append(json.RawMessage(nil), request.OutputSchema...)
	}
	if (request.Provider != "" || request.Model != "" || request.MaxTokens > 0) && !capabilities.AgentOptions {
		return SubagentRun{}, &subagentActivationError{fmt.Sprintf("harness: subagent provider %q does not support agent options", provider.Name()), "UNSUPPORTED_CAPABILITY"}
	}
	if request.AgentPreset != "" && (!capabilities.AgentPreset || provider.InheritsParentContext()) {
		return SubagentRun{}, &subagentActivationError{fmt.Sprintf("harness: subagent provider %q does not support independent agent preset selection", provider.Name()), "UNSUPPORTED_CAPABILITY"}
	}
	if request.Persona != "" && !capabilities.Persona {
		return SubagentRun{}, &subagentActivationError{fmt.Sprintf("harness: subagent provider %q does not support persona", provider.Name()), "UNSUPPORTED_CAPABILITY"}
	}
	if request.ToolFilter != nil && !capabilities.ToolFilter {
		return SubagentRun{}, &subagentActivationError{fmt.Sprintf("harness: subagent provider %q does not support tool filtering", provider.Name()), "UNSUPPORTED_CAPABILITY"}
	}
	if err := r.protectSubagentPreparation(ctx, request.Parent); err != nil {
		return SubagentRun{}, err
	}
	if request.activation != nil {
		if _, err := r.reserveActivationCapacity(ctx, request.Parent); err != nil {
			return SubagentRun{}, err
		}
	}
	prepared, err := provider.Prepare(ctx, request)
	if err != nil {
		return SubagentRun{}, err
	}
	disposal := newSubagentDisposalClaim(prepared.Dispose)
	prepared.Dispose = disposal.callback()
	// Install the sole raw result receiver before any admission check or
	// observer can roll this preparation back. Dispose may synchronously send
	// its terminal value on an unbuffered channel, even after failed admission.
	providerResult := prepared.Result
	if disposal != nil {
		providerResult = retainPreparedSubagentResult(prepared.Result, disposal.done, prepared.ChildID)
	}
	r.mu.RLock()
	manager := r.agents
	r.mu.RUnlock()
	exactChild := prepared.Child
	disposal.bindAgent(manager, exactChild)
	r.retainPreparedSubagentDisposal(ctx, disposal, exactChild)
	waitFinal := func(ctx context.Context) error {
		if ctx == nil {
			ctx = context.Background()
		}
		err := disposal.wait(ctx)
		if exactChild != nil && manager != nil {
			err = errors.Join(err, manager.WaitRetired(ctx, exactChild))
		}
		return err
	}
	// Failed admission still returns its exact cleanup handle, never accepted
	// execution authority. Outer owners can retain policy until rollback drains.
	defer func() {
		if returnedErr != nil && disposal != nil {
			r.cleanupPreparedSubagent(prepared.Dispose)
			returned = SubagentRun{Dispose: prepared.Dispose, Wait: waitFinal}
		}
	}()

	if prepared.ChildID == "" || prepared.Result == nil || prepared.Cancel == nil || prepared.Dispose == nil || prepared.Begin == nil {
		return SubagentRun{}, errors.New("harness: subagent provider returned an incomplete prepared run")
	}
	result := make(chan SubagentResult, 1)
	public := SubagentRun{ID: prepared.ChildID, Result: result, Reports: prepared.Reports, Cancel: prepared.Cancel, Dispose: prepared.Dispose, Wait: waitFinal}
	// In-process one-shot providers publish their Agent during Prepare. Retain
	// it across the paired lifecycle edges so hook bridges can use the child's
	// workspace even after provider-specific registry changes.
	r.mu.RLock()
	agents := r.agents
	r.mu.RUnlock()
	child := prepared.Child
	disposal.bindAgent(agents, child)
	if err := ctx.Err(); err != nil {
		r.cleanupPreparedSubagent(prepared.Dispose)
		return SubagentRun{}, err
	}
	if child != nil && (child.ID() != prepared.ChildID || child.Parent() != request.Parent) {
		return SubagentRun{}, errors.New("harness: prepared child has a different exact owner")
	}
	r.mu.Lock()
	childCurrent := child == nil
	if child != nil && agents != nil {
		current, live := agents.Get(child.ID())
		childCurrent = live && current == child
	}
	if r.disposed || !r.preparationAdmitsLocked(ctx, request.Parent) || !childCurrent {
		r.mu.Unlock()
		return SubagentRun{}, errors.New("harness: subagent parent retired during preparation")
	}
	if _, exists := r.records[prepared.ChildID]; exists {
		r.mu.Unlock()
		return SubagentRun{}, fmt.Errorf("harness: duplicate subagent id %q", prepared.ChildID)
	}
	record := &subagentRecord{snapshot: SubagentSnapshot{
		ID: prepared.ChildID, Parent: request.Parent.ID(), Provider: provider.Name(), Status: SubagentRunning,
		Label: request.Label, Depth: depth + 1, StartedAt: time.Now().UTC(),
	}, run: public, parent: request.Parent, child: child, disposal: disposal, activation: request.activation}
	r.records[prepared.ChildID] = record
	r.nextID++
	record.runID = fmt.Sprintf("subagent-run-%d", r.nextID)
	r.mu.Unlock()
	if err := r.bindActivationRecord(ctx, record); err != nil {
		r.mu.Lock()
		if r.records[record.snapshot.ID] == record {
			delete(r.records, record.snapshot.ID)
		}
		r.mu.Unlock()
		r.rollbackSubagentRecord(record)
		return SubagentRun{}, err
	}
	started := SubagentLifecycle{
		RunID: record.runID, Provider: provider.Name(), ID: prepared.ChildID,
		Parent: request.Parent, Child: child, Local: child != nil, Managed: record.activation != nil, Facade: subagentRecordFacade(record),
	}
	if record.activation != nil {
		record.activation.started.Store(true)
	}
	if err := r.emitSubagentStarted(ctx, started); err != nil {
		r.mu.Lock()
		if r.records[prepared.ChildID] == record {
			delete(r.records, prepared.ChildID)
		}
		r.mu.Unlock()
		r.rollbackSubagentRecord(record)
		return SubagentRun{}, err
	}
	if !r.activationCurrent(record) {
		r.rollbackSubagentRecord(record)
		return SubagentRun{}, errors.New("harness: subagent parent retired before begin")
	}
	if err := establishSubagentCatalogChild(record); err != nil {
		return SubagentRun{}, errors.Join(err, r.rollbackSubagentRecord(record))
	}
	if !r.activationCurrent(record) {
		r.rollbackSubagentRecord(record)
		return SubagentRun{}, errors.New("harness: subagent parent retired during catalog commit")
	}
	go func() {
		defer r.releaseSubagentOwnership(record, 0, false)
		childResult, ok := <-providerResult
		if !ok {
			childResult = SubagentResult{ChildID: prepared.ChildID, Status: SubagentFailed, Reason: FinishError, Diagnostic: "provider closed without a result"}
		}
		if childResult.ChildID != "" && childResult.ChildID != prepared.ChildID {
			childResult = SubagentResult{ChildID: prepared.ChildID, Status: SubagentFailed, Reason: FinishError, Diagnostic: "provider returned a foreign child identity"}
		}
		childResult.ChildID = prepared.ChildID
		if childResult.Status == "" {
			childResult.Status = SubagentFailed
		}
		r.mu.Lock()
		record.snapshot.Status = childResult.Status
		record.snapshot.FinishedAt = time.Now().UTC()
		r.mu.Unlock()
		if record.activation == nil {
			_ = r.emitSubagentEnded(context.Background(), SubagentLifecycle{
				RunID: record.runID, Provider: provider.Name(), ID: prepared.ChildID,
				Parent: request.Parent, Child: child, Local: child != nil, Managed: record.activation != nil, Facade: subagentRecordFacade(record), StopReason: childResult.Status,
			})
		}
		result <- childResult
		close(result)
	}()
	if err := ctx.Err(); err != nil {
		r.rollbackSubagentRecord(record)
		return SubagentRun{}, err
	}
	prepared.Begin()
	if !r.activationCurrent(record) {
		r.rollbackSubagentRecord(record)
		return SubagentRun{}, errors.New("harness: subagent parent retired during begin")
	}
	return public, nil
}

// retainPreparedSubagentResult owns exactly one provider terminal publication.
// It keeps no registry/Agent graph and exits on either result or final cleanup.
func retainPreparedSubagentResult(source <-chan SubagentResult, disposed <-chan struct{}, id SessionID) <-chan SubagentResult {
	result := make(chan SubagentResult, 1)
	go func() {
		defer close(result)
		var value SubagentResult
		var open bool
		select {
		case value, open = <-source:
		case <-disposed:
			// A result produced inside Dispose wins over silent-provider fallback.
			select {
			case value, open = <-source:
			default:
				value, open = SubagentResult{ChildID: id, Status: SubagentAborted, Reason: FinishAborted}, true
			}
		}
		if open {
			result <- value
		}
	}()
	return result
}

// StartContinuable publishes a stable in-process child, then admits its first
// turn. The child remains available after settlement for FIFO follow-ups.
func (r *SubagentRegistry) StartContinuable(ctx context.Context, providerName string, request SubagentRequest) (SessionID, error) {
	if r == nil || request.Parent == nil || !request.hasStartPromptContent() {
		return "", errors.New("harness: continuable subagent start requires a parent and prompt")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := r.requireLiveParent(request.Parent); err != nil {
		return "", err
	}
	if request.initialMessageID == "" {
		messageID, err := newMessageID()
		if err != nil {
			return "", fmt.Errorf("harness: create continuable prompt identity: %w", err)
		}
		request.initialMessageID = messageID
	}
	if !r.beginSubagentCallback() {
		return "", errors.New("harness: subagent registry is disposed")
	}
	defer r.endSubagentCallback()
	preparationCtx, releasePreparation, err := r.reserveSubagentPreparation(ctx, request.Parent)
	if err != nil {
		return "", err
	}
	defer releasePreparation()
	ctx = preparationCtx
	if request.activation == nil {
		request.Label = normalizeSubagentLabel(request.Label, request.promptLabelText())
	}
	depth := r.Depth(request.Parent)
	if request.activation != nil || request.ProviderManagedDepth {
		childDepth, depthErr := r.resolveSubagentChildDepth(request)
		if depthErr != nil {
			return "", depthErr
		}
		request.Depth = childDepth
	} else {
		if request.MaxDepth <= 0 {
			return "", errors.New("harness: subagent max depth must be positive")
		}
		if depth >= request.MaxDepth {
			return "", fmt.Errorf("harness: subagent depth %d reached maximum %d", depth, request.MaxDepth)
		}
		request.Depth = depth + 1
	}
	provider, err := r.resolveProvider(request.Parent.Scope(), providerName)
	if err != nil {
		return "", err
	}
	continuable, ok := provider.(SubagentContinuationProvider)
	if !ok {
		return "", &subagentActivationError{fmt.Sprintf("harness: subagent provider %q does not support continuable children", provider.Name()), "UNSUPPORTED_CAPABILITY"}
	}
	capabilities := provider.Capabilities()
	if len(request.OutputSchema) != 0 {
		if request.activation == nil {
			return "", errors.New("harness: continuable subagents do not support one-turn structured output")
		}
		if err := ValidateObjectJSONSchema(request.OutputSchema); err != nil {
			return "", fmt.Errorf("harness: invalid subagent output schema: %w", err)
		}
		if !capabilities.OutputSchema {
			return "", &subagentActivationError{fmt.Sprintf("harness: subagent provider %q does not support structured output", provider.Name()), "UNSUPPORTED_CAPABILITY"}
		}
		request.OutputSchema = append(json.RawMessage(nil), request.OutputSchema...)
	}
	if (request.Provider != "" || request.Model != "" || request.MaxTokens > 0) && !capabilities.AgentOptions {
		return "", &subagentActivationError{fmt.Sprintf("harness: subagent provider %q does not support agent options", provider.Name()), "UNSUPPORTED_CAPABILITY"}
	}
	if request.AgentPreset != "" && (!capabilities.AgentPreset || provider.InheritsParentContext()) {
		return "", &subagentActivationError{fmt.Sprintf("harness: subagent provider %q does not support independent agent preset selection", provider.Name()), "UNSUPPORTED_CAPABILITY"}
	}
	if request.Persona != "" && !capabilities.Persona {
		return "", &subagentActivationError{fmt.Sprintf("harness: subagent provider %q does not support persona", provider.Name()), "UNSUPPORTED_CAPABILITY"}
	}
	if request.ToolFilter != nil && !capabilities.ToolFilter {
		return "", &subagentActivationError{fmt.Sprintf("harness: subagent provider %q does not support tool filtering", provider.Name()), "UNSUPPORTED_CAPABILITY"}
	}
	prepare := continuable.PrepareContinuable
	if request.activation != nil {
		managed, ok := provider.(SubagentManagedContinuationProvider)
		if !ok {
			return "", ErrSubagentActivationModeUnsupported
		}
		prepare = managed.PrepareActivation
	}
	if err := r.protectSubagentPreparation(ctx, request.Parent); err != nil {
		return "", err
	}
	if request.activation != nil {
		if _, err := r.reserveActivationCapacity(ctx, request.Parent); err != nil {
			return "", err
		}
	}
	prepared, err := prepare(ctx, request)
	if err != nil {
		return "", err
	}
	disposal := newSubagentDisposalClaim(prepared.Dispose)
	prepared.Dispose = disposal.callback()
	disposal.bindAgent(r.agents, prepared.Child)
	r.retainPreparedSubagentDisposal(ctx, disposal, prepared.Child)
	if err := ctx.Err(); err != nil {
		if prepared.Dispose != nil {
			r.cleanupPreparedSubagent(prepared.Dispose)
		}
		return "", err
	}
	if prepared.ChildID == "" || prepared.Child == nil || prepared.InitialMessageID == "" || prepared.Begin == nil || prepared.Submit == nil || prepared.Dispose == nil || (len(request.OutputSchema) != 0 && prepared.CaptureStructured == nil) {
		if prepared.Dispose != nil {
			r.cleanupPreparedSubagent(prepared.Dispose)
		}
		return "", errors.New("harness: subagent provider returned an incomplete continuable child")
	}
	if len(request.OutputSchema) != 0 && prepared.StructuredAdmission == nil {
		r.cleanupPreparedSubagent(prepared.Dispose)
		return "", &subagentActivationError{"harness: managed structured provider must supply an exact admission gate", "UNSUPPORTED_CAPABILITY"}
	}
	if prepared.InitialMessageID != request.initialMessageID {
		r.cleanupPreparedSubagent(prepared.Dispose)
		return "", errors.New("harness: subagent provider changed the continuable prompt identity")
	}
	if request.ChildID != "" && prepared.ChildID != request.ChildID {
		r.cleanupPreparedSubagent(prepared.Dispose)
		return "", fmt.Errorf("harness: subagent provider returned child id %q; requested %q", prepared.ChildID, request.ChildID)
	}
	record := &subagentRecord{snapshot: SubagentSnapshot{
		ID: prepared.ChildID, Parent: request.Parent.ID(), Provider: provider.Name(), Status: SubagentRunning,
		Label: request.Label, Depth: depth + 1, StartedAt: time.Now().UTC(), Continuable: true,
	}, parent: request.Parent, child: prepared.Child, submit: prepared.Submit, dispose: prepared.Dispose, disposal: disposal, epoch: 1, suppressParentSettlement: request.SuppressParentSettlement, activation: request.activation, captureStructured: prepared.CaptureStructured, structuredAdmission: prepared.StructuredAdmission, requiresStructured: len(request.OutputSchema) != 0}
	r.mu.Lock()
	liveChild, childExists := r.agents.Get(prepared.ChildID)
	if r.disposed || !r.preparationAdmitsLocked(ctx, request.Parent) || !childExists || liveChild != prepared.Child || prepared.Child.Parent() != request.Parent {
		r.mu.Unlock()
		r.cleanupPreparedSubagent(prepared.Dispose)
		return "", errors.New("harness: subagent parent retired during preparation")
	}
	if _, exists := r.records[prepared.ChildID]; exists {
		r.mu.Unlock()
		r.cleanupPreparedSubagent(prepared.Dispose)
		return "", fmt.Errorf("harness: duplicate subagent id %q", prepared.ChildID)
	}
	r.nextID++
	record.runID = fmt.Sprintf("subagent-run-%d", r.nextID)
	if gate := record.structuredAdmission; gate != nil {
		if gate.registry != r {
			r.mu.Unlock()
			r.cleanupPreparedSubagent(prepared.Dispose)
			return "", errors.New("harness: structured admission belongs to another registry")
		}
		if err := gate.bindLocked(record, prepared.InitialMessageID); err != nil {
			r.mu.Unlock()
			r.cleanupPreparedSubagent(prepared.Dispose)
			return "", err
		}
	}
	r.records[prepared.ChildID] = record
	r.mu.Unlock()
	if err := r.bindActivationRecord(ctx, record); err != nil {
		r.mu.Lock()
		if r.records[record.snapshot.ID] == record {
			delete(r.records, record.snapshot.ID)
		}
		r.mu.Unlock()
		return "", errors.Join(err, r.rollbackSubagentRecord(record))
	}
	started := SubagentLifecycle{
		RunID: record.runID, Provider: provider.Name(), ID: prepared.ChildID,
		Parent: request.Parent, Child: prepared.Child, Local: true, Managed: record.activation != nil, Facade: subagentRecordFacade(record),
	}
	if record.activation != nil {
		record.activation.started.Store(true)
	}
	if err := r.emitSubagentStarted(ctx, started); err != nil {
		r.mu.Lock()
		if r.records[prepared.ChildID] == record {
			delete(r.records, prepared.ChildID)
		}
		r.mu.Unlock()
		return "", errors.Join(err, r.rollbackSubagentRecord(record))
	}

	if !r.activationCurrent(record) {
		return "", errors.Join(errors.New("harness: subagent parent retired before begin"), r.rollbackSubagentRecord(record))
	}
	turn, err := prepared.Begin(ctx)
	if record.activation != nil && turn != nil {
		// Retain the sole initial provider outcome before catalog commit
		// can roll back. Dispose may synchronously publish on an unbuffered turn.
		turn = retainInitialSubagentTurn(turn, record.disposal.done)
	}
	if err != nil {
		r.mu.Lock()
		if r.records[prepared.ChildID] == record {
			delete(r.records, prepared.ChildID)
		}
		r.mu.Unlock()
		if record.activation == nil {
			_ = r.emitSubagentEnded(context.Background(), SubagentLifecycle{
				RunID: record.runID, Provider: provider.Name(), ID: prepared.ChildID,
				Parent: request.Parent, Child: prepared.Child, Local: true, StopReason: SubagentFailed,
			})
		}
		return "", errors.Join(err, r.rollbackSubagentRecord(record))
	}
	if !r.activationCurrent(record) {
		return "", errors.Join(errors.New("harness: subagent parent retired during begin"), r.rollbackSubagentRecord(record))
	}
	if record.activation != nil {
		if err := establishSubagentCatalogChild(record); err != nil {
			return "", errors.Join(err, r.rollbackSubagentRecord(record))
		}
		record.activation.announced.Store(true)
	}
	r.watchContinuation(record, 1, record.runID, turn)
	return prepared.ChildID, nil
}

// StartContinuableWithReceipt establishes a continuable child and returns the
// exact initial message identity only after the child inbox accepts it.
func (r *SubagentRegistry) StartContinuableWithReceipt(ctx context.Context, providerName string, request SubagentRequest) (SubagentContinuationReceipt, error) {
	messageID, err := newMessageID()
	if err != nil {
		return SubagentContinuationReceipt{}, fmt.Errorf("harness: create continuable prompt identity: %w", err)
	}
	request.initialMessageID = messageID
	childID, err := r.StartContinuable(ctx, providerName, request)
	if err != nil {
		return SubagentContinuationReceipt{}, err
	}
	return SubagentContinuationReceipt{ChildID: childID, MessageID: messageID}, nil
}

// ActivateContinuable makes one direct continuable child resident without
// submitting a turn. It is the cold-resume seam for durable orchestrators that
// must checkpoint a target inbox before waking it.
func (r *SubagentRegistry) ActivateContinuable(ctx context.Context, parent *Agent, childID SessionID) (*Agent, error) {
	if r == nil || parent == nil || childID == "" {
		return nil, errors.New("harness: activate continuable requires parent and child id")
	}
	if !r.beginSubagentCallback() {
		return nil, errors.New("harness: subagent registry is disposed")
	}
	defer r.endSubagentCallback()
	preparationCtx, releasePreparation, err := r.reserveSubagentPreparation(ctx, parent)
	if err != nil {
		return nil, err
	}
	defer releasePreparation()
	record, err := r.continuableRecord(preparationCtx, parent, childID)
	if err != nil {
		return nil, err
	}
	if record.child == nil || record.parent != parent || !r.activationCurrent(record) {
		return nil, fmt.Errorf("harness: continuable subagent %q has no exact live owner", childID)
	}
	if live, exists := r.agents.Get(childID); !exists || live != record.child || record.child.Parent() != parent {
		return nil, fmt.Errorf("harness: continuable subagent %q has no exact live child", childID)
	}
	if err := record.child.ResumeDurableInbox(); err != nil {
		return nil, err
	}
	if !r.activationCurrent(record) {
		r.rollbackSubagentRecord(record)
		return nil, errors.New("harness: continuable owner retired during activation")
	}
	return record.child, nil
}

// retainInitialSubagentTurn keeps exactly one initial outcome until either the
// admission transaction starts its regular consumer or rollback finishes. It
// owns no Agent authority and cannot redirect a later runtime incarnation.
func retainInitialSubagentTurn(source <-chan TurnOutcome, disposed <-chan struct{}) <-chan TurnOutcome {
	result := make(chan TurnOutcome, 1)
	go func() {
		defer close(result)
		select {
		case value, open := <-source:
			if open {
				result <- value
			}
		case <-disposed:
		}
	}()
	return result
}
