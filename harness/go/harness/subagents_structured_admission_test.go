package harness

import (
	"context"
	"errors"
	point "github.com/phodal/pero/harness/go/runtime"
	"sync"
	"sync/atomic"
	"testing"
)

// This gate-only fixture uses a separate registry so tests can establish exact
// receipt and identity states without inventing provider callbacks or workers.
func structuredGateFixture(t *testing.T) (*SubagentStructuredAdmission, *SubagentRegistry, *subagentRecord) {
	t.Helper()
	h := subagentTestHarness(t)
	parent := capacityParent(t, h, "gate-parent")
	child, err := h.Agents().Create(t.Context(), AgentOptions{ID: "gate-child", Parent: parent, Delegated: true, DelegationDepth: 1, CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	r := NewSubagentRegistry(h.Runtime())
	r.attachAgents(h.Agents())
	state := newSubagentActivation("caller")
	state.bindingReady.Store(true)
	record := &subagentRecord{snapshot: SubagentSnapshot{ID: child.ID(), Continuable: true}, parent: parent, child: child, activation: state}
	gate, err := NewSubagentStructuredAdmission(r, child, "initial-gate-input")
	if err != nil {
		t.Fatal(err)
	}
	record.structuredAdmission = gate
	r.records[child.ID()] = record
	r.activationParents = map[*Agent]*subagentActivationState{child: state}
	if err = gate.bindLocked(record, "initial-gate-input"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { state.cancelPreparations(context.Canceled) })
	return gate, r, record
}

func TestStructuredAdmissionGateOwnershipReservationAndExactIdentity(t *testing.T) {
	gate, r, record := structuredGateFixture(t)
	ctx, releasePreparation, err := r.reserveSubagentPreparation(t.Context(), record.child)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = gate.BeginCapture(); !errors.Is(err, ErrSubagentCannotComplete) {
		t.Fatalf("preparing child permitted capture: %v", err)
	}
	token := ctx.Value(subagentPreparationContextKey{}).(*subagentPreparation)
	// A published record can leave the live registry while its exact cleanup
	// receipt remains. Such withdrawal must not satisfy canComplete.
	r.mu.Lock()
	record.activation.preparing = 0
	token.owner = nil
	r.mu.Unlock()
	if _, err = gate.BeginCapture(); !errors.Is(err, ErrSubagentCannotComplete) {
		t.Fatalf("pending preparation receipt permitted capture: %v", err)
	}
	releasePreparation()
	release, err := gate.BeginCapture()
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = r.reserveSubagentPreparation(t.Context(), record.child); !errors.Is(err, ErrSubagentInputClosed) {
		t.Fatalf("capture allowed new ownership: %v", err)
	}
	release()
	release() // rollback is exact-once
	r.mu.Lock()
	replacement := &subagentRecord{snapshot: record.snapshot, child: record.child, activation: newSubagentActivation("caller")}
	r.records[record.snapshot.ID] = replacement
	r.mu.Unlock()
	if _, err = gate.BeginCapture(); err == nil {
		t.Fatal("old gate followed a Session-ID replacement")
	}
	r.mu.Lock()
	r.records[record.snapshot.ID] = record
	record.activation.closing.Store(true)
	gate.captures = 1
	r.mu.Unlock()
	_, err = gate.AdmitDSHMessage(t.Context(), Message{ID: "late", Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: "late"}}}, InboxNextTurn)
	assertSubagentControlCode(t, err, "ACTIVATION_CLOSING")
}

func TestStructuredAdmissionGateRequiresBothInboxesActuallyClaimed(t *testing.T) {
	for _, target := range []InboxTarget{InboxNextTurn, InboxNextStep} {
		t.Run(string(target), func(t *testing.T) {
			gate, _, record := structuredGateFixture(t)
			message := dshInboxMessage("pending", false)
			if _, err := record.child.SpliceDurableInbox(t.Context(), target, 0, 0, []Message{message}); err != nil {
				t.Fatal(err)
			}
			if _, err := gate.BeginCapture(); !errors.Is(err, ErrSubagentCannotComplete) {
				t.Fatalf("pending %s capture=%v", target, err)
			}
			record.child.inboxClaimMu.Lock()
			claimed, err := record.child.durableInbox.Claim(target)
			record.child.inboxClaimMu.Unlock()
			if err != nil || len(claimed) != 1 || claimed[0].ID != message.ID {
				t.Fatalf("actual claim=%+v %v", claimed, err)
			}
			release, err := gate.BeginCapture()
			if err != nil {
				t.Fatalf("claimed inbox still blocked capture: %v", err)
			}
			release()
		})
	}
}

func TestStructuredAdmissionGateCanceledInputDoesNotLeakReservation(t *testing.T) {
	gate, _, _ := structuredGateFixture(t)
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	_, err := gate.AdmitDSHMessage(ctx, Message{ID: "canceled", Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: "canceled"}}}, InboxNextTurn)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel=%v", err)
	}
	release, err := gate.BeginCapture()
	if err != nil {
		t.Fatalf("failed input retained reservation: %v", err)
	}
	release()
}

