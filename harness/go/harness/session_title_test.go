package harness

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestSessionTitleInput(t *testing.T) {
	for _, row := range []struct {
		name, source string
		finish       FinishKind
		prior        string
		want         bool
		followup     bool
	}{
		{name: "completed frozen App input", source: "user", finish: FinishStop, want: true},
		{name: "plugin input", source: "plugin", finish: FinishStop},
		{name: "stopped turn", source: "user", finish: FinishAborted},
		{name: "existing title", source: "user", finish: FinishStop, prior: "session/title"},
		{name: "existing attempt", source: "user", finish: FinishStop, prior: "session/title-llm-request"},
		{name: "completed continuation retains initial question", source: "user", finish: FinishAborted, want: true, followup: true},
	} {
		t.Run(row.name, func(t *testing.T) {
			var events []Event
			add := func(kind string, value any) {
				data, err := json.Marshal(value)
				if err != nil {
					t.Fatal(err)
				}
				events = append(events, Event{Seq: uint64(len(events) + 1), Type: kind, Data: data})
			}
			add("turn/start", struct{ Turn int }{1})
			add("user/message", Message{Role: RoleUser, Source: json.RawMessage(`{"kind":"` + row.source + `"}`), Content: []ContentBlock{
				{Type: BlockText, Text: strings.Repeat("通用执行说明", 2000)},
				{Type: BlockText, Text: "User-selected context (data)\n真正的论文问题"},
			}})
			add("request/header", RequestHeaderEvent{Turn: 1, Provider: "fixture", Model: "selected"})
			add("assistant/message", struct {
				Message Message
				Finish  FinishKind
			}{Message{Role: RoleAssistant, Content: []ContentBlock{{Type: BlockText, Text: "已分析论文"}}}, FinishStop})
			add("turn/end", struct {
				Turn   int
				Reason FinishKind
			}{1, row.finish})
			target, wantMessages := 1, 1
			if row.followup {
				target, wantMessages = 2, 2
				add("turn/start", struct{ Turn int }{2})
				add("user/message", Message{Role: RoleUser, Source: json.RawMessage(`{"kind":"user"}`), Content: []ContentBlock{{Type: BlockText, Text: "继续"}}})
				add("request/header", RequestHeaderEvent{Turn: 2, Provider: "fixture", Model: "selected"})
				add("assistant/message", struct {
					Message Message
					Finish  FinishKind
				}{Message{Role: RoleAssistant, Content: []ContentBlock{{Type: BlockText, Text: "已分析论文"}}}, FinishStop})
				add("turn/end", struct {
					Turn   int
					Reason FinishKind
				}{2, FinishStop})
			}
			if row.prior != "" {
				add(row.prior, struct{ Title string }{"kept"})
			}
			input, ready := sessionTitleInput(events, target)
			if ready != row.want {
				t.Fatalf("ready=%v, want %v", ready, row.want)
			}
			if ready && (!strings.Contains(input.Request, "真正的论文问题") || !strings.Contains(input.Request, "[excerpt truncated]") || !utf8.ValidString(input.Request) || input.Answer != "已分析论文" || input.Route.Model != "selected" || len(input.MessageSeqs) != wantMessages || input.MessageSeqs[0] != 2) {
				t.Fatalf("incorrect title evidence: %+v", input)
			}
		})
	}
}

func TestSessionTitleText(t *testing.T) {
	for _, row := range []struct{ raw, want string }{
		{"\n**论文阅读总结**\nExtra commentary", "论文阅读总结"},
		{"\"Investigate   rendering\"", "Investigate rendering"},
		{"\x00", ""},
		{strings.Repeat("中", 81), strings.Repeat("中", 80)},
	} {
		if got := sessionTitleText(row.raw); got != row.want {
			t.Errorf("title(%q)=%q, want %q", row.raw, got, row.want)
		}
	}
}
