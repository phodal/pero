package harness

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestToolBatchBudgetPreservesRecoverableEvidence(t *testing.T) {
	for _, mode := range []string{"saved", "unavailable", "quota"} {
		t.Run(mode, func(t *testing.T) {
			requests := 0
			original := strings.Repeat("failure detail\n", 2800)
			adapter := AdapterFunc(func(_ context.Context, request GenerateRequest, _ func(StreamChunk) error) (Completion, error) {
				requests++
				if requests == 1 {
					var calls []ContentBlock
					for _, id := range []ToolCallID{"a", "b", "c"} {
						calls = append(calls, ContentBlock{Type: BlockToolCall, Name: "inspect", ToolCallID: id, Arguments: json.RawMessage(`{}`)})
					}
					return Completion{Finish: FinishToolCalls, Message: Message{Role: RoleAssistant, Content: calls}}, nil
				}
				total, results := 0, 0
				for _, message := range request.Messages {
					for _, block := range message.Content {
						if block.Type != BlockToolResult {
							continue
						}
						results++
						if !block.IsError || string(block.Meta) != `{"exit":1}` {
							t.Fatal("projection lost failure attribution")
						}
						text, _ := flattenToolText(block.Content)
						total += len(text)
						if mode == "saved" && !strings.Contains(text, "Full formatted result stored at:") {
							t.Fatal("projection lost recovery pointer")
						}
						if mode != "saved" && text != original {
							t.Fatal("storage failure discarded evidence")
						}
					}
				}
				if results != 3 || mode == "saved" && total > DefaultToolOutputBatchBytes {
					t.Fatalf("results=%d text bytes=%d", results, total)
				}
				return Completion{Finish: FinishStop, Message: Message{Role: RoleAssistant, Content: []ContentBlock{{Type: BlockText, Text: "done"}}}}, nil
			})
			h, err := Boot(t.Context(), Options{Adapter: adapter})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) })
			if mode != "unavailable" {
				quota := int64(0)
				if mode == "quota" {
					quota = 1
				}
				store := NewLocalSpillStoreWithOptions(LocalSpillStoreOptions{Root: t.TempDir() + "/output", SessionMaxBytes: quota})
				if _, err := h.RegisterSpillStore(t.Context(), "output", store, SpillPolicyOptions{}); err != nil {
					t.Fatal(err)
				}
			}
			_, err = h.RegisterTool(t.Context(), "inspect", Tool{Schema: ToolSchema{Name: "inspect", InputSchema: json.RawMessage(`{"type":"object"}`)}, Execute: func(context.Context, json.RawMessage) (ToolResult, error) {
				return ToolResult{IsError: true, Meta: json.RawMessage(`{"exit":1}`), Content: []ContentBlock{{Type: BlockText, Text: original}}}, nil
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
			found := false
			for _, event := range a.Session().Events() {
				if event.Type == "tool/batch-budget" {
					var measurement toolBatchBudget
					if err := json.Unmarshal(event.Data, &measurement); err != nil {
						t.Fatal(err)
					}
					found = true
					if measurement.Met != (mode == "saved") || measurement.BeforeBytes != 3*len(original) {
						t.Fatalf("measurement=%+v", measurement)
					}
				}
			}
			if !found {
				t.Fatal("missing batch attribution")
			}
		})
	}
}
