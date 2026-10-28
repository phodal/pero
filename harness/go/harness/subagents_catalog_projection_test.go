package harness

import (
	"encoding/json"
	"fmt"
	"reflect"
	"testing"
)

func catalogFactEvent(t *testing.T, seq uint64, version int, id, mode string, label *string) Event {
	t.Helper()
	raw, err := json.Marshal(SubagentCatalogFact{Version: version, ChildID: SessionID(id), ChildCreatedAt: int64(1000 - seq), Mode: mode, Label: label})
	if err != nil {
		t.Fatal(err)
	}
	return Event{Seq: seq, Type: "subagent/catalog", Data: raw}
}

func TestSubagentCatalogProjectionVersionsOrderCheckpointsAndOwnership(t *testing.T) {
	d := SubagentCatalogProjectionDefinition()
	if d.StateVersion != 6 {
		t.Fatal(d.StateVersion)
	}
	raw, err := d.Init(SessionHeader{SeedLength: 2})
	if err != nil {
		t.Fatal(err)
	}
	for seq := uint64(1); seq <= 2; seq++ {
		before := raw
		raw, err = d.Apply(raw, Event{Seq: seq, Type: "subagent/catalog", Data: json.RawMessage(`{"invalid":true}`)})
		if err != nil || raw != before {
			t.Fatalf("inherited fact changed state: %v", err)
		}
	}
	label := ""
	var first any
	var checkpoint json.RawMessage
	for i := 0; i < 130; i++ {
		mode, version, caption := "one-shot", 0, (*string)(nil)
		switch i % 4 {
		case 1:
			mode, version, caption = "continuable", 1, &label
		case 2:
			mode, version = "unknown", 1
		case 3:
			mode, version = "external", 2
		}
		raw, err = d.Apply(raw, catalogFactEvent(t, uint64(i+3), version, fmt.Sprintf("child-%d", i), mode, caption))
		if err != nil {
			t.Fatal(err)
		}
		if i == 63 {
			first = raw
			checkpoint, err = d.EncodeState(first)
			if err != nil {
				t.Fatal(err)
			}
		}
	}
	unchanged, _ := d.EncodeState(first)
	if string(unchanged) != string(checkpoint) {
		t.Fatal("append mutated an earlier state")
	}
	encoded, err := d.EncodeState(raw)
	if err != nil {
		t.Fatal(err)
	}
	restored, err := d.DecodeState(encoded)
	if err != nil {
		t.Fatal(err)
	}
	view, err := d.Wire.View(restored)
	if err != nil {
		t.Fatal(err)
	}
	entries := view.([]SubagentChildCatalogEntry)
	if len(entries) != 130 {
		t.Fatal(len(entries))
	}
	for i, entry := range entries {
		if entry.ID != SessionID(fmt.Sprintf("child-%d", i)) {
			t.Fatalf("event order changed at %d: %+v", i, entry)
		}
	}
	if entries[1].Label == nil || *entries[1].Label != "" {
		t.Fatal("empty required label was omitted")
	}
	*entries[1].Label = "mutated"
	entries[0].ID = "mutated"
	again, _ := d.Wire.View(restored)
	if reflect.DeepEqual(entries, again) {
		t.Fatal("view mutation reached retained state")
	}
}

func TestSubagentCatalogProjectionRejectsMalformedOwnFacts(t *testing.T) {
	invalid := []string{
		`{"version":0,"childId":"c","childCreatedAt":0,"mode":"unknown"}`,
		`{"version":1,"childId":"c","childCreatedAt":0,"mode":"external"}`,
		`{"version":2,"childId":"c","childCreatedAt":0,"mode":"one-shot"}`,
		`{"version":9,"childId":"c","childCreatedAt":0,"mode":"one-shot"}`,
		`{"version":0,"childId":"c","childCreatedAt":0,"mode":"continuable"}`,
		`{"version":0,"childId":"c","childCreatedAt":-1,"mode":"one-shot"}`,
		`{"version":0,"childId":"c","childCreatedAt":0,"mode":"one-shot","external":true}`,
		`{"childId":"c","childCreatedAt":0,"mode":"one-shot"}`,
		`{"version":0,"childId":"c","childCreatedAt":0,"mode":"one-shot","label":null}`,
	}
	d := SubagentCatalogProjectionDefinition()
	for _, value := range invalid {
		t.Run(value, func(t *testing.T) {
			state, _ := d.Init(SessionHeader{})
			if _, err := d.Apply(state, Event{Seq: 1, Type: "subagent/catalog", Data: json.RawMessage(value)}); err == nil {
				t.Fatal("invalid fact accepted")
			}
		})
	}
	for _, value := range []string{`{}`, `{"inheritedEventCount":0,"head":{"values":[]}}`, `{"inheritedEventCount":0,"unexpected":1}`} {
		if _, err := d.DecodeState(json.RawMessage(value)); err == nil {
			t.Fatalf("invalid checkpoint accepted: %s", value)
		}
	}
}
