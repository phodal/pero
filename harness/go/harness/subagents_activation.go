package harness

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	point "github.com/phodal/pero/harness/go/runtime"
)

// SubagentActivation is one exact managed execution. Its result becomes visible
// after teardown and optional parent delivery; Dispose never targets a later
// runtime generation that happens to reuse ChildID.
type SubagentActivation struct {
	ChildID   SessionID
	MessageID string
	Result    <-chan SubagentResult
	Dispose   func(context.Context) error
	// RequestDispose revokes input synchronously without joining teardown. Use
	// it from a proven foreign lifecycle callback, then Wait outside that callback.
	RequestDispose func() error
	// Wait joins the original teardown and notification transaction. Do not wait
	// from a synchronous lifecycle callback that the transaction must release.
	Wait func(context.Context) error
	Done <-chan struct{}
}

// ErrSubagentActivationDisposalPending means input authority has been revoked,
// but a synchronous observer or an earlier disposal still owns completion.
// Call Wait outside that observer to join the same transaction.
type subagentActivationError struct{ message, code string }

func (e *subagentActivationError) Error() string         { return e.message }
func (e *subagentActivationError) ToolErrorCode() string { return e.code }

var ErrSubagentActivationDisposalPending = &subagentActivationError{"harness: subagent activation disposal is pending", "SUBAGENT_ACTIVATION_DISPOSAL_PENDING"}
var ErrSubagentActivationNotReady = &subagentActivationError{"harness: subagent activation is still preparing; no input was accepted", "SUBAGENT_ACTIVATION_NOT_READY"}
var ErrSubagentActivationModeUnsupported = &subagentActivationError{"harness: provider or resident child does not support managed activation mode", "SUBAGENT_ACTIVATION_MODE_UNSUPPORTED"}

// SubagentSendFailureKind identifies only service-owned failures whose DSH
// send_message presentation has been proven. It conveys no delivery authority.
type SubagentSendFailureKind uint8

const (
	SubagentSendFailureUnknown SubagentSendFailureKind = iota
	SubagentSendSenderNotLive
	SubagentSendTargetUnavailable
	SubagentSendContinuationUnsupported
	SubagentSendWrongParent
)

type dshSubagentSendContextKey struct{}

// One private receipt per DSH call. Exact registry, sender, target and the
// existing preparation receipt keep nested operations from inheriting it.
type dshSubagentSendInvocation struct {
	registry    *SubagentRegistry
	sender      *Agent
	target      SessionID
	preparation *subagentPreparation
}

type dshSubagentSendFailure struct {
	kind  SubagentSendFailureKind
	cause error
}

func (e *dshSubagentSendFailure) Error() string { return e.cause.Error() }
func (e *dshSubagentSendFailure) Unwrap() error { return e.cause }

// ClassifyDSHSendFailure records a known failure at its service-owned origin.
// Ordinary calls retain the identical error object. Callers must not derive a
// kind from arbitrary error text, error codes or a provider's outer wrapper.
func (r *SubagentRegistry) ClassifyDSHSendFailure(ctx context.Context, sender *Agent, target SessionID, kind SubagentSendFailureKind, cause error) error {
	if cause == nil || ctx == nil {
		return cause
	}
	invocation, _ := ctx.Value(dshSubagentSendContextKey{}).(*dshSubagentSendInvocation)
	preparation, _ := ctx.Value(subagentPreparationContextKey{}).(*subagentPreparation)
	if invocation == nil || invocation.registry != r || invocation.sender != sender || invocation.target != target || invocation.preparation != preparation {
		return cause
	}
	switch kind {
	case SubagentSendSenderNotLive, SubagentSendTargetUnavailable, SubagentSendContinuationUnsupported, SubagentSendWrongParent:
		return &dshSubagentSendFailure{kind: kind, cause: cause}
	default:
		return cause
	}
}

// DSHSubagentSendFailure reads only an exact service-owned diagnostic. An outer
// policy/provider wrapper is authoritative: never unwrap it to recover a tag.
func DSHSubagentSendFailure(err error) (SubagentSendFailureKind, bool) {
	failure, ok := err.(*dshSubagentSendFailure)
	if !ok || failure == nil {
		return SubagentSendFailureUnknown, false
	}
	return failure.kind, true
}

type subagentActivationState struct {
	closing          atomic.Bool
	bindingReady     atomic.Bool
	announced        atomic.Bool
	started          atomic.Bool
	runID            string
	busy             atomic.Int64
	cleanupStarted   atomic.Bool
	once             sync.Once
	cleanupOnce      sync.Once
	disposalFallback sync.Once
	mu               sync.Mutex
	record           *subagentRecord
	capacity         *subagentCapacityLease
	facade           *SubagentFacade
	observer         *point.Instance
	outputStart      int
	failure          error
	failureAt        uint64
	delivery         string
	result           chan SubagentResult
	done             chan struct{}
	cleanupDone      chan struct{}
	bindingDone      chan struct{}
	initialDone      chan struct{}
	initialOnce      sync.Once
	initialStart     bool
	providerResult   bool
	cleanupErr       error
	withdrawErr      error
	noticeErr        error
	captured         *SubagentResult

	// Registry mutex protects input admission and descendant ownership.
	inputs              int
	structuredAdmission *SubagentStructuredAdmission
	preparing           int
	owned               map[*subagentRecord]struct{}
	changed             chan struct{}
	preparationContext  context.Context
	cancelPreparations  context.CancelCauseFunc
}

