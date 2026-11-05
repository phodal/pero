package harness

import (
	"context"
	"encoding/json"
	"testing"
)

func TestToolProgressObservations(t *testing.T) {
	for _, row := range []struct {
		name, tool string
		results    []string
		turns      []int
		want       bool
	}{
		{"unchanged read", "Read", []string{`{"digest":"a"}`, `{"digest":"a"}`, `{"digest":"a"}`}, []int{1, 1, 1}, true},
		{"file changed", "Read", []string{`{"digest":"a"}`, `{"digest":"b"}`, `{"digest":"c"}`}, []int{1, 1, 1}, false},
		{"new turn", "Read", []string{"same", "same", "same"}, []int{1, 1, 2}, false},
		{"polling", "TaskOutput", []string{"same", "same", "same"}, []int{1, 1, 1}, false},
		{"mutation", "Edit", []string{"same", "same", "same"}, []int{1, 1, 1}, false},
		{"shell timing only", "Bash", []string{`{"exitCode":1,"stdout":{"text":"failed"},"durationMs":1}`, `{"exitCode":1,"stdout":{"text":"failed"},"durationMs":2}`, `{"exitCode":1,"stdout":{"text":"failed"},"durationMs":3}`}, []int{1, 1, 1}, true},
		{"shell effect certainty changed", "Bash", []string{`{"exitCode":1,"cleanupUncertain":true}`, `{"exitCode":1,"cleanupUncertain":false}`, `{"exitCode":1,"signal":"killed"}`}, []int{1, 1, 1}, false},
		{"shell output changed", "Bash", []string{`{"exitCode":1,"stdout":{"text":"a"}}`, `{"exitCode":1,"stdout":{"text":"b"}}`, `{"exitCode":0,"stdout":{"text":"c"}}`}, []int{1, 1, 1}, false},
	} {
		t.Run(row.name, func(t *testing.T) {
			var progress toolProgress
			var reminder *DeferredContext
			for i, text := range row.results {
				args := json.RawMessage(`{"a":1,"b":2}`)
				if i == 1 {
					args = json.RawMessage(`{"b":2,"a":1}`)
				}
				reminder = progress.observe(row.turns[i], ContentBlock{Name: row.tool, Arguments: args, ToolCallID: "observed"}, ToolResult{Content: []ContentBlock{{Type: BlockText, Text: text}}})
			}
			if (reminder != nil) != row.want {
				t.Fatalf("reminder=%+v want=%t", reminder, row.want)
			}
		})
	}
}

func TestToolProgressReminderReachesNextRequestAfterResults(t *testing.T) {
	requests := 0
	adapter := AdapterFunc(func(_ context.Context, request GenerateRequest, _ func(StreamChunk) error) (Completion, error) {
		requests++
		if requests <= 3 {
			return Completion{Finish: FinishToolCalls, Message: Message{Role: RoleAssistant, Content: []ContentBlock{{Type: BlockToolCall, ToolCallID: ToolCallID(string(rune('a' + requests))), Name: "Read", Arguments: json.RawMessage(`{}`)}}}}, nil
		}
		last := request.Messages[len(request.Messages)-1]
		var source struct {
			Kind  string
			Count int
		}
		if json.Unmarshal(last.Source, &source) != nil || source.Kind != "tool-progress-reminder" || source.Count != 3 || last.Role != RoleUser {
			t.Fatalf("missing attributed reminder: %+v", last)
		}
		before := request.Messages[len(request.Messages)-2]
		if before.Role != RoleTool || before.Content[0].ToolCallID != "d" {
			t.Fatal("reminder split the call/result protocol")
		}
		return Completion{Finish: FinishStop, Message: Message{Role: RoleAssistant, Content: []ContentBlock{{Type: BlockText, Text: "observed"}}}}, nil
	})
	h, err := Boot(t.Context(), Options{Adapter: adapter})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) })
	_, err = h.RegisterTool(t.Context(), "progress-read", Tool{Schema: ToolSchema{Name: "Read", InputSchema: json.RawMessage(`{"type":"object"}`)}, Execute: func(context.Context, json.RawMessage) (ToolResult, error) {
		return ToolResult{Content: []ContentBlock{{Type: BlockText, Text: `{"digest":"same"}`}}}, nil
	}})
	if err != nil {
		t.Fatal(err)
	}
	a, err := h.Agents().Create(t.Context(), AgentOptions{CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.Prompt(t.Context(), Message{Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: "inspect"}}}); err != nil {
		t.Fatal(err)
	}
	if requests != 4 {
		t.Fatalf("requests=%d", requests)
	}
}
