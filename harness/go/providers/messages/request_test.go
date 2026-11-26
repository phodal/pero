package messages

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/model"
)

func TestRequestToolResultsAreAdjacentAndGrouped(t *testing.T) {
	text := func(s string) model.ContentBlock { return model.ContentBlock{Type: model.BlockText, Text: s} }
	call := func(id model.ToolCallID) model.ContentBlock {
		return model.ContentBlock{Type: model.BlockToolCall, ToolCallID: id, Name: "fixture", Arguments: json.RawMessage(`{"value":1}`)}
	}
	result := func(id model.ToolCallID) model.Message {
		return model.Message{Role: model.RoleTool, Content: []model.ContentBlock{{Type: model.BlockToolResult, ToolCallID: id, Content: []model.ContentBlock{text("returned")}}}}
	}
	user := model.Message{Role: model.RoleUser, Content: []model.ContentBlock{text("prompt")}}
	assistant := model.Message{Role: model.RoleAssistant, Content: []model.ContentBlock{call("a"), call("b")}}
	for _, tc := range []struct {
		name    string
		history []model.Message
		fail    string
	}{
		{"parallel-results-then-user-text", []model.Message{user, assistant, result("a"), result("b"), user}, ""},
		{"missing-result", []model.Message{user, assistant, result("a")}, "incomplete"},
		{"late-result", []model.Message{user, assistant, user, result("a"), result("b")}, "adjacent"},
		{"wrong-id", []model.Message{user, assistant, result("wrong")}, "unmatched"},
		{"unsupported-file", []model.Message{{Role: model.RoleUser, Content: []model.ContentBlock{{Type: model.BlockFile}}}}, "unsupported"},
		{"unsupported-reasoning", []model.Message{user, {Role: model.RoleAssistant, Content: []model.ContentBlock{{Type: model.BlockReasoning}}}, user}, "unsupported"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			wire, err := Encode("fixture", "system", 128, nil, nil, tc.history, nil)
			if tc.fail != "" {
				if err == nil || !strings.Contains(err.Error(), tc.fail) {
					t.Fatalf("expected %q, got %v", tc.fail, err)
				}
				return
			}
			content := wire.Messages[2].Content
			if len(wire.Messages) != 3 || len(content) != 3 || content[0].ToolUseID != "a" || content[1].ToolUseID != "b" || content[2].Type != "text" {
				t.Fatalf("tool results and user text did not stay adjacent: %+v", wire.Messages)
			}
		})
	}
}
