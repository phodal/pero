package harness

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	point "github.com/phodal/pero/harness/go/runtime"
)

func activationTestContext(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	t.Cleanup(cancel)
	return ctx
}

func activationReceive[T any](t *testing.T, ctx context.Context, ch <-chan T) T {
	t.Helper()
	select {
	case v, ok := <-ch:
		if !ok {
			t.Fatal("activation observation channel closed without a value")
		}
		return v
	case <-ctx.Done():
		t.Fatal(ctx.Err())
		var zero T
		return zero
	}
}

func TestSubagentActivationWaitsForExactCleanupAndRetainsFailure(t *testing.T) {
	h := subagentTestHarness(t)
	ctx := activationTestContext(t)
	parent, err := h.Agents().Create(ctx, AgentOptions{ID: "activation-cleanup-parent", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	terminal := make(chan SubagentResult, 1)
	entered, release := make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	defer unblock()
	expected := errors.New("provider cleanup failed after terminal output")
	var calls atomic.Int32
	provider := retirementSubagentProvider{prepare: func(context.Context, SubagentRequest) (SubagentProviderRun, error) {
		return SubagentProviderRun{ChildID: "activation-cleanup-child", Result: terminal, Begin: func() {}, Cancel: func(error) {}, Dispose: func(context.Context) error { calls.Add(1); close(entered); <-release; return expected }}, nil
	}}
	mountRetirementHooks(t, h, func(run *point.Run) error { _, err := h.Subagents().RegisterProvider(run, provider); return err })
	activation, err := h.Subagents().StartActivation(ctx, provider.Name(), SubagentRequest{Parent: parent, Prompt: "work", MaxDepth: 2}, "caller")
	if err != nil {
		t.Fatal(err)
	}
	terminal <- SubagentResult{ChildID: activation.ChildID, Status: SubagentCompleted, Reason: FinishStop, Output: []ContentBlock{{Type: BlockText, Text: "captured output"}}}
	close(terminal)
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	select {
	case result := <-activation.Result:
		t.Fatalf("published before teardown: %+v", result)
	default:
	}
	if err := activation.Dispose(context.Background()); !errors.Is(err, ErrSubagentActivationDisposalPending) {
		t.Fatalf("in-flight receipt=%v", err)
	}
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if err := activation.Wait(cancelled); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled waiter=%v", err)
	}
	unblock()
	result := activationReceive(t, ctx, activation.Result)
	if result.Status != SubagentFailed || result.Reason != FinishError || !strings.Contains(result.Diagnostic, expected.Error()) || len(result.Output) != 1 {
		t.Fatalf("terminal result=%+v", result)
	}
	if err := activation.Wait(ctx); !errors.Is(err, expected) {
		t.Fatalf("cleanup receipt=%v", err)
	}
	if err := activation.Dispose(ctx); !errors.Is(err, expected) || calls.Load() != 1 {
		t.Fatalf("repeated receipt=%v calls=%d", err, calls.Load())
	}
}

type activationProbeProvider struct {
	retirementSubagentProvider
	prepareActivation func(context.Context, SubagentRequest) (SubagentContinuationProviderRun, error)
}

func (p activationProbeProvider) PrepareContinuable(ctx context.Context, request SubagentRequest) (SubagentContinuationProviderRun, error) {
	return p.prepareActivation(ctx, request)
}
func (p activationProbeProvider) PrepareActivation(ctx context.Context, request SubagentRequest) (SubagentContinuationProviderRun, error) {
	return p.prepareActivation(ctx, request)
}

func TestSubagentActivationDisposalReentryReleasesSynchronousObservers(t *testing.T) {
	for _, phase := range []string{"started", "inbox-inserted", "parent-notice"} {
		t.Run(phase, func(t *testing.T) {
			if phase == "started" {
				testSubagentStartedObserverRetirement(t)
				return
			}
			ctx := activationTestContext(t)
			modelEntered := make(chan struct{})
			var enteredOnce sync.Once
			h, err := Boot(ctx, Options{EnableSubagents: true, Adapter: AdapterFunc(func(ctx context.Context, request GenerateRequest, _ func(StreamChunk) error) (Completion, error) {
				if request.Agent.Delegated() {
					enteredOnce.Do(func() { close(modelEntered) })
					<-ctx.Done()
					return Completion{}, ctx.Err()
				}
				return Completion{Message: Message{Role: RoleAssistant}, Finish: FinishStop}, nil
			})})
			if err != nil {
				t.Fatal(err)
			}
			defer h.Dispose(context.Background())
			parent, err := h.Agents().Create(ctx, AgentOptions{ID: "activation-reentrant-parent", CWD: t.TempDir()})
			if err != nil {
				t.Fatal(err)
			}
			var activation SubagentActivation
			observed := make(chan error, 1)
			var armed atomic.Bool
			var observedOnce sync.Once
			observe := func() {
				if armed.Load() {
					observedOnce.Do(func() { observed <- activation.Dispose(context.Background()) })
				}
			}
			terminal := make(chan SubagentResult, 1)
			var cleanupCalls atomic.Int32
			external := retirementSubagentProvider{prepare: func(context.Context, SubagentRequest) (SubagentProviderRun, error) {
				return SubagentProviderRun{ChildID: "activation-notice-child", Result: terminal, Begin: func() {}, Cancel: func(error) {}, Dispose: func(context.Context) error { cleanupCalls.Add(1); return nil }}, nil
			}}
			local := activationProbeProvider{retirementSubagentProvider: external, prepareActivation: func(ctx context.Context, request SubagentRequest) (SubagentContinuationProviderRun, error) {
				child, err := h.Agents().Create(ctx, AgentOptions{ID: "activation-local-child", Parent: parent, Delegated: true, DelegationDepth: 1, CWD: parent.Session().Header().CWD})
				if err != nil {
					return SubagentContinuationProviderRun{}, err
				}
				return SubagentContinuationProviderRun{ChildID: child.ID(), Child: child, InitialMessageID: request.InitialPromptMessage().ID,
					Begin: func(ctx context.Context) (<-chan TurnOutcome, error) {
						return child.FollowupResultContext(ctx, request.InitialPromptMessage())
					}, Submit: child.FollowupResultContext,
					Dispose: func(ctx context.Context) error { cleanupCalls.Add(1); return h.Agents().RemoveExact(ctx, child) }}, nil
			}}
			mountRetirementHooks(t, h, func(run *point.Run) error {
				var provider SubagentProvider = local
				if phase == "parent-notice" {
					provider = external
				}
				if _, err := h.Subagents().RegisterProvider(run, provider); err != nil {
					return err
				}
				_, err := h.Hooks().InboxInserted.On(run, func(_ context.Context, in InboxInsertedInput) error {
					if phase == "inbox-inserted" && in.Agent.Delegated() {
						observe()
					}
					if phase == "parent-notice" && in.Agent == parent && strings.Contains(string(in.Message.Source), "subagent-settled") {
						observe()
					}
					return nil
				})
				return err
			})
			delivery := "caller"
			if phase == "parent-notice" {
				delivery = "parent"
			}
			activation, err = h.Subagents().StartActivation(ctx, external.Name(), SubagentRequest{Parent: parent, Prompt: "wait", MaxDepth: 2}, delivery)
			if err != nil {
				t.Fatal(err)
			}
			armed.Store(true)
			if phase == "parent-notice" {
				terminal <- SubagentResult{ChildID: activation.ChildID, Status: SubagentCompleted, Reason: FinishStop}
				close(terminal)
			} else {
				select {
				case <-modelEntered:
				case <-ctx.Done():
					t.Fatal(ctx.Err())
				}
				_, _ = h.Subagents().SendMessage(ctx, parent, activation.ChildID, []ContentBlock{{Type: BlockText, Text: "reentrant steer"}})
			}
			if err := activationReceive(t, ctx, observed); !errors.Is(err, ErrSubagentActivationDisposalPending) {
				t.Fatalf("observer receipt=%v", err)
			}
			if err := activation.Wait(ctx); err != nil {
				t.Fatal(err)
			}
			result := activationReceive(t, ctx, activation.Result)
			if phase != "parent-notice" && result.Status != SubagentAborted {
				t.Fatalf("disposed terminal=%+v", result)
			}
			if cleanupCalls.Load() != 1 {
				t.Fatalf("provider cleanup calls=%d", cleanupCalls.Load())
			}
			if _, exists := h.Agents().Get(activation.ChildID); exists {
				t.Fatal("retired activation remains resident")
			}
		})
	}
}

// Managed input does not emit another activation Started event. Exercise the
// actual initial Started callback, before Begin or any inbox acceptance, rather
// than relying on the legacy followup path to fabricate a second announcement.
func testSubagentStartedObserverRetirement(t *testing.T) {
	ctx := activationTestContext(t)
	var modelCalls, beginCalls, cleanupCalls, starts, ends atomic.Int32
	h, err := Boot(ctx, Options{EnableSubagents: true, Adapter: AdapterFunc(func(context.Context, GenerateRequest, func(StreamChunk) error) (Completion, error) {
		modelCalls.Add(1)
		return Completion{Message: Message{Role: RoleAssistant}, Finish: FinishStop}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) }()
	parent, err := h.Agents().Create(ctx, AgentOptions{ID: "started-disposal-parent", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	provider := activationProbeProvider{prepareActivation: func(ctx context.Context, request SubagentRequest) (SubagentContinuationProviderRun, error) {
		child, err := h.Agents().Create(ctx, AgentOptions{ID: "started-disposal-child", Parent: parent, Delegated: true, DelegationDepth: 1, CWD: parent.Session().Header().CWD})
		if err != nil {
			return SubagentContinuationProviderRun{}, err
		}
		return SubagentContinuationProviderRun{ChildID: child.ID(), Child: child, InitialMessageID: request.InitialPromptMessage().ID,
			Begin: func(ctx context.Context) (<-chan TurnOutcome, error) {
				beginCalls.Add(1)
				return child.FollowupResultContext(ctx, request.InitialPromptMessage())
			}, Submit: child.FollowupResultContext,
			Dispose: func(ctx context.Context) error { cleanupCalls.Add(1); return h.Agents().RemoveExact(ctx, child) }}, nil
	}}
	r := h.Subagents()
	var record *subagentRecord
	var disposeErr, followupErr error
	var followupID, startedRunID string
	var inserted atomic.Int32
	mountRetirementHooks(t, h, func(run *point.Run) error {
		if _, err := r.RegisterProvider(run, provider); err != nil {
			return err
		}
		if _, err := r.Started.On(run, func(ctx context.Context, info SubagentLifecycle) error {
			starts.Add(1)
			startedRunID = info.RunID
			r.mu.RLock()
			record = r.records[info.ID]
			r.mu.RUnlock()
			if !info.Managed || record == nil || record.child != info.Child {
				return errors.New("Started did not identify its exact managed child")
			}
			// This is the exact callback used by the public activation handle's
			// Dispose; the initial handle cannot be returned until Started exits.
			disposeErr = r.disposeActivation(context.Background(), record)
			r.mu.RLock()
			withdrawn := r.records[info.ID] != record
			r.mu.RUnlock()
			if !record.activation.closing.Load() || !withdrawn {
				return errors.New("Started disposal did not revoke the exact activation before followup")
			}
			followupID, followupErr = r.FollowupMessage(ctx, parent, info.ID, Message{ID: "after-started-retirement", Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: "must reject"}}})
			return nil
		}); err != nil {
			return err
		}
		if _, err := r.Ended.On(run, func(_ context.Context, info SubagentLifecycle) error {
			ends.Add(1)
			if !info.Managed || info.RunID != startedRunID {
				return errors.New("terminal lifecycle lost exact activation identity")
			}
			return nil
		}); err != nil {
			return err
		}
		_, err := h.Hooks().InboxInserted.On(run, func(_ context.Context, in InboxInsertedInput) error {
			if in.Agent.ID() == "started-disposal-child" {
				inserted.Add(1)
			}
			return nil
		})
		return err
	})
	activation, err := r.StartActivation(ctx, provider.Name(), SubagentRequest{Parent: parent, Prompt: "never admitted", MaxDepth: 2}, "caller")
	if err == nil || activation.ChildID != "" || activation.MessageID != "" {
		t.Fatalf("retired Started child received an accepted activation: %+v %v", activation, err)
	}
	if !errors.Is(disposeErr, ErrSubagentActivationDisposalPending) || record == nil {
		t.Fatalf("Started disposal receipt=%v record=%v", disposeErr, record)
	}
	if followupErr == nil || followupID != "" {
		t.Fatalf("actually retired child accepted followup: id=%q error=%v", followupID, followupErr)
	}
	if err := record.activation.wait(ctx); err != nil {
		t.Fatal(err)
	}
	result := activationReceive(t, ctx, record.activation.result)
	if result.Status != SubagentAborted || result.ChildID != record.child.ID() || cleanupCalls.Load() != 1 || starts.Load() != 1 || ends.Load() != 1 {
		t.Fatalf("exact retirement result=%+v cleanup=%d start/end=%d/%d", result, cleanupCalls.Load(), starts.Load(), ends.Load())
	}
	if beginCalls.Load() != 0 || modelCalls.Load() != 0 || inserted.Load() != 0 || len(record.child.PendingDurableInbox(InboxNextTurn)) != 0 {
		t.Fatal("pre-admission retirement executed or accepted child input")
	}
	if _, exists := h.Agents().Get(record.child.ID()); exists {
		t.Fatal("retired Started child remains resident")
	}
}

func TestSubagentActivationDisposesProviderWithoutTerminalResult(t *testing.T) {
	for _, nonblocking := range []bool{false, true} {
		name := "join"
		if nonblocking {
			name = "request"
		}
		t.Run(name, func(t *testing.T) {
			h := subagentTestHarness(t)
			ctx := activationTestContext(t)
			parent, err := h.Agents().Create(ctx, AgentOptions{ID: "missing-result-parent", CWD: t.TempDir()})
			if err != nil {
				t.Fatal(err)
			}
			var disposals atomic.Int32
			provider := retirementSubagentProvider{prepare: func(context.Context, SubagentRequest) (SubagentProviderRun, error) {
				return SubagentProviderRun{ChildID: "missing-result-child", Result: make(chan SubagentResult), Begin: func() {}, Cancel: func(error) {}, Dispose: func(context.Context) error { disposals.Add(1); return nil }}, nil
			}}
			mountRetirementHooks(t, h, func(run *point.Run) error { _, err := h.Subagents().RegisterProvider(run, provider); return err })
			activation, err := h.Subagents().StartActivation(ctx, provider.Name(), SubagentRequest{Parent: parent, Prompt: "work", MaxDepth: 2}, "caller")
			if err != nil {
				t.Fatal(err)
			}
			if nonblocking {
				if err := activation.RequestDispose(); !errors.Is(err, ErrSubagentActivationDisposalPending) {
					t.Fatalf("nonblocking disposal receipt=%v", err)
				}
				if err := activation.Wait(ctx); err != nil {
					t.Fatal(err)
				}
			} else if err := activation.Dispose(ctx); err != nil {
				t.Fatal(err)
			}
			if result := activationReceive(t, ctx, activation.Result); result.Status != SubagentAborted || result.Reason != FinishAborted {
				t.Fatalf("result=%+v", result)
			}
			if err := activation.Dispose(ctx); err != nil || disposals.Load() != 1 {
				t.Fatalf("repeat=%v calls=%d", err, disposals.Load())
			}
		})
	}
}

func activationLocalTestProvider(h *Harness, id SessionID, configure func(*Agent) error) activationProbeProvider {
	return activationProbeProvider{prepareActivation: func(ctx context.Context, request SubagentRequest) (SubagentContinuationProviderRun, error) {
		child, err := h.Agents().Create(ctx, AgentOptions{ID: id, Parent: request.Parent, Delegated: true, DelegationDepth: request.Depth, CWD: request.Parent.Session().Header().CWD})
		if err != nil {
			return SubagentContinuationProviderRun{}, err
		}
		if configure != nil {
			if err := configure(child); err != nil {
				_ = h.Agents().RemoveExact(context.Background(), child)
				return SubagentContinuationProviderRun{}, err
			}
		}
		return SubagentContinuationProviderRun{ChildID: child.ID(), Child: child, InitialMessageID: request.InitialPromptMessage().ID,
			Begin: func(ctx context.Context) (<-chan TurnOutcome, error) {
				return child.FollowupResultContext(ctx, request.InitialPromptMessage())
			},
			Submit: child.FollowupResultContext, Dispose: func(ctx context.Context) error { return h.Agents().RemoveExact(ctx, child) }}, nil
	}}
}

func TestSubagentActivationDoesNotReturnPreviousIncarnationOutput(t *testing.T) {
	ctx := activationTestContext(t)
	h := subagentTestHarness(t)
	parent, err := h.Agents().Create(ctx, AgentOptions{ID: "suffix-parent", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	provider := activationLocalTestProvider(h, "suffix-child", func(child *Agent) error {
		_, err := child.Session().Append("assistant/message", map[string]any{"message": Message{Role: RoleAssistant, Content: []ContentBlock{{Type: BlockText, Text: "old incarnation output"}}}})
		return err
	})
	mountRetirementHooks(t, h, func(run *point.Run) error { _, err := h.Subagents().RegisterProvider(run, provider); return err })
	activation, err := h.Subagents().StartActivation(ctx, provider.Name(), SubagentRequest{Parent: parent, Prompt: "new work", MaxDepth: 2}, "caller")
	if err != nil {
		t.Fatal(err)
	}
	result := activationReceive(t, ctx, activation.Result)
	if result.Status != SubagentCompleted || len(result.Output) != 0 {
		t.Fatalf("incarnation output=%+v", result)
	}
	if err := activation.Wait(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestSubagentActivationFinalCaptureWaitsForInputAcceptedDuringFlush(t *testing.T) {
	ctx := activationTestContext(t)
	var calls atomic.Int32
	h, err := Boot(ctx, Options{EnableSubagents: true, Adapter: AdapterFunc(func(_ context.Context, request GenerateRequest, _ func(StreamChunk) error) (Completion, error) {
		call := calls.Add(1)
		text := "first answer"
		if call > 1 {
			encoded, _ := json.Marshal(request.Messages)
			if !strings.Contains(string(encoded), "accepted during final flush") || !strings.Contains(string(encoded), "wake managed child") {
				return Completion{}, errors.New("follow-up lost accepted input")
			}
			text = "processed both"
		}
		return Completion{Message: Message{Role: RoleAssistant, Content: []ContentBlock{{Type: BlockText, Text: text}}}, Finish: FinishStop}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Dispose(context.Background())
	parent, err := h.Agents().Create(ctx, AgentOptions{ID: "flush-parent", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	flushEntered, flushRelease := make(chan *Agent, 1), make(chan struct{})
	var flushOnce atomic.Bool
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(flushRelease) }) }
	defer release()
	provider := activationLocalTestProvider(h, "flush-child", func(child *Agent) error {
		_, err := child.Session().InstallDurabilityCheckpoint(func(ctx context.Context) error {
			if child.Status() == AgentIdle && flushOnce.CompareAndSwap(false, true) {
				flushEntered <- child
				select {
				case <-flushRelease:
				case <-ctx.Done():
					return ctx.Err()
				}
			}
			return nil
		})
		return err
	})
	mountRetirementHooks(t, h, func(run *point.Run) error { _, err := h.Subagents().RegisterProvider(run, provider); return err })
	activation, err := h.Subagents().StartActivation(ctx, provider.Name(), SubagentRequest{Parent: parent, Prompt: "initial work", MaxDepth: 2}, "caller")
	if err != nil {
		t.Fatal(err)
	}
	child := activationReceive(t, ctx, flushEntered)
	if err := child.Inject(Message{Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: "accepted during final flush"}}}); err != nil {
		t.Fatal(err)
	}
	release()
	if _, err := h.Subagents().SendMessage(ctx, parent, activation.ChildID, []ContentBlock{{Type: BlockText, Text: "wake managed child"}}); err != nil {
		t.Fatal(err)
	}
	result := activationReceive(t, ctx, activation.Result)
	if result.Status != SubagentCompleted || len(result.Output) != 1 || result.Output[0].Text != "processed both" || calls.Load() != 2 {
		t.Fatalf("settlement=%+v calls=%d", result, calls.Load())
	}
	if err := activation.Wait(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestSubagentActivationRejectsUnmanagedProviderAndResidentMode(t *testing.T) {
	ctx := activationTestContext(t)
	entered := make(chan struct{}, 1)
	h, err := Boot(ctx, Options{EnableSubagents: true, Adapter: AdapterFunc(func(ctx context.Context, _ GenerateRequest, _ func(StreamChunk) error) (Completion, error) {
		entered <- struct{}{}
		<-ctx.Done()
		return Completion{}, ctx.Err()
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Dispose(context.Background())
	parent, err := h.Agents().Create(ctx, AgentOptions{ID: "mode-parent", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	other, err := h.Agents().Create(ctx, AgentOptions{ID: "mode-other", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	var prepares atomic.Int32
	managed := activationLocalTestProvider(h, "mode-child", func(*Agent) error { prepares.Add(1); return nil })
	legacy := retirementContinuableProvider{prepareContinuation: managed.PrepareContinuable}
	mountRetirementHooks(t, h, func(run *point.Run) error { _, err := h.Subagents().RegisterProvider(run, legacy); return err })
	if _, err := h.Subagents().StartActivation(ctx, legacy.Name(), SubagentRequest{Parent: parent, Prompt: "new work", MaxDepth: 2}, "caller"); !errors.Is(err, ErrSubagentActivationModeUnsupported) || prepares.Load() != 0 {
		t.Fatalf("unsupported provider err=%v prepares=%d", err, prepares.Load())
	}
	childID, err := h.Subagents().StartContinuable(ctx, legacy.Name(), SubagentRequest{Parent: parent, Prompt: "legacy work", MaxDepth: 2})
	if err != nil {
		t.Fatal(err)
	}
	activationReceive(t, ctx, entered)
	if _, err := h.Subagents().SendMessage(ctx, parent, childID, []ContentBlock{{Type: BlockText, Text: "must not change active mode"}}); !errors.Is(err, ErrSubagentActivationModeUnsupported) {
		t.Fatalf("resident legacy mode err=%v", err)
	}
	if _, err := h.Subagents().SendMessage(ctx, other, childID, []ContentBlock{{Type: BlockText, Text: "forged direct parent"}}); err == nil {
		t.Fatal("unrelated sender admitted")
	}
	if child, live := h.Agents().Get(childID); !live || child.Parent() != parent {
		t.Fatal("unsupported current API removed legacy child")
	}
}

func TestSubagentActivationConcurrentNestedObserversAndAncestorReceipt(t *testing.T) {
	ctx := activationTestContext(t)
	h, err := Boot(ctx, Options{EnableSubagents: true, Adapter: AdapterFunc(func(ctx context.Context, _ GenerateRequest, _ func(StreamChunk) error) (Completion, error) {
		<-ctx.Done()
		return Completion{}, ctx.Err()
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Dispose(context.Background())
	parent, err := h.Agents().Create(ctx, AgentOptions{ID: "nested-activation-root", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	provider := activationProbeProvider{prepareActivation: func(ctx context.Context, request SubagentRequest) (SubagentContinuationProviderRun, error) {
		return activationLocalTestProvider(h, request.ChildID, nil).PrepareActivation(ctx, request)
	}}
	mountRetirementHooks(t, h, func(run *point.Run) error { _, err := h.Subagents().RegisterProvider(run, provider); return err })
	outer, err := h.Subagents().StartActivation(ctx, provider.Name(), SubagentRequest{Parent: parent, ChildID: "nested-activation-parent", Prompt: "wait", MaxDepth: 3}, "caller")
	if err != nil {
		t.Fatal(err)
	}
	child, live := h.Agents().Get(outer.ChildID)
	if !live {
		t.Fatal("first local activation is not resident")
	}
	inner, err := h.Subagents().StartActivation(ctx, provider.Name(), SubagentRequest{Parent: child, ChildID: "nested-activation-child", Prompt: "wait", MaxDepth: 3}, "caller")
	if err != nil {
		t.Fatal(err)
	}
	if err := outer.RequestDispose(); !errors.Is(err, ErrSubagentActivationDisposalPending) {
		t.Fatalf("request receipt=%v", err)
	}
	if err := outer.Wait(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case <-inner.Done:
	default:
		t.Fatal("ancestor receipt preceded its owned child receipt")
	}
	if err := inner.Wait(ctx); err != nil {
		t.Fatal(err)
	}
	if _, live := h.Agents().Get(inner.ChildID); live {
		t.Fatal("nested child remains resident")
	}
}

func TestSubagentActivationClosingParentFencesLatePreparation(t *testing.T) {
	ctx := activationTestContext(t)
	h, err := Boot(ctx, Options{EnableSubagents: true, Adapter: AdapterFunc(func(ctx context.Context, _ GenerateRequest, _ func(StreamChunk) error) (Completion, error) {
		<-ctx.Done()
		return Completion{}, ctx.Err()
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Dispose(context.Background())
	parent, err := h.Agents().Create(ctx, AgentOptions{ID: "closing-activation-root", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	var preparations atomic.Int32
	provider := activationProbeProvider{prepareActivation: func(ctx context.Context, request SubagentRequest) (SubagentContinuationProviderRun, error) {
		preparations.Add(1)
		return activationLocalTestProvider(h, request.ChildID, nil).PrepareActivation(ctx, request)
	}}
	mountRetirementHooks(t, h, func(run *point.Run) error { _, err := h.Subagents().RegisterProvider(run, provider); return err })
	activation, err := h.Subagents().StartActivation(ctx, provider.Name(), SubagentRequest{Parent: parent, ChildID: "closing-activation-parent", Prompt: "wait", MaxDepth: 3}, "caller")
	if err != nil {
		t.Fatal(err)
	}
	registry := h.Subagents()
	registry.mu.RLock()
	record := registry.records[activation.ChildID]
	registry.mu.RUnlock()
	if err := record.activation.observer.Dispose(ctx); err != nil {
		t.Fatal(err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	defer unblock()
	definition := point.Define(point.Descriptor{ID: "test/activation-observer-barrier"}, point.DecodeJSON[struct{}], func(*point.Run, struct{}) (point.Dispose, error) {
		return func(context.Context) error { close(entered); <-release; return nil }, nil
	})
	observer, err := h.Runtime().Mount(record.child.Scope(), "closing-activation-observer-barrier", definition, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := observer.WaitStable(ctx); err != nil {
		t.Fatal(err)
	}
	record.activation.mu.Lock()
	record.activation.observer = observer
	record.activation.mu.Unlock()
	if err := activation.RequestDispose(); !errors.Is(err, ErrSubagentActivationDisposalPending) {
		t.Fatal(err)
	}
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	if current, live := h.Agents().Get(record.child.ID()); !live || current != record.child {
		t.Fatal("barrier failed to hold the pre-retirement window")
	}
	if _, err := registry.StartActivation(ctx, provider.Name(), SubagentRequest{Parent: record.child, ChildID: "late-activation-child", Prompt: "must reject", MaxDepth: 3}, "caller"); err == nil {
		t.Fatal("closing parent admitted a late preparation")
	}
	if preparations.Load() != 1 {
		t.Fatalf("late provider preparation executed: %d", preparations.Load())
	}
	unblock()
	if err := activation.Wait(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestSubagentActivationWithdrawnCleanupReentryRetainsReceipt(t *testing.T) {
	for _, phase := range []string{"provider-registry", "provider-harness", "deactivated-registry", "deactivated-harness"} {
		t.Run(phase, func(t *testing.T) {
			ctx := activationTestContext(t)
			h := subagentTestHarness(t)
			parent, err := h.Agents().Create(ctx, AgentOptions{ID: "cleanup-reentry-parent", CWD: t.TempDir()})
			if err != nil {
				t.Fatal(err)
			}
			observed := make(chan error, 1)
			var once sync.Once
			reenter := func() {
				once.Do(func() {
					if strings.HasSuffix(phase, "harness") {
						observed <- h.Dispose(context.Background())
					} else {
						observed <- h.Subagents().Dispose(context.Background())
					}
				})
			}
			external := retirementSubagentProvider{prepare: func(context.Context, SubagentRequest) (SubagentProviderRun, error) {
				return SubagentProviderRun{ChildID: "cleanup-reentry-child", Result: make(chan SubagentResult), Begin: func() {}, Cancel: func(error) {}, Dispose: func(context.Context) error { reenter(); return nil }}, nil
			}}
			var provider SubagentProvider = external
			if strings.HasPrefix(phase, "deactivated") {
				provider = activationLocalTestProvider(h, "cleanup-reentry-child", nil)
			}
			mountRetirementHooks(t, h, func(run *point.Run) error {
				if _, err := h.Subagents().RegisterProvider(run, provider); err != nil {
					return err
				}
				_, err := h.Hooks().Deactivated.On(run, func(_ context.Context, agent *Agent) error {
					if strings.HasPrefix(phase, "deactivated") && agent.ID() == "cleanup-reentry-child" {
						reenter()
					}
					return nil
				})
				return err
			})
			activation, err := h.Subagents().StartActivation(ctx, provider.Name(), SubagentRequest{Parent: parent, Prompt: "work", MaxDepth: 2}, "caller")
			if err != nil {
				t.Fatal(err)
			}
			_ = activation.RequestDispose()
			callbackErr := activationReceive(t, ctx, observed)
			want := ErrSubagentDisposalInProgress
			if strings.HasSuffix(phase, "harness") {
				want = ErrHarnessDisposalInProgress
			}
			if !errors.Is(callbackErr, want) {
				t.Fatalf("callback receipt=%v; want %v", callbackErr, want)
			}
			if err := activation.Wait(ctx); err != nil {
				t.Fatal(err)
			}
			if strings.HasSuffix(phase, "harness") {
				if err := h.Drain(ctx); err != nil {
					t.Fatal(err)
				}
			} else if err := h.Subagents().Drain(ctx); err != nil {
				t.Fatal(err)
			}
		})
	}
}

type activationExternalProvider struct{ retirementSubagentProvider }

func (p activationExternalProvider) Name() string { return "activation-external-provider" }

func TestSubagentActivationAdoptsPreparationFromActivatedObserver(t *testing.T) {
	ctx := activationTestContext(t)
	h, err := Boot(ctx, Options{EnableSubagents: true, Adapter: AdapterFunc(func(ctx context.Context, _ GenerateRequest, _ func(StreamChunk) error) (Completion, error) {
		<-ctx.Done()
		return Completion{}, ctx.Err()
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Dispose(context.Background())
	parent, err := h.Agents().Create(ctx, AgentOptions{ID: "prebind-root", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	entered, cancelled, release := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	defer unblock()
	finished := make(chan error, 1)
	external := activationExternalProvider{retirementSubagentProvider{prepare: func(ctx context.Context, _ SubagentRequest) (SubagentProviderRun, error) {
		close(entered)
		<-ctx.Done()
		close(cancelled)
		<-release
		return SubagentProviderRun{}, ctx.Err()
	}}}
	local := activationLocalTestProvider(h, "prebind-parent", nil)
	mountRetirementHooks(t, h, func(run *point.Run) error {
		if _, err := h.Subagents().RegisterProvider(run, local); err != nil {
			return err
		}
		if _, err := h.Subagents().RegisterProvider(run, external); err != nil {
			return err
		}
		_, err := h.Hooks().Activated.On(run, func(_ context.Context, agent *Agent) error {
			if agent.ID() != "prebind-parent" {
				return nil
			}
			go func() {
				_, err := h.Subagents().StartActivation(ctx, external.Name(), SubagentRequest{Parent: agent, Prompt: "grandchild preparation", MaxDepth: 3}, "caller")
				finished <- err
			}()
			select {
			case <-entered:
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		})
		return err
	})
	activation, err := h.Subagents().StartActivation(ctx, local.Name(), SubagentRequest{Parent: parent, Prompt: "work", MaxDepth: 3}, "caller")
	if err != nil {
		t.Fatal(err)
	}
	_ = activation.RequestDispose()
	select {
	case <-cancelled:
	case <-ctx.Done():
		t.Fatal("pre-bind descendant did not inherit cancellation")
	}
	select {
	case <-activation.Done:
		t.Fatal("parent receipt preceded pending descendant preparation rollback")
	default:
	}
	unblock()
	if err := activationReceive(t, ctx, finished); !errors.Is(err, context.Canceled) {
		t.Fatalf("late preparation=%v", err)
	}
	if err := activation.Wait(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestSubagentActivationTerminalWaitsForInitialAnnouncement(t *testing.T) {
	ctx := activationTestContext(t)
	h := subagentTestHarness(t)
	parent, err := h.Agents().Create(ctx, AgentOptions{ID: "announcement-root", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	defer unblock()
	ended := make(chan struct{}, 1)
	provider := retirementSubagentProvider{prepare: func(context.Context, SubagentRequest) (SubagentProviderRun, error) {
		return SubagentProviderRun{ChildID: "announcement-child", Result: make(chan SubagentResult), Begin: func() { t.Error("withdrawn child began") }, Cancel: func(error) {}, Dispose: func(context.Context) error { return nil }}, nil
	}}
	mountRetirementHooks(t, h, func(run *point.Run) error {
		if _, err := h.Subagents().RegisterProvider(run, provider); err != nil {
			return err
		}
		if _, err := h.Subagents().Started.On(run, func(context.Context, SubagentLifecycle) error { close(entered); <-release; return nil }); err != nil {
			return err
		}
		_, err := h.Subagents().Ended.On(run, func(context.Context, SubagentLifecycle) error { ended <- struct{}{}; return nil })
		return err
	})
	finished := make(chan error, 1)
	go func() {
		_, err := h.Subagents().StartActivation(ctx, provider.Name(), SubagentRequest{Parent: parent, Prompt: "work", MaxDepth: 2}, "caller")
		finished <- err
	}()
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	r := h.Subagents()
	r.mu.RLock()
	record := r.records["announcement-child"]
	r.mu.RUnlock()
	if err := r.requestActivationDisposal(record); !errors.Is(err, ErrSubagentActivationDisposalPending) {
		t.Fatal(err)
	}
	select {
	case <-record.activation.cleanupDone:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	select {
	case <-record.activation.done:
		t.Fatal("terminal result preceded initial admission receipt")
	case <-ended:
		t.Fatal("Ended raced ahead of the Started callback")
	default:
	}
	unblock()
	if err := activationReceive(t, ctx, finished); err == nil {
		t.Fatal("withdrawn initial admission succeeded")
	}
	if err := record.activation.wait(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case <-ended:
	default:
		t.Fatal("initial Started did not receive its terminal edge")
	}
}

func TestSubagentActivationResidentMessageCannotOwnInitialAnnouncement(t *testing.T) {
	ctx := activationTestContext(t)
	h, err := Boot(ctx, Options{EnableSubagents: true, Adapter: AdapterFunc(func(ctx context.Context, _ GenerateRequest, _ func(StreamChunk) error) (Completion, error) {
		<-ctx.Done()
		return Completion{}, ctx.Err()
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Dispose(context.Background())
	parent, err := h.Agents().Create(ctx, AgentOptions{ID: "initial-owner-root", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	defer unblock()
	var starts atomic.Int32
	provider := activationLocalTestProvider(h, "initial-owner-child", nil)
	mountRetirementHooks(t, h, func(run *point.Run) error {
		if _, err := h.Subagents().RegisterProvider(run, provider); err != nil {
			return err
		}
		_, err := h.Subagents().Started.On(run, func(_ context.Context, info SubagentLifecycle) error {
			if info.ID != "initial-owner-child" || !info.Managed {
				t.Error("resident input emitted a non-managed or foreign Started event")
			}
			if starts.Add(1) == 1 {
				close(entered)
				<-release
			}
			return nil
		})
		return err
	})
	finished := make(chan error, 1)
	go func() {
		_, err := h.Subagents().StartActivation(ctx, provider.Name(), SubagentRequest{Parent: parent, Prompt: "initial", MaxDepth: 2}, "caller")
		finished <- err
	}()
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	r := h.Subagents()
	r.mu.RLock()
	record := r.records["initial-owner-child"]
	r.mu.RUnlock()
	// Model the narrow published-but-unbound registry state independently of
	// scheduler timing. Premature input must reject without waiting on startup.
	record.activation.bindingReady.Store(false)
	before := len(record.child.Session().Events())
	if _, err := r.SendMessage(ctx, parent, "initial-owner-child", []ContentBlock{{Type: BlockText, Text: "premature message"}}); !errors.Is(err, ErrSubagentActivationNotReady) {
		t.Fatalf("unbound input receipt=%v", err)
	}
	if len(record.child.Session().Events()) != before {
		t.Fatal("unbound input mutated the child")
	}
	record.activation.bindingReady.Store(true)
	if _, err := r.SendMessage(ctx, parent, "initial-owner-child", []ContentBlock{{Type: BlockText, Text: "concurrent message"}}); err != nil {
		t.Fatal(err)
	}
	if id, err := r.FollowupMessage(ctx, parent, "initial-owner-child", Message{ID: "legacy-resident-input", Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: "legacy concurrent message"}}}); err != nil || id != "legacy-resident-input" {
		t.Fatalf("managed legacy input receipt=%q error=%v", id, err)
	}
	if starts.Load() != 1 {
		t.Fatalf("resident current/legacy input emitted duplicate Started: %d", starts.Load())
	}
	_ = r.requestActivationDisposal(record)
	select {
	case <-record.activation.cleanupDone:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	select {
	case <-record.activation.initialDone:
		t.Fatal("resident caller closed original admission barrier")
	case <-record.activation.done:
		t.Fatal("resident caller allowed premature completion")
	default:
	}
	unblock()
	if err := activationReceive(t, ctx, finished); err == nil {
		t.Fatal("withdrawn initial admission succeeded")
	}
	if err := record.activation.wait(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestSubagentActivationAdoptsWithdrawnChildFinalReceipt(t *testing.T) {
	ctx := activationTestContext(t)
	h, err := Boot(ctx, Options{EnableSubagents: true, Adapter: AdapterFunc(func(ctx context.Context, _ GenerateRequest, _ func(StreamChunk) error) (Completion, error) {
		<-ctx.Done()
		return Completion{}, ctx.Err()
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Dispose(context.Background())
	parent, err := h.Agents().Create(ctx, AgentOptions{ID: "prebind-cleanup-root", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	entered, release, deactivated := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	defer unblock()
	terminal := make(chan SubagentResult, 1)
	ready := make(chan SubagentActivation, 1)
	external := activationExternalProvider{retirementSubagentProvider{prepare: func(context.Context, SubagentRequest) (SubagentProviderRun, error) {
		return SubagentProviderRun{ChildID: "prebind-cleanup-external", Result: terminal, Begin: func() {}, Cancel: func(error) {}, Dispose: func(context.Context) error { close(entered); <-release; return nil }}, nil
	}}}
	local := activationLocalTestProvider(h, "prebind-cleanup-parent", nil)
	mountRetirementHooks(t, h, func(run *point.Run) error {
		if _, err := h.Subagents().RegisterProvider(run, local); err != nil {
			return err
		}
		if _, err := h.Subagents().RegisterProvider(run, external); err != nil {
			return err
		}
		if _, err := h.Hooks().Deactivated.On(run, func(_ context.Context, agent *Agent) error {
			if agent.ID() == "prebind-cleanup-parent" {
				close(deactivated)
			}
			return nil
		}); err != nil {
			return err
		}
		_, err := h.Hooks().Activated.On(run, func(_ context.Context, agent *Agent) error {
			if agent.ID() != "prebind-cleanup-parent" {
				return nil
			}
			activation, err := h.Subagents().StartActivation(ctx, external.Name(), SubagentRequest{Parent: agent, Prompt: "external", MaxDepth: 3}, "caller")
			if err != nil {
				return err
			}
			terminal <- SubagentResult{ChildID: activation.ChildID, Status: SubagentCompleted, Reason: FinishStop}
			close(terminal)
			select {
			case <-entered:
				ready <- activation
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		})
		return err
	})
	outer, err := h.Subagents().StartActivation(ctx, local.Name(), SubagentRequest{Parent: parent, Prompt: "work", MaxDepth: 3}, "caller")
	if err != nil {
		t.Fatal(err)
	}
	inner := activationReceive(t, ctx, ready)
	_ = outer.RequestDispose()
	select {
	case <-deactivated:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	select {
	case <-outer.Done:
		t.Fatal("parent completed before adopted external cleanup receipt")
	default:
	}
	unblock()
	if err := outer.Wait(ctx); err != nil {
		t.Fatal(err)
	}
	if err := inner.Wait(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestSubagentActivationKeepsProviderResultSettledInsideDispose(t *testing.T) {
	ctx := activationTestContext(t)
	h := subagentTestHarness(t)
	parent, err := h.Agents().Create(ctx, AgentOptions{ID: "dispose-result-root", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	var next atomic.Int32
	provider := retirementSubagentProvider{prepare: func(context.Context, SubagentRequest) (SubagentProviderRun, error) {
		id := SessionID(fmt.Sprintf("dispose-result-%d", next.Add(1)))
		terminal := make(chan SubagentResult, 1)
		return SubagentProviderRun{ChildID: id, Result: terminal, Begin: func() {}, Cancel: func(error) {}, Dispose: func(context.Context) error {
			terminal <- SubagentResult{ChildID: id, Status: SubagentCompleted, Reason: FinishStop, Output: []ContentBlock{{Type: BlockText, Text: "provider final"}}}
			close(terminal)
			return nil
		}}, nil
	}}
	mountRetirementHooks(t, h, func(run *point.Run) error { _, err := h.Subagents().RegisterProvider(run, provider); return err })
	for range 16 {
		activation, err := h.Subagents().StartActivation(ctx, provider.Name(), SubagentRequest{Parent: parent, Prompt: "work", MaxDepth: 2}, "caller")
		if err != nil {
			t.Fatal(err)
		}
		_ = activation.RequestDispose()
		if err := activation.Wait(ctx); err != nil {
			t.Fatal(err)
		}
		result := activationReceive(t, ctx, activation.Result)
		if result.Status != SubagentCompleted || len(result.Output) != 1 || result.Output[0].Text != "provider final" {
			t.Fatalf("provider result lost to disposal fallback: %+v", result)
		}
	}
}

func TestSubagentActivationFailedAdmissionDrainsUnbufferedProviderResult(t *testing.T) {
	ctx := activationTestContext(t)
	h := subagentTestHarness(t)
	parent, err := h.Agents().Create(ctx, AgentOptions{ID: "failed-result-root", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	expected := errors.New("started observer rejected admission")
	disposed := make(chan struct{})
	provider := retirementSubagentProvider{prepare: func(_ context.Context, request SubagentRequest) (SubagentProviderRun, error) {
		if request.Label == "missing-dispose" {
			return SubagentProviderRun{ChildID: "invalid-disposer", Result: make(chan SubagentResult), Begin: func() {}, Cancel: func(error) {}}, nil
		}
		terminal := make(chan SubagentResult)
		return SubagentProviderRun{ChildID: "failed-result-child", Result: terminal, Begin: func() { t.Error("failed admission began execution") }, Cancel: func(error) {}, Dispose: func(context.Context) error {
			select {
			case terminal <- SubagentResult{ChildID: "failed-result-child", Status: SubagentAborted, Reason: FinishAborted}:
				close(terminal)
				close(disposed)
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		}}, nil
	}}
	mountRetirementHooks(t, h, func(run *point.Run) error {
		if _, err := h.Subagents().RegisterProvider(run, provider); err != nil {
			return err
		}
		_, err := h.Subagents().Started.On(run, func(context.Context, SubagentLifecycle) error { return expected })
		return err
	})
	if _, invalidErr := h.Subagents().StartActivation(ctx, provider.Name(), SubagentRequest{Parent: parent, Prompt: "work", Label: "missing-dispose", MaxDepth: 2}, "caller"); invalidErr == nil {
		t.Fatal("provider with no disposer was admitted")
	}
	_, err = h.Subagents().StartActivation(ctx, provider.Name(), SubagentRequest{Parent: parent, Prompt: "work", MaxDepth: 2}, "caller")
	if !errors.Is(err, expected) {
		t.Fatalf("failed admission = %v", err)
	}
	select {
	case <-disposed:
	case <-ctx.Done():
		t.Fatal("rollback had no provider result receiver")
	}
	_ = h.Subagents().Dispose(ctx)
	if err := h.Subagents().Drain(ctx); err != nil {
		t.Fatalf("failed admission final receipt = %v", err)
	}
}

func TestActivationTextPresenceDoesNotRelaxOrdinaryStarts(t *testing.T) {
	h := subagentTestHarness(t)
	ctx := activationTestContext(t)
	parent, err := h.Agents().Create(ctx, AgentOptions{ID: "presence-parent", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	stopped := errors.New("presence probe stopped before child creation")
	var captured SubagentRequest
	var calls int
	capture := func(request SubagentRequest) { calls++; captured = request }
	provider := activationProbeProvider{retirementSubagentProvider: retirementSubagentProvider{prepare: func(_ context.Context, request SubagentRequest) (SubagentProviderRun, error) {
		capture(request)
		return SubagentProviderRun{}, stopped
	}}, prepareActivation: func(_ context.Context, request SubagentRequest) (SubagentContinuationProviderRun, error) {
		capture(request)
		return SubagentContinuationProviderRun{}, stopped
	}}
	mountRetirementHooks(t, h, func(run *point.Run) error { _, err := h.Subagents().RegisterProvider(run, provider); return err })
	for _, blocks := range [][]ContentBlock{nil, {}, {{Type: BlockText, Text: ""}}, {{Type: BlockText, Text: " \t\n "}}} {
		request := SubagentRequest{Parent: parent, PromptContent: blocks, Label: " \t raw\n  label ", MaxDepth: 2}
		before := calls
		if _, err := h.Subagents().Start(ctx, provider.Name(), request); err == nil || errors.Is(err, stopped) {
			t.Fatalf("ordinary Start accepted blank: %+v %v", blocks, err)
		}
		if _, err := h.Subagents().StartContinuable(ctx, provider.Name(), request); err == nil || errors.Is(err, stopped) {
			t.Fatalf("ordinary StartContinuable accepted blank: %+v %v", blocks, err)
		}
		if calls != before {
			t.Fatal("legacy blank prepared provider")
		}
		_, err := h.Subagents().StartActivation(ctx, provider.Name(), request, "caller")
		if len(blocks) == 0 {
			if err == nil || errors.Is(err, stopped) || calls != before {
				t.Fatalf("absent managed prompt accepted: %+v %v", blocks, err)
			}
		} else {
			if !errors.Is(err, stopped) || calls != before+1 || captured.Label != request.Label || len(captured.PromptBlocks()) != 1 || captured.PromptBlocks()[0].Text != blocks[0].Text {
				t.Fatalf("managed text changed: %+v %v", captured, err)
			}
		}
	}
	for _, continuable := range []bool{false, true} {
		request := SubagentRequest{Parent: parent, Prompt: "work", Label: " \t raw\n  label ", MaxDepth: 2}
		if continuable {
			_, err = h.Subagents().StartContinuable(ctx, provider.Name(), request)
		} else {
			_, err = h.Subagents().Start(ctx, provider.Name(), request)
		}
		if !errors.Is(err, stopped) || captured.Label != "raw label" {
			t.Fatalf("legacy normalization changed: %+v %v", captured, err)
		}
	}
	if len(h.Subagents().ListChildren(parent, true)) != 0 {
		t.Fatal("probe published a child")
	}
}