func newSubagentActivation(delivery string) *subagentActivationState {
	preparationContext, cancelPreparations := context.WithCancelCause(context.Background())
	return &subagentActivationState{delivery: delivery, result: make(chan SubagentResult, 1), done: make(chan struct{}), cleanupDone: make(chan struct{}), bindingDone: make(chan struct{}), initialDone: make(chan struct{}), owned: make(map[*subagentRecord]struct{}), changed: make(chan struct{}), preparationContext: preparationContext, cancelPreparations: cancelPreparations}
}

// activationAcceptsInput is safe under the registry lock and never re-enters it.
func (r *SubagentRegistry) activationAcceptsInput(record *subagentRecord) bool {
	return record != nil && (record.activation == nil || !record.activation.closing.Load())
}

// hasActivationPromptContent accepts explicit empty text without treating an
// absent prompt as text. Legacy scalar prompt admission remains unchanged.
func (request SubagentRequest) hasActivationPromptContent() bool {
	if request.hasPromptContent() {
		return true
	}
	for _, block := range request.PromptContent {
		if block.Type == BlockText {
			return true
		}
	}
	return false
}

// Only StartActivation can install the private activation state. Ordinary
// Start/StartContinuable callers retain the legacy nonblank admission rule.
func (request SubagentRequest) hasStartPromptContent() bool {
	if request.activation != nil {
		return request.hasActivationPromptContent()
	}
	return request.hasPromptContent()
}

// StartActivation starts a managed local or external execution. Cancellation of
// ctx owns preparation only; after acceptance callers dispose the returned handle.
func (r *SubagentRegistry) StartActivation(ctx context.Context, providerName string, request SubagentRequest, delivery string) (SubagentActivation, error) {
	if r == nil || request.Parent == nil || !request.hasActivationPromptContent() {
		return SubagentActivation{}, errors.New("harness: activation requires registry, parent, and prompt")
	}
	if delivery != "parent" && delivery != "caller" {
		return SubagentActivation{}, errors.New("harness: subagent delivery must be parent or caller")
	}
	if r == nil || !r.beginSubagentCallback() {
		return SubagentActivation{}, errors.New("harness: subagent registry is disposed")
	}
	defer r.endSubagentCallback()
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return SubagentActivation{}, err
	}
	if err := r.requireLiveParent(request.Parent); err != nil {
		return SubagentActivation{}, err
	}
	provider, err := r.resolveProvider(request.Parent.Scope(), providerName)
	if err != nil {
		return SubagentActivation{}, err
	}
	// DSH resolves relative delegation directories against the parent's current
	// working directory before provider preparation. This is execution context
	// only: providers retain the immutable delegated sandbox/Project root.
	if !filepath.IsAbs(request.CWD) {
		request.CWD, err = filepath.Abs(filepath.Join(request.Parent.Session().WorkingDirectory(), request.CWD))
		if err != nil {
			return SubagentActivation{}, fmt.Errorf("harness: resolve subagent working directory: %w", err)
		}
	}
	state := newSubagentActivation(delivery)
	state.initialStart = true
	defer state.finishInitial()
	request.activation = state
	request.SuppressParentSettlement = true
	if _, local := provider.(SubagentContinuationProvider); local {
		if _, ok := provider.(SubagentManagedContinuationProvider); !ok {
			return SubagentActivation{}, ErrSubagentActivationModeUnsupported
		}
		receipt, err := r.StartContinuableWithReceipt(ctx, providerName, request)
		if err != nil {
			return SubagentActivation{}, err
		}
		state.mu.Lock()
		record := state.record
		state.mu.Unlock()
		if record == nil {
			return SubagentActivation{}, errors.New("harness: continuable activation lost its prepared record")
		}
		return SubagentActivation{ChildID: receipt.ChildID, MessageID: receipt.MessageID, Result: state.result, Dispose: func(ctx context.Context) error { return r.disposeActivation(ctx, record) }, RequestDispose: func() error { return r.requestActivationDisposal(record) }, Wait: state.wait, Done: state.done}, nil
	}
	if request.ChildID != "" {
		return SubagentActivation{}, &subagentActivationError{"harness: reserved child ids require a local subagent provider", "UNSUPPORTED_CAPABILITY"}
	}
	// The provider's sole result consumer owns external terminal arbitration,
	// including a result produced synchronously by Dispose. Local fallback must
	// never race that consumer with an invented aborted result.
	state.providerResult = true
	run, err := r.Start(ctx, providerName, request)
	if err != nil {
		state.mu.Lock()
		record := state.record
		state.mu.Unlock()
		if record != nil {
			r.beginActivationCleanup(record)
			go r.completeActivation(record, SubagentResult{ChildID: record.snapshot.ID, Status: SubagentAborted, Reason: FinishAborted})
		}
		return SubagentActivation{}, err
	}
	state.mu.Lock()
	record := state.record
	state.mu.Unlock()
	if record == nil || record.run.Result != run.Result {
		_ = run.Dispose(context.Background())
		return SubagentActivation{}, errors.New("harness: external activation lost its exact record")
	}
	state.mu.Lock()
	state.record = record
	state.runID = record.runID
	state.announced.Store(true)
	state.mu.Unlock()
	go func() {
		var result SubagentResult
		var ok bool
		select {
		case result, ok = <-run.Result:
		case <-state.done:
			return
		}
		if !ok {
			result = SubagentResult{ChildID: run.ID, Status: SubagentFailed, Reason: FinishError, Diagnostic: "external subagent closed without a result"}
		}
		state.capture(result)
		state.closing.Store(true)
		_ = r.cleanupActivation(context.Background(), record)
		r.completeActivation(record, result)
	}()
	return SubagentActivation{ChildID: run.ID, Result: state.result, Dispose: func(ctx context.Context) error { return r.disposeActivation(ctx, record) }, RequestDispose: func() error { return r.requestActivationDisposal(record) }, Wait: state.wait, Done: state.done}, nil
}

