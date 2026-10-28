package harness

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"sync"
	"testing"

	point "github.com/phodal/pero/harness/go/runtime"
)

func facadeForTest(t *testing.T, h *Harness, capacity int) *SubagentFacade {
	t.Helper()
	facade, err := h.Subagents().NewFacade(SubagentRuntimeConfig{MaxDepth: 1, MaxActiveSubagents: capacity})
	if err != nil {
		t.Fatal(err)
	}
	return facade
}
func facadeStart(t *testing.T, facade *SubagentFacade, parent *Agent, provider string) SubagentActivation {
	t.Helper()
	activation, err := facade.StartActivation(activationTestContext(t), provider, SubagentRequest{Parent: parent, Prompt: "facade test", MaxDepth: 8}, "caller")
	if err != nil {
		t.Fatal(err)
	}
	return activation
}
func facadeDrain(t *testing.T, facade *SubagentFacade) {
	t.Helper()
	if err := facade.RequestDispose(); err != nil && !errors.Is(err, ErrSubagentFacadeDisposalPending) {
		t.Fatal(err)
	}
	if err := facade.Wait(activationTestContext(t)); err != nil {
		t.Fatal(err)
	}
}

func TestSubagentFacadePoolsConfigAndDisposalAreGenerationScoped(t *testing.T) {
	h := subagentTestHarness(t)
	ctx := activationTestContext(t)
	parent := capacityParent(t, h, "facade-shared-parent")
	p := &capacityExternalProvider{name: "facade-external"}
	capacityRegister(t, h, p)
	first, second := facadeForTest(t, h, 1), facadeForTest(t, h, 2)
	owned := facadeStart(t, first, parent, p.Name())
	other := facadeStart(t, second, parent, p.Name())
	native := capacityStart(t, h, parent, p.Name(), "caller")
	_, err := first.StartActivation(ctx, p.Name(), SubagentRequest{Parent: parent, Prompt: "full", MaxDepth: 1}, "caller")
	capacityLimitError(t, err, 1)
	if err := first.ReplaceConfig(SubagentRuntimeConfig{MaxDepth: 0, MaxActiveSubagents: 3}); err != nil {
		t.Fatal(err)
	}
	if second.Config().MaxDepth != 1 || second.Config().MaxActiveSubagents != 2 || h.Subagents().Config() != DefaultSubagentRuntimeConfig() {
		t.Fatal("facade edit leaked into another authority")
	}
	facadeDrain(t, first)
	select {
	case <-owned.Done:
	default:
		t.Fatal("facade drain returned before owned final receipt")
	}
	for _, a := range []SubagentActivation{other, native} {
		select {
		case <-a.Done:
			t.Fatal("facade disposal retired another owner")
		default:
		}
	}
	if _, err := first.StartActivation(ctx, p.Name(), SubagentRequest{Parent: parent, Prompt: "stale generation", MaxDepth: 1}, "caller"); !errors.Is(err, ErrSubagentFacadeDraining) {
		t.Fatalf("stale facade admitted: %v", err)
	}
	if err := first.ReplaceConfig(DefaultSubagentRuntimeConfig()); !errors.Is(err, ErrSubagentFacadeDraining) {
		t.Fatalf("disposed config changed: %v", err)
	}
	replacement := facadeForTest(t, h, 1)
	fresh := facadeStart(t, replacement, parent, p.Name())
	capacityDispose(t, fresh)
	facadeDrain(t, replacement)
	capacityDispose(t, native)
	facadeDrain(t, second)
}

func TestSubagentFacadeCloseFromPreparationKeepsExactRollbackReceipt(t *testing.T) {
	h := subagentTestHarness(t)
	ctx := activationTestContext(t)
	parent := capacityParent(t, h, "facade-reentry-parent")
	facade := facadeForTest(t, h, 1)
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	defer unblock()
	observed := make(chan error, 1)
	failure := errors.New("facade rollback cleanup failed")
	p := &capacityExternalProvider{name: "facade-reentry"}
	p.prepare = func(context.Context, SubagentRequest, int32) (SubagentProviderRun, error) {
		observed <- facade.Dispose(context.Background())
		return SubagentProviderRun{ChildID: "facade-late-child", Result: make(chan SubagentResult), Begin: func() {}, Cancel: func(error) {}, Dispose: func(context.Context) error { close(entered); <-release; return failure }}, nil
	}
	capacityRegister(t, h, p)
	started := make(chan error, 1)
	go func() {
		_, err := facade.StartActivation(ctx, p.Name(), SubagentRequest{Parent: parent, Prompt: "close while preparing", MaxDepth: 1}, "caller")
		started <- err
	}()
	if err := activationReceive(t, ctx, observed); !errors.Is(err, ErrSubagentFacadeDisposalPending) {
		t.Fatalf("reentrant close=%v", err)
	}
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if err := facade.Wait(cancelled); !errors.Is(err, context.Canceled) {
		t.Fatalf("rollback barrier returned early: %v", err)
	}
	unblock()
	if err := activationReceive(t, ctx, started); err == nil {
		t.Fatal("closed generation published late preparation")
	}
	if err := facade.Wait(ctx); !errors.Is(err, failure) {
		t.Fatalf("exact rollback failure lost: %v", err)
	}
}

