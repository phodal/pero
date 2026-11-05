package harness

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync/atomic"
	"testing"

	point "github.com/phodal/pero/harness/go/runtime"
)

func TestDeferredActivationFold(t *testing.T) {
	version := deferredToolVersion{Name: "probe", Digest: strings.Repeat("a", 64), Registration: 3}
	parent := deferredToolActivation{Session: "parent", Epoch: "old", Tools: []deferredToolVersion{version}}
	checkpoint := deferredToolActivation{Session: "parent", Epoch: "new", Reset: true}
	for _, tc := range []struct {
		name, session string
		facts         []deferredToolActivation
		want          int
		bad           bool
	}{
		{"own discovery", "parent", []deferredToolActivation{parent}, 1, false},
		{"fork excludes inherited discovery", "child", []deferredToolActivation{parent}, 0, false},
		{"empty restoration clears unavailable tools", "parent", []deferredToolActivation{parent, checkpoint}, 0, false},
		{"epoch requires restoration", "parent", []deferredToolActivation{parent, {Session: "parent", Epoch: "new", Tools: []deferredToolVersion{version}}}, 0, true},
		{"malformed matching fact", "parent", []deferredToolActivation{{Session: "parent", Epoch: "new"}}, 0, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var events []Event
			for _, fact := range tc.facts {
				raw, _ := json.Marshal(fact)
				events = append(events, Event{Seq: uint64(len(events) + 1), Type: deferredToolsEvent, Data: raw})
			}
			state, err := deferredActivations(events, SessionID(tc.session))
			if (err != nil) != tc.bad || err == nil && len(state.Tools) != tc.want {
				t.Fatalf("state=%+v err=%v", state, err)
			}
		})
	}
}

