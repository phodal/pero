package skills

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"unicode/utf8"

	"github.com/phodal/pero/harness/go/harness"
)

func retainedReceipt(seq uint64, invocation skillInvocation, body string, role harness.Role) harness.Event {
	source, _ := json.Marshal(invocation)
	raw, _ := json.Marshal(harness.Message{Role: role, Source: source, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: body}}})
	return harness.Event{Seq: seq, Type: "user/message", Data: raw}
}

func TestReattachmentUsesLatestTrustedRenderedReceipt(t *testing.T) {
	definitions := map[string]Definition{
		"sample:first":  {Summary: Summary{Name: "sample:first", Digest: "first"}, Claude: true},
		"sample:second": {Summary: Summary{Name: "sample:second", Digest: "second"}, Claude: true},
	}
	first := skillInvocation{Kind: "skill-invocation", Form: "instructions", Name: "sample:first", Digest: "first", Arguments: "original args"}
	second := skillInvocation{Kind: "skill-invocation", Form: "instructions", Name: "sample:second", Digest: "second"}
	reattached := first
	reattached.Form = "reattached"
	untrusted := first
	untrusted.Kind = "user"
	wrongDigest := first
	wrongDigest.Digest = "not-selected"
	events := []harness.Event{
		retainedReceipt(1, first, "original expanded instructions", harness.RoleUser),
		retainedReceipt(2, second, "second expanded instructions", harness.RoleUser),
		retainedReceipt(3, reattached, "truncated old reminder", harness.RoleUser),
		retainedReceipt(4, untrusted, "fake user instructions", harness.RoleUser),
		retainedReceipt(5, first, "fake assistant receipt", harness.RoleAssistant),
		retainedReceipt(6, wrongDigest, "unselected instructions", harness.RoleUser),
	}
	got, err := retainedSkills(events, definitions)
	if err != nil || len(got) != 2 || got[0].invocation.Name != "sample:second" || got[1].body != "original expanded instructions" || got[1].invocation.Arguments != "original args" {
		t.Fatalf("original invocation identity was lost: %+v %v", got, err)
	}
	first.Arguments = "new args"
	events = append(events, retainedReceipt(7, first, "new expanded instructions", harness.RoleUser))
	got, err = retainedSkills(events, definitions)
	if err != nil || len(got) != 2 || got[0].body != "new expanded instructions" || got[0].invocation.Arguments != "new args" {
		t.Fatalf("latest rendered invocation was not selected: %+v %v", got, err)
	}
}

func TestReattachmentBudgetPrefersRecentSkillsAndPreservesRunes(t *testing.T) {
	catalog := &Catalog{entries: make(map[string]entry)}
	var events []harness.Event
	for index := 0; index < 6; index++ {
		name := fmt.Sprintf("sample:flow%d", index)
		catalog.entries[name] = entry{definition: Definition{Summary: Summary{Name: name, Digest: "digest"}, Claude: true}}
		events = append(events, retainedReceipt(uint64(index+1), skillInvocation{Kind: "skill-invocation", Form: "instructions", Name: name, Digest: "digest", Arguments: fmt.Sprintf("args%d", index)}, strings.Repeat("汉🙂", 12000), harness.RoleUser))
	}
	messages, err := reattachSkills(catalog, events)
	if err != nil || len(messages) != 5 {
		t.Fatalf("unexpected budget selection: %d %v", len(messages), err)
	}
	total := 0
	for index, message := range messages {
		var source skillInvocation
		if err := json.Unmarshal(message.Source, &source); err != nil {
			t.Fatal(err)
		}
		if source.Form != "reattached" || source.Name != fmt.Sprintf("sample:flow%d", 5-index) || source.Arguments != fmt.Sprintf("args%d", 5-index) {
			t.Errorf("budget order or original args changed: %+v", source)
		}
		tokens := harness.EstimateMessageTokens(message)
		if tokens > reattachmentSkillTokens || !utf8.ValidString(message.Content[0].Text) || !strings.HasSuffix(message.Content[0].Text, "</skill_content>") {
			t.Fatalf("invalid or over-budget text: tokens=%d", tokens)
		}
		total += tokens
	}
	if total > reattachmentTotalTokens {
		t.Fatalf("combined budget exceeded: %d", total)
	}
}