// Preparations are tracked even before the parent's managed record binds:
// Activated observers can delegate while a provider is publishing that Agent.
// Registry mutex protects token ownership and adoption by a later activation.
type subagentPreparation struct {
	bound     *subagentRecord
	parent    *Agent
	published chan struct{}
	settled   chan struct{}
	finalErr  error
	facade    *SubagentFacade
	capacity  *subagentCapacityLease
	receipt   *subagentParentReceipt
	owner     *subagentActivationState
	cancel    context.CancelCauseFunc
	stop      func() bool
}

// reserveSubagentPreparation prevents a managed parent from settling while
// an accepted child preparation has not yet published or rolled back.
func (r *SubagentRegistry) reserveSubagentPreparation(ctx context.Context, parent *Agent) (context.Context, func(), error) {
	if ctx == nil {
		ctx = context.Background()
	}
	facade, _ := ctx.Value(subagentFacadeContextKey{}).(*SubagentFacade)
	r.mu.Lock()
	if r.disposed || !r.preparationAdmitsLocked(ctx, parent) {
		r.mu.Unlock()
		return nil, nil, ErrSubagentAdmissionClosed
	}
	if facade != nil && (facade.registry != r || facade.closing) {
		r.mu.Unlock()
		return nil, nil, ErrSubagentFacadeDraining
	}
	state := r.activationParents[parent]
	if state != nil && state.closing.Load() {
		r.mu.Unlock()
		return nil, nil, errors.New("harness: parent activation is closing")
	}
	if state != nil && state.structuredAdmission != nil && state.structuredAdmission.captures != 0 {
		r.mu.Unlock()
		return nil, nil, ErrSubagentInputClosed
	}
	preparedCtx, cancel := context.WithCancelCause(ctx)
	token := &subagentPreparation{cancel: cancel, facade: facade, parent: parent, published: make(chan struct{}), settled: make(chan struct{})}
	if facade != nil {
		facade.preparations[token] = struct{}{}
		facade.signalLocked()
	}
	if r.parentPreparations == nil {
		r.parentPreparations = make(map[*Agent]map[*subagentPreparation]struct{})
	}
	if r.parentPreparations[parent] == nil {
		r.parentPreparations[parent] = make(map[*subagentPreparation]struct{})
	}
	r.parentPreparations[parent][token] = struct{}{}
	if r.preparationReceipts == nil {
		r.preparationReceipts = make(map[*Agent]map[*subagentPreparation]struct{})
	}
	if r.preparationReceipts[parent] == nil {
		r.preparationReceipts[parent] = make(map[*subagentPreparation]struct{})
	}
	r.preparationReceipts[parent][token] = struct{}{}
	r.signalSubagentOwnershipLocked()
	r.adoptSubagentPreparationLocked(state, token)
	r.mu.Unlock()
	var once sync.Once
	return context.WithValue(preparedCtx, subagentPreparationContextKey{}, token), func() {
		once.Do(func() {
			r.mu.Lock()
			if token.stop != nil {
				token.stop()
			}
			delete(r.parentPreparations[parent], token)
			if len(r.parentPreparations[parent]) == 0 {
				delete(r.parentPreparations, parent)
			}
			if token.owner != nil {
				token.owner.preparing--
				r.signalActivationLocked(token.owner)
			}
			token.owner, token.stop = nil, nil
			// Facade admission remains outstanding through the exact rollback receipt.
			r.mu.Unlock()
			cancel(nil)
			if token.receipt != nil {
				token.receipt.publish()
			}
			close(token.published)
			finish := func(err error) {
				r.mu.Lock()
				token.finalErr = err
				delete(r.preparationReceipts[parent], token)
				if len(r.preparationReceipts[parent]) == 0 {
					delete(r.preparationReceipts, parent)
				}
				close(token.settled)
				r.signalSubagentOwnershipLocked()
				if token.facade != nil {
					token.facade.err = errors.Join(token.facade.err, err)
					delete(token.facade.preparations, token)
					token.facade.signalLocked()
				}
				r.mu.Unlock()
			}
			if token.receipt == nil {
				finish(nil)
			} else {
				go func() { finish(token.receipt.claim.wait(context.Background())) }()
			}
		})
	}, nil
}

func (r *SubagentRegistry) adoptSubagentPreparationLocked(state *subagentActivationState, token *subagentPreparation) {
	if state == nil || token.owner != nil {
		return
	}
	token.owner = state
	state.preparing++
	token.stop = context.AfterFunc(state.preparationContext, func() { token.cancel(context.Cause(state.preparationContext)) })
}

