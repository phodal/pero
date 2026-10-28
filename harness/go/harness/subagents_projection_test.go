package harness

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"
)

func subagentProjectionEvent(seq uint64, kind string, at int64, data string) Event {
	return Event{Seq: seq, Type: kind, Time: time.UnixMilli(at), Data: json.RawMessage(data)}
}

func subagentProjectionJSON(t *testing.T, d ProjectionDefinition, state any) any {
	t.Helper()
	value, err := d.Wire.View(state)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := d.Wire.EncodeView(value)
	if err != nil {
		t.Fatal(err)
	}
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	return decoded
}

func assertSubagentProjectionJSON(t *testing.T, actual any, expected string) {
	t.Helper()
	var want any
	if err := json.Unmarshal([]byte(expected), &want); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(actual, want) {
		t.Fatalf("got %#v; want %#v", actual, want)
	}
}

func TestSubagentIdentityProjectionResetsInvalidOwnDescriptorAndKeepsNativeAuthority(t *testing.T) {
	d := SubagentIdentityProjectionDefinition()
	if d.Key != "subagent" || d.StateVersion != 2 {
		t.Fatal(d.Key, d.StateVersion)
	}
	parent := `{"version":3,"mode":"continuable","provider":"spawn","label":"parent"}`
	for _, payload := range []string{
		`null`, `[]`, `{}`, `{"version":99}`, `{"version":null}`, `{"version":"3"}`,
		`{"version":3,"mode":"one-shot","provider":null}`,
		`{"version":3,"mode":"continuable","provider":"spawn"}`,
		`{"version":3,"mode":"one-shot","provider":"spawn","label":null}`,
		`{"version":3,"mode":"one-shot","provider":"spawn","persona":"forbidden"}`,
		`{"version":3,"mode":"continuable","provider":"spawn","label":"child","extra":1}`,
		`{"version":3,"mode":"continuable","provider":"spawn","label":"child","toolFilter":{}}`,
		`{"version":3,"mode":"continuable","provider":"spawn","label":"child","toolFilter":{"allow":[null]}}`,
		`{"version":3,"mode":"continuable","provider":"spawn","label":"child","toolFilter":{"deny":null}}`,
		`{"version":4,"mode":"continuable","provider":"spawn","label":"child","suppressParentSettlement":true}`,
		`{"version":5,"mode":"continuable","provider":"spawn","label":"child","agentProvider":"unpaired"}`,
		`{"version":6,"mode":"continuable","provider":"spawn"}`,
		`{"version":6,"mode":"continuable","provider":"spawn","label":null}`,
		`{"version":6,"mode":"continuable","provider":"spawn","label":7}`,
		`{"version":6,"mode":"one-shot","provider":"spawn","label":""}`,
		`{"version":7,"mode":"continuable","provider":"spawn","label":""}`,
		`{"version":5,"mode":"continuable","provider":"spawn","label":"child","suppressParentSettlement":null}`,
	} {
		state, _ := d.Init(SessionHeader{SeedLength: 1})
		state, err := d.Apply(state, subagentProjectionEvent(1, "subagent/descriptor", 100, parent))
		if err != nil {
			t.Fatal(err)
		}
		assertSubagentProjectionJSON(t, subagentProjectionJSON(t, d, state), `{"mode":"continuable","label":"parent","seq":1}`)
		state, err = d.Apply(state, subagentProjectionEvent(2, "subagent/descriptor", 200, payload))
		if err != nil {
			t.Fatal(err)
		}
		assertSubagentProjectionJSON(t, subagentProjectionJSON(t, d, state), `null`)
		raw, err := d.EncodeState(state)
		if err != nil || string(raw) != "{}" {
			t.Fatal(string(raw), err)
		}
		state, err = d.DecodeState(raw)
		if err != nil {
			t.Fatal(err)
		}
		assertSubagentProjectionJSON(t, subagentProjectionJSON(t, d, state), `null`)
	}
	for _, tc := range []struct{ payload, view string }{
		{`{"version":3,"mode":"one-shot","provider":""}`, `{"mode":"one-shot","seq":7}`},
		{`{"version":3,"mode":"one-shot","provider":"spawn","label":""}`, `{"mode":"one-shot","label":"","seq":7}`},
		{`{"version":3,"mode":"continuable","provider":"","label":"","agentModel":"solo","agentReasoningEffort":"high","toolFilter":{"allow":[]}}`, `{"mode":"continuable","label":"","seq":7}`},
		{`{"version":4,"mode":"continuable","provider":"spawn","label":"child","agentReasoningEffort":"high"}`, `{"mode":"continuable","label":"child","seq":7}`},
		{`{"version":5,"mode":"continuable","provider":"spawn","label":"child","suppressParentSettlement":true}`, `{"mode":"continuable","label":"child","seq":7}`},
		{`{"version":6,"mode":"continuable","provider":"spawn","label":"","suppressParentSettlement":true}`, `{"mode":"continuable","label":"","seq":7}`},
	} {
		state, _ := d.Init(SessionHeader{})
		state, err := d.Apply(state, subagentProjectionEvent(7, "subagent/descriptor", 100, tc.payload))
		if err != nil {
			t.Fatal(err)
		}
		assertSubagentProjectionJSON(t, subagentProjectionJSON(t, d, state), tc.view)
		view, _ := d.Wire.View(state)
		if value := view.(*SubagentIdentityProjection); value.Label != nil {
			*value.Label = "mutated"
		}
		assertSubagentProjectionJSON(t, subagentProjectionJSON(t, d, state), tc.view)
	}
	// Projection display acceptance must not weaken the stricter native resume parser.
	if _, supported, err := parseSubagentDescriptor([]byte(`{"version":3,"mode":"continuable","provider":"","label":"","agentModel":"solo","agentReasoningEffort":"high"}`)); supported || err == nil {
		t.Fatal("display semantics changed continuation authority")
	}
}

