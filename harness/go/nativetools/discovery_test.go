package nativetools

import (
	"context"
	"encoding/json"
	"reflect"
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
	search := func(agent *harness.Agent, query string) toolSearchResult {
		t.Helper()
		result := f.call(t, agent, "ToolSearch", map[string]any{"query": query})
		var parsed toolSearchResult
		if result.IsError || json.Unmarshal([]byte(result.Content[0].Text), &parsed) != nil {
			t.Fatal(result)
		}
		return parsed
	}
	queries := []string{"UNIQUE probe", "catalog_probe", "select:catalog_probe,missing"}
	for _, query := range queries {
		parent := search(f.allowed, query)
		if parent.Total != 1 || len(parent.Tools[0].Digest) != 64 || !strings.Contains(string(parent.Tools[0].InputSchema), "value") {
			t.Fatalf("missing current schema for %q: %+v", query, parent)
		}
		if result := search(child, query); result.Total != 0 {
			t.Fatalf("restricted schema leaked for %q: %+v", query, result)
		}
	}
	if err := registration.Dispose(t.Context()); err != nil {
		t.Fatal(err)
	}
	for _, query := range queries {
		if disposed := search(f.allowed, query); disposed.Total != 0 {
			t.Fatalf("retired schema survived for %q: %+v", query, disposed)
		}
	}
}

func TestToolSearchMatching(t *testing.T) {
	schemas := []harness.ToolSchema{
		{Name: "a", Description: "Read text"}, {Name: "b", Description: "Read text"},
		{Name: "c", Description: "Read text"}, {Name: "d", Description: "Read text"},
		{Name: "e", Description: "Read text"}, {Name: "NotebookRead", Description: "Read notebook text"},
		{Name: "Read", Description: "Read bounded UTF-8 text with line numbers"},
		{Name: "Write", Description: "Create bounded UTF-8 text"}, {Name: "self", Description: "Read text"},
	}
	for _, tc := range []struct {
		query string
		want  []string
		total int
	}{
		{"Read", []string{"Read", "NotebookRead", "a", "b", "c"}, 7},
		{" read ", []string{"Read", "NotebookRead", "a", "b", "c"}, 7},
		{"read text", []string{"NotebookRead", "Read", "a", "b", "c"}, 7},
		{"bounded UTF-8", []string{"Read", "Write"}, 2},
		{"select:Write, read,Read,missing,self", []string{"Read", "Write"}, 2},
		{"select:Read", []string{"Read"}, 1},
		{"select:", []string{}, 0},
		{"files terminal list read write", []string{}, 0},
		{"read file contents", []string{}, 0},
	} {
		t.Run(tc.query, func(t *testing.T) {
			result := searchToolSchemas(schemas, "self", tc.query, 0, 0)
			names := make([]string, 0, len(result.Tools))
			for _, tool := range result.Tools {
				names = append(names, tool.Name)
			}
			if result.Total != tc.total || !reflect.DeepEqual(names, tc.want) {
				t.Fatalf("query %q: total=%d names=%v want %d %v", tc.query, result.Total, names, tc.total, tc.want)
			}
			if result.Total == 0 && (!strings.Contains(result.Notice, "no tools were activated") || !strings.Contains(result.Notice, "select:")) {
				t.Fatalf("missing zero-result recovery: %s", result.Notice)
			}
		})
	}
}

func TestToolSearchBudgetAndPagination(t *testing.T) {
	schemas := []harness.ToolSchema{
		{Name: "b", Description: "probe", InputSchema: json.RawMessage(`{"type":"object"}`)},
		{Name: "a", Description: "probe", InputSchema: json.RawMessage(`{"type":"object","description":"` + strings.Repeat("x", 40000) + `"}`)},
	}
	for _, query := range []string{"probe", "select:b,a"} {
		page := searchToolSchemas(schemas, "self", query, 0, 1)
		if len(page.Tools) != 1 || page.Tools[0].Name != "a" || !page.Tools[0].SchemaOmitted || page.NextOffset == nil || *page.NextOffset != 1 {
			t.Fatalf("bounded page for %q: %+v", query, page)
		}
		if next := searchToolSchemas(schemas, "self", query, *page.NextOffset, 1); len(next.Tools) != 1 || next.Tools[0].Name != "b" || next.NextOffset != nil {
			t.Fatalf("continuation for %q: %+v", query, next)
		}
	}
}
