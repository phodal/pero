package harness

import (
	"context"
	"errors"
	"sync"
	"testing"

	point "github.com/phodal/pero/harness/go/runtime"
)

func assertSubagentParentRetirementPending(t *testing.T, parent *Agent) {
	t.Helper()
	receipt := parent.retirement.Load()
	if receipt == nil {
		t.Fatal("exact parent retirement was not installed")
	}
	select {
	case <-receipt.done:
		t.Fatal("parent retired before child-provider receipt")
	default:
	}
}

func TestSubagentActivationOrdinaryRootOwnsBlockedPreparation(t *testing.T) {
	for _, reentry := range []bool{false, true} {
		t.Run(map[bool]string{false: "outside-remove", true: "prepare-reentrant-remove"}[reentry], func(t *testing.T) {
			ctx := activationTestContext(t)
			h := subagentTestHarness(t)
			parent, err := h.Agents().Create(ctx, AgentOptions{ID: "ordinary-root", CWD: t.TempDir()})
			if err != nil {
				t.Fatal(err)
			}
			entered, cancelled, release := make(chan struct{}), make(chan struct{}), make(chan struct{})
			cleanupEntered, cleanupRelease := make(chan struct{}), make(chan struct{})
			var prepareOnce, cleanupOnce sync.Once
			releasePrepare := func() { prepareOnce.Do(func() { close(release) }) }
			releaseCleanup := func() { cleanupOnce.Do(func() { close(cleanupRelease) }) }
			defer releasePrepare()
			defer releaseCleanup()
			removal := make(chan error, 1)
			failure := errors.New("late provider cleanup failure")
			provider := retirementSubagentProvider{prepare: func(preparing context.Context, request SubagentRequest) (SubagentProviderRun, error) {
				close(entered)
				if reentry {
					removal <- h.Agents().RemoveExact(context.Background(), request.Parent)
				}
				<-preparing.Done()
				close(cancelled)
				<-release
				return SubagentProviderRun{ChildID: "late-external", Result: make(chan SubagentResult), Begin: func() { t.Error("withdrawn preparation began") }, Cancel: func(error) {}, Dispose: func(context.Context) error { close(cleanupEntered); <-cleanupRelease; return failure }}, nil
			}}
			mountRetirementHooks(t, h, func(run *point.Run) error { _, err := h.Subagents().RegisterProvider(run, provider); return err })
			started := make(chan error, 1)
			go func() {
				_, err := h.Subagents().StartActivation(context.Background(), provider.Name(), SubagentRequest{Parent: parent, Prompt: "work", MaxDepth: 2}, "caller")
				started <- err
			}()
			select {
			case <-entered:
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
			if !reentry {
				removal <- h.Agents().RemoveExact(context.Background(), parent)
			}
			if err := activationReceive(t, ctx, removal); !errors.Is(err, ErrAgentDisposalInProgress) {
				t.Fatalf("parent removal receipt=%v", err)
			}
			select {
			case <-cancelled:
			case <-ctx.Done():
				t.Fatal("parent retirement did not cancel provider preparation")
			}
			assertSubagentParentRetirementPending(t, parent)
			releasePrepare()
			select {
			case <-cleanupEntered:
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
			assertSubagentParentRetirementPending(t, parent)
			releaseCleanup()
			if err := activationReceive(t, ctx, started); err == nil {
				t.Fatal("retired parent published a child")
			}
			if err := h.Agents().WaitRetired(ctx, parent); !errors.Is(err, failure) {
				t.Fatalf("parent final cleanup receipt=%v", err)
			}
			if parent.subagentReceipts.Load() != 0 {
				t.Fatal("parent retained settled child-provider busy receipt")
			}
		})
	}
}

func TestSubagentActivationOrdinaryRootOwnsWithdrawnCleanupReentry(t *testing.T) {
	ctx := activationTestContext(t)
	h := subagentTestHarness(t)
	parent, err := h.Agents().Create(ctx, AgentOptions{ID: "withdrawn-root", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	terminal := make(chan SubagentResult, 1)
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	defer unblock()
	removal := make(chan error, 1)
	failure := errors.New("withdrawn external cleanup failure")
	provider := retirementSubagentProvider{prepare: func(context.Context, SubagentRequest) (SubagentProviderRun, error) {
		return SubagentProviderRun{ChildID: "withdrawn-external", Result: terminal, Begin: func() {}, Cancel: func(error) {}, Dispose: func(context.Context) error {
			removal <- h.Agents().RemoveExact(context.Background(), parent)
			close(entered)
			<-release
			return failure
		}}, nil
	}}
	mountRetirementHooks(t, h, func(run *point.Run) error { _, err := h.Subagents().RegisterProvider(run, provider); return err })
	activation, err := h.Subagents().StartActivation(ctx, provider.Name(), SubagentRequest{Parent: parent, Prompt: "work", MaxDepth: 2}, "caller")
	if err != nil {
		t.Fatal(err)
	}
	terminal <- SubagentResult{ChildID: activation.ChildID, Status: SubagentCompleted, Reason: FinishStop}
	close(terminal)
	if err := activationReceive(t, ctx, removal); !errors.Is(err, ErrAgentDisposalInProgress) {
		t.Fatalf("cleanup reentry=%v", err)
	}
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	assertSubagentParentRetirementPending(t, parent)
	unblock()
	if err := activation.Wait(ctx); !errors.Is(err, failure) {
		t.Fatalf("activation final receipt=%v", err)
	}
	if err := h.Agents().WaitRetired(ctx, parent); !errors.Is(err, failure) {
		t.Fatalf("parent final receipt=%v", err)
	}
	if parent.subagentReceipts.Load() != 0 {
		t.Fatal("parent retained settled cleanup busy receipt")
	}
}
