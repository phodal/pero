package tool

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/model"
	"github.com/phodal/pero/harness/go/session"
)

func TestDuplicateErrorProjection(t *testing.T) {
	for _, row := range []struct {
		name            string
		enabled         bool
		command, output string
		truncated       bool
		want            int
		reuseID         bool
		keep            int
	}{
		{"default protects", false, "check", "error: same", false, 0, false, 0},
		{"identical complete", true, "check", "error: same", false, 1, false, 0},
		{"recent protected", true, "check", "error: same", false, 0, false, 1},
		{"changed command", true, "other", "error: same", false, 0, false, 0},
		{"reused id different arguments", true, "other", "error: same", false, 0, true, 0},
		{"changed diagnostic", true, "check", "error: changed", false, 0, false, 0},
		{"truncated", true, "check", "error: same", true, 0, false, 0},
	} {
		t.Run(row.name, func(t *testing.T) {
			s := session.NewSession("errors", "")
			s.Append("turn/start", struct {
				Turn int `json:"turn"`
			}{1})
			var first model.Event
			var original string
			for i := 0; i < 2; i++ {
				command, output := "check", "error: same"
				if i == 1 {
					command, output = row.command, row.output
				}
				id := model.ToolCallID(fmt.Sprint(i))
				if row.reuseID {
					id = "reused"
				}
				callEvent, _ := s.Append("tool/call", struct {
					CallID    model.ToolCallID `json:"callId"`
					Name      string           `json:"name"`
					Arguments any              `json:"arguments"`
				}{id, "Bash", struct {
					Command string `json:"command"`
				}{command}})
				raw, _ := json.Marshal(struct {
					ExitCode int `json:"exitCode"`
					Stdout   any `json:"stdout"`
				}{1, struct {
					Text      string `json:"text"`
					Truncated bool   `json:"truncated"`
				}{strings.Repeat(output, 300), row.truncated}})
				e, err := s.AppendSurface("tool/result", model.ContentBlock{Type: model.BlockToolResult, ToolCallID: id, IsError: true, Content: []model.ContentBlock{{Type: model.BlockText, Text: string(raw)}}}, []uint64{callEvent.Seq})
				if err != nil {
					t.Fatal(err)
				}
				if i == 0 {
					first = e
					original = string(raw)
				}
			}
			high, low, recent := 2000, 0, row.keep
			p, err := NewToolResultPruner(ToolResultPruneConfig{TotalChars: &high, LowWatermarkChars: &low, KeepRecent: &recent, DeduplicateErrors: row.enabled})
			if err != nil {
				t.Fatal(err)
			}
			got, err := p.PruneHistorySession(s)
			if err != nil || len(got.Pruned) != row.want {
				t.Fatalf("%+v %v", got, err)
			}
			if row.want > 0 {
				s.Append("turn/end", struct {
					Turn int `json:"turn"`
				}{1})
				restored, err := session.RestoreSession(s.Header(), s.Events())
				if err != nil {
					t.Fatal(err)
				}
				read, err := ReadSessionToolOutput(restored, fmt.Sprintf("session-tool-result:errors:%d", first.Seq), 0, 1<<20)
				if err != nil || read.Read == nil || read.Read.Text != original {
					t.Fatal("lost original diagnostic after restore", err)
				}
				events, surface := restored.HistorySnapshot()
				latest := events[len(events)-2]
				var block model.ContentBlock
				if json.Unmarshal(latest.Data, &block) != nil || !block.IsError || !strings.Contains(block.Content[0].Text, "Identical complete diagnostic") || len(surface) == 0 {
					t.Fatal("projection lost failure or readback identity")
				}
			}
		})
	}
}
