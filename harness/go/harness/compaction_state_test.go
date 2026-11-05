package harness

import (
	"encoding/json"
	"testing"
)

func TestCheckpointFileOperations(t *testing.T) {
	var events []Event
	appendEvent := func(kind string, value any) {
		raw, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		events = append(events, Event{Seq: uint64(len(events) + 1), Type: kind, Data: raw})
	}
	appendEvent("tool/call", struct {
		CallID    string `json:"callId"`
		Name      string
		Arguments json.RawMessage
	}{"r", "Read", json.RawMessage(`{"file_path":"src/算法.go"}`)})
	appendEvent("tool/result", ContentBlock{Type: BlockToolResult, ToolCallID: "r"})
	appendEvent("tool/call", struct {
		CallID    string `json:"callId"`
		Name      string
		Arguments json.RawMessage
	}{"w", "Write", json.RawMessage(`{"file_path":"missing"}`)})
	appendEvent("tool/result", ContentBlock{Type: BlockToolResult, ToolCallID: "w", IsError: true})
	appendEvent("tool/call", struct {
		CallID    string `json:"callId"`
		Name      string
		Arguments json.RawMessage
	}{"later", "Edit", json.RawMessage(`{"file_path":"later"}`)})
	appendEvent("tool/result", ContentBlock{Type: BlockToolResult, ToolCallID: "later"})
	rows := checkpointFileOperations(events, 4)
	if len(rows) != 1 || rows[0].Path != "src/算法.go" || rows[0].ResultSeq != 2 || rows[0].Operation != "read" {
		t.Fatalf("rows=%+v", rows)
	}
}