func TestSubagentTimingProjectionDescriptorResetsAndCheckpointCuts(t *testing.T) {
	d := SubagentTimingProjectionDefinition()
	if d.Key != "subagentTiming" || d.StateVersion != 3 {
		t.Fatal(d.Key, d.StateVersion)
	}
	events := []Event{
		subagentProjectionEvent(1, "turn/start", 10, `{}`),
		subagentProjectionEvent(2, "turn/end", 20, `{"reason":{"kind":"completed"}}`),
		subagentProjectionEvent(3, "turn/start", 100, `{}`),
		subagentProjectionEvent(4, "subagent/descriptor", 110, `null`),
		subagentProjectionEvent(5, "assistant/attempt", 150, `{}`),
		subagentProjectionEvent(6, "turn/end", 300, `{"reason":{"kind":"completed"}}`),
		subagentProjectionEvent(7, "turn/start", 1000, `{}`),
		subagentProjectionEvent(8, "subagent/descriptor", 1100, `{"version":99}`),
		subagentProjectionEvent(9, "turn/end", 4100, `{"reason":{"kind":"interrupted"}}`),
		subagentProjectionEvent(10, "turn/start", 10000, `{}`),
		subagentProjectionEvent(11, "turn/end", 9000, `{"reason":"aborted"}`),
		subagentProjectionEvent(12, "turn/start", 12000, `{}`),
		subagentProjectionEvent(13, "turn/end", 13000, `{"reason":"completed"}`),
		subagentProjectionEvent(14, "subagent/descriptor", 14000, `null`),
	}
	views := []string{
		`{"settledMs":0}`, `{"settledMs":0}`, `{"settledMs":0}`,
		`{"settledMs":0,"active":{"since":100,"through":110}}`,
		`{"settledMs":0,"active":{"since":100,"through":150}}`,
		`{"settledMs":200,"lastTurnCompleted":true}`,
		`{"settledMs":200,"active":{"since":1000,"through":1000}}`,
		`{"settledMs":0,"active":{"since":1000,"through":1100}}`,
		`{"settledMs":3100,"lastTurnCompleted":false}`,
		`{"settledMs":3100,"active":{"since":10000,"through":10000}}`,
		`{"settledMs":3100,"lastTurnCompleted":false}`,
		`{"settledMs":3100,"active":{"since":12000,"through":12000}}`,
		`{"settledMs":4100,"lastTurnCompleted":true}`, `{"settledMs":0}`,
	}
	state, _ := d.Init(SessionHeader{SeedLength: 6})
	for i, event := range events {
		before, _ := d.EncodeState(state)
		previous := state
		var err error
		state, err = d.Apply(state, event)
		if err != nil {
			t.Fatal(err)
		}
		unchanged, _ := d.EncodeState(previous)
		if string(before) != string(unchanged) {
			t.Fatal("fold mutated previous state")
		}
		assertSubagentProjectionJSON(t, subagentProjectionJSON(t, d, state), views[i])
		checkpoint, err := d.EncodeState(state)
		if err != nil {
			t.Fatal(err)
		}
		state, err = d.DecodeState(checkpoint)
		if err != nil {
			t.Fatal(err)
		}
		assertSubagentProjectionJSON(t, subagentProjectionJSON(t, d, state), views[i])
		view, _ := d.Wire.View(state)
		value := view.(SubagentTimingProjection)
		if value.Active != nil {
			value.Active.Since = 0
		}
		if value.LastTurnCompleted != nil {
			*value.LastTurnCompleted = !*value.LastTurnCompleted
		}
		assertSubagentProjectionJSON(t, subagentProjectionJSON(t, d, state), views[i])
	}
	before := state
	for _, event := range []Event{subagentProjectionEvent(15, "turn/end", 15000, `{}`), subagentProjectionEvent(16, "unrelated", 16000, `{}`)} {
		state, _ = d.Apply(state, event)
		if state != before {
			t.Fatal("irrelevant event changed state")
		}
	}
}

