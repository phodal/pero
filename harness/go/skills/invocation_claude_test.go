package skills

import (
	"encoding/json"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
)

func TestClaudeHeadlessSlashGrammar(t *testing.T) {
	rows := []Summary{{Name: "sample:first"}, {Name: "sample:second"}}
	for _, test := range []struct {
		name, text, extra, source, arguments string
		want                                 int
	}{
		{name: "direct", text: "/sample:first topic with spaces", arguments: "topic with spaces", want: 1},
		{name: "stack is arguments", text: "/sample:first /sample:second topic", arguments: "/sample:second topic", want: 1},
		{name: "mention after prose", text: "consider /sample:first topic"},
		{name: "unknown first", text: "/unknown /sample:first topic"},
		{name: "later text block", text: "consider this", extra: "/sample:first topic"},
		{name: "nested source", text: "/sample:first topic", source: `{"kind":"plugin"}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := test.source
			if source == "" {
				source = `{"kind":"user"}`
			}
			messages := []harness.Message{{Role: harness.RoleUser, Source: json.RawMessage(source), Content: []harness.ContentBlock{{Type: harness.BlockText, Text: test.text}, {Type: harness.BlockText, Text: test.extra}}}}
			got := explicitInvocations(messages, rows, true)
			if len(got) != test.want || len(got) > 0 && got[0].Arguments != test.arguments {
				t.Fatalf("invocations=%+v want=%d arguments=%q", got, test.want, test.arguments)
			}
		})
	}
}
