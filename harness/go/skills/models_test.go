package skills

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
)

func TestCurrentSkillModelReceipts(t *testing.T) {
	models := map[skillModelKey]skillModel{{"sample:first", "digest"}: {provider: "fixture", model: "first"}, {"sample:second", "digest"}: {provider: "fixture", model: "second"}}
	message := func(name, form, id string, turn int) harness.Message {
		source, _ := json.Marshal(skillInvocation{Kind: "skill-invocation", Form: form, Name: name, Digest: "digest", Turn: turn, ID: id})
		return harness.Message{Role: harness.RoleUser, Source: source}
	}
	event := func(message harness.Message) harness.Event {
		data, _ := json.Marshal(message)
		return harness.Event{Type: "user/message", Data: data}
	}
	start := harness.Event{Type: "turn/start", Data: json.RawMessage(`{"turn":2}`)}
	first, second := message("sample:first", "instructions", "one", 2), message("sample:second", "activation", "two", 2)
	for _, test := range []struct {
		name     string
		events   []harness.Event
		pending  []harness.Message
		expected string
	}{
		{name: "same request slash", events: []harness.Event{start}, pending: []harness.Message{first}, expected: "first"},
		{name: "model tool activation", events: []harness.Event{start, event(second)}, expected: "second"},
		{name: "latest selection", events: []harness.Event{start, event(first), event(second)}, expected: "second"},
		{name: "inherit preserves active override", events: []harness.Event{start, event(first), event(message("sample:inherit", "activation", "inherit", 2))}, expected: "first"},
		{name: "return to prior skill is a new invocation", events: []harness.Event{start, event(first), event(second)}, pending: []harness.Message{first, second, message("sample:first", "instructions", "three", 2)}, expected: "first"},
		{name: "compacted receipt still applies", events: []harness.Event{start, event(first), {Type: "compaction/end"}}, expected: "first"},
		{name: "reattachment does not reactivate", events: []harness.Event{start, event(first), event(message("sample:second", "reattached", "reattach", 2))}, expected: "first"},
		{name: "old pending history cannot select", events: []harness.Event{start}, pending: []harness.Message{message("sample:first", "instructions", "old", 1)}},
		{name: "new turn clears override", events: []harness.Event{event(first), start}, pending: []harness.Message{message("sample:first", "instructions", "old", 1)}},
		{name: "direct user steering clears override", events: []harness.Event{start, event(first)}, pending: []harness.Message{{Role: harness.RoleUser, Source: json.RawMessage(`{"kind":"user"}`)}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			model, found, err := currentSkillModel(test.events, test.pending, 2, models)
			if err != nil || found != (test.expected != "") || model.model != test.expected {
				t.Fatalf("model=%+v found=%v error=%v, want %q", model, found, err, test.expected)
			}
		})
	}
}

func TestSkillModelToolInvocationTurnLifecycle(t *testing.T) {
	requireCatalogPlatform(t)
	root := canonicalTempDir(t)
	var selections []FileSelection
	for _, model := range []string{"first", "inherit", "second"} {
		selection := selectedFixture(t, root, "sample:"+model)
		selection.Definition.Model = model
		selections = append(selections, selection)
	}
	catalog, err := OpenSelected(t.Context(), nil, selections)
	if err != nil {
		t.Fatal(err)
	}
	defer catalog.Close()
	var calls atomic.Int32
	adapter := harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		index := int(calls.Add(1)) - 1
		want := []string{"primary", "model-first", "model-first", "model-second", "model-first", "primary"}
		if index >= len(want) {
			t.Error("unexpected model request")
			return harness.Completion{}, errors.New("unexpected request")
		}
		if request.Model != want[index] || request.TransientModel != (index > 0 && index < 5) {
			t.Errorf("request %d route=%s transient=%v want=%s", index+1, request.Model, request.TransientModel, want[index])
		}
		if index < 4 {
			name := []string{"first", "inherit", "second", "first"}[index]
			return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, Name: "Skill", ToolCallID: harness.ToolCallID(fmt.Sprintf("model-skill-%d", index)), Arguments: json.RawMessage(`{"skill":"sample:` + name + `"}`)}}}}, nil
		}
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}}, nil
	})
	h, err := harness.Boot(t.Context(), harness.Options{Adapter: adapter, AdapterProviders: []string{"fixture"}})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) }()
	if err := MountCatalog(t.Context(), h, catalog, MountOptions{Claude: true, ResolveModel: func(alias string) (string, string, error) { return "fixture", "model-" + alias, nil }}); err != nil {
		t.Fatal(err)
	}
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "skill-models", CWD: root, Provider: "fixture", Model: "primary", MaxSteps: 8})
	if err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{"use the workflow", "continue without a workflow"} {
		if _, err := agent.Prompt(t.Context(), harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: text}}}); err != nil {
			t.Fatal(err)
		}
	}
	if calls.Load() != 6 || agent.ModelSelection().Model != "primary" {
		t.Fatalf("model leaked across turns: calls=%d selection=%+v", calls.Load(), agent.ModelSelection())
	}
}