func (s *subagentActivationState) finishInitial() { s.initialOnce.Do(func() { close(s.initialDone) }) }

func (r *SubagentRegistry) signalActivationLocked(state *subagentActivationState) {
	r.signalSubagentOwnershipLocked()
	close(state.changed)
	state.changed = make(chan struct{})
}

// bindActivationRecord runs before Begin can emit a terminal result. The
// caller's preparation reservation keeps its parent live through this bind.
func (r *SubagentRegistry) bindActivationRecord(ctx context.Context, record *subagentRecord) error {
	if record.activation != nil {
		defer close(record.activation.bindingDone)
		if token, _ := ctx.Value(subagentPreparationContextKey{}).(*subagentPreparation); token != nil {
			record.activation.capacity = token.capacity
			record.activation.facade = token.facade
		}
	}
	r.mu.Lock()
	if r.parentRecords == nil {
		r.parentRecords = make(map[*Agent]map[*subagentRecord]struct{})
	}
	if r.parentRecords[record.parent] == nil {
		r.parentRecords[record.parent] = make(map[*subagentRecord]struct{})
	}
	r.parentRecords[record.parent][record] = struct{}{}
	r.signalSubagentOwnershipLocked()
	if owner := r.activationParents[record.parent]; owner != nil {
		owner.owned[record] = struct{}{}
		record.activationOwner = owner
		r.signalActivationLocked(owner)
	}
	if record.activation != nil && record.child != nil {
		if r.activationParents == nil {
			r.activationParents = make(map[*Agent]*subagentActivationState)
		}
		r.activationParents[record.child] = record.activation
		for token := range r.parentPreparations[record.child] {
			r.adoptSubagentPreparationLocked(record.activation, token)
		}
		// Accepted ownership survives live-record withdrawal, including a
		// naturally settled external child still blocked in provider cleanup.
		for childRecord := range r.parentRecords[record.child] {
			if childRecord.activationOwner == nil {
				record.activation.owned[childRecord] = struct{}{}
				childRecord.activationOwner = record.activation
			}
		}
	}
	r.mu.Unlock()
	if record.activation != nil {
		// The caller still owns an admitted preparation. Extend its existing
		// nonzero receipt before teardown can seal registry admission.
		r.callbackWG.Add(1)
		r.activationReceipts.Add(1)
		record.activation.mu.Lock()
		if record.child != nil {
			record.activation.outputStart = len(record.child.Session().Events())
		}
		record.activation.record = record
		record.activation.runID = record.runID
		record.activation.mu.Unlock()
	}
	if record.disposal != nil {
		go func() {
			_ = record.disposal.wait(context.Background())
			if record.activation != nil {
				// An ancestor or registry teardown can withdraw this record without
				// calling its public activation disposer. Join the exact same receipt
				// and settle result ownership even if its turn/provider never reports.
				r.beginActivationCleanup(record)
			} else {
				r.mu.RLock()
				epoch := record.epoch
				r.mu.RUnlock()
				r.releaseSubagentOwnership(record, epoch, true)
			}
		}()
	}
	r.retainPreparedSubagentRecord(ctx, record)
	if record.activation != nil && record.activation.facade != nil {
		r.mu.Lock()
		owner := record.activation.facade
		owner.activations[record.activation] = struct{}{}
		closing := owner.closing
		owner.signalLocked()
		r.mu.Unlock()
		if closing {
			r.beginActivationCleanup(record)
			return ErrSubagentFacadeDraining
		}
	}
	err := r.observeActivationInput(ctx, record)
	if err == nil && record.activation != nil {
		record.activation.bindingReady.Store(true)
	}
	return err
}

// observeActivationInput uses the existing scoped event lifetime. It does not
// consume turn/result channels or turn a quiet input into an unsolicited wake.
func (r *SubagentRegistry) observeActivationInput(ctx context.Context, record *subagentRecord) error {
	child, state := record.child, record.activation
	if child == nil || state == nil {
		return nil
	}
	wake := func() {
		r.mu.Lock()
		r.signalActivationLocked(state)
		r.mu.Unlock()
	}
	definition := point.Define(point.Descriptor{ID: "harness.subagent-activation-observer"}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
		unsubscribe := child.Session().Subscribe(func(event Event) {
			state.mu.Lock()
			if event.Type == "turn/end" && state.failure != nil && event.Seq >= state.failureAt {
				state.failure = nil
			}
			state.mu.Unlock()
			wake()
		})
		if err := run.Defer("activation-session-observer", func(context.Context) error { unsubscribe(); return nil }); err != nil {
			unsubscribe()
			return nil, err
		}
		if _, err := child.hooks.Status.On(run, func(_ context.Context, input AgentStatusInput) error {
			if input.Agent == child {
				wake()
			}
			return nil
		}); err != nil {
			return nil, err
		}
		if _, err := child.hooks.InboxInserted.On(run, func(_ context.Context, input InboxInsertedInput) error {
			if input.Agent == child {
				wake()
			}
			return nil
		}); err != nil {
			return nil, err
		}
		if _, err := child.hooks.InboxClaimed.On(run, func(_ context.Context, input InboxClaimedInput) error {
			if input.Agent == child {
				wake()
			}
			return nil
		}); err != nil {
			return nil, err
		}
		if _, err := child.hooks.InboxDiscarded.On(run, func(_ context.Context, input InboxDiscardedInput) error {
			if input.Agent == child {
				wake()
			}
			return nil
		}); err != nil {
			return nil, err
		}
		if _, err := child.hooks.Error.On(run, func(_ context.Context, input AgentErrorInput) error {
			if input.Agent == child {
				state.mu.Lock()
				state.failure, state.failureAt = input.Error, uint64(len(child.Session().Events()))
				state.mu.Unlock()
				wake()
			}
			return nil
		}); err != nil {
			return nil, err
		}
		return nil, nil
	})
	observerID, err := newMessageID()
	if err != nil {
		return err
	}
	instance, err := r.runtime.Mount(child.Scope(), "subagent-activation-observer-"+observerID, definition, nil)
	if err != nil {
		return err
	}
	state.mu.Lock()
	state.observer = instance
	state.mu.Unlock()
	if err := instance.WaitStable(ctx); err != nil {
		return errors.Join(err, instance.Dispose(context.Background()))
	}
	if snapshot := instance.Snapshot(); snapshot.State == point.Failed {
		return errors.Join(errors.New(snapshot.LastError), instance.Dispose(context.Background()))
	}
	return nil
}