func TestDeferredToolsCheckpointAndNativeFinalContent(t *testing.T) {
	h := retirementHarness(t)
	agent, err := h.Agents().Create(t.Context(), AgentOptions{ID: "deferred-durability"})
	if err != nil {
		t.Fatal(err)
	}
	var view *DeferredTools
	var executions atomic.Int32
	probe := Tool{Schema: ToolSchema{Name: "probe", InputSchema: json.RawMessage(`{"type":"object"}`)}, Execute: func(context.Context, json.RawMessage) (ToolResult, error) {
		executions.Add(1)
		return ToolResult{Content: []ContentBlock{{Type: BlockText, Text: "full body"}}}, nil
	}, nativeFinalContent: &nativeFinalContent{prepare: func(ToolRequest) (func(ToolResult) (ToolOutputProjection, error), error) {
		return func(ToolResult) (ToolOutputProjection, error) {
			return ToolOutputProjection{Content: []ContentBlock{{Type: BlockText, Text: "bounded native result"}}}, nil
		}, nil
	}}}
	mountRetirementHooks(t, h, func(run *point.Run) error {
		if _, err := h.Tools().Register(run, probe); err != nil {
			return err
		}
		var err error
		view, _, err = h.Tools().RegisterDeferredTools(run, "deferred", "search")
		return err
	})
	checkpointFailure := errors.New("fixture checkpoint failure")
	var fail atomic.Bool
	fail.Store(true)
	remove, err := agent.Session().InstallDurabilityCheckpoint(func(context.Context) error {
		if fail.Load() {
			return checkpointFailure
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(remove)
	if err := view.Activate(t.Context(), agent, []ToolSchema{probe.Schema}); !errors.Is(err, checkpointFailure) {
		t.Fatalf("activation ignored checkpoint failure: %v", err)
	}
	if _, err := h.Tools().SchemasForAgent(t.Context(), agent); !errors.Is(err, checkpointFailure) {
		t.Fatalf("uncheckpointed activation was declared: %v", err)
	}
	out, err := h.Tools().Execute(t.Context(), ToolRequest{Agent: agent, Name: "probe", CallID: "blocked", Arguments: json.RawMessage(`{}`)})
	if err == nil && !out.Result.IsError || executions.Load() != 0 {
		t.Fatalf("uncheckpointed activation dispatched: %+v %v", out, err)
	}
	fail.Store(false)
	out, err = h.Tools().Execute(t.Context(), ToolRequest{Agent: agent, Name: "probe", CallID: "durable", Arguments: json.RawMessage(`{}`)})
	if err != nil || out.Result.IsError || executions.Load() != 1 || len(out.Result.Content) != 1 || out.Result.Content[0].Text != "bounded native result" {
		t.Fatalf("deferred presentation lost native finalization: %+v %v", out, err)
	}
}

func TestDeferredToolsRejectIncompatiblePresenters(t *testing.T) {
	for _, deferredFirst := range []bool{true, false} {
		t.Run(map[bool]string{true: "deferred-first", false: "presenter-first"}[deferredFirst], func(t *testing.T) {
			h := retirementHarness(t)
			mountRetirementHooks(t, h, func(run *point.Run) error {
				ordinary := func() error {
					_, err := h.Tools().RegisterCatalogProvider(run, "ptc", ToolCatalogProvider{Authoritative: true, Schemas: func(context.Context, *Agent) ([]ToolSchema, error) { return nil, nil }, Resolve: func(context.Context, *Agent, string) (Tool, bool, error) { return Tool{}, false, nil }})
					return err
				}
				deferred := func() error {
					_, _, err := h.Tools().RegisterDeferredTools(run, "deferred", "search")
					return err
				}
				first, second := ordinary, deferred
				if deferredFirst {
					first, second = deferred, ordinary
				}
				if err := first(); err != nil {
					return err
				}
				if err := second(); err == nil || !strings.Contains(err.Error(), "cannot compose") {
					t.Errorf("incompatible presenter silently composed: %v", err)
				}
				return nil
			})
		})
	}
}

func TestDeferredToolsRestoredVersionsStayBoundToCurrentRegistration(t *testing.T) {
	h := retirementHarness(t)
	probe := Tool{Schema: ToolSchema{Name: "probe", InputSchema: json.RawMessage(`{"type":"object"}`)}, Execute: func(context.Context, json.RawMessage) (ToolResult, error) { return ToolResult{}, nil }}
	var run *point.Run
	mountRetirementHooks(t, h, func(active *point.Run) error {
		run = active
		if _, err := h.Tools().ReplaceGeneration(run, "probe-generation", []Tool{probe}); err != nil {
			return err
		}
		_, _, err := h.Tools().RegisterDeferredTools(run, "deferred", "search")
		return err
	})
	session := NewSession("restored", "")
	if _, err := session.Append(deferredToolsEvent, deferredToolActivation{Session: session.Header().ID, Epoch: "previous-runtime", Tools: []deferredToolVersion{{Name: "probe", Digest: ToolSchemaDigest(probe.Schema), Registration: 123}}}); err != nil {
		t.Fatal(err)
	}
	agent, err := h.Agents().Resume(t.Context(), session, AgentOptions{})
	if err != nil {
		t.Fatal(err)
	}
	schemas, err := h.Tools().SchemasForAgent(t.Context(), agent)
	if err != nil || len(schemas) != 1 || schemas[0].Name != "probe" {
		t.Fatalf("matching recovery failed: %+v %v", schemas, err)
	}
	for _, prepared := range []PreparedAdapterCall{{ModelInfo: ModelInfo{ToolUpdate: "in-history"}}, {ModelInfo: ModelInfo{ToolUpdate: "addition-only"}}, {ProjectsToolHistory: true}} {
		if _, err := h.Tools().boundDeferredRequest(t.Context(), agent, schemas, prepared); err == nil {
			t.Fatal("incompatible history presenter was accepted")
		}
	}
	if _, err := h.Tools().ReplaceGeneration(run, "probe-generation", []Tool{probe}); err != nil {
		t.Fatal(err)
	}
	schemas, err = h.Tools().SchemasForAgent(t.Context(), agent)
	if err != nil || len(schemas) != 0 {
		t.Fatalf("recovered activation revived a same-schema replacement: %+v %v", schemas, err)
	}
}