func TestSubagentFacadeStartedFailureAndColdResumeOwnership(t *testing.T) {
	for _, phase := range []string{"started-failure", "cold-resume"} {
		t.Run(phase, func(t *testing.T) {
			h := capacityBlockingHarness(t)
			ctx := activationTestContext(t)
			parent := capacityParent(t, h, SessionID("facade-"+phase+"-parent"))
			local := &capacityLocalProvider{h: h}
			facade := facadeForTest(t, h, 1)
			failed := errors.New("started observer failed")
			mountRetirementHooks(t, h, func(run *point.Run) error {
				if _, err := h.Subagents().RegisterProvider(run, local); err != nil {
					return err
				}
				if phase == "started-failure" {
					_, err := h.Subagents().Started.On(run, func(context.Context, SubagentLifecycle) error { return failed })
					return err
				}
				return nil
			})
			if phase == "started-failure" {
				_, err := facade.StartActivation(ctx, local.Name(), SubagentRequest{Parent: parent, Prompt: "reject started", MaxDepth: 2}, "caller")
				if !errors.Is(err, failed) {
					t.Fatal(err)
				}
				facadeDrain(t, facade)
				return
			}
			assertRelay := func(child *Agent, id, input string) {
				t.Helper()
				accepted, found := child.durableInbox.Accepted(id)
				wantContent := []ContentBlock{{Type: BlockText, Text: fmt.Sprintf("Agent %s sent a message: ", parent.ID())}, {Type: BlockText, Text: input}}
				if !found || accepted.ID != id || accepted.Role != RoleUser || !reflect.DeepEqual(accepted.Content, wantContent) {
					t.Fatalf("facade lost canonical accepted relay: id=%q message=%+v found=%v", id, accepted, found)
				}
				var source map[string]string
				if err := json.Unmarshal(accepted.Source, &source); err != nil || len(source) != 3 || source["kind"] != "agent-message" || source["form"] != "relay" || source["senderSessionId"] != string(parent.ID()) {
					t.Fatalf("facade lost exact relay source: %s, err=%v", accepted.Source, err)
				}
			}
			original := facadeStart(t, facade, parent, local.Name())
			originalChild, found := h.Agents().Get(original.ChildID)
			if !found {
				t.Fatal("original activation did not materialize its exact child")
			}
			capacityDispose(t, original)
			if err := h.Agents().WaitRetired(ctx, originalChild); err != nil {
				t.Fatal(err)
			}
			// A resident activation belongs to its exact facade generation. Another
			// facade cannot deliver to it merely by sharing its parent's address.
			resident := facadeStart(t, facade, parent, local.Name())
			residentChild, found := h.Agents().Get(resident.ChildID)
			if !found {
				t.Fatal("resident activation is not live")
			}
			visitor := facadeForTest(t, h, 1)
			id, err := visitor.SendMessage(ctx, parent, resident.ChildID, []ContentBlock{{Type: BlockText, Text: "foreign resident input"}})
			var coded interface{ ToolErrorCode() string }
			if id != "" || !errors.As(err, &coded) || coded.ToolErrorCode() != "UNAUTHORIZED" {
				t.Fatalf("foreign facade received resident admission: id=%q err=%v", id, err)
			}
			for _, event := range residentChild.Session().Events() {
				if event.Type == "agent/inbox/spliced" && strings.Contains(string(event.Data), "foreign resident input") {
					t.Fatal("foreign facade mutated the resident inbox")
				}
			}
			if local.resumes.Load() != 0 {
				t.Fatal("foreign resident addressing triggered cold materialization")
			}
			id, err = facade.SendMessage(ctx, parent, resident.ChildID, []ContentBlock{{Type: BlockText, Text: "resident input"}})
			if err != nil || id == "" {
				t.Fatalf("owning facade resident admission=%q %v", id, err)
			}
			assertRelay(residentChild, id, "resident input")
			facadeDrain(t, visitor)
			select {
			case <-resident.Done:
				t.Fatal("visitor adopted another facade's resident child")
			default:
			}
			capacityDispose(t, resident)
			if _, live := h.Agents().Get(original.ChildID); live {
				t.Fatal("cold test still had the original resident Agent")
			}
			h.Subagents().mu.RLock()
			oldRecord := h.Subagents().records[original.ChildID]
			h.Subagents().mu.RUnlock()
			if oldRecord != nil {
				t.Fatal("cold test still had the original resident activation")
			}
			id, err = facade.SendMessage(ctx, parent, original.ChildID, []ContentBlock{{Type: BlockText, Text: "cold input"}})
			if err != nil || id == "" {
				t.Fatalf("owning facade cold admission=%q %v", id, err)
			}
			h.Subagents().mu.RLock()
			record := h.Subagents().records[original.ChildID]
			h.Subagents().mu.RUnlock()
			if record == nil || record.activation == nil || record.activation.facade != facade || record.child == originalChild || local.resumes.Load() != 1 {
				t.Fatal("cold resume missing fresh exact Agent and facade ownership")
			}
			assertRelay(record.child, id, "cold input")
			facadeDrain(t, facade)
			if err := record.activation.wait(ctx); err != nil {
				t.Fatal(err)
			}
			if _, live := h.Agents().Get(original.ChildID); live {
				t.Fatal("cold activation remained resident after facade drain")
			}
		})
	}
}

