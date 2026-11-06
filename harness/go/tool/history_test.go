package tool

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	harnessmodel "github.com/phodal/pero/harness/go/model"
	harnesssession "github.com/phodal/pero/harness/go/session"
)

func TestToolHistoryWatermarksAndReplay(t *testing.T) {
	for _, row := range []struct {
		name                  string
		high, low, keep, want int
		unconsumed            bool
		pending               int
	}{
		{"below threshold", 10000, 5000, 1, 0, false, 0},
		{"low watermark", 4000, 2500, 1, 3, false, 0},
		{"recent protection", 4000, 1000, 3, 1, false, 0},
		{"no response yet", 4000, 1000, 1, 0, true, 0},
		{"pending batch exceeds recent count", 4000, 1000, 1, 3, false, 8},
		{"pending batch with no recent protection", 4000, 0, 0, 4, false, 8},
	} {
		t.Run(row.name, func(t *testing.T) {
			s := harnesssession.NewSession("owner", "")
			if _, err := s.Append("turn/start", struct {
				Turn int `json:"turn"`
			}{1}); err != nil {
				t.Fatal(err)
			}
			var original harnessmodel.Event
			for i := 0; i < 5; i++ {
				block := harnessmodel.ContentBlock{Type: harnessmodel.BlockToolResult, ToolCallID: harnessmodel.ToolCallID(fmt.Sprint(i)), IsError: i == 1, Content: []harnessmodel.ContentBlock{{Type: harnessmodel.BlockText, Text: strings.Repeat("数据🙂", 300)}}}
				event, err := s.Append("tool/result", block)
				if err != nil {
					t.Fatal(err)
				}
				if i == 0 {
					original = event
				}
			}
			if !row.unconsumed {
				if _, err := s.Append("assistant/message", struct {
					Message harnessmodel.Message `json:"message"`
				}{harnessmodel.Message{Role: harnessmodel.RoleAssistant}}); err != nil {
					t.Fatal(err)
				}
			}
			for i := 0; i < row.pending; i++ {
				if _, err := s.Append("tool/result", harnessmodel.ContentBlock{
					Type: harnessmodel.BlockToolResult, ToolCallID: harnessmodel.ToolCallID(fmt.Sprintf("pending-%d", i)),
					Content: []harnessmodel.ContentBlock{{Type: harnessmodel.BlockText, Text: strings.Repeat("fresh", 300)}},
				}); err != nil {
					t.Fatal(err)
				}
			}
			p, err := NewToolResultPruner(ToolResultPruneConfig{TotalChars: &row.high, LowWatermarkChars: &row.low, KeepRecent: &row.keep})
			if err != nil {
				t.Fatal(err)
			}
			result, err := p.PruneHistorySession(s)
			if err != nil || len(result.Pruned) != row.want {
				t.Fatalf("result=%+v err=%v", result, err)
			}
			for _, entry := range result.Pruned {
				if entry.ToolCallID == "1" || row.keep > 0 && entry.ToolCallID == "4" || strings.HasPrefix(string(entry.ToolCallID), "pending-") {
					t.Fatal("cleared protected result")
				}
			}
			if row.pending > 0 {
				if _, err := s.Append("assistant/message", struct {
					Message harnessmodel.Message `json:"message"`
				}{harnessmodel.Message{Role: harnessmodel.RoleAssistant}}); err != nil {
					t.Fatal(err)
				}
				after, err := p.PruneHistorySession(s)
				if err != nil || len(after.Pruned) == 0 {
					t.Fatalf("consumed batch never became eligible: %+v %v", after, err)
				}
			}
			if _, err = s.Append("turn/end", struct {
				Turn int `json:"turn"`
			}{1}); err != nil {
				t.Fatal(err)
			}
			restored, err := harnesssession.RestoreSession(s.Header(), s.Events())
			if err != nil {
				t.Fatal(err)
			}
			locator := fmt.Sprintf("session-tool-result:owner:%d", original.Seq)
			var recovered strings.Builder
			for offset := int64(0); ; {
				page, err := ReadSessionToolOutput(restored, locator, offset, 17)
				if err != nil || page.Read == nil {
					t.Fatalf("page=%+v err=%v", page, err)
				}
				recovered.WriteString(page.Read.Text)
				if !page.Read.Truncated {
					break
				}
				offset += int64(len(page.Read.Text))
			}
			if recovered.String() != strings.Repeat("数据🙂", 300) {
				t.Fatal("lost original text after replay")
			}
			fork, err := restored.ForkCompleted("child", nil)
			if err != nil {
				t.Fatal(err)
			}
			if page, err := ReadSessionToolOutput(fork, locator, 0, 17); err != nil || page.Read == nil || page.Read.Text == "" {
				t.Fatalf("fork lost inherited original: %+v %v", page, err)
			}
			if _, err := ReadSessionToolOutput(restored, locator, 1, 17); err == nil {
				t.Fatal("accepted split UTF-8 rune")
			}
			other := harnesssession.NewSession("other", "")
			if page, _ := ReadSessionToolOutput(other, locator, 0, 17); page.Read != nil {
				t.Fatal("read another Session")
			}
			var block harnessmodel.ContentBlock
			if err := json.Unmarshal(original.Data, &block); err != nil || block.Content[0].Text != recovered.String() {
				t.Fatal("original event mutated")
			}
		})
	}
}

func TestToolHistoryCommandFailures(t *testing.T) {
	for _, row := range []struct {
		name, tool, outcome string
		protected           bool
	}{
		{"exit code", "Bash", `"exitCode":1`, true},
		{"shell timeout", "shell", `"exitCode":0,"timedOut":true`, true},
		{"aborted", "Bash", `"aborted":true`, true},
		{"background failure", "TaskOutput", `"status":"completed","result":{"exitCode":2}`, true},
		{"outer failure", "TaskOutput", `"status":"failed","result":{"exitCode":0}`, true},
		{"success", "Bash", `"exitCode":0`, false},
	} {
		t.Run(row.name, func(t *testing.T) {
			s := harnesssession.NewSession("commands", "")
			if _, err := s.Append("turn/start", struct {
				Turn int `json:"turn"`
			}{1}); err != nil {
				t.Fatal(err)
			}
			if _, err := s.Append("tool/call", struct {
				CallID string `json:"callId"`
				Name   string `json:"name"`
			}{"cmd", row.tool}); err != nil {
				t.Fatal(err)
			}
			if _, err := s.Append("tool/result", harnessmodel.ContentBlock{
				Type: harnessmodel.BlockToolResult, ToolCallID: "cmd",
				Content: []harnessmodel.ContentBlock{{Type: harnessmodel.BlockText, Text: `{` + row.outcome + `,"stdout":"` + strings.Repeat("x", 2000) + `"}`}},
			}); err != nil {
				t.Fatal(err)
			}
			if _, err := s.Append("assistant/message", struct {
				Message harnessmodel.Message `json:"message"`
			}{harnessmodel.Message{Role: harnessmodel.RoleAssistant}}); err != nil {
				t.Fatal(err)
			}
			high, low, keep := 1000, 0, 0
			p, err := NewToolResultPruner(ToolResultPruneConfig{TotalChars: &high, LowWatermarkChars: &low, KeepRecent: &keep})
			if err != nil {
				t.Fatal(err)
			}
			result, err := p.PruneHistorySession(s)
			if err != nil {
				t.Fatal(err)
			}
			if (len(result.Pruned) == 0) != row.protected {
				t.Fatalf("protected=%v result=%+v", row.protected, result)
			}
		})
	}
}