type structuredMissingGateProvider struct{ activationProbeProvider }

func (structuredMissingGateProvider) Capabilities() SubagentCapabilities {
	return SubagentCapabilities{OutputSchema: true, DepthLimit: true}
}

func TestStructuredAdmissionManagedCustomProviderMustOptIn(t *testing.T) {
	h := subagentTestHarness(t)
	parent := capacityParent(t, h, "missing-gate-parent")
	provider := structuredMissingGateProvider{activationProbeProvider: activationProbeProvider{prepareActivation: func(ctx context.Context, request SubagentRequest) (SubagentContinuationProviderRun, error) {
		child, err := h.Agents().Create(ctx, AgentOptions{ID: "missing-gate-child", Parent: parent, Delegated: true, DelegationDepth: 1, CWD: t.TempDir()})
		if err != nil {
			return SubagentContinuationProviderRun{}, err
		}
		return SubagentContinuationProviderRun{Child: child, ChildID: child.ID(), InitialMessageID: request.InitialPromptMessage().ID, Begin: func(context.Context) (<-chan TurnOutcome, error) {
			t.Error("opaque structured provider began")
			return nil, nil
		}, Submit: child.FollowupResultContext, Dispose: func(ctx context.Context) error { return h.Agents().RemoveExact(ctx, child) }, CaptureStructured: func() any { return map[string]any{"answer": 42} }}, nil
	}}}
	capacityRegister(t, h, provider)
	_, err := h.Subagents().StartActivation(activationTestContext(t), provider.Name(), SubagentRequest{Parent: parent, Prompt: "structured", MaxDepth: 2, OutputSchema: []byte(`{"type":"object","properties":{"answer":{"type":"integer"}},"required":["answer"]}`)}, "caller")
	assertSubagentControlCode(t, err, "UNSUPPORTED_CAPABILITY")
	if _, ok := h.Agents().Get("missing-gate-child"); ok {
		t.Fatal("rejected custom gate left a live child")
	}
}

// Commit ordinals are observed synchronously inside InboxInserted, so this
// regression cannot pass merely because the stale A watcher ran late. The
// blocked B model additionally verifies the user-visible ListChildren snapshot.
func TestManagedAdmissionReentrantCommitOrderKeepsLatestRunning(t *testing.T) {
	for _, structured := range []bool{false, true} {
		t.Run(map[bool]string{false: "ordinary", true: "structured"}[structured], func(t *testing.T) {
			testManagedAdmissionReentrantCommitOrder(t, structured)
		})
	}
}

