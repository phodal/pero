package harness

import (
	"context"
	"encoding/json"
	"testing"
)

func subagentTestHarness(t *testing.T) *Harness {
	t.Helper()
	h, err := Boot(t.Context(), Options{EnableSubagents: true, Adapter: AdapterFunc(func(context.Context, GenerateRequest, func(StreamChunk) error) (Completion, error) {
		return Completion{Message: Message{Role: RoleAssistant}, Finish: FinishStop}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.Dispose(context.Background()) })
	return h
}

func dshInboxMessage(id string, human bool) Message {
	source := json.RawMessage(`{"kind":"agent-message","sessionId":"parent"}`)
	if human {
		source = json.RawMessage(`{"kind":"user"}`)
	}
	return Message{ID: id, Role: RoleUser, Source: source, Content: []ContentBlock{{Type: BlockText, Text: id}}}
}
func TestSubagentsDisabledByDefault(t *testing.T) {
	h := retirementHarness(t)
	if h.Subagents() != nil {
		t.Fatal("subagents implicitly enabled")
	}
}