// activationResult reads only this incarnation's output suffix, never a
// parent's inherited answer or the previous cold activation's final message.
func activationResult(record *subagentRecord, fallback TurnOutcome) SubagentResult {
	state := record.activation
	state.mu.Lock()
	start, failure := state.outputStart, state.failure
	state.mu.Unlock()
	events := record.child.Session().Events()
	if start > len(events) {
		start = len(events)
	}
	var output []ContentBlock
	var partial strings.Builder
	reason, diagnostic := fallback.Turn.Reason, ""
	if fallback.Err != nil {
		reason, diagnostic = FinishError, fallback.Err.Error()
	}
	for _, event := range events[start:] {
		switch event.Type {
		case "assistant/message":
			var payload struct {
				Message Message `json:"message"`
			}
			if json.Unmarshal(event.Data, &payload) == nil && len(payload.Message.Content) > 0 {
				output = cloneContentBlocks(payload.Message.Content)
			}
		case "assistant/chunk":
			var payload struct {
				Chunk StreamChunk `json:"chunk"`
			}
			if json.Unmarshal(event.Data, &payload) == nil {
				for _, block := range payload.Chunk.Content {
					if block.Type == BlockText {
						partial.WriteString(block.Text)
					}
				}
			}
		case "turn/end":
			var payload struct {
				Reason FinishKind `json:"reason"`
				Error  string     `json:"error"`
			}
			if json.Unmarshal(event.Data, &payload) == nil {
				reason, diagnostic = payload.Reason, payload.Error
			}
		}
	}
	if output == nil && partial.Len() > 0 {
		output = []ContentBlock{{Type: BlockText, Text: partial.String()}}
	}
	if failure != nil {
		reason, diagnostic = FinishError, failure.Error()
	}
	status := SubagentCompleted
	if reason == FinishAborted {
		status = SubagentAborted
	} else if reason != FinishStop {
		status = SubagentFailed
	}
	result := SubagentResult{ChildID: record.snapshot.ID, Status: status, Reason: reason, Output: output, Diagnostic: diagnostic}
	if record.requiresStructured {
		if record.captureStructured != nil {
			result.Structured = record.captureStructured()
		}
		if result.Structured == nil && result.Status == SubagentCompleted {
			result.Status, result.Reason, result.Diagnostic = SubagentFailed, FinishError, "subagent finished without required structured output"
		}
	}
	return result
}

// releaseSubagentOwnership also observes legacy terminal epochs without
// reading their result channels. Managed records release after notification.
func (r *SubagentRegistry) releaseSubagentOwnership(record *subagentRecord, epoch uint64, managed bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if record.epoch != epoch || (!managed && record.activation != nil) {
		return
	}
	delete(r.parentRecords[record.parent], record)
	r.signalSubagentOwnershipLocked()
	if len(r.parentRecords[record.parent]) == 0 {
		delete(r.parentRecords, record.parent)
	}
	if owner := record.activationOwner; owner != nil {
		delete(owner.owned, record)
		record.activationOwner = nil
		r.signalActivationLocked(owner)
	}
}

