package harness

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"

	point "github.com/phodal/pero/harness/go/runtime"
)

func awaitDescendantSignal(t *testing.T, ctx context.Context, ch <-chan struct{}) {
	t.Helper()
	select {
	case <-ch:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
}

type descendantWaitContext struct {
	context.Context
	entered chan struct{}
	once    sync.Once
}

func (c *descendantWaitContext) Done() <-chan struct{} {
	c.once.Do(func() { close(c.entered) })
	return c.Context.Done()
}

func TestSubagentScopedDrainOwnsUnpublishedRollbackAndFencesAdmission(t *testing.T) {
	h := subagentTestHarness(t)
	ctx := activationTestContext(t)
	r := h.Subagents()
	parent, err := h.Agents().Create(ctx, AgentOptions{ID: "drain-preparing-parent", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	entered, prepareRelease, cleanupEntered, cleanupRelease := make(chan struct{}), make(chan struct{}), make(chan struct{}), make(chan struct{})
	var prepareOnce, cleanupOnce sync.Once
	releasePrepare := func() { prepareOnce.Do(func() { close(prepareRelease) }) }
	releaseCleanup := func() { cleanupOnce.Do(func() { close(cleanupRelease) }) }
	defer releaseCleanup()
	defer releasePrepare()
	failure := errors.New("unpublished cleanup failed")
	provider := retirementSubagentProvider{prepare: func(context.Context, SubagentRequest) (SubagentProviderRun, error) {
		close(entered)
		<-prepareRelease
		return SubagentProviderRun{ChildID: "drain-unpublished-child", Result: make(chan SubagentResult), Begin: func() {}, Cancel: func(error) {}, Dispose: func(context.Context) error { close(cleanupEntered); <-cleanupRelease; return failure }}, nil
	}}
	mountRetirementHooks(t, h, func(run *point.Run) error { _, err := r.RegisterProvider(run, provider); return err })
	started := make(chan error, 1)
	go func() {
		_, err := r.StartActivation(ctx, provider.Name(), SubagentRequest{Parent: parent, Prompt: "work", MaxDepth: 2}, "caller")
		started <- err
	}()
	awaitDescendantSignal(t, ctx, entered)
	receipt := r.BeginDrainDescendants([]*Agent{parent})
	if _, err = r.StartActivation(ctx, provider.Name(), SubagentRequest{Parent: parent, Prompt: "late", MaxDepth: 2}, "caller"); err == nil {
		t.Fatal("draining root admitted another preparation")
	}
	releasePrepare()
	awaitDescendantSignal(t, ctx, cleanupEntered)
	if !r.CaptureSessionActivity(parent.ID()).Active {
		t.Fatal("unpublished cleanup vanished from session activity")
	}
	select {
	case <-receipt.Done():
		t.Fatal("scoped drain returned before rollback receipt")
	default:
	}
	releaseCleanup()
	if err = receipt.Wait(ctx); !errors.Is(err, failure) {
		t.Fatalf("scoped final error=%v", err)
	}
	if err = activationReceive(t, ctx, started); err == nil {
		t.Fatal("cancelled preparation was accepted")
	}
	r.mu.RLock()
	remaining := len(r.preparationReceipts[parent])
	r.mu.RUnlock()
	if remaining != 0 {
		t.Fatal("final preparation receipt leaked")
	}
}

func TestSubagentScopedDrainChildrenValidatesBeforeAnyWithdrawal(t *testing.T) {
	h := subagentTestHarness(t)
	ctx := activationTestContext(t)
	r := h.Subagents()
	first, err := h.Agents().Create(ctx, AgentOptions{ID: "drain-first-parent", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	second, err := h.Agents().Create(ctx, AgentOptions{ID: "drain-second-parent", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	var disposed atomic.Int32
	provider := retirementSubagentProvider{prepare: func(_ context.Context, request SubagentRequest) (SubagentProviderRun, error) {
		return SubagentProviderRun{ChildID: SessionID(string(request.Parent.ID()) + "-child"), Result: make(chan SubagentResult), Begin: func() {}, Cancel: func(error) {}, Dispose: func(context.Context) error { disposed.Add(1); return nil }}, nil
	}}
	mountRetirementHooks(t, h, func(run *point.Run) error { _, err := r.RegisterProvider(run, provider); return err })
	start := func(parent *Agent) SubagentActivation {
		a, err := r.StartActivation(ctx, provider.Name(), SubagentRequest{Parent: parent, Prompt: "work", MaxDepth: 2}, "caller")
		if err != nil {
			t.Fatal(err)
		}
		return a
	}
	one, two := start(first), start(second)
	if _, err = r.BeginDrainChildren(first, []SessionID{one.ChildID, two.ChildID}); err == nil {
		t.Fatal("foreign direct child was authorized")
	}
	if disposed.Load() != 0 {
		t.Fatal("batch partly withdrew before checking all ownership")
	}
	receipt, err := r.BeginDrainChildren(first, []SessionID{one.ChildID, one.ChildID})
	if err != nil {
		t.Fatal(err)
	}
	if err = receipt.Wait(ctx); err != nil {
		t.Fatal(err)
	}
	if disposed.Load() != 1 {
		t.Fatalf("exact selected disposals=%d", disposed.Load())
	}
	select {
	case <-two.Done:
		t.Fatal("selected drain stopped foreign parent's child")
	default:
	}
	intermediate, err := h.Agents().Create(ctx, AgentOptions{ID: "drain-intermediate", Parent: first, Delegated: true, CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	grandchild := start(intermediate)
	if err = r.BeginDrainDescendants([]*Agent{first, first}).Wait(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case <-grandchild.Done:
	default:
		t.Fatal("scoped root drain missed a deeper external descendant")
	}
	if _, err = r.StartActivation(ctx, provider.Name(), SubagentRequest{Parent: intermediate, Prompt: "late descendant", MaxDepth: 3}, "caller"); err == nil {
		t.Fatal("closed ancestor admitted a new grandchild")
	}
	select {
	case <-two.Done:
		t.Fatal("root drain stopped a foreign family")
	default:
	}
	_ = two.RequestDispose()
	if err = two.Wait(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestSubagentWaitForChildrenRechecksPublishedDescendants(t *testing.T) {
	h := subagentTestHarness(t)
	ctx := activationTestContext(t)
	r := h.Subagents()
	parent, err := h.Agents().Create(ctx, AgentOptions{ID: "wait-progress-parent", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	terminals := []chan SubagentResult{make(chan SubagentResult, 1), make(chan SubagentResult, 1)}
	var next atomic.Int32
	provider := retirementSubagentProvider{prepare: func(context.Context, SubagentRequest) (SubagentProviderRun, error) {
		index := int(next.Add(1)) - 1
		return SubagentProviderRun{ChildID: SessionID(fmt.Sprintf("wait-child-%d", index)), Result: terminals[index], Begin: func() {}, Cancel: func(error) {}, Dispose: func(context.Context) error { return nil }}, nil
	}}
	mountRetirementHooks(t, h, func(run *point.Run) error { _, err := r.RegisterProvider(run, provider); return err })
	start := func() SubagentActivation {
		a, err := r.StartActivation(ctx, provider.Name(), SubagentRequest{Parent: parent, Prompt: "work", MaxDepth: 2}, "caller")
		if err != nil {
			t.Fatal(err)
		}
		return a
	}
	one := start()
	waiting := &descendantWaitContext{Context: ctx, entered: make(chan struct{})}
	result := make(chan struct {
		observed bool
		err      error
	}, 1)
	go func() {
		observed, err := r.WaitForChildren(waiting, parent)
		result <- struct {
			observed bool
			err      error
		}{observed, err}
	}()
	awaitDescendantSignal(t, ctx, waiting.entered)
	two := start()
	terminals[0] <- SubagentResult{ChildID: one.ChildID, Status: SubagentCompleted, Reason: FinishStop}
	close(terminals[0])
	if err = one.Wait(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case out := <-result:
		t.Fatalf("wait missed child published during await: %+v", out)
	default:
	}
	terminals[1] <- SubagentResult{ChildID: two.ChildID, Status: SubagentCompleted, Reason: FinishStop}
	close(terminals[1])
	out := activationReceive(t, ctx, result)
	if !out.observed || out.err != nil {
		t.Fatalf("wait=%+v", out)
	}
	if observed, err := r.WaitForChildren(ctx, parent); observed || err != nil {
		t.Fatalf("settled family remained progressing: %v %v", observed, err)
	}
}

func TestSubagentWaitForChildrenLeavesIdleParkedInput(t *testing.T) {
	h := subagentTestHarness(t)
	ctx := activationTestContext(t)
	r := h.Subagents()
	parent, err := h.Agents().Create(ctx, AgentOptions{ID: "parked-parent", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	child, err := h.Agents().Create(ctx, AgentOptions{ID: "parked-child", Parent: parent, CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	if err = child.Inject(Message{Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: "do not wake"}}}); err != nil {
		t.Fatal(err)
	}
	// This unit fixture isolates the idle/parked observation boundary without a
	// turn completion observer independently settling the synthetic activation.
	state := newSubagentActivation("caller")
	record := &subagentRecord{parent: parent, child: child, activation: state, snapshot: SubagentSnapshot{ID: child.ID(), Parent: parent.ID(), Continuable: true}}
	r.mu.Lock()
	r.records[child.ID()] = record
	r.mu.Unlock()
	defer func() { r.mu.Lock(); delete(r.records, child.ID()); r.mu.Unlock() }()
	if observed, err := r.WaitForChildren(ctx, parent); observed || err != nil {
		t.Fatalf("parked input incorrectly joined: %v %v", observed, err)
	}
	if child.Status() != AgentIdle {
		t.Fatal("wait woke an idle child")
	}
	child.injectMu.Lock()
	parked := len(child.injected)
	child.injectMu.Unlock()
	if parked != 1 {
		t.Fatal("wait discarded parked input")
	}
}

func TestSubagentArchiveSnapshotFencesLatePreparationAndAllowsUnarchive(t *testing.T) {
	h := subagentTestHarness(t)
	ctx := activationTestContext(t)
	r := h.Subagents()
	parent, err := h.Agents().Create(ctx, AgentOptions{ID: "archive-exact-parent", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	var archived atomic.Bool
	off := r.RegisterArchivedSessionCheck(func(id SessionID) bool { return id == parent.ID() && archived.Load() })
	defer off()
	var next atomic.Int32
	provider := retirementSubagentProvider{prepare: func(context.Context, SubagentRequest) (SubagentProviderRun, error) {
		id := SessionID(fmt.Sprintf("archive-child-%d", next.Add(1)))
		return SubagentProviderRun{ChildID: id, Result: make(chan SubagentResult), Begin: func() {}, Cancel: func(error) {}, Dispose: func(context.Context) error { return nil }}, nil
	}}
	mountRetirementHooks(t, h, func(run *point.Run) error { _, err := r.RegisterProvider(run, provider); return err })
	captured := r.CaptureSessionActivity(parent.ID())
	if captured.Active {
		t.Fatal("empty family reported activity")
	}
	start := func() (SubagentActivation, error) {
		return r.StartActivation(ctx, provider.Name(), SubagentRequest{Parent: parent, Prompt: "work", MaxDepth: 2}, "caller")
	}
	late, err := start()
	if err != nil {
		t.Fatal(err)
	}
	active := r.CaptureSessionActivity(parent.ID())
	if !active.Active || len(active.Items) != 1 || active.Items[0].ID != late.ChildID {
		t.Fatalf("external activity=%+v", active)
	}
	archived.Store(true)
	if err = captured.Stop(ctx); err != nil {
		t.Fatal(err)
	}
	if err = late.Wait(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err = start(); err == nil {
		t.Fatal("committed archive admitted another child")
	}
	archived.Store(false)
	resumed, err := start()
	if err != nil {
		t.Fatalf("unarchive did not reopen same exact parent: %v", err)
	}
	_ = resumed.RequestDispose()
	if err = resumed.Wait(ctx); err != nil {
		t.Fatal(err)
	}
	// An earlier archive capture may not adopt a later incarnation with the
	// same durable session identity after the old owner has fully retired.
	stale := r.CaptureSessionActivity(parent.ID())
	if err = h.Agents().RemoveExact(ctx, parent); err != nil && !errors.Is(err, ErrAgentDisposalInProgress) {
		t.Fatal(err)
	}
	if err = h.Agents().WaitRetired(ctx, parent); err != nil {
		t.Fatal(err)
	}
	parent, err = h.Agents().Resume(ctx, parent.Session(), AgentOptions{})
	if err != nil {
		t.Fatal(err)
	}
	replacement, err := start()
	if err != nil {
		t.Fatal(err)
	}
	if err = stale.Stop(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case <-replacement.Done:
		t.Fatal("stale archive snapshot adopted replacement generation")
	default:
	}
	_ = replacement.RequestDispose()
	if err = replacement.Wait(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestSubagentScopedDrainStartedCallbackReturnsPendingReceipt(t *testing.T) {
	h := subagentTestHarness(t)
	ctx := activationTestContext(t)
	r := h.Subagents()
	parent, err := h.Agents().Create(ctx, AgentOptions{ID: "drain-callback-parent", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	var disposed atomic.Int32
	provider := retirementSubagentProvider{prepare: func(context.Context, SubagentRequest) (SubagentProviderRun, error) {
		return SubagentProviderRun{ChildID: "drain-callback-child", Result: make(chan SubagentResult), Begin: func() {}, Cancel: func(error) {}, Dispose: func(context.Context) error { disposed.Add(1); return nil }}, nil
	}}
	callback := make(chan error, 1)
	mountRetirementHooks(t, h, func(run *point.Run) error {
		if _, err := r.RegisterProvider(run, provider); err != nil {
			return err
		}
		_, err := r.Started.On(run, func(context.Context, SubagentLifecycle) error {
			callback <- r.DrainDescendants(context.Background(), []*Agent{parent})
			return nil
		})
		return err
	})
	if _, err = r.StartActivation(ctx, provider.Name(), SubagentRequest{Parent: parent, Prompt: "work", MaxDepth: 2}, "caller"); err == nil {
		t.Fatal("callback-drained start was accepted")
	}
	if err = activationReceive(t, ctx, callback); !errors.Is(err, ErrSubagentDrainPending) {
		t.Fatalf("callback result=%v", err)
	}
	if err = r.BeginDrainDescendants([]*Agent{parent}).Wait(ctx); err != nil {
		t.Fatal(err)
	}
	if disposed.Load() != 1 {
		t.Fatalf("callback disposal calls=%d", disposed.Load())
	}
}

func TestSubagentFacadeScopedDrainDoesNotCloseOtherGenerations(t *testing.T) {
	h := subagentTestHarness(t)
	ctx := activationTestContext(t)
	r := h.Subagents()
	parent, err := h.Agents().Create(ctx, AgentOptions{ID: "facade-drain-parent", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	var next atomic.Int32
	provider := retirementSubagentProvider{prepare: func(context.Context, SubagentRequest) (SubagentProviderRun, error) {
		return SubagentProviderRun{ChildID: SessionID(fmt.Sprintf("facade-drain-child-%d", next.Add(1))), Result: make(chan SubagentResult), Begin: func() {}, Cancel: func(error) {}, Dispose: func(context.Context) error { return nil }}, nil
	}}
	mountRetirementHooks(t, h, func(run *point.Run) error { _, err := r.RegisterProvider(run, provider); return err })
	one, err := r.NewFacade(DefaultSubagentRuntimeConfig())
	if err != nil {
		t.Fatal(err)
	}
	two, err := r.NewFacade(DefaultSubagentRuntimeConfig())
	if err != nil {
		t.Fatal(err)
	}
	request := SubagentRequest{Parent: parent, Prompt: "work", MaxDepth: 2}
	first, err := one.StartActivation(ctx, provider.Name(), request, "caller")
	if err != nil {
		t.Fatal(err)
	}
	second, err := two.StartActivation(ctx, provider.Name(), request, "caller")
	if err != nil {
		t.Fatal(err)
	}
	if err = one.BeginDrainDescendants([]*Agent{parent}).Wait(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case <-first.Done:
	default:
		t.Fatal("own generation drain missed its activation")
	}
	select {
	case <-second.Done:
		t.Fatal("drain stopped a foreign facade generation")
	default:
	}
	if observed, err := one.WaitForChildren(ctx, parent); observed || err != nil {
		t.Fatalf("facade wait observed a foreign activation: %v %v", observed, err)
	}
	if _, err = one.StartActivation(ctx, provider.Name(), request, "caller"); err == nil {
		t.Fatal("drained facade root admitted another child")
	}
	third, err := two.StartActivation(ctx, provider.Name(), request, "caller")
	if err != nil {
		t.Fatalf("foreign facade root was fenced: %v", err)
	}
	native, err := r.StartActivation(ctx, provider.Name(), request, "caller")
	if err != nil {
		t.Fatalf("facade drain fenced native callers: %v", err)
	}
	_ = two.RequestDispose()
	if err = two.Wait(ctx); err != nil {
		t.Fatal(err)
	}
	if err = third.Wait(ctx); err != nil {
		t.Fatal(err)
	}
	_ = native.RequestDispose()
	if err = native.Wait(ctx); err != nil {
		t.Fatal(err)
	}
	_ = one.RequestDispose()
	if err = one.Wait(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestSubagentScopedDrainOwnedOperationReturnsPending(t *testing.T) {
	for _, descendants := range []bool{false, true} {
		t.Run(fmt.Sprintf("descendants=%v", descendants), func(t *testing.T) {
			h := capacityBlockingHarness(t)
			ctx := activationTestContext(t)
			r := h.Subagents()
			parent := capacityParent(t, h, "drain-operation-parent")
			local := &capacityLocalProvider{h: h}
			capacityRegister(t, h, local)
			activation := capacityStart(t, h, parent, local.Name(), "caller")
			child, ok := h.Agents().Get(activation.ChildID)
			if !ok {
				t.Fatal("missing local activation")
			}
			operation, err := child.beginOperation(ctx)
			if err != nil {
				t.Fatal(err)
			}
			var once sync.Once
			release := func() { once.Do(operation.release) }
			defer release()
			if descendants {
				err = r.DrainDescendants(ctx, []*Agent{parent})
			} else {
				err = r.DrainChildren(ctx, parent, []SessionID{activation.ChildID})
			}
			if !errors.Is(err, ErrSubagentDrainPending) {
				t.Fatalf("owned operation drain=%v", err)
			}
			receipt, err := r.BeginDrainChildren(parent, []SessionID{activation.ChildID})
			if err != nil {
				t.Fatal(err)
			}
			select {
			case <-receipt.Done():
				t.Fatal("drain completed before owned operation returned")
			default:
			}
			release()
			if err := receipt.Wait(ctx); err != nil {
				t.Fatal(err)
			}
			if err := activation.Wait(ctx); err != nil {
				t.Fatal(err)
			}
			if err := h.Agents().WaitRetired(ctx, child); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestSubagentScopedDrainOrdinaryCallerJoinsExactCleanup(t *testing.T) {
	for _, descendants := range []bool{false, true} {
		t.Run(fmt.Sprintf("descendants=%v", descendants), func(t *testing.T) {
			h := subagentTestHarness(t)
			ctx := activationTestContext(t)
			r := h.Subagents()
			parent := capacityParent(t, h, "drain-ordinary-parent")
			cleanupEntered, cleanupRelease := make(chan struct{}), make(chan struct{})
			var once sync.Once
			release := func() { once.Do(func() { close(cleanupRelease) }) }
			defer release()
			provider := retirementSubagentProvider{prepare: func(context.Context, SubagentRequest) (SubagentProviderRun, error) {
				return SubagentProviderRun{ChildID: "drain-ordinary-child", Result: make(chan SubagentResult), Begin: func() {}, Cancel: func(error) {}, Dispose: func(context.Context) error { close(cleanupEntered); <-cleanupRelease; return nil }}, nil
			}}
			mountRetirementHooks(t, h, func(run *point.Run) error { _, err := r.RegisterProvider(run, provider); return err })
			activation := capacityStart(t, h, parent, provider.Name(), "caller")
			// The target cleanup does not depend on a parent operation. Do not
			// mistake it or the standing parent receipt for child callback reentry.
			operation, err := parent.beginOperation(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer operation.release()
			waitCtx := &descendantWaitContext{Context: ctx, entered: make(chan struct{})}
			drained := make(chan error, 1)
			go func() {
				if descendants {
					drained <- r.DrainDescendants(waitCtx, []*Agent{parent})
				} else {
					drained <- r.DrainChildren(waitCtx, parent, []SessionID{activation.ChildID})
				}
			}()
			awaitDescendantSignal(t, ctx, cleanupEntered)
			select {
			case err := <-drained:
				t.Fatalf("ordinary drain returned before exact cleanup: %v", err)
			case <-waitCtx.entered:
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
			release()
			if err := activationReceive(t, ctx, drained); err != nil {
				t.Fatal(err)
			}
			if err := activation.Wait(ctx); err != nil {
				t.Fatal(err)
			}
		})
	}
}
