package nativetools

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
)

func TestSavedOutputReadback(t *testing.T) {
	root := t.TempDir() + "/saved"
	store := harness.NewLocalSpillStore(root)
	f := newClaudeFixture(t, Options{SpillStore: store})
	text := strings.Repeat("输出🙂\n", 40)
	ref, err := store.SaveText(t.Context(), harness.SaveTextSpill{Owner: harness.SpillOwner{SessionID: f.allowed.ID()}, Source: harness.SpillSource{ToolName: "Bash", CallID: "saved", Label: "result"}, SuggestedName: "output.txt", Content: text})
	if err != nil {
		t.Fatal(err)
	}
	// A new store object uses the stable root, as a resumed CLI would.
	cold := harness.NewLocalSpillStore(root)
	var recovered strings.Builder
	for offset := int64(0); ; {
		page, err := cold.ReadTextPage(t.Context(), harness.SpillOwner{SessionID: f.allowed.ID()}, ref.Locator, offset, 17)
		if err != nil || page.Read == nil {
			t.Fatalf("page=%+v error=%v", page, err)
		}
		recovered.WriteString(page.Read.Text)
		if !page.Read.Truncated {
			break
		}
		if page.Read.Text == "" {
			t.Fatal("pagination did not advance")
		}
		offset += int64(len(page.Read.Text))
	}
	if recovered.String() != text {
		t.Fatal("cold readback lost content")
	}
	for _, owner := range []harness.SpillOwner{{SessionID: f.allowed.ID()}, {SessionID: "other"}} {
		lookup, err := cold.ReadTextPage(t.Context(), owner, ref.Locator, 1, 17)
		if owner.SessionID == f.allowed.ID() && err == nil {
			t.Fatal("accepted offset inside UTF-8 rune")
		}
		if owner.SessionID != f.allowed.ID() && lookup.Read != nil {
			t.Fatal("read another Session's output")
		}
	}
	raw, _ := json.Marshal(struct {
		Locator string `json:"locator"`
		Limit   int    `json:"limit"`
	}{ref.Locator, 17})
	result, err := f.harness.Tools().Execute(t.Context(), harness.ToolRequest{Agent: f.allowed, Name: "ReadToolOutput", CallID: "read", Arguments: raw})
	if err != nil || result.Result.IsError {
		t.Fatalf("tool readback=%+v %v", result, err)
	}
	var page struct {
		Text       string
		NextOffset int64 `json:"next_offset"`
	}
	if json.Unmarshal([]byte(result.Result.Content[0].Text), &page) != nil || page.NextOffset != int64(len(page.Text)) || page.NextOffset == 0 {
		t.Fatal("readback tool lost continuation")
	}
}

func TestSessionHistoryReadbackWithoutSpill(t *testing.T) {
	f := newClaudeFixture(t, Options{})
	event, err := f.allowed.Session().Append("tool/result", harness.ContentBlock{Type: harness.BlockToolResult, ToolCallID: "old", Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "历史原文🙂"}}})
	if err != nil {
		t.Fatal(err)
	}
	args, _ := json.Marshal(struct {
		Locator string `json:"locator"`
	}{fmt.Sprintf("session-tool-result:%s:%d", f.allowed.ID(), event.Seq)})
	out, err := f.harness.Tools().Execute(t.Context(), harness.ToolRequest{Agent: f.allowed, Name: "ReadToolOutput", CallID: "recover", Arguments: args})
	if err != nil || out.Result.IsError || !strings.Contains(out.Result.Content[0].Text, "历史原文") {
		t.Fatalf("result=%+v error=%v", out, err)
	}
}
