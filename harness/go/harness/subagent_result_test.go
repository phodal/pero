package harness

import "testing"

func TestSubagentToolContentPreservesSupportedMediaAndIsolatesTranscript(t *testing.T) {
	result := SubagentResult{Output: []ContentBlock{
		{Type: BlockText, Text: "answer"},
		{Type: BlockToolCall, Name: "Bash", Arguments: []byte(`{"command":"do not replay"}`)},
		{Type: BlockReasoning, Text: "private reasoning"},
		{Type: BlockToolResult, Content: []ContentBlock{{Type: BlockText, Text: "raw tool output"}}},
		{Type: BlockImage, MIMEType: "image/png", Data: []byte("image")},
	}}
	content := result.ParentContent()
	if len(content) != 2 || content[0].Type != BlockText || content[0].Text != "answer" || content[1].Type != BlockImage || content[1].MIMEType != "image/png" {
		t.Fatalf("invalid parent tool content: %+v", content)
	}
	content[0].Text = "changed"
	content[1].Data[0] = 'X'
	if result.Output[0].Text != "answer" || string(result.Output[4].Data) != "image" || result.Output[1].Type != BlockToolCall {
		t.Fatal("projection mutated the retained child transcript")
	}
}