// settleActivationTurn observes the existing sole turn consumer; it never reads
// the turn channel itself. A newer accepted turn supersedes this settlement.
func (r *SubagentRegistry) settleActivationTurn(record *subagentRecord, epoch uint64, outcome TurnOutcome) {
	if record.activation == nil || record.child == nil {
		return
	}
	go func() {
		for {
			if err := record.child.WhenIdle(context.Background()); err != nil {
				r.beginActivationCleanup(record)
				return
			}
			record.admissionMu.Lock()
			r.mu.RLock()
			owned := r.records[record.snapshot.ID] == record
			current := record.epoch == epoch && r.activationAcceptsInput(record)
			waiting := record.activation.preparing != 0 || len(record.activation.owned) != 0 || r.activationInputPendingLocked(record)
			changed := record.activation.changed
			r.mu.RUnlock()
			if !owned {
				record.admissionMu.Unlock()
				record.activation.closing.Store(true)
				_ = r.cleanupActivation(context.Background(), record)
				r.completeActivation(record, SubagentResult{ChildID: record.snapshot.ID, Status: SubagentAborted, Reason: FinishAborted, Output: activationResult(record, TurnOutcome{}).Output})
				return
			}
			if !current {
				record.admissionMu.Unlock()
				return
			}
			// An interrupted DSH phase can be idle with accepted next-turn work
			// parked. Maintenance correctly rejects its pending request count; wait
			// for an input/status generation instead of spinning on that rejection.
			child := record.child
			child.inboxClaimMu.Lock()
			parkedInput := child.durableInbox.HasNextTurn() || child.durableInbox.HasNextStep()
			child.inboxClaimMu.Unlock()
			if waiting || parkedInput {
				record.admissionMu.Unlock()
				select {
				case <-changed:
				case <-record.activation.done:
					return
				}
				continue
			}
			// Reserve the same idle phase used by maintenance so a concurrently queued
			// parent message cannot race the final output capture with another turn.
			lease, err := record.child.BeginMaintenance(context.Background())
			if err != nil {
				record.admissionMu.Unlock()
				if record.child.mutationAdmissionError() != nil {
					r.beginActivationCleanup(record)
					return
				}
				continue
			}
			var flushErr error
			if record.child.Session().DurabilityAttached() {
				flushErr = record.child.Session().Flush(context.Background())
			}
			child.admissionMu.Lock()
			child.inboxClaimMu.Lock()
			child.injectMu.Lock()
			pendingInput := child.pendingPrompts.Load() != 0 || len(child.injected) != 0 || child.durableInbox.HasNextTurn() || child.durableInbox.HasNextStep()
			r.mu.Lock()
			current = r.records[record.snapshot.ID] == record && record.epoch == epoch && r.activationAcceptsInput(record)
			waiting = record.activation.preparing != 0 || len(record.activation.owned) != 0 || r.activationInputPendingLocked(record)
			changed = record.activation.changed
			if current && !waiting && !pendingInput {
				record.activation.closing.Store(true)
			}
			r.mu.Unlock()
			if !current || waiting || pendingInput {
				child.injectMu.Unlock()
				child.inboxClaimMu.Unlock()
				child.admissionMu.Unlock()
				lease.Close()
				record.admissionMu.Unlock()
				if !current {
					return
				}
				select {
				case <-changed:
				case <-record.activation.done:
					return
				}
				continue
			}
			result := activationResult(record, outcome)
			if flushErr != nil {
				result.Status, result.Reason = SubagentFailed, FinishError
				if result.Diagnostic != "" {
					result.Diagnostic += "\n"
				}
				result.Diagnostic += "final session flush failed: " + flushErr.Error()
			}
			record.activation.capture(result)
			// Existing manager authority performs the linearization: retire the
			// exact subtree before any direct Agent input can pass these gates.
			// The busy gates force a pending receipt; never join it on this stack.
			withdrawErr := r.agents.RemoveExact(context.Background(), child)
			if !errors.Is(withdrawErr, ErrAgentDisposalInProgress) {
				record.activation.mu.Lock()
				record.activation.withdrawErr = withdrawErr
				record.activation.mu.Unlock()
			}
			child.injectMu.Unlock()
			child.inboxClaimMu.Unlock()
			child.admissionMu.Unlock()
			r.beginActivationCleanup(record)
			lease.Close()
			record.admissionMu.Unlock()
			_ = r.cleanupActivation(context.Background(), record)
			r.completeActivation(record, result)
			return
		}
	}()
}

func (s *subagentActivationState) capture(result SubagentResult) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.captured == nil {
		result.Output = cloneContentBlocks(result.Output)
		s.captured = &result
	}
}

