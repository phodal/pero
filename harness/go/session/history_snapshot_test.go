package session

import (
	"bytes"
	"encoding/json"
	"reflect"
	"testing"
)

func TestHistorySnapshotDetachesHistoryAndSurface(t *testing.T) {
	s := NewSession("history-snapshot", "")
	event, err := s.Append("user/message", Message{ID: "a", Role: RoleUser, Source: json.RawMessage(`{"kind":"user"}`), Content: []ContentBlock{{Type: BlockText, Text: "first"}}})
	if err != nil {
		t.Fatal(err)
	}
	events, surface := s.HistorySnapshot()
	if len(events) != 1 || len(surface) != 1 || surface[0] != event.Seq {
		t.Fatal("inconsistent history snapshot")
	}
	events[0].Data[0] = '!'
	events[0].SurfaceOp[0] = '!'
	surface[0] = 999
	again, againSurface := s.HistorySnapshot()
	if !json.Valid(again[0].Data) || !json.Valid(again[0].SurfaceOp) || againSurface[0] != event.Seq {
		t.Fatal("snapshot aliases Session storage")
	}
	s.Subscribe(func(Event) {
		events, surface := s.HistorySnapshot()
		if len(events) != 2 || len(surface) != 2 {
			t.Error("subscriber did not observe atomic committed history")
		}
	})
	if _, err = s.Append("user/message", Message{ID: "b", Role: RoleUser, Source: json.RawMessage(`{"kind":"user"}`), Content: []ContentBlock{{Type: BlockText, Text: "second"}}}); err != nil {
		t.Fatal(err)
	}
}

// The durable skill reducer reads this combined snapshot. Opaque metadata must
// remain detached there too, without becoming semantic surface or provenance.
func TestHistorySnapshotPreservesDetachedOpaqueMetadata(t *testing.T) {
	for _, raw := range []json.RawMessage{nil, json.RawMessage(`null`), json.RawMessage(`[]`), json.RawMessage(`17`), json.RawMessage(`{"future":[1,"\ud800"]}`)} {
		t.Run(string(raw), func(t *testing.T) {
			base := NewSession("opaque-history", "")
			first, err := base.Append("user/message", Message{ID: "ordinary", Role: RoleUser, Source: json.RawMessage(`{"kind":"user"}`), Content: []ContentBlock{{Type: BlockText, Text: "visible"}}})
			if err != nil {
				t.Fatal(err)
			}
			opaque := Event{Seq: 2, Time: first.Time, Type: "plugin:future/history", Ignorable: true, Data: json.RawMessage(`{"turn":999,"text":"\ud800"}`), SurfaceOp: json.RawMessage(`{"replace":{"start":1,"end":999}}`), OpaqueSourceEventSeqs: raw}
			log, err := RestoreSession(base.Header(), append(base.Events(), opaque))
			if err != nil {
				t.Fatal(err)
			}
			events, surface := log.HistorySnapshot()
			if len(events) != 2 || !events[1].IsOpaque() || events[1].SourceEventSeqs != nil || !reflect.DeepEqual(surface, []uint64{first.Seq}) || !bytes.Equal(events[1].OpaqueSourceEventSeqs, raw) {
				t.Fatal("opaque snapshot changed identity, presence or surface")
			}
			events[1].Data[0] = '!'
			events[1].SurfaceOp[0] = '!'
			surface[0] = 999
			if len(events[1].OpaqueSourceEventSeqs) > 0 {
				events[1].OpaqueSourceEventSeqs[0] = '!'
			}
			again, againSurface := log.HistorySnapshot()
			if !bytes.Equal(again[1].Data, opaque.Data) || !bytes.Equal(again[1].SurfaceOp, opaque.SurfaceOp) || !bytes.Equal(again[1].OpaqueSourceEventSeqs, raw) || !reflect.DeepEqual(againSurface, []uint64{first.Seq}) {
				t.Fatal("combined history snapshot aliases opaque storage")
			}
			if turn, err := log.LastTurn(); err != nil || turn != 0 {
				t.Fatalf("opaque metadata gained turn authority: %d %v", turn, err)
			}
		})
	}
}

func TestSurfaceDeltaTracksReplacementsAndDetachesReceipts(t *testing.T) {
	s := NewSession("surface-delta", "")
	first, err := s.Append("user/message", Message{Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: "before"}}})
	if err != nil {
		t.Fatal(err)
	}
	events, surface, last := s.SurfaceDelta(0)
	if len(events) != 1 || len(surface) != 1 || last != first.Seq {
		t.Fatal("incomplete initial surface")
	}
	_, err = s.AppendReplacement("user/message", Message{Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: "after"}}}, SurfaceRange{Start: first.Seq, End: first.Seq}, []uint64{first.Seq})
	if err != nil {
		t.Fatal(err)
	}
	delta, current, next := s.SurfaceDelta(last)
	if len(delta) != 1 || len(current) != 1 || current[0] != delta[0].Seq || next <= last {
		t.Fatal("replacement missing from incremental surface")
	}
	raw, ok := s.EventAt(first.Seq)
	if !ok || string(raw.Data) != string(events[0].Data) {
		t.Fatal("shadowed original is not recoverable")
	}
	delta[0].Data[0] = '!'
	current[0] = 999
	raw.Data[0] = '!'
	original, _ := s.EventAt(first.Seq)
	again, _, _ := s.SurfaceDelta(last)
	if original.Data[0] == '!' || again[0].Data[0] == '!' {
		t.Fatal("snapshot aliases committed receipts")
	}
	empty, retained, _ := s.SurfaceDelta(next)
	if len(empty) != 0 || len(retained) != 1 {
		t.Fatal("stable snapshot recopied committed payload")
	}
}
