package model

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestProjectAppUseContextPreservesUserHistory(t *testing.T) {
	text := func(value string) ContentBlock {
		return ContentBlock{Type: BlockText, Text: value}
	}
	const workflow = "Host-provided App Use workflow:\nbody"
	selected := ContentBlock{Type: BlockText, Text: workflow, Meta: AppUseContextSelected.Metadata()}
	automatic := ContentBlock{Type: BlockText, Text: workflow, Meta: AppUseContextAutomatic.Metadata()}
	user := func(id string, content ...ContentBlock) Message {
		return Message{ID: id, Role: RoleUser, Content: content}
	}

	for _, tc := range []struct {
		name  string
		input []Message
		want  []Message
	}{
		{
			name:  "legacy unmarked text remains user content",
			input: []Message{user("legacy", text(workflow)), user("current", text("second"), automatic)},
			want:  []Message{user("legacy", text(workflow)), user("current", text("second"), automatic)},
		},
		{
			name: "new workflow supersedes old workflow and preserves the tool continuation",
			input: []Message{
				user("first", text("first"), selected, text("selected data")),
				{ID: "assistant", Role: RoleAssistant, Content: []ContentBlock{{Type: BlockToolCall, ToolCallID: "call", Name: "read"}}},
				{ID: "result", Role: RoleTool, Content: []ContentBlock{{Type: BlockToolResult, ToolCallID: "call", Content: []ContentBlock{text("observation")}}}},
				user("second", text("second"), automatic),
				user("followup", text("continue after the tool")),
			},
			want: []Message{
				user("first", text("first"), text("selected data")),
				{ID: "assistant", Role: RoleAssistant, Content: []ContentBlock{{Type: BlockToolCall, ToolCallID: "call", Name: "read"}}},
				{ID: "result", Role: RoleTool, Content: []ContentBlock{{Type: BlockToolResult, ToolCallID: "call", Content: []ContentBlock{text("observation")}}}},
				user("second", text("second"), automatic),
				user("followup", text("continue after the tool")),
			},
		},
		{
			name: "unknown metadata remains ordinary content",
			input: []Message{user("unknown",
				ContentBlock{Type: BlockText, Text: workflow, Meta: json.RawMessage(`{"pero.appUseContext":"future"}`)},
				ContentBlock{Type: BlockText, Text: workflow, Meta: json.RawMessage(`{"pero.appusecontext":"selected"}`)},
			), user("current", selected)},
			want: []Message{user("unknown",
				ContentBlock{Type: BlockText, Text: workflow, Meta: json.RawMessage(`{"pero.appUseContext":"future"}`)},
				ContentBlock{Type: BlockText, Text: workflow, Meta: json.RawMessage(`{"pero.appusecontext":"selected"}`)},
			), user("current", selected)},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			original := CloneMessages(tc.input)
			if got := ProjectAppUseContext(tc.input); !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("projected messages = %+v, want %+v", got, tc.want)
			}
			if !reflect.DeepEqual(tc.input, original) {
				t.Fatalf("projection modified original messages: %+v", tc.input)
			}
		})
	}
}
