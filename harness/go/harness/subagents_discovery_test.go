package harness

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"sync"
	"testing"
	"time"

	point "github.com/phodal/pero/harness/go/runtime"
)

type catalogQueryProbe struct {
	children map[SessionID][]SubagentChildCatalogEntry
	failures map[SessionID]error
	resident map[SessionID]bool
	reads    []SessionID
	onRead   func(SessionID)
}

func (q *catalogQueryProbe) ReadSubagentCatalog(_ context.Context, id SessionID) ([]SubagentChildCatalogEntry, error) {
	q.reads = append(q.reads, id)
	if q.onRead != nil {
		q.onRead(id)
	}
	return q.children[id], q.failures[id]
}
func (q *catalogQueryProbe) SubagentSessionResident(id SessionID) bool { return q.resident[id] }

type catalogReadFailure string

func (e catalogReadFailure) Error() string         { return string(e) }
func (e catalogReadFailure) ToolErrorCode() string { return string(e) }
func mountCatalogQueryProbe(t *testing.T, h *Harness, q *catalogQueryProbe) {
	t.Helper()
	definition := point.Define(point.Descriptor{ID: "test/catalog-query", Provides: []point.AnyKey{SubagentCatalogQueryKey.Any()}}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
		_, err := point.Provide(run, SubagentCatalogQueryKey, SubagentCatalogQuery(q))
		return nil, err
	})
	instance, err := h.Runtime().Mount(nil, "test/catalog-query", definition, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = instance.Dispose(context.Background()) })
	if err = instance.WaitStable(t.Context()); err != nil {
		t.Fatal(err)
	}
}
func TestSubagentCatalogDiscoveryPreorderLeavesDiagnosticsAndCycles(t *testing.T) {
	h := subagentTestHarness(t)
	q := &catalogQueryProbe{children: map[SessionID][]SubagentChildCatalogEntry{
		"root": {{ID: "z", Mode: "continuable"}, {ID: "external", Mode: "external"}, {ID: "unknown", Mode: "unknown"}, {ID: "bad", Mode: "one-shot"}, {ID: "missing", Mode: "one-shot"}, {ID: "z", Mode: "one-shot"}},
		"z":    {{ID: "grandchild", Mode: "one-shot"}}, "grandchild": {{ID: "root", Mode: "one-shot"}}, "unknown": {{ID: "under-unknown", Mode: "one-shot"}},
		"unreachable": {{ID: "hidden", Mode: "external"}},
	}, failures: map[SessionID]error{"bad": catalogReadFailure("SESSION_QUERY_CORRUPT_SESSION"), "missing": errors.New("offline")}, resident: map[SessionID]bool{"z": true}}
	mountCatalogQueryProbe(t, h, q)
	rows, err := h.Subagents().ListDescendantsBySessionID(t.Context(), "root")
	if err != nil {
		t.Fatal(err)
	}
	ids := []SessionID{}
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	if !reflect.DeepEqual(ids, []SessionID{"z", "grandchild", "external", "unknown", "under-unknown", "bad", "missing"}) {
		t.Fatalf("order=%v", ids)
	}
	if rows[0].Activity != "running" || rows[0].HasChildren == nil || !*rows[0].HasChildren || rows[1].Activity != "inactive" || rows[1].ParentID != "z" || rows[1].Depth != 2 {
		t.Fatalf("child rows=%+v", rows[:2])
	}
	if rows[2].HasChildren == nil || *rows[2].HasChildren || rows[2].Activity != "inactive" || rows[3].Reason != "unsupported" || rows[4].Depth != 2 || rows[5].Reason != "corrupt" || rows[6].Reason != "unavailable" {
		t.Fatalf("diagnostics=%+v", rows)
	}
	if !reflect.DeepEqual(q.reads, []SessionID{"root", "z", "grandchild", "unknown", "under-unknown", "bad", "missing"}) {
		t.Fatalf("read external, duplicate, cycle, or unreachable catalog: %v", q.reads)
	}
}
func TestSubagentCatalogDiscoveryRootDependencyAndCancellationFailures(t *testing.T) {
	h := subagentTestHarness(t)
	if _, err := h.Subagents().ListChildrenBySessionID(t.Context(), "root"); !errors.Is(err, ErrSubagentCatalogQueryUnavailable) {
		t.Fatal(err)
	}
	q := &catalogQueryProbe{children: map[SessionID][]SubagentChildCatalogEntry{"root": {{ID: "child", Mode: "continuable"}}}, failures: map[SessionID]error{"root": errors.New("root missing")}}
	mountCatalogQueryProbe(t, h, q)
	if _, err := h.Subagents().ListDescendantsBySessionID(t.Context(), "root"); err != q.failures["root"] {
		t.Fatalf("root failure became diagnostic: %v", err)
	}
	delete(q.failures, "root")
	q.failures["child"] = ErrSubagentCatalogProjectionsUnavailable
	if _, err := h.Subagents().ListDescendantsBySessionID(t.Context(), "root"); !errors.Is(err, ErrSubagentCatalogProjectionsUnavailable) {
		t.Fatalf("dependency failure became diagnostic: %v", err)
	}
	delete(q.failures, "child")
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	q.onRead = func(id SessionID) {
		if id == "child" {
			cancel()
		}
	}
	if _, err := h.Subagents().ListDescendantsBySessionID(ctx, "root"); !errors.Is(err, errSubagentListingCancelled) {
		t.Fatalf("cancellation became diagnostic: %v", err)
	}
}

