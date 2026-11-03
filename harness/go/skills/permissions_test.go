package skills

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync/atomic"
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
		{"edit covers notebook edit", "Edit", "NotebookEdit", "", true},
		{"global glob is not an allow rule", "*", "Write", "", false},
		{"mcp server wildcard", "mcp__issues__get_*", "mcp__issues__get_issue", "", true},
		{"mcp server identity", "mcp__*__get_*", "mcp__issues__get_issue", "", false},
		{"bare shell", "Bash", "Bash", "printf ok; date", true},
		{"all shell syntax", "Bash(*)", "Bash", "printf ok; date", true},
		{"exact command", "Bash(npm test)", "Bash", "npm test", true},
		{"exact command rejects extra", "Bash(npm test)", "Bash", "npm test --watch", false},
		{"prefix", "Bash(npm test:*)", "Bash", "npm test --watch", true},
		{"bare prefix", "Bash(npm test *)", "Bash", "npm test", true},
		{"prefix boundary", "Bash(ls *)", "Bash", "lsof", false},
		{"literal wildcard", "Bash(ls*)", "Bash", "lsof", true},
		{"middle wildcard", "Bash(git log * main)", "Bash", "git log -5 main", true},
		{"compound does not inherit first grant", "Bash(npm test *)", "Bash", "npm test && rm file", false},
		{"substitution does not inherit grant", "Bash(printf *)", "Bash", "printf $(touch file)", false},
		{"specifier must close", "Bash(npm test", "Bash", "npm test", false},
		{"compound both granted", "Bash(npm test *)", "Bash", "npm test && npm run lint", true},
		{"trailing and refused", "Bash(npm *)", "Bash", "npm test &&", false},
		{"wrapper stripped", "Bash(npm test *)", "Bash", "timeout 30 npm test", true},
		{"safe env stripped", "Bash(npm test *)", "Bash", "NODE_ENV=test npm test", true},
		{"unknown env refused", "Bash(npm test *)", "Bash", "SECRET=1 npm test", false},
		{"find delete prefix blocked", "Bash(find *)", "Bash", "find . -delete", false},
		{"find delete exact allowed", "Bash(find . -delete)", "Bash", "find . -delete", true},
		{"readonly second part", "Bash(npm test *)", "Bash", "cd packages && npm test", true},
		{"readonly alone with bash grant", "Bash(npm test *)", "Bash", "git status --short", true},
		{"readonly without bash grant", "Write", "Bash", "git status", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			arguments, _ := json.Marshal(struct {
				Command string `json:"command"`
			}{test.command})
			rules := []string{test.rule}
			if test.name == "compound both granted" {
				rules = []string{"Bash(npm test *)", "Bash(npm run lint *)"}
			}
			if got := AllowsTool(rules, test.tool, arguments); got != test.want {
				t.Fatalf("allowed=%t want=%t", got, test.want)
			}
		})
	}
}

func TestSkillDenialsApplyBeforeFirstRequestAndExpire(t *testing.T) {
	requireCatalogPlatform(t)
	root := canonicalTempDir(t)
	selection := selectedFixture(t, root, "sample:limited")
	selection.Definition.DisallowedTools = []string{"Write"}
	selection.Definition.AllowedTools = []string{"Write"}
	catalog, err := OpenSelected(t.Context(), nil, []FileSelection{selection})
	if err != nil {
		t.Fatal(err)
	}
	defer catalog.Close()
	var writes, requests atomic.Int32
	adapter := harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		index := requests.Add(1)
		visible := false
		for _, tool := range request.Tools {
			visible = visible || tool.Name == "Write"
		}
		if visible != (request.Turn == 2) {
			t.Errorf("turn %d: Write visibility=%v", request.Turn, visible)
		}
		if index == 1 || index == 3 {
			return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, ToolCallID: harness.ToolCallID(fmt.Sprintf("write-%d", index)), Name: "Write", Arguments: json.RawMessage(`{}`)}}}}, nil
		}
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant}}, nil
	})
	h, err := harness.Boot(t.Context(), harness.Options{Adapter: adapter})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { h.Dispose(context.Background()); h.Drain(context.Background()) }()
	if err := MountCatalog(t.Context(), h, catalog, MountOptions{Claude: true}); err != nil {
		t.Fatal(err)
	}
	_, err = h.RegisterTool(t.Context(), "fixture/write", harness.Tool{Schema: harness.ToolSchema{Name: "Write", InputSchema: json.RawMessage(`{"type":"object"}`)}, Execute: func(context.Context, json.RawMessage) (harness.ToolResult, error) {
		writes.Add(1)
		return harness.ToolResult{}, os.WriteFile(filepath.Join(root, "effect"), []byte("one"), 0600)
	}})
	if err != nil {
		t.Fatal(err)
	}
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "denials", CWD: root})
	if err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{"/sample:limited", "continue normally"} {
		if _, err := agent.Prompt(t.Context(), harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: text}}}); err != nil {
			t.Fatal(err)
		}
		if text == "/sample:limited" && writes.Load() != 0 {
			t.Fatal("allow grant overrode explicit skill denial")
		}
	}
	if writes.Load() != 1 || requests.Load() != 4 {
		t.Fatalf("writes=%d requests=%d", writes.Load(), requests.Load())
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