func TestSubagentProjectionStateSchemasRejectCorruptCheckpoints(t *testing.T) {
	for _, tc := range []struct {
		definition ProjectionDefinition
		invalid    []string
	}{
		{SubagentIdentityProjectionDefinition(), []string{`null`, `[]`, `{"identity":null}`, `{"identity":{"mode":"one-shot"}}`, `{"identity":{"mode":"continuable","seq":0}}`, `{"identity":{"mode":"one-shot","seq":-1}}`, `{"identity":{"mode":"one-shot","seq":9007199254740992}}`, `{"identity":{"mode":"one-shot","seq":1.2}}`, `{"identity":{"mode":"one-shot","seq":0,"label":null}}`, `{"identity":{"mode":"one-shot","seq":0,"extra":1}}`, `{"unknown":true}`}},
		{SubagentTimingProjectionDefinition(), []string{`null`, `{}`, `{"settledMs":0}`, `{"settledMs":null,"descriptorSeen":false}`, `{"settledMs":0,"descriptorSeen":null}`, `{"settledMs":-1,"descriptorSeen":false}`, `{"settledMs":0,"descriptorSeen":false,"active":null}`, `{"settledMs":0,"descriptorSeen":false,"active":{"since":1}}`, `{"settledMs":0,"descriptorSeen":false,"active":{"since":1,"through":null}}`, `{"settledMs":0,"descriptorSeen":false,"active":{"since":1,"through":0,"extra":1}}`, `{"settledMs":0,"descriptorSeen":false,"pendingTurnStart":null}`, `{"settledMs":0,"descriptorSeen":false,"lastTurnCompleted":null}`, `{"settledMs":0,"descriptorSeen":false,"extra":1}`}},
	} {
		for _, raw := range tc.invalid {
			if _, err := tc.definition.DecodeState([]byte(raw)); err == nil {
				t.Fatalf("%s accepted %s", tc.definition.Key, raw)
			}
		}
	}
}