// This fixture supplies an explicit trusted owner capability; production owner
// cancellation/drain is exercised in sessionquery's lifecycle tests.
type leasedCatalogProbe struct {
	*catalogQueryProbe
	releases int
}

func (q *leasedCatalogProbe) BeginSubagentCatalogRead(ctx context.Context) (context.Context, SubagentCatalogQuery, func(), error) {
	released := false
	return ctx, q, func() {
		if !released {
			released = true
			q.releases++
		}
	}, nil
}
func mountLeasedCatalogProbe(t *testing.T, h *Harness, q SubagentCatalogQuery) {
	t.Helper()
	definition := point.Define(point.Descriptor{ID: "test/leased-catalog", Provides: []point.AnyKey{SubagentCatalogQueryKey.Any()}}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
		_, err := point.Provide(run, SubagentCatalogQueryKey, q)
		return nil, err
	})
	instance, err := h.Runtime().Mount(nil, "test/leased-catalog", definition, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := instance.Dispose(ctx); err != nil {
			t.Error(err)
		}
	})
	if err := instance.WaitStable(t.Context()); err != nil {
		t.Fatal(err)
	}
	if state := instance.Snapshot(); state.State != point.Active {
		t.Fatalf("query owner state=%v error=%v", state.State, state.LastError)
	}
}
func TestSubagentListDSHCallerFenceAndFatalDependency(t *testing.T) {
	for _, retireDuringRead := range []bool{false, true} {
		t.Run(fmt.Sprintf("retire-during-read-%v", retireDuringRead), func(t *testing.T) {
			h := subagentTestHarness(t)
			ctx := activationTestContext(t)
			parent := capacityParent(t, h, "catalog-authority")
			probe := &leasedCatalogProbe{catalogQueryProbe: &catalogQueryProbe{children: map[SessionID][]SubagentChildCatalogEntry{"catalog-authority": {{ID: "child", Mode: "one-shot"}}, "child": {{ID: "never", Mode: "one-shot"}}}, failures: map[SessionID]error{}, resident: map[SessionID]bool{}}}
			mountLeasedCatalogProbe(t, h, probe)
			for _, invalid := range []*Agent{nil, {id: parent.ID(), session: parent.Session()}} {
				_, err := h.Subagents().ListAgentsDSH(ctx, invalid, true)
				assertSubagentControlCode(t, err, "UNAUTHORIZED")
			}
			if len(probe.reads) != 0 {
				t.Fatal("invalid caller read query")
			}
			if retireDuringRead {
				entered, release, done := make(chan struct{}), make(chan struct{}), make(chan error, 1)
				finished := make(chan struct{})
				var releaseOnce sync.Once
				unblock := func() { releaseOnce.Do(func() { close(release) }) }
				t.Cleanup(func() {
					unblock()
					cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
					defer cancel()
					select {
					case <-finished:
					case <-cleanup.Done():
						t.Error("catalog callback did not settle")
					}
				})
				probe.onRead = func(id SessionID) {
					if id == parent.ID() {
						close(entered)
						<-release
					}
				}
				go func() { defer close(finished); _, err := h.Subagents().ListAgentsDSH(ctx, parent, true); done <- err }()
				select {
				case <-entered:
				case <-ctx.Done():
					t.Fatal(ctx.Err())
				}
				if err := h.Agents().Remove(ctx, parent.ID()); err != nil {
					unblock()
					t.Fatal(err)
				}
				replacement, err := h.Agents().Resume(ctx, parent.Session(), AgentOptions{})
				if err != nil {
					unblock()
					t.Fatal(err)
				}
				unblock()
				select {
				case err := <-done:
					assertSubagentControlCode(t, err, "UNAUTHORIZED")
				case <-ctx.Done():
					t.Fatal(ctx.Err())
				}
				if !reflect.DeepEqual(probe.reads, []SessionID{parent.ID()}) || probe.releases != 1 {
					t.Fatalf("reads=%v releases=%d", probe.reads, probe.releases)
				}
				if replacement == parent {
					t.Fatal("identity was not replaced")
				}
				probe.onRead = nil
				probe.reads = nil
				_, err = h.Subagents().ListAgentsDSH(ctx, parent, false)
				assertSubagentControlCode(t, err, "UNAUTHORIZED")
				if len(probe.reads) != 0 {
					t.Fatal("stale identity read replacement catalog")
				}
			} else {
				probe.failures["child"] = ErrSubagentCatalogOwnerRetired
				rows, err := h.Subagents().ListAgentsDSH(ctx, parent, true)
				if !errors.Is(err, ErrSubagentCatalogOwnerRetired) || rows != nil || probe.releases != 1 {
					t.Fatalf("retirement became diagnostic success rows=%v err=%v releases=%d", rows, err, probe.releases)
				}
			}
		})
	}
}
func TestSubagentListDSHRequiresOptionalOwnerWithoutChangingLegacyQuery(t *testing.T) {
	h := subagentTestHarness(t)
	parent := capacityParent(t, h, "legacy-query")
	q := &catalogQueryProbe{children: map[SessionID][]SubagentChildCatalogEntry{"legacy-query": {{ID: "child", Mode: "one-shot"}}}}
	mountCatalogQueryProbe(t, h, q)
	if _, err := h.Subagents().ListAgentsDSH(t.Context(), parent, false); !errors.Is(err, ErrSubagentCatalogReadOwnerUnavailable) {
		t.Fatal(err)
	}
	if len(q.reads) != 0 {
		t.Fatal("unleased DSH query read")
	}
	rows, err := h.Subagents().ListChildrenBySessionID(t.Context(), parent.ID())
	if err != nil || len(rows) != 1 {
		t.Fatalf("legacy query changed: %v %v", rows, err)
	}
}

func TestSubagentListDSHIdleAgentAndResidentSessionAreInactive(t *testing.T) {
	h := subagentTestHarness(t)
	parent := capacityParent(t, h, "status-parent")
	idle := capacityParent(t, h, "idle-child")
	if _, err := h.Sessions().Create("session-only", t.TempDir()); err != nil {
		t.Fatal(err)
	}
	label := "label"
	probe := &leasedCatalogProbe{catalogQueryProbe: &catalogQueryProbe{
		children: map[SessionID][]SubagentChildCatalogEntry{parent.ID(): {{ID: idle.ID(), Mode: "continuable", Label: &label}, {ID: "session-only", Mode: "continuable", Label: &label}}},
		resident: map[SessionID]bool{idle.ID(): true, "session-only": true},
	}}
	mountLeasedCatalogProbe(t, h, probe)
	rows, err := h.Subagents().ListAgentsDSH(t.Context(), parent, true)
	if err != nil || len(rows) != 2 {
		t.Fatalf("status rows=%v err=%v", rows, err)
	}
	for _, row := range rows {
		if row.Activity != "inactive" {
			t.Fatalf("residency treated as running: %+v", row)
		}
	}
}