func (r *SubagentRegistry) completeActivation(record *subagentRecord, result SubagentResult) {
	state := record.activation
	state.once.Do(func() {
		defer r.callbackWG.Done()
		defer r.activationReceipts.Add(-1)
		// Initial admission owns its lifecycle announcement. An ancestor may
		// start teardown during binding, but cannot publish a terminal edge ahead
		// of that admission's final Started decision.
		<-state.initialDone
		// No completion observer runs until teardown has produced its honest receipt.
		<-state.cleanupDone
		state.mu.Lock()
		if state.captured != nil {
			result = *state.captured
		}
		cleanupErr := state.cleanupErr
		state.mu.Unlock()
		result.Output = cloneContentBlocks(result.Output)
		if cleanupErr != nil {
			result.Status, result.Reason = SubagentFailed, FinishError
			if result.Diagnostic != "" {
				result.Diagnostic += "\n"
			}
			result.Diagnostic += "activation teardown failed: " + cleanupErr.Error()
		}
		if state.delivery == "parent" && state.announced.Load() {
			r.mu.RLock()
			live := r.liveParentLocked(record.parent)
			r.mu.RUnlock()
			if live {
				// A parent observer may dispose this same activation. It must receive a
				// pending receipt instead of waiting for the observer currently on stack.
				state.busy.Add(1)
				// The accepted activation owns this callback even after registry
				// admission is sealed, just like its terminal lifecycle observer.
				r.callbacks.Add(1)
				err := deliverActivationParentNotice(record.parent, result.ChildID, result, record.snapshot.Continuable)
				r.callbacks.Add(-1)
				state.busy.Add(-1)
				if err != nil {
					if result.Diagnostic != "" {
						result.Diagnostic += "\n"
					}
					result.Diagnostic += "parent settlement notice failed: " + err.Error()
					state.mu.Lock()
					state.noticeErr = err
					state.mu.Unlock()
				}
			}
		}
		var endedErr error
		if state.started.Load() {
			state.busy.Add(1)
			// This accepted activation already owns callbackWG even if registry
			// admission closed. Do not Add a fresh callback claim during Drain.
			r.callbacks.Add(1)
			endedErr = r.Ended.Emit(context.Background(), SubagentLifecycle{RunID: state.runID, Provider: record.snapshot.Provider, ID: record.snapshot.ID, Parent: record.parent, Child: record.child, Local: record.child != nil, StopReason: result.Status, Managed: true, Facade: state.facade, Result: &result})
			r.callbacks.Add(-1)
			state.busy.Add(-1)
		}
		if endedErr != nil {
			state.mu.Lock()
			state.noticeErr = errors.Join(state.noticeErr, endedErr)
			state.mu.Unlock()
			if result.Diagnostic != "" {
				result.Diagnostic += "\n"
			}
			result.Diagnostic += "activation settlement observer failed: " + endedErr.Error()
		}
		state.result <- result
		close(state.result)
		r.mu.Lock()
		r.callbackCleanupErr = errors.Join(r.callbackCleanupErr, state.cleanupErr, state.noticeErr)
		// Keep the closing fence through exact Agent retirement and notification;
		// withdrawal from records alone must never reclassify it as unmanaged.
		if r.activationParents[record.child] == state {
			delete(r.activationParents, record.child)
		}
		r.mu.Unlock()
		close(state.done)
		r.mu.RLock()
		epoch := record.epoch
		r.mu.RUnlock()
		r.releaseSubagentOwnership(record, epoch, true)
		if state.facade != nil {
			r.mu.Lock()
			delete(state.facade.activations, state)
			state.facade.err = errors.Join(state.facade.err, state.cleanupErr, state.noticeErr)
			state.facade.signalLocked()
			r.mu.Unlock()
		}
	})
}

