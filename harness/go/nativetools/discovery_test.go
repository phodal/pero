package nativetools

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

func TestToolSearchUsesCurrentCallerCatalog(t *testing.T) {
	f := newClaudeFixture(t, Options{})
	registration, err := f.harness.RegisterTool(t.Context(), "search-probe", harness.Tool{Schema: harness.ToolSchema{Name: "catalog_probe", Description: "unique search probe", InputSchema: json.RawMessage(`{"type":"object","properties":{"value":{"type":"string"}}}`)}, Execute: func(context.Context, json.RawMessage) (harness.ToolResult, error) { return harness.ToolResult{}, nil }})
	if err != nil {
		t.Fatal(err)
	}
	child, err := f.harness.Agents().Create(t.Context(), harness.AgentOptions{Parent: f.allowed, CWD: f.root, Configure: func(ctx context.Context, run *point.Run, agent *harness.Agent) error {
		_, err := f.harness.Tools().Restrict(ctx, run, agent, harness.ToolRestriction{Deny: []string{"catalog_probe"}})
		return err
	}})
	if err != nil {
		t.Fatal(err)
	}
	search := func(agent *harness.Agent) toolSearchResult {
		t.Helper()
		result := f.call(t, agent, "ToolSearch", map[string]any{"query": "UNIQUE probe"})
		var parsed toolSearchResult
		if result.IsError || json.Unmarshal([]byte(result.Content[0].Text), &parsed) != nil {
			t.Fatal(result)
		}
		return parsed
	}
	parent := search(f.allowed)
	if parent.Total != 1 || len(parent.Tools[0].Digest) != 64 || !strings.Contains(string(parent.Tools[0].InputSchema), "value") {
		t.Fatalf("missing current schema: %+v", parent)
	}
	if child := search(child); child.Total != 0 {
		t.Fatalf("restricted schema leaked: %+v", child)
	}
	if err := registration.Dispose(t.Context()); err != nil {
		t.Fatal(err)
	}
	if disposed := search(f.allowed); disposed.Total != 0 {
		t.Fatalf("retired schema survived: %+v", disposed)
	}
}

func TestToolSearchBudgetAndPagination(t *testing.T) {
	schemas := []harness.ToolSchema{
		{Name: "b", Description: "probe", InputSchema: json.RawMessage(`{"type":"object"}`)},
		{Name: "a", Description: "probe", InputSchema: json.RawMessage(`{"type":"object","description":"` + strings.Repeat("x", 40000) + `"}`)},
	}
	page := searchToolSchemas(schemas, "self", "probe", 0, 1)
	if len(page.Tools) != 1 || page.Tools[0].Name != "a" || !page.Tools[0].SchemaOmitted || page.NextOffset == nil || *page.NextOffset != 1 {
		t.Fatalf("bounded page: %+v", page)
	}
	if next := searchToolSchemas(schemas, "self", "probe", *page.NextOffset, 1); len(next.Tools) != 1 || next.Tools[0].Name != "b" || next.NextOffset != nil {
		t.Fatalf("continuation: %+v", next)
	}
}