func TestSubagentProjectionsBootRegistrationAndVersionedRestore(t *testing.T) {
	h := subagentTestHarness(t)
	session, err := h.Sessions().Create("subagent-projection-restore", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	initial, err := h.Projections().Snapshot(session, "subagent", "subagentTiming")
	if err != nil {
		t.Fatal(err)
	}
	if string(initial.Values["subagent"]) != "null" || string(initial.Values["subagentTiming"]) != "{\"settledMs\":0}" {
		t.Fatal(initial.Values)
	}
	events := []Event{subagentProjectionEvent(1, "turn/start", 100, `{}`), subagentProjectionEvent(2, "subagent/descriptor", 110, `{"version":3,"mode":"one-shot","provider":"spawn"}`), subagentProjectionEvent(3, "turn/end", 200, `{"reason":{"kind":"completed"}}`), subagentProjectionEvent(4, "subagent/descriptor", 300, `null`)}
	first, err := h.Projections().Restore(nil, events[:2], 1, SessionHeader{})
	if err != nil {
		t.Fatal(err)
	}
	restored, err := h.Projections().Restore(first.Checkpoint, events[2:], 3, SessionHeader{})
	if err != nil {
		t.Fatal(err)
	}
	full, err := h.Projections().Restore(nil, events, 1, SessionHeader{})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(restored, full) {
		t.Fatalf("checkpoint changed result: %#v %#v", restored, full)
	}
	old := first.Checkpoint["subagent"]
	old.Version = 1
	old.Value = json.RawMessage(`{"identity":{"mode":"one-shot"}}`)
	first.Checkpoint["subagent"] = old
	if _, err := h.Projections().Restore(first.Checkpoint, events[2:], 3, SessionHeader{}); err == nil {
		t.Fatal("accepted obsolete identity checkpoint without full log")
	}
	replay, err := h.Projections().Restore(first.Checkpoint, events, 1, SessionHeader{})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(replay.Snapshot, full.Snapshot) {
		t.Fatal("old checkpoint did not refold")
	}
}

func TestSubagentProjectionCheckpointAcceptsJSONIntegerNotations(t *testing.T) {
	for _, tc := range []struct {
		definition ProjectionDefinition
		state      string
	}{
		{SubagentIdentityProjectionDefinition(), `{"identity":{"mode":"one-shot","seq":1e0}}`},
		{SubagentTimingProjectionDefinition(), `{"descriptorSeen":false,"settledMs":0.0,"pendingTurnStart":1e2,"active":{"since":0e0,"through":1.0}}`},
	} {
		if _, err := tc.definition.DecodeState([]byte(tc.state)); err != nil {
			t.Fatal(err)
		}
	}
}

func TestSubagentIdentityProjectionDoesNotRewriteFirstOwnDescriptorAuthority(t *testing.T) {
	parent := NewSession("projection-authority-parent", "")
	if _, err := parent.Append("subagent/descriptor", json.RawMessage(`{"version":5,"mode":"continuable","provider":"parent-provider","label":"parent"}`)); err != nil {
		t.Fatal(err)
	}
	header := NewSession("projection-authority-child", "").Header()
	header.SeedLength = uint64(len(parent.Events()))
	child, err := RestoreSession(header, parent.Events())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := child.Append("subagent/descriptor", json.RawMessage(`{"version":5,"mode":"continuable","provider":"child-provider","label":"child"}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := child.Append("subagent/descriptor", json.RawMessage(`{"version":99}`)); err != nil {
		t.Fatal(err)
	}
	d := SubagentIdentityProjectionDefinition()
	state, _ := d.Init(header)
	for _, event := range child.Events() {
		state, err = d.Apply(state, event)
		if err != nil {
			t.Fatal(err)
		}
	}
	assertSubagentProjectionJSON(t, subagentProjectionJSON(t, d, state), `null`)
	descriptor, found, err := FoldSubagentDescriptor(child)
	if err != nil || !found || descriptor.Provider != "child-provider" {
		t.Fatalf("display fold changed own-descriptor authority: %+v %v %v", descriptor, found, err)
	}
}
