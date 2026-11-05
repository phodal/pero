package harness

import (
	"context"
	"encoding/json"
	"testing"
)

func TestDiagnosticReminderFollowsCompleteResultBatch(t *testing.T) {
	requests := 0
	adapter := AdapterFunc(func(_ context.Context, request GenerateRequest, _ func(StreamChunk) error) (Completion, error) {
		requests++
		if requests == 1 {
			return Completion{Finish: FinishToolCalls, Message: Message{Role: RoleAssistant, Content: []ContentBlock{
				{Type: BlockToolCall, ToolCallID: "failure", Name: "Bash", Arguments: json.RawMessage(`{"command":"missing-command"}`)},
				{Type: BlockToolCall, ToolCallID: "independent", Name: "Bash", Arguments: json.RawMessage(`{"command":"true"}`)},
			}}}, nil
		}
		last := request.Messages[len(request.Messages)-1]
		var source struct {
			Kind string `json:"kind"`
		}
		if json.Unmarshal(last.Source, &source) != nil || source.Kind != "tool-diagnostic-reminder" {
			t.Fatalf("missing diagnostic context: %+v", last)
		}
		before := request.Messages[len(request.Messages)-2]
		if before.Role != RoleTool || before.Content[0].ToolCallID != "independent" || request.Messages[len(request.Messages)-3].Content[0].ToolCallID != "failure" {
			t.Fatalf("context interrupted result batch: %+v", before)
		}
		return Completion{Finish: FinishStop, Message: Message{Role: RoleAssistant, Content: []ContentBlock{{Type: BlockText, Text: "observed"}}}}, nil
	})
	h, err := Boot(t.Context(), Options{Adapter: adapter})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { h.Dispose(context.Background()); h.Drain(context.Background()) })
	_, err = h.RegisterTool(t.Context(), "diagnostic-test", Tool{Schema: ToolSchema{Name: "Bash", InputSchema: json.RawMessage(`{"type":"object"}`)}, Execute: func(_ context.Context, raw json.RawMessage) (ToolResult, error) {
		text := `{"exitCode":127,"stderr":"missing-command: command not found"}`
		if string(raw) == `{"command":"true"}` {
			text = `{"exitCode":0}`
		}
		return ToolResult{Content: []ContentBlock{{Type: BlockText, Text: text}}}, nil
	}})
	if err != nil {
		t.Fatal(err)
	}
	a, err := h.Agents().Create(t.Context(), AgentOptions{CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.Prompt(t.Context(), Message{Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: "run"}}}); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, event := range a.Session().Events() {
		if event.Type == "tool/diagnostic" {
			found = true
		}
	}
	if !found || requests != 2 {
		t.Fatal("diagnostic observation was not persisted")
	}
}
