package skills

import (
	"context"
	"encoding/json"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
)

func TestSkillPathPatterns(t *testing.T) {
	for _, test := range []struct {
		pattern, file string
		match         bool
	}{
		{"notes/*.txt", "notes/a.txt", true},
		{"notes/*.txt", "notes/inner/a.txt", false},
		{"src/**/*.go", "src/a/b.go", true},
		{"src/**/*.go", "src/a/b.ts", false},
		{"**/*.md", "docs/readme.md", true},
	} {
		if skillPathMatches([]string{test.pattern}, test.file) != test.match {
			t.Fatalf("%s vs %s match=%v", test.pattern, test.file, test.match)
		}
	}
}

func TestMatchingFileSuggestsTheSkillOnTheNextStep(t *testing.T) {
	requireCatalogPlatform(t)
	root := canonicalTempDir(t)
	selection := selectedFixture(t, root, "sample:notes")
	selection.Definition.Paths = []string{"notes/*.txt"}
	catalog, err := OpenSelected(t.Context(), nil, []FileSelection{selection})
	if err != nil {
		t.Fatal(err)
	}
	defer catalog.Close()
	var calls atomic.Int32
	var saw bool
	adapter := harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		index := calls.Add(1)
		if index == 1 {
			return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, Name: "Read", ToolCallID: "read-note", Arguments: json.RawMessage(`{"file_path":"notes/a.txt"}`)}}}}, nil
		}
		var text string
		for _, message := range request.Messages {
			for _, block := range message.Content {
				text += block.Text
			}
		}
		saw = strings.Contains(text, "sample:notes") && strings.Contains(text, "notes/a.txt")
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}}, nil
	})
	h, err := harness.Boot(t.Context(), harness.Options{Adapter: adapter, AdapterProviders: []string{"fixture"}})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) }()
	if _, err := h.RegisterTool(t.Context(), "test/read", harness.Tool{Schema: harness.ToolSchema{Name: "Read", Description: "Read a file.", InputSchema: json.RawMessage(`{"type":"object","properties":{"file_path":{"type":"string"}},"required":["file_path"]}`)}, ExecuteRequest: func(context.Context, harness.ToolRequest) (harness.ToolResult, error) {
		return harness.ToolResult{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "note"}}}, nil
	}}); err != nil {
		t.Fatal(err)
	}
	if err := MountCatalog(t.Context(), h, catalog, MountOptions{Claude: true}); err != nil {
		t.Fatal(err)
	}
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "paths", CWD: root, Provider: "fixture", Model: "primary", MaxSteps: 3})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := agent.Prompt(t.Context(), harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "look"}}}); err != nil {
		t.Fatal(err)
	}
	if calls.Load() < 2 || !saw {
		t.Fatalf("calls=%d saw=%v", calls.Load(), saw)
	}
}
