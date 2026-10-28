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

func capacityInt(value int) *int { return &value }

func capacityLimitError(t *testing.T, err error, capacity int) {
	t.Helper()
	var coded interface{ ToolErrorCode() string }
	if !errors.As(err, &coded) || coded.ToolErrorCode() != "ACTIVATION_LIMIT_REACHED" {
		t.Fatalf("expected capacity rejection, got %v", err)
	}
	expected := fmt.Sprintf("subagent limit reached (active child limit: %d); wait for an existing child to finish or complete this work with the current agents", capacity)
	if err.Error() != expected {
		t.Fatalf("capacity diagnostic=%q", err.Error())
	}
}

func capacityParent(t *testing.T, h *Harness, id SessionID) *Agent {
	t.Helper()
	parent, err := h.Agents().Create(t.Context(), AgentOptions{ID: id, CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	return parent
}

func capacityStart(t *testing.T, h *Harness, parent *Agent, provider string, delivery string) SubagentActivation {
	t.Helper()
	activation, err := h.Subagents().StartActivation(activationTestContext(t), provider, SubagentRequest{Parent: parent, Prompt: "capacity test", MaxDepth: 8}, delivery)
	if err != nil {
		t.Fatal(err)
	}
	return activation
}

func capacityDispose(t *testing.T, activation SubagentActivation) {
	t.Helper()
	err := activation.RequestDispose()
	if err != nil && !errors.Is(err, ErrSubagentActivationDisposalPending) {
		t.Fatal(err)
	}
	if err := activation.Wait(activationTestContext(t)); err != nil {
		t.Fatal(err)
	}
}

type capacityExternalProvider struct {
	name    string
	next    atomic.Int32
	prepare func(context.Context, SubagentRequest, int32) (SubagentProviderRun, error)
}

func (p *capacityExternalProvider) Name() string { return p.name }
func (*capacityExternalProvider) Capabilities() SubagentCapabilities {
	return SubagentCapabilities{DepthLimit: true}
}
func (*capacityExternalProvider) InheritsParentContext() bool { return false }
func (p *capacityExternalProvider) Prepare(ctx context.Context, request SubagentRequest) (SubagentProviderRun, error) {
	index := p.next.Add(1)
	if p.prepare != nil {
		return p.prepare(ctx, request, index)
	}
	return SubagentProviderRun{ChildID: SessionID(fmt.Sprintf("%s-%d", p.name, index)), Result: make(chan SubagentResult), Begin: func() {}, Cancel: func(error) {}, Dispose: func(context.Context) error { return nil }}, nil
}

func capacityRegister(t *testing.T, h *Harness, providers ...SubagentProvider) {
	t.Helper()
	mountRetirementHooks(t, h, func(run *point.Run) error {
		for _, provider := range providers {
			if _, err := h.Subagents().RegisterProvider(run, provider); err != nil {
				return err
			}
		}
		return nil
	})
}

func TestSubagentCapacityConfigDefaultsAndAtomicUpdates(t *testing.T) {
	registry := subagentTestHarness(t).Subagents()
	if got := registry.Config(); got != (SubagentRuntimeConfig{MaxDepth: 1, MaxActiveSubagents: 8}) {
		t.Fatalf("defaults=%+v", got)
	}
	for _, config := range []SubagentRuntimeConfig{{-1, 8}, {1, 0}, {1, -1}, {SubagentMaxSafeInteger + 1, 8}, {1, SubagentMaxSafeInteger + 1}} {
		if err := registry.ReplaceConfig(config); err == nil {
			t.Fatalf("accepted invalid config %+v", config)
		}
	}
	if err := registry.UpdateConfig(SubagentRuntimeConfigUpdate{MaxDepth: capacityInt(0)}); err != nil {
		t.Fatal(err)
	}
	if err := registry.UpdateConfig(SubagentRuntimeConfigUpdate{MaxDepth: capacityInt(4), MaxActiveSubagents: capacityInt(0)}); err == nil {
		t.Fatal("invalid compound edit accepted")
	}
	if got := registry.Config(); got.MaxDepth != 0 || got.MaxActiveSubagents != 8 {
		t.Fatalf("partial invalid commit=%+v", got)
	}
	depth, err := registry.ResolveMaxDepth(nil, false)
	if err != nil || depth == nil || *depth != 0 {
		t.Fatalf("zero default=%v %v", depth, err)
	}
	explicit := 2
	depth, err = registry.ResolveMaxDepth(&explicit, false)
	if err != nil || depth == nil || *depth != 2 {
		t.Fatalf("explicit depth=%v %v", depth, err)
	}
	*depth = 3
	if explicit != 2 {
		t.Fatal("resolver aliases caller memory")
	}
	if depth, err := registry.ResolveMaxDepth(nil, true); err != nil || depth != nil {
		t.Fatalf("provider-managed=%v %v", depth, err)
	}
	if err := registry.ReplaceConfig(SubagentRuntimeConfig{MaxDepth: 4, MaxActiveSubagents: SubagentMaxSafeInteger}); err != nil {
		t.Fatal(err)
	}
	depth, err = registry.ResolveMaxDepth(nil, false)
	if err != nil || *depth != 4 {
		t.Fatalf("replacement default=%v %v", depth, err)
	}
}

func TestSubagentCapacityReservesBeforeProviderAndReleasesFailedPreparation(t *testing.T) {
	h := subagentTestHarness(t)
	ctx := activationTestContext(t)
	parent := capacityParent(t, h, "capacity-preparing-parent")
	if err := h.Subagents().UpdateConfig(SubagentRuntimeConfigUpdate{MaxActiveSubagents: capacityInt(1)}); err != nil {
		t.Fatal(err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	defer unblock()
	failure := errors.New("preparation failed")
	p := &capacityExternalProvider{name: "capacity-preparing"}
	p.prepare = func(ctx context.Context, _ SubagentRequest, index int32) (SubagentProviderRun, error) {
		if index == 1 {
			close(entered)
			select {
			case <-release:
			case <-ctx.Done():
				return SubagentProviderRun{}, ctx.Err()
			}
			return SubagentProviderRun{}, failure
		}
		return SubagentProviderRun{ChildID: "capacity-after-failure", Result: make(chan SubagentResult), Begin: func() {}, Cancel: func(error) {}, Dispose: func(context.Context) error { return nil }}, nil
	}
	capacityRegister(t, h, p)
	failed := make(chan error, 1)
	go func() {
		_, err := h.Subagents().StartActivation(ctx, p.Name(), SubagentRequest{Parent: parent, Prompt: "first", MaxDepth: 1}, "caller")
		failed <- err
	}()
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	_, err := h.Subagents().StartActivation(ctx, p.Name(), SubagentRequest{Parent: parent, Prompt: "blocked", MaxDepth: 1}, "caller")
	capacityLimitError(t, err, 1)
	if p.next.Load() != 1 {
		t.Fatalf("provider invoked beyond reserved capacity: %d", p.next.Load())
	}
	unblock()
	if err := activationReceive(t, ctx, failed); !errors.Is(err, failure) {
		t.Fatal(err)
	}
	replacement := capacityStart(t, h, parent, p.Name(), "caller")
	capacityDispose(t, replacement)
}

func TestSubagentCapacityConcurrentDefaultEightAndIndependentRoots(t *testing.T) {
	h := subagentTestHarness(t)
	ctx := activationTestContext(t)
	parent := capacityParent(t, h, "capacity-root")
	other := capacityParent(t, h, "capacity-other-root")
	p := &capacityExternalProvider{name: "capacity-parallel"}
	capacityRegister(t, h, p)
	type outcome struct {
		activation SubagentActivation
		err        error
	}
	ready := make(chan struct{})
	outcomes := make(chan outcome, 16)
	for index := 0; index < 16; index++ {
		go func() {
			<-ready
			a, e := h.Subagents().StartActivation(ctx, p.Name(), SubagentRequest{Parent: parent, Prompt: "parallel", MaxDepth: 1}, "caller")
			outcomes <- outcome{a, e}
		}()
	}
	close(ready)
	var active []SubagentActivation
	for index := 0; index < 16; index++ {
		out := activationReceive(t, ctx, outcomes)
		if out.err != nil {
			capacityLimitError(t, out.err, 8)
		} else {
			active = append(active, out.activation)
		}
	}
	if len(active) != 8 || p.next.Load() != 8 {
		t.Fatalf("accepted=%d provider calls=%d", len(active), p.next.Load())
	}
	independent := capacityStart(t, h, other, p.Name(), "parent")
	for _, activation := range active {
		capacityDispose(t, activation)
	}
	capacityDispose(t, independent)
	replacement := capacityStart(t, h, parent, p.Name(), "caller")
	capacityDispose(t, replacement)
	h.Subagents().mu.RLock()
	defer h.Subagents().mu.RUnlock()
	if len(h.Subagents().activationPools) != 0 {
		t.Fatal("settled root identities retained in capacity map")
	}
}

func TestSubagentCapacityRuntimeEditsDoNotEvictAndShareDeliveryModes(t *testing.T) {
	h := subagentTestHarness(t)
	ctx := activationTestContext(t)
	parent := capacityParent(t, h, "capacity-edit-parent")
	registry := h.Subagents()
	p := &capacityExternalProvider{name: "capacity-edits"}
	capacityRegister(t, h, p)
	if err := registry.UpdateConfig(SubagentRuntimeConfigUpdate{MaxActiveSubagents: capacityInt(1)}); err != nil {
		t.Fatal(err)
	}
	first := capacityStart(t, h, parent, p.Name(), "caller")
	_, err := registry.StartActivation(ctx, p.Name(), SubagentRequest{Parent: parent, Prompt: "blocked", MaxDepth: 1}, "parent")
	capacityLimitError(t, err, 1)
	if err := registry.UpdateConfig(SubagentRuntimeConfigUpdate{MaxActiveSubagents: capacityInt(2)}); err != nil {
		t.Fatal(err)
	}
	second := capacityStart(t, h, parent, p.Name(), "parent")
	if err := registry.UpdateConfig(SubagentRuntimeConfigUpdate{MaxActiveSubagents: capacityInt(1)}); err != nil {
		t.Fatal(err)
	}
	for _, a := range []SubagentActivation{first, second} {
		select {
		case <-a.Done:
			t.Fatal("lowering capacity evicted resident")
		default:
		}
	}
	capacityDispose(t, first)
	_, err = registry.StartActivation(ctx, p.Name(), SubagentRequest{Parent: parent, Prompt: "still blocked", MaxDepth: 1}, "caller")
	capacityLimitError(t, err, 1)
	if err := registry.UpdateConfig(SubagentRuntimeConfigUpdate{MaxActiveSubagents: capacityInt(3)}); err != nil {
		t.Fatal(err)
	}
	third := capacityStart(t, h, parent, p.Name(), "caller")
	capacityDispose(t, second)
	capacityDispose(t, third)
}

func TestSubagentCapacityRetainedThroughCleanupAndReleasedBeforeSettlement(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(fmt.Sprint(fail), func(t *testing.T) {
			h := subagentTestHarness(t)
			ctx := activationTestContext(t)
			parent := capacityParent(t, h, "capacity-cleanup-parent")
			registry := h.Subagents()
			if err := registry.UpdateConfig(SubagentRuntimeConfigUpdate{MaxActiveSubagents: capacityInt(1)}); err != nil {
				t.Fatal(err)
			}
			entered, release := make(chan struct{}), make(chan struct{})
			var once sync.Once
			unblock := func() { once.Do(func() { close(release) }) }
			defer unblock()
			cleanupFailure := errors.New("cleanup failed after barrier")
			p := &capacityExternalProvider{name: "capacity-cleanup"}
			p.prepare = func(_ context.Context, _ SubagentRequest, index int32) (SubagentProviderRun, error) {
				return SubagentProviderRun{ChildID: SessionID(fmt.Sprintf("capacity-cleanup-%d", index)), Result: make(chan SubagentResult), Begin: func() {}, Cancel: func(error) {}, Dispose: func(context.Context) error {
					if index == 1 {
						close(entered)
						<-release
						if fail {
							return cleanupFailure
						}
					}
					return nil
				}}, nil
			}
			admitted := make(chan SubagentActivation, 1)
			observerErrors := make(chan error, 1)
			mountRetirementHooks(t, h, func(run *point.Run) error {
				if _, err := registry.RegisterProvider(run, p); err != nil {
					return err
				}
				_, err := registry.Ended.On(run, func(_ context.Context, info SubagentLifecycle) error {
					if info.ID != "capacity-cleanup-1" {
						return nil
					}
					a, e := registry.StartActivation(ctx, p.Name(), SubagentRequest{Parent: parent, Prompt: "replacement in end", MaxDepth: 1}, "caller")
					if e != nil {
						observerErrors <- e
					} else {
						admitted <- a
					}
					return nil
				})
				return err
			})
			first := capacityStart(t, h, parent, p.Name(), "caller")
			_ = first.RequestDispose()
			select {
			case <-entered:
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
			_, err := registry.StartActivation(ctx, p.Name(), SubagentRequest{Parent: parent, Prompt: "too early", MaxDepth: 1}, "caller")
			capacityLimitError(t, err, 1)
			unblock()
			if err := first.Wait(ctx); (fail && !errors.Is(err, cleanupFailure)) || (!fail && err != nil) {
				t.Fatalf("final cleanup=%v", err)
			}
			select {
			case err := <-observerErrors:
				t.Fatalf("slot still held at settlement: %v", err)
			case replacement := <-admitted:
				capacityDispose(t, replacement)
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
		})
	}
}

func TestSubagentCapacityDepthBoundariesAndProviderManaged(t *testing.T) {
	h := subagentTestHarness(t)
	ctx := activationTestContext(t)
	parent := capacityParent(t, h, "capacity-depth-parent")
	p := &capacityExternalProvider{name: "capacity-depth"}
	capacityRegister(t, h, p)
	for _, max := range []int{0, -1, SubagentMaxSafeInteger + 1} {
		_, err := h.Subagents().StartActivation(ctx, p.Name(), SubagentRequest{Parent: parent, Prompt: "forbidden", MaxDepth: max}, "caller")
		if err == nil {
			t.Fatalf("maxDepth %d accepted", max)
		}
		if max == 0 {
			var depth *SubagentDepthError
			if !errors.As(err, &depth) || depth.AttemptedDepth != 1 || depth.MaxDepth != 0 || err.Error() != "subagent depth 1 exceeds maxDepth 0" {
				t.Fatalf("zero cap=%v", err)
			}
		}
	}
	if p.next.Load() != 0 {
		t.Fatal("invalid cap created provider resources")
	}
	a, err := h.Subagents().StartActivation(ctx, p.Name(), SubagentRequest{Parent: parent, Prompt: "uncapped", ProviderManagedDepth: true}, "caller")
	if err != nil {
		t.Fatal(err)
	}
	capacityDispose(t, a)
}

type capacityLocalProvider struct {
	h       *Harness
	next    atomic.Int32
	resumes atomic.Int32
}

func (*capacityLocalProvider) Name() string { return "capacity-local" }
func (*capacityLocalProvider) Capabilities() SubagentCapabilities {
	return SubagentCapabilities{DepthLimit: true}
}
func (*capacityLocalProvider) InheritsParentContext() bool { return false }
func (*capacityLocalProvider) Prepare(context.Context, SubagentRequest) (SubagentProviderRun, error) {
	return SubagentProviderRun{}, errors.New("use local preparation")
}
func (p *capacityLocalProvider) create(ctx context.Context, parent *Agent, id SessionID, depth int) (SubagentContinuationProviderRun, error) {
	child, err := p.h.Agents().Create(ctx, AgentOptions{ID: id, Parent: parent, Delegated: true, DelegationDepth: depth, CWD: parent.Session().WorkingDirectory()})
	if err != nil {
		return SubagentContinuationProviderRun{}, err
	}
	return SubagentContinuationProviderRun{ChildID: id, Child: child, Submit: child.FollowupResultContext, Dispose: func(ctx context.Context) error { return p.h.Agents().RemoveExact(ctx, child) }}, nil
}
func (p *capacityLocalProvider) PrepareContinuable(ctx context.Context, request SubagentRequest) (SubagentContinuationProviderRun, error) {
	return p.PrepareActivation(ctx, request)
}
func (p *capacityLocalProvider) PrepareActivation(ctx context.Context, request SubagentRequest) (SubagentContinuationProviderRun, error) {
	id := SessionID(fmt.Sprintf("capacity-local-%d", p.next.Add(1)))
	prepared, err := p.create(ctx, request.Parent, id, request.Depth)
	if err != nil {
		return prepared, err
	}
	prepared.InitialMessageID = request.InitialPromptMessage().ID
	prepared.Begin = func(ctx context.Context) (<-chan TurnOutcome, error) {
		return prepared.Child.FollowupResultContext(ctx, request.InitialPromptMessage())
	}
	return prepared, nil
}
func (p *capacityLocalProvider) PrepareResume(ctx context.Context, parent *Agent, id SessionID) (SubagentContinuationProviderRun, SubagentSnapshot, error) {
	return p.PrepareManagedResume(ctx, parent, id)
}
func (p *capacityLocalProvider) PrepareManagedResume(ctx context.Context, parent *Agent, id SessionID) (SubagentContinuationProviderRun, SubagentSnapshot, error) {
	p.resumes.Add(1)
	session, found := p.h.Sessions().Get(id)
	if !found {
		return SubagentContinuationProviderRun{}, SubagentSnapshot{}, ErrSubagentResumeUnavailable
	}
	child, err := p.h.Agents().Resume(ctx, session, AgentOptions{Parent: parent, Delegated: true})
	if err != nil {
		return SubagentContinuationProviderRun{}, SubagentSnapshot{}, err
	}
	prepared := SubagentContinuationProviderRun{ChildID: id, Child: child, Submit: child.FollowupResultContext, Dispose: func(ctx context.Context) error { return p.h.Agents().RemoveExact(ctx, child) }}
	return prepared, SubagentSnapshot{ID: id, Provider: p.Name(), Parent: parent.ID(), Continuable: true}, nil
}

func capacityBlockingHarness(t *testing.T) *Harness {
	t.Helper()
	h, err := Boot(t.Context(), Options{EnableSubagents: true, Adapter: AdapterFunc(func(ctx context.Context, _ GenerateRequest, _ func(StreamChunk) error) (Completion, error) {
		<-ctx.Done()
		return Completion{}, ctx.Err()
	})})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.Dispose(context.Background()) })
	return h
}

func TestSubagentCapacityManagedAncestryAndUnmanagedBreaks(t *testing.T) {
	h := capacityBlockingHarness(t)
	ctx := activationTestContext(t)
	root := capacityParent(t, h, "capacity-lineage-root")
	other := capacityParent(t, h, "capacity-lineage-other")
	local := &capacityLocalProvider{h: h}
	external := &capacityExternalProvider{name: "capacity-lineage-external"}
	capacityRegister(t, h, local, external)
	if err := h.Subagents().UpdateConfig(SubagentRuntimeConfigUpdate{MaxActiveSubagents: capacityInt(3)}); err != nil {
		t.Fatal(err)
	}
	first := capacityStart(t, h, root, local.Name(), "caller")
	child, ok := h.Agents().Get(first.ChildID)
	if !ok {
		t.Fatal("managed child absent")
	}
	nested := capacityStart(t, h, child, external.Name(), "caller")
	sibling := capacityStart(t, h, root, external.Name(), "caller")
	for _, parent := range []*Agent{root, child} {
		_, err := h.Subagents().StartActivation(ctx, external.Name(), SubagentRequest{Parent: parent, Prompt: "full tree", MaxDepth: 8}, "caller")
		capacityLimitError(t, err, 3)
	}
	independent := capacityStart(t, h, other, external.Name(), "caller")
	unmanaged, err := h.Agents().Create(ctx, AgentOptions{ID: "capacity-unmanaged-link", Parent: root, CWD: root.Session().WorkingDirectory()})
	if err != nil {
		t.Fatal(err)
	}
	split := capacityStart(t, h, unmanaged, external.Name(), "caller")
	// A durable ancestry edge without a resident managed activation starts a new pool.
	capacityDispose(t, split)
	capacityDispose(t, independent)
	capacityDispose(t, nested)
	capacityDispose(t, sibling)
	capacityDispose(t, first)
}

func TestSubagentCapacityColdResumeReservesAndResidentMessageDoesNot(t *testing.T) {
	h := capacityBlockingHarness(t)
	ctx := activationTestContext(t)
	parent := capacityParent(t, h, "capacity-cold-parent")
	local := &capacityLocalProvider{h: h}
	capacityRegister(t, h, local)
	if err := h.Subagents().UpdateConfig(SubagentRuntimeConfigUpdate{MaxActiveSubagents: capacityInt(1)}); err != nil {
		t.Fatal(err)
	}
	first := capacityStart(t, h, parent, local.Name(), "caller")
	capacityDispose(t, first)
	busy := capacityStart(t, h, parent, local.Name(), "caller")
	_, err := h.Subagents().SendMessage(ctx, parent, first.ChildID, []ContentBlock{{Type: BlockText, Text: "cold"}})
	capacityLimitError(t, err, 1)
	if local.resumes.Load() != 0 {
		t.Fatal("cold provider called without capacity")
	}
	if _, err := h.Subagents().SendMessage(ctx, parent, busy.ChildID, []ContentBlock{{Type: BlockText, Text: "resident"}}); err != nil {
		t.Fatalf("resident input consumed a second slot: %v", err)
	}
	capacityDispose(t, busy)
	if _, err := h.Subagents().SendMessage(ctx, parent, first.ChildID, []ContentBlock{{Type: BlockText, Text: "cold"}}); err != nil {
		t.Fatal(err)
	}
	if local.resumes.Load() != 1 {
		t.Fatalf("resume calls=%d", local.resumes.Load())
	}
	_, err = h.Subagents().StartActivation(ctx, local.Name(), SubagentRequest{Parent: parent, Prompt: "cold is resident", MaxDepth: 8}, "caller")
	capacityLimitError(t, err, 1)
	h.Subagents().mu.RLock()
	record := h.Subagents().records[first.ChildID]
	h.Subagents().mu.RUnlock()
	if record == nil || record.activation == nil {
		t.Fatal("cold activation not retained")
	}
	_ = h.Subagents().requestActivationDisposal(record)
	if err := record.activation.wait(ctx); err != nil {
		t.Fatal(err)
	}
	replacement := capacityStart(t, h, parent, local.Name(), "caller")
	capacityDispose(t, replacement)
}

func TestSubagentCapacityExactRootGenerationDoesNotReuseIdentity(t *testing.T) {
	h := subagentTestHarness(t)
	ctx := activationTestContext(t)
	registry := h.Subagents()
	if err := registry.UpdateConfig(SubagentRuntimeConfigUpdate{MaxActiveSubagents: capacityInt(1)}); err != nil {
		t.Fatal(err)
	}
	parent := capacityParent(t, h, "capacity-reused-root")
	// Hold an exact lease independent of execution to probe that pool membership
	// cannot be reconstructed from durable identity after the registry replaces it.
	prep, releasePrep, err := registry.reserveSubagentPreparation(ctx, parent)
	if err != nil {
		t.Fatal(err)
	}
	if err := registry.protectSubagentPreparation(prep, parent); err != nil {
		releasePrep()
		t.Fatal(err)
	}
	release, err := registry.reserveActivationCapacity(prep, parent)
	if err != nil {
		releasePrep()
		t.Fatal(err)
	}
	token := prep.Value(subagentPreparationContextKey{}).(*subagentPreparation)
	oldPool := token.capacity.pool
	release()
	releasePrep()
	if err := h.Agents().RemoveExact(ctx, parent); err != nil && !errors.Is(err, ErrAgentDisposalInProgress) {
		t.Fatal(err)
	}
	if err := h.Agents().WaitRetired(ctx, parent); err != nil {
		t.Fatal(err)
	}
	replacement, err := h.Agents().Resume(ctx, parent.Session(), AgentOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if replacement == parent {
		t.Fatal("test did not replace root identity")
	}
	next, releaseNext, err := registry.reserveSubagentPreparation(ctx, replacement)
	if err != nil {
		t.Fatal(err)
	}
	defer releaseNext()
	if err := registry.protectSubagentPreparation(next, replacement); err != nil {
		t.Fatal(err)
	}
	release, err = registry.reserveActivationCapacity(next, replacement)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	newPool := next.Value(subagentPreparationContextKey{}).(*subagentPreparation).capacity.pool
	if newPool == oldPool || newPool.root != replacement {
		t.Fatal("new root inherited previous generation pool")
	}
	if _, err := registry.reserveActivationCapacity(prep, parent); err == nil {
		t.Fatal("retired parent retained admission")
	}
}