func TestSkillArgumentHintIsAdvertised(t *testing.T) {
	requireCatalogPlatform(t)
	root := canonicalTempDir(t)
	selection := selectedFixture(t, root, "sample:deploy")
	selection.Definition.ArgumentHint = "<target>"
	catalog, err := OpenSelected(t.Context(), nil, []FileSelection{selection})
	if err != nil {
		t.Fatal(err)
	}
	defer catalog.Close()
	h, err := harness.Boot(t.Context(), harness.Options{Adapter: harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		return harness.Completion{}, nil
	}), AdapterProviders: []string{"fixture"}})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) }()
	if err := MountCatalog(t.Context(), h, catalog, MountOptions{Claude: true}); err != nil {
		t.Fatal(err)
	}
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "hint", CWD: root, Provider: "fixture", Model: "primary"})
	if err != nil {
		t.Fatal(err)
	}
	schemas, err := h.Tools().SchemasForAgent(t.Context(), agent)
	if err != nil {
		t.Fatal(err)
	}
	var description string
	for _, schema := range schemas {
		if schema.Name == "Skill" {
			description = schema.Description
		}
	}
	if !strings.Contains(description, `"argumentHint":"\u003ctarget\u003e"`) && !strings.Contains(description, `"argumentHint":"<target>"`) {
		t.Fatalf("description = %s", description)
	}
	out, err := h.Tools().Execute(t.Context(), harness.ToolRequest{Agent: agent, Name: "Skill", CallID: "list", Arguments: json.RawMessage(`{}`)})
	if err != nil {
		t.Fatal(err)
	}
	var listed []Summary
	if err := json.Unmarshal([]byte(out.Result.Content[0].Text), &listed); err != nil || len(listed) != 1 || listed[0].ArgumentHint != "<target>" {
		t.Fatalf("list = %s %v", out.Result.Content[0].Text, err)
	}
}

func TestSkillEffortAppliesForTheInvocationTurn(t *testing.T) {
	requireCatalogPlatform(t)
	root := canonicalTempDir(t)
	selection := selectedFixture(t, root, "sample:focused")
	selection.Definition.Effort = "high"
	catalog, err := OpenSelected(t.Context(), nil, []FileSelection{selection})
	if err != nil {
		t.Fatal(err)
	}
	defer catalog.Close()
	var calls atomic.Int32
	adapter := harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		index := int(calls.Add(1)) - 1
		want := []harness.ReasoningEffort{"", "high", ""}
		if index >= len(want) || request.ReasoningEffort != want[index] || request.Model != "primary" {
			t.Errorf("request %d effort=%q model=%s", index+1, request.ReasoningEffort, request.Model)
		}
		if index == 0 {
			return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, Name: "Skill", ToolCallID: "effort-skill", Arguments: json.RawMessage(`{"skill":"sample:focused"}`)}}}}, nil
		}
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}}, nil
	})
	h, err := harness.Boot(t.Context(), harness.Options{Adapter: adapter, AdapterProviders: []string{"fixture"}})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) }()
	if err := MountCatalog(t.Context(), h, catalog, MountOptions{Claude: true}); err != nil {
		t.Fatal(err)
	}
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "skill-effort", CWD: root, Provider: "fixture", Model: "primary", MaxSteps: 4})
	if err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{"use the skill", "continue"} {
		if _, err := agent.Prompt(t.Context(), harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: text}}}); err != nil {
			t.Fatal(err)
		}
	}
	if calls.Load() != 3 {
		t.Fatalf("calls=%d", calls.Load())
	}
}

func TestSkillModelRequiresExplicitRoute(t *testing.T) {
	requireCatalogPlatform(t)
	for _, resolver := range []func(string) (string, string, error){nil, func(string) (string, string, error) { return "", "", nil }} {
		root := canonicalTempDir(t)
		selection := selectedFixture(t, root, "sample:draft")
		selection.Definition.Model = "undeclared"
		catalog, err := OpenSelected(t.Context(), nil, []FileSelection{selection})
		if err != nil {
			t.Fatal(err)
		}
		h, err := harness.Boot(t.Context(), harness.Options{})
		if err != nil {
			t.Fatal(err)
		}
		if err := MountCatalog(t.Context(), h, catalog, MountOptions{Claude: true, ResolveModel: resolver}); err == nil {
			t.Error("model without a trusted route was silently accepted")
		}
		_ = h.Dispose(context.Background())
		_ = h.Drain(context.Background())
		_ = catalog.Close()
	}
}