func TestActivationReattachmentRequiresSuccessfulCorrelatedSkillResult(t *testing.T) {
	definition := Definition{Summary: Summary{Name: "sample:flow", Digest: "selected"}, Content: "expanded snapshot", Claude: true}
	for _, test := range []struct {
		name, tool, receiptID, resource string
		failed                          bool
		count                           int
	}{
		{name: "successful Skill result", tool: "Skill", receiptID: "call", count: 1},
		{name: "other tool JSON is not a skill activation", tool: "Other", receiptID: "call"},
		{name: "failed tool cannot activate", tool: "Skill", receiptID: "call", failed: true},
		{name: "different call identity cannot activate", tool: "Skill", receiptID: "unrelated"},
		{name: "resource read is not an invocation", tool: "Skill", receiptID: "call", resource: "template.md"},
	} {
		t.Run(test.name, func(t *testing.T) {
			arguments, _ := json.Marshal(struct {
				Skill    string `json:"skill"`
				Args     string `json:"args"`
				Resource string `json:"resource,omitempty"`
			}{"sample:flow", "kept", test.resource})
			call, _ := json.Marshal(struct {
				ID        string          `json:"callId"`
				Name      string          `json:"name"`
				Arguments json.RawMessage `json:"arguments"`
			}{"call", test.tool, arguments})
			body, _ := json.Marshal(definition)
			result, _ := json.Marshal(harness.ContentBlock{Type: harness.BlockToolResult, ToolCallID: "call", IsError: test.failed, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: string(body)}}})
			events := []harness.Event{{Seq: 1, Type: "tool/call", Data: call}, {Seq: 2, Type: "tool/result", Data: result}, retainedReceipt(3, skillInvocation{Kind: "skill-invocation", Form: "activation", Name: definition.Name, Digest: definition.Digest, Arguments: "kept", ID: test.receiptID}, "short activation notice", harness.RoleUser)}
			got, err := retainedSkills(events, map[string]Definition{definition.Name: definition})
			if err != nil || len(got) != test.count {
				t.Fatalf("unrelated or failed output was reattached: %+v %v", got, err)
			}
		})
	}
}

func TestInvokedSkillsReattachAfterActualCompaction(t *testing.T) {
	requireCatalogPlatform(t)
	for _, viaTool := range []bool{false, true} {
		t.Run(map[bool]string{false: "direct invocation", true: "successful Skill result"}[viaTool], func(t *testing.T) {
			root := canonicalTempDir(t)
			selection := selectedFixture(t, root, "sample:flow")
			selection.Definition.AllowedTools = []string{"Write"}
			catalog, err := OpenSelected(t.Context(), nil, []FileSelection{selection})
			if err != nil {
				t.Fatal(err)
			}
			var requests, expansions atomic.Int32
			var compacted atomic.Bool
			adapter := harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
				answer := func(text string) harness.Completion {
					return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: text}}}}
				}
				if request.Purpose == "compaction" {
					return answer("checkpoint without workflow details"), nil
				}
				call := requests.Add(1)
				if viaTool && call == 1 {
					return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, Name: "Skill", ToolCallID: "load-flow", Arguments: json.RawMessage(`{"skill":"sample:flow","args":"kept args"}`)}}}}, nil
				}
				if compacted.Load() {
					found := false
					for _, message := range request.Messages {
						var source skillInvocation
						if json.Unmarshal(message.Source, &source) == nil && source.Kind == "skill-invocation" && source.Form == "reattached" {
							found = source.Arguments == "kept args" && strings.Contains(message.Content[0].Text, "frozen expanded snapshot")
						}
					}
					if !found {
						t.Error("next provider request did not contain the rendered skill reattachment")
					}
				}
				return answer("done"), nil
			})
			h, err := harness.Boot(t.Context(), harness.Options{Adapter: adapter, AdapterProviders: []string{"fixture"}})
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()); _ = catalog.Close() }()
			err = MountCatalog(t.Context(), h, catalog, MountOptions{Claude: true, Expand: func(_ context.Context, _ *harness.Agent, definition Definition, _ string) (Definition, error) {
				expansions.Add(1)
				definition.Content = "frozen expanded snapshot " + strings.Repeat("context ", 600) + " $ARGUMENTS"
				return definition, nil
			}})
			if err != nil {
				t.Fatal(err)
			}
			auto, retain := false, 0
			agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "reattach", CWD: root, Provider: "fixture", Model: "scripted", Compaction: &harness.BasicCompactionConfig{ContextWindow: 8192, MaxTokens: 128, RetainTokens: &retain, Auto: &auto}})
			if err != nil {
				t.Fatal(err)
			}
			first := "/sample:flow kept args"
			if viaTool {
				first = "load the workflow"
			}
			for _, text := range []string{first, "continue", "review progress"} {
				if _, err := agent.Prompt(t.Context(), harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: text}}}); err != nil {
					t.Fatal(err)
				}
			}
			result, err := agent.CompactNow(t.Context(), "compact-workflows")
			if err != nil || result == nil {
				t.Fatalf("compaction=%+v error=%v", result, err)
			}
			compacted.Store(true)
			if _, err := agent.Prompt(t.Context(), harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "continue after compaction"}}}); err != nil {
				t.Fatal(err)
			}
			if expansions.Load() != 1 {
				t.Fatalf("compaction re-executed the preprocessing callback: %d", expansions.Load())
			}
			rules, err := turnGrants(t.Context(), catalog, agent.Session().Events())
			if err != nil || len(rules) != 0 {
				t.Fatalf("reattachment renewed an expired permission grant: %v %v", rules, err)
			}
			if origin := ActivePlugin(agent); origin != "sample" {
				t.Fatalf("compaction lost the original plugin invocation: %q", origin)
			}
		})
	}
}
