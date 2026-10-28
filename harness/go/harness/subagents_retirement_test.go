package harness

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	point "github.com/phodal/pero/harness/go/runtime"
)

type retirementSubagentProvider struct {
	prepare func(context.Context, SubagentRequest) (SubagentProviderRun, error)
}

func TestSubagentDisposalClaimReportsPendingAndRetainsFinalError(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	defer unblock()
	expected := errors.New("provider cleanup failed")
	var calls atomic.Int32
	var dispose func(context.Context) error
	nested := make(chan error, 1)
	dispose = guardSubagentDisposal(func(context.Context) error {
		calls.Add(1)
		nested <- dispose(context.Background())
		close(entered)
		<-release
		return expected
	})
	finished := make(chan error, 1)
	go func() { finished <- dispose(context.Background()) }()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("disposal callback could not reenter")
	}
	if err := <-nested; !errors.Is(err, ErrSubagentDisposalInProgress) {
		t.Fatalf("reentrant receipt=%v", err)
	}
	if err := dispose(context.Background()); !errors.Is(err, ErrSubagentDisposalInProgress) {
		t.Fatalf("concurrent receipt=%v", err)
	}
	unblock()
	if err := <-finished; !errors.Is(err, expected) {
		t.Fatal(err)
	}
	if err := dispose(context.Background()); !errors.Is(err, expected) || calls.Load() != 1 {
		t.Fatalf("final receipt=%v cleanup calls=%d", err, calls.Load())
	}
}

func (p retirementSubagentProvider) Name() string { return "retirement-provider" }
func (p retirementSubagentProvider) Capabilities() SubagentCapabilities {
	return SubagentCapabilities{}
}
func (p retirementSubagentProvider) InheritsParentContext() bool { return false }
func (p retirementSubagentProvider) Prepare(ctx context.Context, request SubagentRequest) (SubagentProviderRun, error) {
	return p.prepare(ctx, request)
}

type retirementContinuableProvider struct {
	retirementSubagentProvider
	prepareContinuation func(context.Context, SubagentRequest) (SubagentContinuationProviderRun, error)
}

func (p retirementContinuableProvider) PrepareContinuable(ctx context.Context, request SubagentRequest) (SubagentContinuationProviderRun, error) {
	return p.prepareContinuation(ctx, request)
}