func TestSubagentFacadeDrainWaitsForCancelledLatePreparation(t *testing.T) {
	h := subagentTestHarness(t)
	ctx := activationTestContext(t)
	parent := capacityParent(t, h, "facade-cancel-parent")
	facade := facadeForTest(t, h, 1)
	entered, cancelled, release := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	defer unblock()
	p := &capacityExternalProvider{name: "facade-cancel"}
	p.prepare = func(ctx context.Context, _ SubagentRequest, _ int32) (SubagentProviderRun, error) {
		close(entered)
		<-ctx.Done()
		close(cancelled)
		<-release
		return SubagentProviderRun{}, ctx.Err()
	}
	capacityRegister(t, h, p)
	start := make(chan error, 1)
	go func() {
		_, err := facade.StartActivation(ctx, p.Name(), SubagentRequest{Parent: parent, Prompt: "await cancel", MaxDepth: 1}, "caller")
		start <- err
	}()
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	_ = facade.RequestDispose()
	select {
	case <-cancelled:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	select {
	case <-facade.done:
		t.Fatal("facade completed before late provider rollback")
	default:
	}
	if err := facade.ReplaceConfig(SubagentRuntimeConfig{MaxDepth: 3, MaxActiveSubagents: 4}); !errors.Is(err, ErrSubagentFacadeDraining) {
		t.Fatal(err)
	}
	unblock()
	if err := activationReceive(t, ctx, start); !errors.Is(err, context.Canceled) {
		t.Fatalf("prepare error=%v", err)
	}
	if err := facade.Wait(ctx); err != nil {
		t.Fatal(err)
	}
	if got := fmt.Sprint(facade.Config().MaxDepth, facade.Config().MaxActiveSubagents); got != "1 1" {
		t.Fatalf("closed config=%s", got)
	}
}

func TestSubagentFacadeOwnedOperationDisposalDoesNotJoinItself(t *testing.T) {
	h := capacityBlockingHarness(t)
	ctx := activationTestContext(t)
	parent := capacityParent(t, h, "facade-operation-parent")
	local := &capacityLocalProvider{h: h}
	capacityRegister(t, h, local)
	facade := facadeForTest(t, h, 2)
	activation := facadeStart(t, facade, parent, local.Name())
	child, ok := h.Agents().Get(activation.ChildID)
	if !ok {
		t.Fatal("missing local activation")
	}
	if !facade.DisposalDependsOn(child) || facade.DisposalDependsOn(parent) || facade.DisposalDependsOn(&Agent{session: child.Session()}) {
		t.Fatal("facade dependency lost exact runtime identity")
	}
	operation, err := child.beginOperation(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var once sync.Once
	release := func() { once.Do(operation.release) }
	defer release()
	if err := facade.Dispose(ctx); !errors.Is(err, ErrSubagentFacadeDisposalPending) {
		t.Fatalf("owned operation reentry=%v", err)
	}
	select {
	case <-facade.done:
		t.Fatal("facade completed before operation returned")
	default:
	}
	release()
	if err := facade.Wait(ctx); err != nil {
		t.Fatal(err)
	}
	if facade.DisposalDependsOn(child) {
		t.Fatal("final facade retained an Agent graph")
	}
}