func (s *subagentActivationState) wait(ctx context.Context) error {
	if ctx == nil {
		ctx = context.Background()
	}
	select {
	case <-s.done:
	case <-ctx.Done():
		return ctx.Err()
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return errors.Join(s.cleanupErr, s.noticeErr)
}

// beginActivationCleanup revokes exact-record input admission synchronously.
// Its owned teardown is independent of a caller's cancelled wait context.
func (r *SubagentRegistry) beginActivationCleanup(record *subagentRecord) bool {
	state := record.activation
	started := false
	state.cleanupOnce.Do(func() {
		started = true
		state.closing.Store(true)
		state.cancelPreparations(errors.New("harness: parent activation is closing"))
		state.cleanupStarted.Store(true)
		r.mu.Lock()
		epoch := record.epoch
		cleanup := r.withdrawActivationLocked(record, epoch)
		r.mu.Unlock()
		go func() {
			err := cleanup(context.Background())
			for {
				r.mu.RLock()
				waiting := state.preparing != 0 || len(state.owned) != 0
				changed := state.changed
				r.mu.RUnlock()
				if !waiting {
					break
				}
				<-changed
			}
			state.mu.Lock()
			state.cleanupErr = errors.Join(state.withdrawErr, err)
			state.mu.Unlock()
			state.capacity.close()
			close(state.cleanupDone)
		}()
		// The disposer owns termination even when a provider violates its result
		// promise or an ancestor closes the child before the turn observer runs.
		state.disposalFallback.Do(func() {
			if state.providerResult {
				return
			}
			go func() {
				<-state.cleanupDone
				result := SubagentResult{ChildID: record.snapshot.ID, Status: SubagentAborted, Reason: FinishAborted}
				if record.child != nil {
					result.Output = activationResult(record, TurnOutcome{}).Output
				}
				r.completeActivation(record, result)
			}()
		})
	})
	return started
}

func (r *SubagentRegistry) cleanupActivation(ctx context.Context, record *subagentRecord) error {
	if ctx == nil {
		ctx = context.Background()
	}
	r.beginActivationCleanup(record)
	state := record.activation
	select {
	case <-state.cleanupDone:
	case <-ctx.Done():
		return ctx.Err()
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	return state.cleanupErr
}

func (r *SubagentRegistry) requestActivationDisposal(record *subagentRecord) error {
	select {
	case <-record.activation.done:
		return record.activation.wait(context.Background())
	default:
	}
	r.beginActivationCleanup(record)
	return ErrSubagentActivationDisposalPending
}

func (r *SubagentRegistry) disposeActivation(ctx context.Context, record *subagentRecord) error {
	if ctx == nil {
		ctx = context.Background()
	}
	state := record.activation
	select {
	case <-state.done:
		return state.wait(ctx)
	default:
	}
	pending := state.busy.Load() != 0 || r.callbacks.Load() != 0 ||
		agentCallbackMaySelfWait(record.child) || agentCallbackMaySelfWait(record.parent) ||
		(record.disposal != nil && record.disposal.inProgress())
	started := r.beginActivationCleanup(record)

	if !started || pending {
		return ErrSubagentActivationDisposalPending
	}
	return state.wait(ctx)
}

// withdrawActivationLocked never acquires admissionMu. A synchronous admission
// callback may be the disposer, and teardown must let that callback return.
// The returned closure captures runtime pointers, never an ID-only lookup.
func (r *SubagentRegistry) withdrawActivationLocked(record *subagentRecord, epoch uint64) func(context.Context) error {
	if record.epoch != epoch {
		return func(context.Context) error { return nil }
	}
	owned := r.records[record.snapshot.ID] == record
	if owned {
		delete(r.records, record.snapshot.ID)
	}
	child, parent, run, agents, disposal := record.child, record.parent, record.run, r.agents, record.disposal
	return func(ctx context.Context) error {
		// Binding and observation own the same accepted preparation. Teardown
		// cannot miss an observer which is still being installed.
		<-record.activation.bindingDone
		var err error
		record.activation.mu.Lock()
		observer := record.activation.observer
		record.activation.mu.Unlock()
		if observer != nil {
			err = observer.Dispose(ctx)
		}
		waitExact := child != nil && child.Parent() == parent && agents != nil
		if waitExact {
			requestErr := agents.RemoveExact(ctx, child)
			if !errors.Is(requestErr, ErrAgentDisposalInProgress) {
				err = errors.Join(err, requestErr)
			} // WaitRetired below replaces an incomplete request receipt.
		}
		if !record.snapshot.Continuable && run.Cancel != nil {
			err = errors.Join(err, callSubagentCleanup(func() error { run.Cancel(errors.New("subagent activation disposed")); return nil }))
		}
		if disposal == nil {
			return errors.Join(err, errors.New("harness: activation has no exact provider disposal receipt"))
		}
		// Ancestor retirement may already own this same claim. Joining its receipt
		// preserves cleanup failures and never looks up a replacement by child ID.
		cleanupErr := disposal.invoke(ctx)
		if errors.Is(cleanupErr, ErrSubagentDisposalInProgress) {
			cleanupErr = disposal.wait(ctx)
		}
		if waitExact {
			err = errors.Join(err, agents.WaitRetired(ctx, child))
		}
		return errors.Join(err, cleanupErr)
	}
}

func (r *SubagentRegistry) retireActivation(ctx context.Context, record *subagentRecord, epoch uint64) error {
	r.mu.Lock()
	cleanup := r.withdrawActivationLocked(record, epoch)
	r.mu.Unlock()
	return cleanup(ctx)
}

// SendMessage admits a model-authored message only along one exact live
// direct-parent edge. The Host constructs attribution and steers the active
// turn; an idle direct child wakes without changing that authorization boundary.
func (r *SubagentRegistry) SendMessage(ctx context.Context, sender *Agent, targetID SessionID, content []ContentBlock) (string, error) {
	return r.sendMessage(ctx, sender, targetID, content, false)
}

// SendMessageDSH adds the source-owned diagnostic contract to the same adjacent
// delivery path. Empty addresses fail only after the existing live admission.
func (r *SubagentRegistry) SendMessageDSH(ctx context.Context, sender *Agent, targetID SessionID, content []ContentBlock) (string, error) {
	return r.sendMessage(ctx, sender, targetID, content, true)
}

func (r *SubagentRegistry) sendMessage(ctx context.Context, sender *Agent, targetID SessionID, content []ContentBlock, dsh bool) (string, error) {
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
	preparationCtx, releasePreparation, err := r.reserveSubagentPreparation(ctx, sender)
	if err != nil {
		return "", err
	}
	defer releasePreparation()
	if invocation != nil {
		preparation, _ := preparationCtx.Value(subagentPreparationContextKey{}).(*subagentPreparation)
		preparationCtx = context.WithValue(preparationCtx, dshSubagentSendContextKey{}, &dshSubagentSendInvocation{registry: r, sender: sender, target: targetID, preparation: preparation})
	}
	record, created, err := r.continuableRecordMode(preparationCtx, sender, targetID, true)
	if err != nil {
		return "", err
	}
	if created {
		defer record.activation.finishInitial()
	}
	if err := r.steerActivationMessage(ctx, record, sender, nil, message); err != nil {
		return "", err
	}
	return messageID, nil
}

// Admission reserves the exact destination without holding a lock across
// observers, including simultaneous messages in opposite directions.
func (r *SubagentRegistry) steerActivationMessage(ctx context.Context, record *subagentRecord, sender *Agent, sourceRecord *subagentRecord, message Message) error {
	return r.admitActivationMessage(ctx, record, sender, sourceRecord, message, "steer")
}

func (r *SubagentRegistry) admitActivationMessage(ctx context.Context, record *subagentRecord, sender *Agent, sourceRecord *subagentRecord, message Message, delivery string) error {
	r.mu.Lock()
	allowed := !r.disposed && r.records[record.snapshot.ID] == record && record.child != nil && r.parentAdmitsLocked(sender) && r.activationAcceptsInput(record)
	if sourceRecord == nil {
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
		if gate := record.structuredAdmission; gate != nil {
			turn, err = gate.admitDSHMessage(ctx, message, target, func() { finishLocked(true) })
		} else {
			turn, err = record.child.admitDSHMessage(ctx, message, target, func() {
				r.mu.Lock()
				finishLocked(true)
				r.mu.Unlock()
			})
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
