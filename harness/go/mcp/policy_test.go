package mcp

import (
	"encoding/json"
	"strings"
	"testing"
)

func memoryRules() *ToolPolicy {
	pin := func(name, value string) map[string]json.RawMessage {
		return map[string]json.RawMessage{name: json.RawMessage(value)}
	}
	return &ToolPolicy{Mutations: MutationsApprove, Tools: []ToolRule{
		{Name: "search", Pin: pin("project", `"p"`), Forbid: []string{"all_projects"}},
		{Name: "save", Mutates: true, Pin: map[string]json.RawMessage{"project": json.RawMessage(`"p"`), "capture_prompt": json.RawMessage(`false`)}},
	}}
}

func TestToolPolicyExposure(t *testing.T) {
	for _, test := range []struct {
		name      string
		mutations MutationMode
		tool      string
		exposed   bool
	}{
		{"read tool", MutationsDeny, "search", true},
		{"mutation denied by default", "", "save", false},
		{"mutation denied explicitly", MutationsDeny, "save", false},
		{"mutation needs the operator to approve it", MutationsApprove, "save", true},
		{"unlisted tool never exposed", MutationsApprove, "delete", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			policy := memoryRules()
			policy.Mutations = test.mutations
			if got := policy.Exposes(test.tool); got != test.exposed {
				t.Fatalf("Exposes(%q)=%v", test.tool, got)
			}
		})
	}
}

func TestToolRuleAdmit(t *testing.T) {
	policy := memoryRules()
	search, _ := policy.Rule("search")
	save, _ := policy.Rule("save")
	for _, test := range []struct {
		name    string
		rule    ToolRule
		args    string
		want    map[string]any
		wantErr string
	}{
		{"pins are filled in", search, `{"query":"q"}`, map[string]any{"query": "q", "project": "p"}, ""},
		{"empty arguments", search, ``, map[string]any{"project": "p"}, ""},
		{"null arguments", search, `null`, map[string]any{"project": "p"}, ""},
		{"matching pin passes", search, `{"query":"q","project":"p"}`, map[string]any{"query": "q", "project": "p"}, ""},
		{"null pin is filled in", search, `{"project":null}`, map[string]any{"project": "p"}, ""},
		{"other project rejected", search, `{"query":"q","project":"other"}`, nil, `"project" must be`},
		{"all_projects rejected", search, `{"query":"q","all_projects":true}`, nil, `"all_projects" is not permitted`},
		{"all_projects false allowed and dropped", search, `{"all_projects":false}`, map[string]any{"project": "p"}, ""},
		{"capture_prompt cannot be enabled", save, `{"title":"t","capture_prompt":true}`, nil, `"capture_prompt" must be false`},
		{"capture_prompt is forced off when absent", save, `{"title":"t"}`, map[string]any{"title": "t", "project": "p", "capture_prompt": false}, ""},
		{"malformed arguments", save, `[1]`, nil, "invalid MCP arguments"},
	} {
		t.Run(test.name, func(t *testing.T) {
			raw, err := test.rule.Admit(json.RawMessage(test.args))
			if test.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), test.wantErr) {
					t.Fatalf("err=%v want %q", err, test.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			var got map[string]any
			if err := json.Unmarshal(raw, &got); err != nil {
				t.Fatal(err)
			}
			if len(got) != len(test.want) {
				t.Fatalf("got %v want %v", got, test.want)
			}
			for key, value := range test.want {
				if got[key] != value {
					t.Fatalf("got %v want %v", got, test.want)
				}
			}
		})
	}
}

func TestToolPolicyValidate(t *testing.T) {
	for _, test := range []struct {
		name   string
		mutate func(*ToolPolicy)
		bad    bool
	}{
		{"valid", func(*ToolPolicy) {}, false},
		{"unknown mode", func(p *ToolPolicy) { p.Mutations = "allow" }, true},
		{"empty list would expose nothing", func(p *ToolPolicy) { p.Tools = nil }, true},
		{"duplicate rule", func(p *ToolPolicy) { p.Tools = append(p.Tools, p.Tools[0]) }, true},
		{"unnamed rule", func(p *ToolPolicy) { p.Tools[0].Name = " " }, true},
		{"pin and forbid clash", func(p *ToolPolicy) { p.Tools[0].Forbid = []string{"project"} }, true},
		{"null pin", func(p *ToolPolicy) { p.Tools[0].Pin = map[string]json.RawMessage{"x": json.RawMessage(`null`)} }, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			policy := memoryRules()
			test.mutate(policy)
			if err := policy.Validate(); (err != nil) != test.bad {
				t.Fatalf("err=%v", err)
			}
		})
	}
}