func TestSubagentRegistryDisposalFromLifecycleCallbackDrainsExactlyOnce(t *testing.T) {
	for _, phase := range []string{"started-continuation", "ended-one-shot"} {
		t.Run(phase, func(t *testing.T) {
			h := subagentTestHarness(t)
			registry := h.Subagents()
			parent, err := h.Agents().Create(t.Context(), AgentOptions{ID: "dispose-callback-parent", CWD: t.TempDir()})
			if err != nil {
				t.Fatal(err)
			}
			var disposed atomic.Int32
			result := make(chan SubagentResult, 1)
			var once sync.Once
			finish := func() {
				once.Do(func() {
					result <- SubagentResult{ChildID: "dispose-callback-child", Status: SubagentCompleted, Reason: FinishStop}
					close(result)
				})
			}
			provider := retirementContinuableProvider{retirementSubagentProvider: retirementSubagentProvider{prepare: func(context.Context, SubagentRequest) (SubagentProviderRun, error) {
				return SubagentProviderRun{ChildID: "dispose-callback-child", Result: result, Begin: finish, Cancel: func(error) { finish() }, Dispose: func(context.Context) error { disposed.Add(1); return nil }}, nil
			}}, prepareContinuation: func(ctx context.Context, request SubagentRequest) (SubagentContinuationProviderRun, error) {
				child, err := h.Agents().Create(ctx, AgentOptions{ID: "dispose-callback-child", Parent: parent, Delegated: true, DelegationDepth: 1})
				if err != nil {
					return SubagentContinuationProviderRun{}, err
				}
				return SubagentContinuationProviderRun{ChildID: child.ID(), Child: child, InitialMessageID: request.InitialPromptMessage().ID,
					Begin: func(context.Context) (<-chan TurnOutcome, error) {
						t.Error("retired continuation began")
						return make(chan TurnOutcome), nil
					},
					Submit:  func(context.Context, Message) (<-chan TurnOutcome, error) { return make(chan TurnOutcome), nil },
					Dispose: func(ctx context.Context) error { disposed.Add(1); return h.Agents().RemoveExact(ctx, child) }}, nil
			}}
			nested := make(chan error, 1)
			mountRetirementHooks(t, h, func(run *point.Run) error {
				if _, err := registry.RegisterProvider(run, provider); err != nil {
					return err
				}
				callback := func(context.Context, SubagentLifecycle) error {
					nested <- registry.Dispose(context.Background())
					return nil
				}
				if phase == "started-continuation" {
					_, err := registry.Started.On(run, callback)
					return err
				}
				_, err := registry.Ended.On(run, callback)
				return err
			})
			request := SubagentRequest{Parent: parent, Prompt: "dispose from observer", MaxDepth: 3}
			if phase == "started-continuation" {
				if _, err := registry.StartContinuable(t.Context(), provider.Name(), request); err == nil {
					t.Fatal("disposed registry accepted continuation")
				}
			} else {
				_, _ = registry.Start(t.Context(), provider.Name(), request)
			}
			select {
			case err := <-nested:
				if !errors.Is(err, ErrSubagentDisposalInProgress) {
					t.Fatalf("callback receipt=%v", err)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("registry disposal waited for its own lifecycle callback")
			}
			ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
			defer cancel()
			if err := registry.Drain(ctx); err != nil {
				t.Fatal(err)
			}
			if disposed.Load() != 1 {
				t.Fatalf("provider cleanup calls=%d", disposed.Load())
			}
			registry.mu.RLock()
			remaining := len(registry.records)
			registry.mu.RUnlock()
			if remaining != 0 {
				t.Fatal("disposed registry retained authority")
			}
			if _, live := h.Agents().Get("dispose-callback-child"); live {
				t.Fatal("disposal drain retained child")
			}
			if err := registry.Dispose(ctx); err != nil {
				t.Fatalf("final disposal receipt=%v", err)
			}
		})
	}
}

func TestSubagentPreparationAndBeginRejectRetiredParent(t *testing.T) {
	for _, phase := range []string{"entry", "prepare", "started", "begin"} {
		t.Run(phase, func(t *testing.T) {
			h := subagentTestHarness(t)
			parent, err := h.Agents().Create(t.Context(), AgentOptions{ID: "provider-parent", CWD: t.TempDir()})
			if err != nil {
				t.Fatal(err)
			}
			var prepared, begun, disposed atomic.Int32
			result := make(chan SubagentResult, 1)
			var once sync.Once
			finish := func() {
				once.Do(func() { result <- SubagentResult{ChildID: "external-child", Status: SubagentAborted}; close(result) })
			}
			retire := func() {
				if err := h.Agents().RemoveExact(t.Context(), parent); err != nil && !errors.Is(err, ErrAgentDisposalInProgress) {
					t.Error(err)
				}
			}
			provider := retirementSubagentProvider{prepare: func(context.Context, SubagentRequest) (SubagentProviderRun, error) {
				prepared.Add(1)
				if phase == "prepare" {
					retire()
				}
				return SubagentProviderRun{ChildID: "external-child", Result: result, Begin: func() {
					begun.Add(1)
					if phase == "begin" {
						retire()
					}
				}, Cancel: func(error) { finish() }, Dispose: func(context.Context) error { disposed.Add(1); finish(); return nil }}, nil
			}}
			mountRetirementHooks(t, h, func(run *point.Run) error {
				if _, err := h.Subagents().RegisterProvider(run, provider); err != nil {
					return err
				}
				if phase == "started" {
					_, err := h.Subagents().Started.On(run, func(context.Context, SubagentLifecycle) error { retire(); return nil })
					return err
				}
				return nil
			})
			if phase == "entry" {
				retire()
			}
			run, err := h.Subagents().Start(t.Context(), provider.Name(), SubagentRequest{Parent: parent, Prompt: "request", MaxDepth: 3})
			if err == nil || run.ID != "" {
				t.Fatalf("retired parent received run=%+v err=%v", run, err)
			}
			if run.Result != nil || run.Reports != nil || run.Cancel != nil {
				t.Fatal("failed preparation returned execution authority")
			}
			if phase == "entry" {
				if run.Dispose != nil || run.Wait != nil {
					t.Fatal("rejected entry created a cleanup handle")
				}
			} else {
				if run.Dispose == nil || run.Wait == nil {
					t.Fatal("failed preparation lost exact cleanup receipt")
				}
				if err := run.Wait(t.Context()); err != nil {
					t.Fatalf("prepared rollback final receipt=%v", err)
				}
			}
			if err := h.Agents().WaitRetired(t.Context(), parent); err != nil {
				t.Fatalf("parent final receipt=%v", err)
			}
			wantPrepared, wantBegun := int32(1), int32(0)
			if phase == "entry" {
				wantPrepared = 0
			}
			if phase == "begin" {
				wantBegun = 1
			}
			if prepared.Load() != wantPrepared || begun.Load() != wantBegun || disposed.Load() != wantPrepared {
				t.Fatalf("callbacks prepared=%d begun=%d disposed=%d", prepared.Load(), begun.Load(), disposed.Load())
			}
			h.Subagents().mu.RLock()
			remaining := len(h.Subagents().records)
			h.Subagents().mu.RUnlock()
			if remaining != 0 {
				t.Fatal("retired owner left published external record")
			}
		})
	}
}

func TestLateSubagentCompletionCannotNotifyReplacementParent(t *testing.T) {
	h := subagentTestHarness(t)
	oldParent, err := h.Agents().Create(t.Context(), AgentOptions{ID: "old-parent", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	registry := h.Subagents()
	result := make(chan SubagentResult, 1)
	run := SubagentRun{ID: "reused-child", Result: result, Dispose: func(context.Context) error { return nil }}
	oldRecord := &subagentRecord{snapshot: SubagentSnapshot{ID: run.ID, Parent: oldParent.ID()}, parent: oldParent, run: run}
	registry.mu.Lock()
	registry.records[run.ID] = oldRecord
	registry.mu.Unlock()
	done := registry.watchParentActivation(run)
	if err := h.Agents().RemoveExact(t.Context(), oldParent); err != nil {
		t.Fatal(err)
	}
	replacement, err := h.Agents().Create(t.Context(), AgentOptions{ID: "replacement-parent", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	lease, err := replacement.BeginMaintenance(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer lease.Close()
	replacementRecord := &subagentRecord{snapshot: SubagentSnapshot{ID: run.ID, Parent: replacement.ID()}, parent: replacement}
	registry.mu.Lock()
	registry.records[run.ID] = replacementRecord
	registry.mu.Unlock()
	result <- SubagentResult{ChildID: run.ID, Status: SubagentCompleted, Output: []ContentBlock{{Type: BlockText, Text: "OLD_PRIVATE_RESULT"}}}
	close(result)
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("late completion did not finish")
	}
	replacement.injectMu.Lock()
	injected := len(replacement.injected)
	replacement.injectMu.Unlock()
	if injected != 0 || replacement.pendingPrompts.Load() != 0 {
		t.Fatal("old result was delivered to replacement parent")
	}
	registry.mu.RLock()
	current := registry.records[run.ID]
	registry.mu.RUnlock()
	if current != replacementRecord {
		t.Fatal("late completion mutated replacement record")
	}
}

type retirementResumer struct {
	retirementSubagentProvider
	resume func(context.Context, *Agent, SessionID) (SubagentContinuationProviderRun, SubagentSnapshot, error)
}

func (p retirementResumer) PrepareResume(ctx context.Context, parent *Agent, id SessionID) (SubagentContinuationProviderRun, SubagentSnapshot, error) {
	return p.resume(ctx, parent, id)
}

func TestColdContinuationCannotPublishAfterParentRetires(t *testing.T) {
	h := subagentTestHarness(t)
	parent, err := h.Agents().Create(t.Context(), AgentOptions{ID: "resume-parent", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	defer unblock()
	var calls, disposals atomic.Int32
	provider := retirementResumer{retirementSubagentProvider: retirementSubagentProvider{prepare: func(context.Context, SubagentRequest) (SubagentProviderRun, error) {
		return SubagentProviderRun{}, errors.New("not used")
	}}}
	provider.resume = func(ctx context.Context, owner *Agent, id SessionID) (SubagentContinuationProviderRun, SubagentSnapshot, error) {
		options := AgentOptions{ID: id, CWD: owner.Session().Header().CWD, Parent: owner, Delegated: true, DelegationDepth: 1}
		var child *Agent
		var err error
		if session, exists := h.Sessions().Get(id); exists {
			child, err = h.Agents().Resume(ctx, session, options)
		} else {
			child, err = h.Agents().Create(ctx, options)
		}
		if err != nil {
			return SubagentContinuationProviderRun{}, SubagentSnapshot{}, err
		}
		if calls.Add(1) == 1 {
			close(entered)
			<-release
		}
		return SubagentContinuationProviderRun{ChildID: id, Child: child, Submit: func(context.Context, Message) (<-chan TurnOutcome, error) { return make(chan TurnOutcome), nil }, Dispose: func(ctx context.Context) error { disposals.Add(1); return h.Agents().RemoveExact(ctx, child) }}, SubagentSnapshot{ID: id, Continuable: true}, nil
	}
	mountRetirementHooks(t, h, func(run *point.Run) error { _, err := h.Subagents().RegisterProvider(run, provider); return err })
	finished := make(chan error, 1)
	go func() {
		_, err := h.Subagents().ActivateContinuable(t.Context(), parent, "cold-child")
		finished <- err
	}()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("resume missed barrier")
	}
	if err := h.Agents().RemoveExact(t.Context(), parent); !errors.Is(err, ErrAgentDisposalInProgress) {
		t.Fatalf("unpublished preparation retirement must be pending: %v", err)
	}
	receipt := parent.retirement.Load()
	if receipt == nil {
		t.Fatal("parent retirement has no exact receipt")
	}
	select {
	case <-receipt.done:
		t.Fatal("parent final receipt preceded provider rollback")
	default:
	}
	if replacement, err := h.Agents().Resume(t.Context(), parent.Session(), AgentOptions{}); replacement != nil || (err == nil || err.Error() != "harness: session is already active or activating") {
		t.Fatalf("replacement crossed unpublished rollback receipt: %p %v", replacement, err)
	}
	unblock()
	select {
	case err := <-finished:
		if err == nil {
			t.Fatal("retired parent published cold record")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("resume cleanup did not finish")
	}
	if err := h.Agents().WaitRetired(t.Context(), parent); err != nil {
		t.Fatalf("cold preparation final receipt=%v", err)
	}
	h.Subagents().mu.RLock()
	record := h.Subagents().records["cold-child"]
	h.Subagents().mu.RUnlock()
	if record != nil || disposals.Load() != 1 {
		t.Fatal("failed cold resume retained record or provider lease")
	}
	replacement, err := h.Agents().Resume(t.Context(), parent.Session(), AgentOptions{})
	if err != nil {
		t.Fatal(err)
	}
	child, err := h.Subagents().ActivateContinuable(t.Context(), replacement, "cold-child")
	if err != nil || child.Parent() != replacement {
		t.Fatalf("stale record poisoned fresh parent: %p %v", child, err)
	}
}

func TestActivateContinuableRejectsUnrelatedLiveParent(t *testing.T) {
	h := subagentTestHarness(t)
	first, err := h.Agents().Create(t.Context(), AgentOptions{ID: "first-parent", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	second, err := h.Agents().Create(t.Context(), AgentOptions{ID: "second-parent", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	child, err := h.Agents().Create(t.Context(), AgentOptions{ID: "owned-child", Parent: first, Delegated: true, DelegationDepth: 1})
	if err != nil {
		t.Fatal(err)
	}
	record := &subagentRecord{snapshot: SubagentSnapshot{ID: child.ID(), Parent: first.ID(), Continuable: true}, parent: first, child: child, submit: func(context.Context, Message) (<-chan TurnOutcome, error) { return make(chan TurnOutcome), nil }}
	h.Subagents().mu.Lock()
	h.Subagents().records[child.ID()] = record
	h.Subagents().mu.Unlock()
	if got, err := h.Subagents().ActivateContinuable(t.Context(), second, child.ID()); err == nil || got != nil {
		t.Fatal("unrelated parent acquired child")
	}
	if got, err := h.Subagents().ActivateContinuable(t.Context(), first, child.ID()); err != nil || got != child {
		t.Fatalf("exact parent rejected: %v", err)
	}
}