func testManagedAdmissionReentrantCommitOrder(t *testing.T, structured bool) {
	ctx := activationTestContext(t)
	firstEntered, releaseFirst, bEntered := make(chan struct{}, 1), make(chan struct{}), make(chan struct{}, 1)
	var calls atomic.Int32
	h, err := Boot(ctx, Options{EnableSubagents: true, Adapter: AdapterFunc(func(ctx context.Context, _ GenerateRequest, _ func(StreamChunk) error) (Completion, error) {
		switch calls.Add(1) {
		case 1:
			firstEntered <- struct{}{}
			select {
			case <-releaseFirst:
			case <-ctx.Done():
				return Completion{}, ctx.Err()
			}
		case 3:
			bEntered <- struct{}{}
			<-ctx.Done()
			return Completion{}, ctx.Err()
		}
		return Completion{Message: Message{Role: RoleAssistant, Content: []ContentBlock{{Type: BlockText, Text: "done"}}}, Finish: FinishStop}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(releaseFirst) }) }
	defer func() { unblock(); _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) }()
	parent := capacityParent(t, h, "commit-order-parent")
	provider := structuredMissingGateProvider{activationProbeProvider: activationProbeProvider{prepareActivation: func(ctx context.Context, request SubagentRequest) (SubagentContinuationProviderRun, error) {
		child, err := h.Agents().Create(ctx, AgentOptions{ID: "commit-order-child", Parent: parent, Delegated: true, DelegationDepth: 1, CWD: t.TempDir()})
		if err != nil {
			return SubagentContinuationProviderRun{}, err
		}
		if !structured {
			return SubagentContinuationProviderRun{Child: child, ChildID: child.ID(), InitialMessageID: request.InitialPromptMessage().ID, Begin: func(ctx context.Context) (<-chan TurnOutcome, error) {
				return child.AdmitDSHMessage(ctx, request.InitialPromptMessage(), InboxNextTurn)
			}, Submit: child.FollowupResultContext, Dispose: func(ctx context.Context) error { return h.Agents().RemoveExact(ctx, child) }}, nil
		}
		gate, err := NewSubagentStructuredAdmission(h.Subagents(), child, request.InitialPromptMessage().ID)
		if err != nil {
			return SubagentContinuationProviderRun{}, err
		}
		return SubagentContinuationProviderRun{Child: child, ChildID: child.ID(), InitialMessageID: request.InitialPromptMessage().ID, Begin: func(ctx context.Context) (<-chan TurnOutcome, error) {
			return gate.AdmitDSHMessage(ctx, request.InitialPromptMessage(), InboxNextTurn)
		}, Submit: child.FollowupResultContext, Dispose: func(ctx context.Context) error { return h.Agents().RemoveExact(ctx, child) }, CaptureStructured: func() any { return map[string]any{"answer": 42} }, StructuredAdmission: gate}, nil
	}}}
	ordinals := make(chan uint64, 2)
	nested := make(chan error, 1)
	mountRetirementHooks(t, h, func(run *point.Run) error {
		if _, err := h.Subagents().RegisterProvider(run, provider); err != nil {
			return err
		}
		_, err := h.Hooks().InboxInserted.On(run, func(ctx context.Context, in InboxInsertedInput) error {
			if in.Message.ID != "A" && in.Message.ID != "B" {
				return nil
			}
			h.Subagents().mu.RLock()
			record := h.Subagents().records[in.Agent.ID()]
			epoch := record.epoch
			h.Subagents().mu.RUnlock()
			ordinals <- epoch
			if in.Message.ID == "A" {
				_, err := h.Subagents().DeliverSubagentPrompt(ctx, parent, in.Agent.ID(), Message{ID: "B", Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: "B"}}}, "queue")
				nested <- err
			}
			return nil
		})
		return err
	})
	var schema []byte
	if structured {
		schema = []byte(`{"type":"object","properties":{"answer":{"type":"integer"}},"required":["answer"]}`)
	}
	activation, err := h.Subagents().StartActivation(ctx, provider.Name(), SubagentRequest{Parent: parent, Prompt: "initial", MaxDepth: 2, OutputSchema: schema}, "caller")
	if err != nil {
		t.Fatal(err)
	}
	activationReceive(t, ctx, firstEntered)
	if _, err = h.Subagents().DeliverSubagentPrompt(ctx, parent, activation.ChildID, Message{ID: "A", Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: "A"}}}, "queue"); err != nil {
		t.Fatal(err)
	}
	if err = activationReceive(t, ctx, nested); err != nil {
		t.Fatal(err)
	}
	if a, b := activationReceive(t, ctx, ordinals), activationReceive(t, ctx, ordinals); a != 2 || b != 3 {
		t.Fatalf("durable commit ordinals A=%d B=%d; want 2,3", a, b)
	}
	unblock()
	activationReceive(t, ctx, bEntered)
	rows := h.Subagents().ListChildren(parent, false)
	if len(rows) != 1 || rows[0].Status != SubagentRunning || !rows[0].FinishedAt.IsZero() {
		t.Fatalf("A completion overwrote B's running snapshot: %+v", rows)
	}
	if err = activation.RequestDispose(); err != nil && !errors.Is(err, ErrSubagentActivationDisposalPending) {
		t.Fatal(err)
	}
	if err = activation.Wait(ctx); err != nil {
		t.Fatal(err)
	}
}

type structuredBlockingAttachments struct {
	AttachmentStore
	entered chan struct{}
}

func (s structuredBlockingAttachments) SaveImages(ctx context.Context, _ []SaveImageAttachment) ([]ImageAttachmentRef, error) {
	s.entered <- struct{}{}
	<-ctx.Done()
	return nil, ctx.Err()
}

func TestStructuredAdmissionReservationBlocksCaptureBeforeMutationLocks(t *testing.T) {
	gate, _, record := structuredGateFixture(t)
	entered := make(chan struct{}, 1)
	record.child.attachments = structuredBlockingAttachments{entered: entered}
	ctx, cancel := context.WithCancel(activationTestContext(t))
	defer cancel()
	finished := make(chan error, 1)
	go func() {
		_, err := gate.AdmitDSHMessage(ctx, Message{ID: "preparing-image", Role: RoleUser, Content: []ContentBlock{{Type: BlockImage, MIMEType: "image/png", Data: []byte("fixture")}}}, InboxNextTurn)
		finished <- err
	}()
	activationReceive(t, ctx, entered)
	// No durable mutation or Agent admission lock has started. A bool check
	// followed by an unlocked stage would incorrectly succeed at this barrier.
	if _, err := gate.BeginCapture(); !errors.Is(err, ErrSubagentCannotComplete) {
		t.Fatalf("pre-source input reservation did not exclude capture: %v", err)
	}
	if pending := record.child.PendingDurableInbox(InboxNextTurn); len(pending) != 0 {
		t.Fatal("attachment preparation became accepted input")
	}
	cancel()
	err := activationReceive(t, activationTestContext(t), finished)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("pre-source cancellation=%v", err)
	}
	release, err := gate.BeginCapture()
	if err != nil {
		t.Fatalf("rolled-back source preparation left gate closed: %v", err)
	}
	release()
}
