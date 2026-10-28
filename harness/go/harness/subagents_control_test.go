package harness

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"

	point "github.com/phodal/pero/harness/go/runtime"
)

func assertSubagentControlCode(t *testing.T, err error, code string) {
	t.Helper()
	var coded interface{ ToolErrorCode() string }
	if !errors.As(err, &coded) || coded.ToolErrorCode() != code {
		t.Fatalf("code=%s error=%v", code, err)
	}
}

func TestSubagentProtocolPromptPreservesQueueSteerAndAcceptedSource(t *testing.T) {
	ctx := activationTestContext(t)
	entered := make(chan struct{}, 4)
	h, err := Boot(ctx, Options{EnableSubagents: true, Adapter: AdapterFunc(func(ctx context.Context, req GenerateRequest, _ func(StreamChunk) error) (Completion, error) {
		if req.Agent != nil && req.Agent.Parent() != nil {
			entered <- struct{}{}
		}
		<-ctx.Done()
		return Completion{}, ctx.Err()
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Dispose(context.Background())
	parent := capacityParent(t, h, "protocol-parent")
	provider := &capacityLocalProvider{h: h}
	capacityRegister(t, h, provider)
	inserted := make(chan InboxInsertedInput, 2)
	mountSubagentControlObserver(t, h, func(run *point.Run) error {
		_, err := h.Hooks().InboxInserted.On(run, func(_ context.Context, in InboxInsertedInput) error {
			var source struct {
				RPCID string `json:"rpcId"`
			}
			_ = json.Unmarshal(in.Message.Source, &source)
			if source.RPCID != "" {
				inserted <- in
			}
			return nil
		})
		return err
	})
	activation := capacityStart(t, h, parent, provider.Name(), "caller")
	awaitDescendantSignal(t, ctx, entered)
	child, _ := h.Agents().Get(activation.ChildID)
	for _, mode := range []string{"queue", "steer"} {
		source := json.RawMessage(fmt.Sprintf(`{"kind":"user","rpcId":"browser-%s","clientTimeZone":"UTC"}`, mode))
		message := Message{Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: mode}}, Source: source}
		admission, cancel := context.WithCancel(ctx)
		id, err := h.Subagents().DeliverSubagentPrompt(admission, parent, activation.ChildID, message, mode)
		cancel() // An accepted queued turn has its own lifetime.
		if err != nil || id == "" {
			t.Fatalf("admission=%s %v", id, err)
		}
		in := activationReceive(t, ctx, inserted)
		target := InboxNextTurn
		if mode == "steer" {
			target = InboxNextStep
		}
		if in.Agent != child || in.Target != target || in.Message.ID != id || string(in.Message.Source) != string(source) || len(in.Message.Content) != 1 || in.Message.Content[0].Text != mode || !in.UserAuthored {
			t.Fatalf("mode=%s inserted=%+v", mode, in)
		}
	}
	if len(child.PendingDurableInbox(InboxNextTurn)) == 0 || len(child.PendingDurableInbox(InboxNextStep)) == 0 {
		t.Fatal("caller cancellation discarded accepted protocol input")
	}
	capacityDispose(t, activation)
}

func TestSubagentProtocolPromptRejectsForeignOwnerAndTextOnlyImages(t *testing.T) {
	ctx := activationTestContext(t)
	h, err := Boot(ctx, Options{EnableSubagents: true, Adapter: AdapterFunc(func(ctx context.Context, _ GenerateRequest, _ func(StreamChunk) error) (Completion, error) {
		<-ctx.Done()
		return Completion{}, ctx.Err()
	}),
		ModelInfo: ModelInfoResolverFunc(func(context.Context, string, string) (ModelInfo, error) {
			return ModelInfo{Provider: "fixed", Model: "text", InputModalities: []string{"text"}}, nil
		}),
	})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Dispose(context.Background())
	parent, foreign := capacityParent(t, h, "image-parent"), capacityParent(t, h, "image-foreign")
	provider := &capacityLocalProvider{h: h}
	capacityRegister(t, h, provider)
	activation := capacityStart(t, h, parent, provider.Name(), "caller")
	child, _ := h.Agents().Get(activation.ChildID)
	if _, err := child.Session().Append("session/model-selected", AgentModelSelection{Provider: "fixed", Model: "text"}); err != nil {
		t.Fatal(err)
	}
	_, err = h.Subagents().DeliverSubagentPrompt(ctx, foreign, activation.ChildID, Message{Content: []ContentBlock{{Type: BlockText, Text: "forged"}}}, "queue")
	assertSubagentControlCode(t, err, "UNAUTHORIZED")
	before := child.pendingPrompts.Load()
	_, err = h.Subagents().DeliverSubagentPrompt(ctx, parent, activation.ChildID, Message{Content: []ContentBlock{{Type: BlockImage, Data: []byte("unmaterialized")}}}, "steer")
	assertSubagentControlCode(t, err, "MODEL_DOES_NOT_SUPPORT_IMAGES")
	if child.pendingPrompts.Load() != before {
		t.Fatal("rejected image reached inbox")
	}
	capacityDispose(t, activation)
}

func TestSubagentInterruptExternalExactAuthorityAndGeneration(t *testing.T) {
	h := subagentTestHarness(t)
	ctx := activationTestContext(t)
	parent, foreign := capacityParent(t, h, "interrupt-parent"), capacityParent(t, h, "interrupt-foreign")
	var cancels atomic.Int32
	cleanupEntered, cleanupRelease := make(chan struct{}), make(chan struct{})
	var once sync.Once
	release := func() { once.Do(func() { close(cleanupRelease) }) }
	defer release()
	provider := retirementSubagentProvider{prepare: func(context.Context, SubagentRequest) (SubagentProviderRun, error) {
		return SubagentProviderRun{ChildID: "interrupt-external", Result: make(chan SubagentResult), Begin: func() {}, Cancel: func(error) { cancels.Add(1) }, Dispose: func(context.Context) error { close(cleanupEntered); <-cleanupRelease; return nil }}, nil
	}}
	capacityRegister(t, h, provider)
	activation := capacityStart(t, h, parent, provider.Name(), "caller")
	r := h.Subagents()
	r.mu.RLock()
	runID := r.records[activation.ChildID].activation.runID
	r.mu.RUnlock()
	if err := r.InterruptDSH(parent, ""); err != nil {
		t.Fatal(err)
	}
	if err := r.InterruptDSH(parent, " "); err != nil {
		t.Fatal(err)
	}
	assertSubagentControlCode(t, r.Interrupt(parent, ""), "UNAUTHORIZED")
	assertSubagentControlCode(t, r.InterruptDSH(nil, ""), "UNAUTHORIZED")
	assertSubagentControlCode(t, r.InterruptDSH(&Agent{session: parent.Session()}, ""), "UNAUTHORIZED")
	assertSubagentControlCode(t, r.InterruptDSH(foreign, activation.ChildID), "UNAUTHORIZED")
	assertSubagentControlCode(t, r.Interrupt(foreign, activation.ChildID), "UNAUTHORIZED")
	assertSubagentControlCode(t, r.Interrupt(&Agent{session: parent.Session()}, activation.ChildID), "UNAUTHORIZED")
	assertSubagentControlCode(t, r.Interrupt(parent, parent.ID()), "UNAUTHORIZED")
	assertSubagentControlCode(t, r.InterruptByParentID(foreign.ID(), activation.ChildID), "UNAUTHORIZED")
	if err := r.InterruptActivation(parent, activation.ChildID, runID+"-stale"); err != nil {
		t.Fatal(err)
	}
	if cancels.Load() != 0 {
		t.Fatal("unauthorized or stale generation canceled provider")
	}
	if err := r.InterruptActivationByParentID(parent.ID(), activation.ChildID, runID); err != nil {
		t.Fatal(err)
	}
	if cancels.Load() == 0 {
		t.Fatal("interrupt returned before issuing cancellation")
	}
	awaitDescendantSignal(t, ctx, cleanupEntered)
	select {
	case <-activation.Done:
		t.Fatal("external interrupt joined held cleanup")
	default:
	}
	release()
	if err := activation.Wait(ctx); err != nil {
		t.Fatal(err)
	}
	if err := r.InterruptByParentID("unrelated", activation.ChildID); err != nil {
		t.Fatalf("absent target must no-op: %v", err)
	}
}

func TestSubagentInterruptFacadeCannotAdoptAnotherGeneration(t *testing.T) {
	h := subagentTestHarness(t)
	ctx := activationTestContext(t)
	parent := capacityParent(t, h, "interrupt-facade-parent")
	provider := &capacityExternalProvider{name: "interrupt-facade"}
	capacityRegister(t, h, provider)
	first, second := facadeForTest(t, h, 2), facadeForTest(t, h, 2)
	activation := facadeStart(t, first, parent, provider.Name())
	r := h.Subagents()
	r.mu.RLock()
	runID := r.records[activation.ChildID].activation.runID
	r.mu.RUnlock()
	if err := second.InterruptActivation(parent, activation.ChildID, runID); err != nil {
		t.Fatal(err)
	}
	select {
	case <-activation.Done:
		t.Fatal("foreign facade adopted activation")
	default:
	}
	if err := first.InterruptActivation(parent, activation.ChildID, runID); err != nil {
		t.Fatal(err)
	}
	if err := activation.Wait(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestSubagentProtocolPromptCannotAdoptAnotherFacade(t *testing.T) {
	h := capacityBlockingHarness(t)
	ctx := activationTestContext(t)
	parent := capacityParent(t, h, "protocol-facade-parent")
	provider := &capacityLocalProvider{h: h}
	capacityRegister(t, h, provider)
	owner, other := facadeForTest(t, h, 2), facadeForTest(t, h, 2)
	activation := facadeStart(t, owner, parent, provider.Name())
	operation, release, err := other.BeginOperation(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, err = h.Subagents().DeliverSubagentPrompt(operation, parent, activation.ChildID, Message{Content: []ContentBlock{{Type: BlockText, Text: "foreign service"}}}, "queue")
	release()
	assertSubagentControlCode(t, err, "UNAUTHORIZED")
	capacityDispose(t, activation)
}

func TestSubagentProtocolPromptAcceptedReceiptSurvivesObserverRetirement(t *testing.T) {
	ctx := activationTestContext(t)
	h, err := Boot(ctx, Options{EnableSubagents: true, Adapter: AdapterFunc(func(ctx context.Context, _ GenerateRequest, _ func(StreamChunk) error) (Completion, error) {
		<-ctx.Done()
		return Completion{}, ctx.Err()
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Dispose(context.Background())
	parent := capacityParent(t, h, "accepted-observer-parent")
	provider := &capacityLocalProvider{h: h}
	capacityRegister(t, h, provider)
	activation := capacityStart(t, h, parent, provider.Name(), "caller")
	child, _ := h.Agents().Get(activation.ChildID)
	removed := make(chan error, 1)
	mountSubagentControlObserver(t, h, func(run *point.Run) error {
		_, err := h.Hooks().InboxInserted.On(run, func(_ context.Context, in InboxInsertedInput) error {
			if in.Agent == child && in.Message.ID == "accepted-before-retirement" {
				removed <- h.Agents().RemoveExact(context.Background(), child)
			}
			return nil
		})
		return err
	})
	id, err := h.Subagents().DeliverSubagentPrompt(ctx, parent, child.ID(), Message{ID: "accepted-before-retirement", Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: "keep accepted identity"}}, Source: json.RawMessage(`{"kind":"user","rpcId":"observer-rpc"}`)}, "queue")
	if err != nil || id != "accepted-before-retirement" {
		t.Fatalf("committed receipt=%q %v", id, err)
	}
	if err := activationReceive(t, ctx, removed); !errors.Is(err, ErrAgentDisposalInProgress) {
		t.Fatalf("observer removal=%v", err)
	}
	if err := activation.Wait(ctx); err != nil {
		t.Fatal(err)
	}
	if err := h.Agents().WaitRetired(ctx, child); err != nil {
		t.Fatal(err)
	}
	if _, live := h.Agents().Get(child.ID()); live {
		t.Fatal("accepted receipt retained retired Agent")
	}
}

func TestSubagentProtocolPromptFacadeCannotRelayForeignChild(t *testing.T) {
	h := capacityBlockingHarness(t)
	ctx := activationTestContext(t)
	parent := capacityParent(t, h, "relay-facade-parent")
	provider := &capacityLocalProvider{h: h}
	capacityRegister(t, h, provider)
	owner, other := facadeForTest(t, h, 2), facadeForTest(t, h, 2)
	activation := facadeStart(t, owner, parent, provider.Name())
	child, _ := h.Agents().Get(activation.ChildID)
	observed := make(chan InboxInsertedInput, 2)
	mountSubagentControlObserver(t, h, func(run *point.Run) error {
		_, err := h.Hooks().InboxInserted.On(run, func(_ context.Context, in InboxInsertedInput) error {
			if in.Agent == parent {
				observed <- in
			}
			return nil
		})
		return err
	})
	foreign, release, err := other.BeginOperation(ctx)
	if err != nil {
		t.Fatal(err)
	}
	id, err := h.Subagents().SendMessage(foreign, child, parent.ID(), []ContentBlock{{Type: BlockText, Text: "foreign relay"}})
	release()
	assertSubagentControlCode(t, err, "UNAUTHORIZED")
	if id != "" {
		t.Fatal("unauthorized relay received an accepted identity")
	}
	select {
	case in := <-observed:
		t.Fatalf("foreign facade reached parent inbox: %+v", in)
	default:
	}
	owned, release, err := owner.BeginOperation(ctx)
	if err != nil {
		t.Fatal(err)
	}
	id, err = h.Subagents().SendMessage(owned, child, parent.ID(), []ContentBlock{{Type: BlockText, Text: "owned relay"}})
	release()
	if err != nil || id == "" {
		t.Fatalf("owner relay=%q %v", id, err)
	}
	if in := activationReceive(t, ctx, observed); in.Message.ID != id {
		t.Fatalf("owner accepted identity=%q want=%q", in.Message.ID, id)
	}
	capacityDispose(t, activation)
}

// Provider setup already owns the shared retirement fixture entry. Keep this
// independent observer lifetime separate without replacing provider hooks.
func mountSubagentControlObserver(t *testing.T, h *Harness, apply func(*point.Run) error) {
	t.Helper()
	const entry = "test/subagent-control-observer"
	definition := point.Define(point.Descriptor{ID: entry}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) { return nil, apply(run) })
	instance, err := h.Runtime().Mount(nil, entry, definition, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = instance.Dispose(context.Background()) })
	if err := instance.WaitStable(t.Context()); err != nil {
		t.Fatal(err)
	}
	if instance.Snapshot().State == point.Failed {
		t.Fatal(instance.Snapshot().LastError)
	}
}

func TestSubagentInterruptDSHEmptyRequiresCurrentCaller(t *testing.T) {
	h := subagentTestHarness(t)
	ctx := activationTestContext(t)
	parent := capacityParent(t, h, "empty-interrupt-parent")
	registry := h.Subagents()
	if err := registry.InterruptDSH(parent, ""); err != nil {
		t.Fatal(err)
	}
	if err := h.Agents().Remove(ctx, parent.ID()); err != nil {
		t.Fatal(err)
	}
	assertSubagentControlCode(t, registry.InterruptDSH(parent, ""), "UNAUTHORIZED")
	// Remove retires the Agent identity but retains its Session. Resume that
	// exact Session to exercise a new live identity at the same session ID.
	replacement, err := h.Agents().Resume(ctx, parent.Session(), AgentOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if replacement == parent || replacement.ID() != parent.ID() || replacement.Session() != parent.Session() {
		t.Fatal("resume did not replace the Agent identity on the existing Session")
	}
	assertSubagentControlCode(t, registry.InterruptDSH(parent, ""), "UNAUTHORIZED")
	if err := registry.InterruptDSH(replacement, ""); err != nil {
		t.Fatal(err)
	}
	registry.mu.RLock()
	records := len(registry.records)
	registry.mu.RUnlock()
	if records != 0 {
		t.Fatalf("empty interrupt created records: %d", records)
	}
	var absent *SubagentRegistry
	assertSubagentControlCode(t, absent.InterruptDSH(replacement, ""), "UNAUTHORIZED")
	closed := &SubagentRegistry{disposed: true, agents: h.Agents()}
	assertSubagentControlCode(t, closed.InterruptDSH(replacement, ""), "UNAUTHORIZED")
}

func TestSubagentSendMessageDSHEmptyPreservesAdmission(t *testing.T) {
	h := subagentTestHarness(t)
	ctx := activationTestContext(t)
	parent := capacityParent(t, h, "empty-send-parent")
	registry := h.Subagents()
	provider := &capacityLocalProvider{h: h}
	capacityRegister(t, h, provider)
	content := []ContentBlock{{Type: BlockText, Text: ""}}
	assertKind := func(err error, want SubagentSendFailureKind) {
		t.Helper()
		kind, known := DSHSubagentSendFailure(err)
		if !known || kind != want {
			t.Fatalf("failure kind=%d/%t want=%d err=%v", kind, known, want, err)
		}
	}
	before := len(parent.Session().Events())
	id, err := registry.SendMessageDSH(ctx, parent, "", content)
	if id != "" {
		t.Fatalf("failed send returned receipt %q", id)
	}
	assertKind(err, SubagentSendTargetUnavailable)
	if _, legacy := registry.SendMessage(ctx, parent, "", content); legacy == nil || legacy.Error() != "harness: adjacent-agent message requires sender, target, and content" {
		t.Fatalf("legacy empty send changed: %v", legacy)
	} else if _, known := DSHSubagentSendFailure(legacy); known {
		t.Fatal("legacy send acquired a DSH diagnostic")
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := registry.SendMessageDSH(cancelled, parent, "", content); err != context.Canceled {
		t.Fatalf("empty target displaced cancellation: %v", err)
	}
	if _, err := registry.SendMessageDSH(ctx, nil, "", content); err == nil {
		t.Fatal("nil sender accepted")
	}
	if _, err := registry.SendMessageDSH(ctx, parent, "", nil); err == nil {
		t.Fatal("empty content accepted")
	}
	_, err = registry.SendMessageDSH(ctx, &Agent{id: parent.ID(), session: parent.Session()}, "", content)
	assertKind(err, SubagentSendSenderNotLive)
	if len(parent.Session().Events()) != before {
		t.Fatal("empty send changed the parent log")
	}
	if err := h.Agents().Remove(ctx, parent.ID()); err != nil {
		t.Fatal(err)
	}
	_, err = registry.SendMessageDSH(ctx, parent, "", content)
	assertKind(err, SubagentSendSenderNotLive)
	assertSubagentControlCode(t, err, "UNAUTHORIZED")
	replacement, err := h.Agents().Resume(ctx, parent.Session(), AgentOptions{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = registry.SendMessageDSH(ctx, parent, "", content)
	assertKind(err, SubagentSendSenderNotLive)
	_, err = registry.SendMessageDSH(ctx, replacement, "", content)
	assertKind(err, SubagentSendTargetUnavailable)
	var absent *SubagentRegistry
	if _, err := absent.SendMessageDSH(ctx, replacement, "", content); err == nil {
		t.Fatal("nil registry accepted")
	}
	closed := &SubagentRegistry{disposed: true, agents: h.Agents()}
	if _, err := closed.SendMessageDSH(ctx, replacement, "", content); err == nil {
		t.Fatal("disposed registry accepted")
	}
	registry.mu.RLock()
	records := len(registry.records)
	registry.mu.RUnlock()
	if records != 0 || provider.resumes.Load() != 0 || provider.next.Load() != 0 {
		t.Fatalf("rejected empty send had effects: records=%d resume=%d prepare=%d events=%d/%d", records, provider.resumes.Load(), provider.next.Load(), len(parent.Session().Events()), before)
	}
}

type sendDiagnosticProvider struct {
	capacityLocalProvider
	resume func(context.Context, *Agent, SessionID) error
}

func (p *sendDiagnosticProvider) PrepareResume(ctx context.Context, parent *Agent, target SessionID) (SubagentContinuationProviderRun, SubagentSnapshot, error) {
	return p.PrepareManagedResume(ctx, parent, target)
}

func (p *sendDiagnosticProvider) PrepareManagedResume(ctx context.Context, parent *Agent, target SessionID) (SubagentContinuationProviderRun, SubagentSnapshot, error) {
	return SubagentContinuationProviderRun{}, SubagentSnapshot{}, p.resume(ctx, parent, target)
}

func TestSubagentSendMessageDSHDiagnosticScopeAndOpaqueWrappers(t *testing.T) {
	h := subagentTestHarness(t)
	ctx := activationTestContext(t)
	parent := capacityParent(t, h, "send-diagnostic-parent")
	other := capacityParent(t, h, "send-diagnostic-other")
	registry := h.Subagents()
	content := []ContentBlock{{Type: BlockText, Text: "test"}}
	provider := &sendDiagnosticProvider{capacityLocalProvider: capacityLocalProvider{h: h}}
	capacityRegister(t, h, provider)
	// An inherited receipt with the identical address must still be disabled
	// by the ordinary entry. A resident foreign edge reaches a classified
	// rejection origin without reentering the cold-resume serialization lock.
	registry.mu.Lock()
	registry.records["resident-foreign"] = &subagentRecord{parent: other}
	registry.mu.Unlock()
	inherited := context.WithValue(ctx, dshSubagentSendContextKey{}, &dshSubagentSendInvocation{registry: registry, sender: parent, target: "resident-foreign"})
	_, ordinary := registry.SendMessage(inherited, parent, "resident-foreign", content)
	registry.mu.Lock()
	delete(registry.records, "resident-foreign")
	registry.mu.Unlock()
	if _, known := DSHSubagentSendFailure(ordinary); known {
		t.Fatal("ordinary same-address send inherited the DSH receipt")
	}
	assertSubagentControlCode(t, ordinary, "UNAUTHORIZED")
	original := &subagentActivationError{"SAFE_PROVIDER_FAILURE", "NOT_RESUMABLE"}
	if got := registry.ClassifyDSHSendFailure(ctx, parent, "missing", SubagentSendTargetUnavailable, original); got != original {
		t.Fatal("ordinary classification changed error identity")
	}
	for _, wrapped := range []bool{false, true} {
		t.Run(fmt.Sprint(wrapped), func(t *testing.T) {
			provider.resume = func(call context.Context, sender *Agent, target SessionID) error {
				for _, attempt := range []struct {
					registry *SubagentRegistry
					sender   *Agent
					target   SessionID
				}{
					{registry, other, target}, {registry, sender, "different"}, {&SubagentRegistry{}, sender, target},
				} {
					if got := attempt.registry.ClassifyDSHSendFailure(call, attempt.sender, attempt.target, SubagentSendTargetUnavailable, original); got != original {
						t.Fatal("unrelated operation inherited diagnostic receipt")
					}
				}
				// A reentrant ordinary send must shadow the DSH context even
				// when a provider deliberately reuses the received context.
				_, ordinary := registry.SendMessage(call, sender, "", content)
				if _, known := DSHSubagentSendFailure(ordinary); known || ordinary == nil {
					t.Fatalf("nested ordinary send inherited diagnostic: %v", ordinary)
				}
				differentPreparation := context.WithValue(call, subagentPreparationContextKey{}, &subagentPreparation{})
				if got := registry.ClassifyDSHSendFailure(differentPreparation, sender, target, SubagentSendTargetUnavailable, original); got != original {
					t.Fatal("same-address nested preparation inherited diagnostic receipt")
				}
				tagged := registry.ClassifyDSHSendFailure(call, sender, target, SubagentSendTargetUnavailable, original)
				if tagged.Error() != original.Error() || !errors.Is(tagged, original) {
					t.Fatal("classification changed cause or text")
				}
				assertSubagentControlCode(t, tagged, "NOT_RESUMABLE")
				if wrapped {
					return fmt.Errorf("SAFE_OUTER_POLICY: %w", tagged)
				}
				return tagged
			}
			_, err := registry.SendMessageDSH(ctx, parent, "missing", content)
			kind, known := DSHSubagentSendFailure(err)
			if known == wrapped || (!wrapped && kind != SubagentSendTargetUnavailable) {
				t.Fatalf("wrapper authority lost: %d/%t %v", kind, known, err)
			}
		})
	}
	provider.resume = func(context.Context, *Agent, SessionID) error { return original }
	_, err := registry.SendMessageDSH(ctx, parent, "missing", content)
	if err != original {
		t.Fatalf("unknown provider error replaced: %v", err)
	}
	if _, known := DSHSubagentSendFailure(err); known {
		t.Fatal("provider code alone selected DSH classification")
	}
}

func TestSubagentSendMessageDSHUnavailableAggregationIsExact(t *testing.T) {
	h := subagentTestHarness(t)
	parent := capacityParent(t, h, "send-aggregate-parent")
	registry := h.Subagents()
	provider := &sendDiagnosticProvider{capacityLocalProvider: capacityLocalProvider{h: h}}
	capacityRegister(t, h, provider)
	for _, opaque := range []bool{false, true} {
		provider.resume = func(ctx context.Context, sender *Agent, target SessionID) error {
			err := registry.ClassifyDSHSendFailure(ctx, sender, target, SubagentSendTargetUnavailable, ErrSubagentResumeUnavailable)
			if opaque {
				return fmt.Errorf("SAFE_OUTER_POLICY: %w", err)
			}
			return err
		}
		_, err := registry.SendMessageDSH(t.Context(), parent, "missing", []ContentBlock{{Type: BlockText, Text: "hello"}})
		kind, known := DSHSubagentSendFailure(err)
		if known == opaque || (!opaque && kind != SubagentSendTargetUnavailable) || !errors.Is(err, ErrSubagentResumeUnavailable) {
			t.Fatalf("aggregate changed wrapper/cause: %d/%t %v", kind, known, err)
		}
	}
}
