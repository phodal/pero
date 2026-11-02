package skills

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
)

func TestAllowedToolGrants(t *testing.T) {
	for _, test := range []struct {
		name, rule, tool, command string
		want                      bool
	}{
		{"exact tool", "Write", "Write", "", true},
		{"other tool", "Write", "Edit", "", false},
		{"global glob is not an allow rule", "*", "Write", "", false},
		{"mcp server wildcard", "mcp__issues__get_*", "mcp__issues__get_issue", "", true},
		{"mcp server identity", "mcp__*__get_*", "mcp__issues__get_issue", "", false},
		{"bare shell", "Bash", "Bash", "printf ok; date", true},
		{"all shell syntax", "Bash(*)", "Bash", "printf ok; date", true},
		{"exact command", "Bash(git status)", "Bash", "git status", true},
		{"exact command rejects extra", "Bash(git status)", "Bash", "git status --short", false},
		{"prefix", "Bash(git status:*)", "Bash", "git status --short", true},
		{"bare prefix", "Bash(git status *)", "Bash", "git status", true},
		{"prefix boundary", "Bash(ls *)", "Bash", "lsof", false},
		{"literal wildcard", "Bash(ls*)", "Bash", "lsof", true},
		{"middle wildcard", "Bash(git log * main)", "Bash", "git log -5 main", true},
		{"compound does not inherit first grant", "Bash(git status *)", "Bash", "git status && rm file", false},
		{"substitution does not inherit grant", "Bash(printf *)", "Bash", "printf $(touch file)", false},
		{"specifier must close", "Bash(git status", "Bash", "git status", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			arguments, _ := json.Marshal(struct {
				Command string `json:"command"`
			}{test.command})
			if got := AllowsTool([]string{test.rule}, test.tool, arguments); got != test.want {
				t.Fatalf("allowed=%t want=%t", got, test.want)
			}
		})
	}
}

func TestSkillGrantsEndAtUserAdmissionOrTurn(t *testing.T) {
	catalog := &Catalog{entries: map[string]entry{"sample:draft": {definition: Definition{Summary: Summary{Name: "sample:draft", Digest: "digest"}, AllowedTools: []string{"Write"}}}}}
	catalog.entries["sample:isolated"] = entry{definition: Definition{Summary: Summary{Name: "sample:isolated", Digest: "digest"}, Context: "fork", AllowedTools: []string{"Write"}}}
	message := func(source string) harness.Event {
		raw, _ := json.Marshal(harness.Message{Role: harness.RoleUser, Source: json.RawMessage(source)})
		return harness.Event{Type: "user/message", Data: raw}
	}
	invoked := message(`{"kind":"skill-invocation","name":"sample:draft","digest":"digest"}`)
	reattached := message(`{"kind":"skill-invocation","form":"reattached","name":"sample:draft","digest":"digest"}`)
	user := message(`{"kind":"user"}`)
	for _, test := range []struct {
		name   string
		events []harness.Event
		count  int
	}{
		{"same turn", []harness.Event{{Type: "turn/start"}, user, invoked, {Type: "compaction/end"}}, 1},
		{"new direct message", []harness.Event{invoked, user}, 0},
		{"new turn", []harness.Event{invoked, {Type: "turn/start"}}, 0},
		{"fork does not grant parent", []harness.Event{message(`{"kind":"skill-invocation","name":"sample:isolated","digest":"digest","form":"activation"}`)}, 0},
		{"fork child grant", []harness.Event{message(`{"kind":"skill-invocation","name":"sample:isolated","digest":"digest","form":"fork-grant"}`)}, 1},
		{"reattachment cannot renew grants", []harness.Event{invoked, user, reattached}, 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			rules, err := turnGrants(context.Background(), catalog, test.events)
			if err != nil || len(rules) != test.count {
				t.Fatalf("rules=%v error=%v", rules, err)
			}
		})
	}
}
