package harness

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	point "github.com/phodal/pero/harness/go/runtime"
)

func readCatalogProjection(t *testing.T, h *Harness, s *Session) []SubagentChildCatalogEntry {
	t.Helper()
	snapshot, err := h.Projections().Snapshot(s, "subagentCatalog")
	if err != nil {
		t.Fatal(err)
	}
	var rows []SubagentChildCatalogEntry
	if err = json.Unmarshal(snapshot.Values["subagentCatalog"], &rows); err != nil {
		t.Fatal(err)
	}
	return rows
}
func TestSubagentCatalogManagedStartedPrecedesInboxAndCommit(t *testing.T) {
	ctx := activationTestContext(t)
	h, err := Boot(ctx, Options{EnableSubagents: true, Adapter: AdapterFunc(func(ctx context.Context, _ GenerateRequest, _ func(StreamChunk) error) (Completion, error) {
		<-ctx.Done()
		return Completion{}, ctx.Err()
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Dispose(context.Background())
	parent, err := h.Agents().Create(ctx, AgentOptions{ID: "catalog-order-parent", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	order := []string{}
	add := func(value string) { mu.Lock(); order = append(order, value); mu.Unlock() }
	unsubscribe := parent.Session().Subscribe(func(event Event) {
		if event.Type == "subagent/catalog" {
			add("catalog")
		}
	})
	defer unsubscribe()
	provider := activationProbeProvider{prepareActivation: func(ctx context.Context, request SubagentRequest) (SubagentContinuationProviderRun, error) {
		child, err := h.Agents().Create(ctx, AgentOptions{ID: "catalog-order-child", Parent: parent, Delegated: true, DelegationDepth: 1, CWD: parent.Session().Header().CWD})
		if err != nil {
			return SubagentContinuationProviderRun{}, err
		}
		return SubagentContinuationProviderRun{ChildID: child.ID(), Child: child, InitialMessageID: request.InitialPromptMessage().ID, Begin: func(ctx context.Context) (<-chan TurnOutcome, error) {
			return child.FollowupResultContext(ctx, request.InitialPromptMessage())
		}, Submit: child.FollowupResultContext, Dispose: func(ctx context.Context) error { return h.Agents().RemoveExact(ctx, child) }}, nil
	}}
	mountRetirementHooks(t, h, func(run *point.Run) error {
		if _, err := h.Subagents().RegisterProvider(run, provider); err != nil {
			return err
		}
		if _, err := h.Hooks().InboxInserted.On(run, func(_ context.Context, input InboxInsertedInput) error {
			if input.Agent.Delegated() {
				add("inbox")
			}
			return nil
		}); err != nil {
			return err
		}
		_, err := h.Subagents().Started.On(run, func(_ context.Context, event SubagentLifecycle) error {
			add("started")
			rows := readCatalogProjection(t, h, parent.Session())
			if len(rows) != 0 || event.Child == nil {
				t.Errorf("Started must see a materialized child before initial catalog: %+v", rows)
			}
			return nil
		})
		return err
	})
	activation, err := h.Subagents().StartActivation(ctx, provider.Name(), SubagentRequest{Parent: parent, Prompt: "work", Label: "Kept label", MaxDepth: 2}, "caller")
	if err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	got := append([]string(nil), order...)
	mu.Unlock()
	if !reflect.DeepEqual(got, []string{"started", "inbox", "catalog"}) {
		t.Fatalf("public admission order=%v", got)
	}
	if err = activation.RequestDispose(); err != nil && !errors.Is(err, ErrSubagentActivationDisposalPending) {
		t.Fatal(err)
	}
	if err = activation.Wait(ctx); err != nil {
		t.Fatal(err)
	}
	rows := readCatalogProjection(t, h, parent.Session())
	if len(rows) != 1 || rows[0].Label == nil || *rows[0].Label != "Kept label" {
		t.Fatalf("durable catalog after cleanup=%+v", rows)
	}
}
func TestSubagentCatalogCommitFailureRetainsUnbufferedInitialOutcome(t *testing.T) {
	h := subagentTestHarness(t)
	ctx := activationTestContext(t)
	parent, err := h.Agents().Create(ctx, AgentOptions{ID: "catalog-failure-parent", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	turn := make(chan TurnOutcome)
	disposed := make(chan struct{})
	expected := errors.New("initial outcome during catalog rollback")
	var began atomic.Bool
	var exact *Agent
	provider := activationProbeProvider{prepareActivation: func(ctx context.Context, request SubagentRequest) (SubagentContinuationProviderRun, error) {
		header := NewSession("catalog-failure-child", parent.Session().Header().CWD).Header()
		header.ParentSession, header.Origin, header.DelegationDepth = parent.ID(), "subagent", 1
		header.CreatedAt = time.Unix(-1, 0) // valid Session provenance, invalid catalog timestamp
		session, err := RestoreSession(header, nil)
		if err != nil {
			return SubagentContinuationProviderRun{}, err
		}
		child, err := h.Agents().Resume(ctx, session, AgentOptions{ID: header.ID, Parent: parent, Delegated: true, DelegationDepth: 1, CWD: header.CWD})
		if err != nil {
			return SubagentContinuationProviderRun{}, err
		}
		exact = child
		return SubagentContinuationProviderRun{ChildID: child.ID(), Child: child, InitialMessageID: request.InitialPromptMessage().ID, Begin: func(context.Context) (<-chan TurnOutcome, error) { began.Store(true); return turn, nil }, Submit: child.FollowupResultContext, Dispose: func(ctx context.Context) error {
			turn <- TurnOutcome{Err: expected}
			close(turn)
			defer close(disposed)
			return h.Agents().RemoveExact(ctx, child)
		}}, nil
	}}
	mountRetirementHooks(t, h, func(run *point.Run) error {
		if _, err := h.Subagents().RegisterProvider(run, provider); err != nil {
			return err
		}
		return nil
	})
	done := make(chan error, 1)
	go func() {
		_, err := h.Subagents().StartActivation(ctx, provider.Name(), SubagentRequest{Parent: parent, Prompt: "work", MaxDepth: 2}, "caller")
		done <- err
	}()
	if err = activationReceive(t, ctx, done); err == nil || !strings.Contains(err.Error(), "subagent catalog: invalid") || !began.Load() {
		t.Fatalf("catalog failure=%v began=%v", err, began.Load())
	}
	select {
	case <-disposed:
	case <-ctx.Done():
		t.Fatal("cleanup could not publish unbuffered initial outcome")
	}
	if rows := readCatalogProjection(t, h, parent.Session()); len(rows) != 0 {
		t.Fatalf("failed catalog fact was committed: %+v", rows)
	}
	if exact == nil {
		t.Fatal("missing exact prepared child")
	}
	if err := h.Agents().WaitRetired(ctx, exact); err != nil {
		t.Fatal(err)
	}
}
func TestSubagentCatalogExternalParentDeliveryOnly(t *testing.T) {
	for _, delivery := range []string{"parent", "caller"} {
		t.Run(delivery, func(t *testing.T) {
			h := subagentTestHarness(t)
			ctx := activationTestContext(t)
			parent, err := h.Agents().Create(ctx, AgentOptions{ID: "catalog-external-parent", CWD: t.TempDir()})
			if err != nil {
				t.Fatal(err)
			}
			terminal := make(chan SubagentResult, 1)
			provider := retirementSubagentProvider{prepare: func(context.Context, SubagentRequest) (SubagentProviderRun, error) {
				return SubagentProviderRun{ChildID: "catalog-external-child", Result: terminal, Begin: func() {}, Cancel: func(error) {}, Dispose: func(context.Context) error { return nil }}, nil
			}}
			mountRetirementHooks(t, h, func(run *point.Run) error {
				if _, err := h.Subagents().RegisterProvider(run, provider); err != nil {
					return err
				}
				_, err := h.Subagents().Started.On(run, func(context.Context, SubagentLifecycle) error {
					rows := readCatalogProjection(t, h, parent.Session())
					if len(rows) != 0 {
						t.Errorf("catalog membership at Started=%+v", rows)
					}
					return nil
				})
				return err
			})
			activation, err := h.Subagents().StartActivation(ctx, provider.Name(), SubagentRequest{Parent: parent, Prompt: "work", Label: "External review", MaxDepth: 2}, delivery)
			if err != nil {
				t.Fatal(err)
			}
			terminal <- SubagentResult{ChildID: activation.ChildID, Status: SubagentCompleted, Reason: FinishStop}
			close(terminal)
			_ = activationReceive(t, ctx, activation.Result)
			rows := readCatalogProjection(t, h, parent.Session())
			if delivery == "parent" && (len(rows) != 1 || rows[0].Mode != "external" || rows[0].CreatedAt < 0) {
				t.Fatalf("external catalog=%+v", rows)
			}
			if delivery == "caller" && len(rows) != 0 {
				t.Fatal("caller-only external execution leaked into catalog")
			}
		})
	}
}

func TestSubagentCatalogNativeStartedFailureAdmitsNothing(t *testing.T) {
	h := subagentTestHarness(t)
	ctx := activationTestContext(t)
	parent, err := h.Agents().Create(ctx, AgentOptions{ID: "catalog-started-reject-parent", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	expected := errors.New("native Started observer failed")
	var began atomic.Bool
	var exact *Agent
	disposed := make(chan struct{})
	provider := activationProbeProvider{prepareActivation: func(ctx context.Context, request SubagentRequest) (SubagentContinuationProviderRun, error) {
		child, err := h.Agents().Create(ctx, AgentOptions{ID: "catalog-started-reject-child", Parent: parent, Delegated: true, DelegationDepth: 1, CWD: parent.Session().Header().CWD})
		if err != nil {
			return SubagentContinuationProviderRun{}, err
		}
		exact = child
		return SubagentContinuationProviderRun{ChildID: child.ID(), Child: child, InitialMessageID: request.InitialPromptMessage().ID, Begin: func(context.Context) (<-chan TurnOutcome, error) {
			began.Store(true)
			return make(chan TurnOutcome), nil
		}, Submit: child.FollowupResultContext, Dispose: func(ctx context.Context) error { defer close(disposed); return h.Agents().RemoveExact(ctx, child) }}, nil
	}}
	mountRetirementHooks(t, h, func(run *point.Run) error {
		if _, err := h.Subagents().RegisterProvider(run, provider); err != nil {
			return err
		}
		_, err := h.Subagents().Started.On(run, func(context.Context, SubagentLifecycle) error { return expected })
		return err
	})
	activation, err := h.Subagents().StartActivation(ctx, provider.Name(), SubagentRequest{Parent: parent, Prompt: "never admitted", MaxDepth: 2}, "caller")
	if !errors.Is(err, expected) || activation.ChildID != "" || activation.MessageID != "" || began.Load() {
		t.Fatalf("failed Started receipt=%+v err=%v began=%v", activation, err, began.Load())
	}
	select {
	case <-disposed:
	case <-ctx.Done():
		t.Fatal("pre-Begin child cleanup did not complete")
	}
	if exact == nil {
		t.Fatal("missing exact child")
	}
	if err = h.Agents().WaitRetired(ctx, exact); err != nil {
		t.Fatal(err)
	}
	if rows := readCatalogProjection(t, h, parent.Session()); len(rows) != 0 {
		t.Fatalf("failed Started committed catalog: %+v", rows)
	}
}

func TestSubagentCatalogObserverRetirementCannotBeginExternalWork(t *testing.T) {
	h := subagentTestHarness(t)
	ctx := activationTestContext(t)
	parent, err := h.Agents().Create(ctx, AgentOptions{ID: "catalog-retire-parent", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	terminal := make(chan SubagentResult)
	disposed := make(chan struct{})
	var began atomic.Bool
	provider := retirementSubagentProvider{prepare: func(context.Context, SubagentRequest) (SubagentProviderRun, error) {
		return SubagentProviderRun{ChildID: "catalog-retire-child", Result: terminal, Begin: func() { began.Store(true) }, Cancel: func(error) {}, Dispose: func(context.Context) error {
			terminal <- SubagentResult{ChildID: "catalog-retire-child", Status: SubagentAborted, Reason: FinishAborted}
			close(terminal)
			close(disposed)
			return nil
		}}, nil
	}}
	mountRetirementHooks(t, h, func(run *point.Run) error { _, err := h.Subagents().RegisterProvider(run, provider); return err })
	var withdrawErr error
	off := parent.Session().Subscribe(func(event Event) {
		if event.Type == "subagent/catalog" {
			withdrawErr = h.Agents().RemoveExact(context.Background(), parent)
		}
	})
	defer off()
	activation, err := h.Subagents().StartActivation(ctx, provider.Name(), SubagentRequest{Parent: parent, Prompt: "must not begin", MaxDepth: 2}, "parent")
	if err == nil || activation.ChildID != "" || began.Load() {
		t.Fatalf("retired parent admitted external work: %+v %v began=%v", activation, err, began.Load())
	}
	if withdrawErr != nil && !errors.Is(withdrawErr, ErrAgentDisposalInProgress) {
		t.Fatal(withdrawErr)
	}
	select {
	case <-disposed:
	case <-ctx.Done():
		t.Fatal("catalog observer retirement did not join exact external cleanup")
	}
	if err = h.Agents().WaitRetired(ctx, parent); err != nil {
		t.Fatal(err)
	}
}
