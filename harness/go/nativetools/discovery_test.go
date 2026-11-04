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
		if parsed.PartialMatch && !strings.Contains(parsed.Notice, "partial keyword matches") {
			t.Fatal("partial keyword result did not disclose its matching mode")
		}
		return parsed
	}
	queries := []string{"UNIQUE probe", "catalog_probe nonexistent_keyword", "catalog_probe", "select:catalog_probe,missing"}
	for _, query := range queries {
		parent := search(f.allowed, query)
		if parent.Total != 1 || len(parent.Tools[0].Digest) != 64 || !strings.Contains(string(parent.Tools[0].InputSchema), "value") {
			t.Fatalf("missing current schema for %q: %+v", query, parent)
		}
		for _, item := range search(child, query).Tools {
			if item.Name == "catalog_probe" {
				t.Fatalf("restricted schema leaked for %q: %+v", query, item)
			}
		}
	}
	if err := registration.Dispose(t.Context()); err != nil {
		t.Fatal(err)
	}
	for _, query := range queries {
		for _, item := range search(f.allowed, query).Tools {
			if item.Name == "catalog_probe" {
				t.Fatalf("retired schema survived for %q: %+v", query, item)
			}
		}
	}
}

func TestToolSearchMatching(t *testing.T) {
	schemas := []harness.ToolSchema{
		{Name: "a", Description: "Read text"}, {Name: "b", Description: "Read text"},
		{Name: "c", Description: "Read text"}, {Name: "d", Description: "Read text"},
		{Name: "e", Description: "Read text"}, {Name: "NotebookRead", Description: "Read notebook text"},
		{Name: "Read", Description: "Read bounded UTF-8 file text with line numbers"},
		{Name: "Write", Description: "Create bounded UTF-8 text"}, {Name: "self", Description: "Read text"},
		{Name: "TaskStop", Description: "Stop an owned job"},
		{Name: "Agent", Description: "Use TaskStop to stop the agent"},
		{Name: "Bash", Description: "Use TaskStop to stop a background command"},
	}
	for _, tc := range []struct {
		query   string
		want    []string
		total   int
		partial bool
	}{
		{"Read", []string{"Read"}, 1, false},
		{" read ", []string{"Read"}, 1, false},
		{"TaskStop", []string{"TaskStop"}, 1, false},
		{"read text", []string{"NotebookRead", "Read", "a", "b", "c"}, 7, false},
		{"bounded UTF-8", []string{"Read", "Write"}, 2, false},
		{"read file", []string{"Read"}, 1, false},
		{"select:Write, read,Read,missing,self", []string{"Read", "Write"}, 2, false},
		{"select:Read", []string{"Read"}, 1, false},
		{"select:a,b,c,d,e,Read,Write", []string{"Read", "Write", "a", "b", "c", "d", "e"}, 7, false},
		{"select:", []string{}, 0, false},
		{"select:read_file,list_dir", []string{}, 0, false},
		{"files terminal list read write", []string{"NotebookRead", "Read", "Write", "a", "b"}, 8, true},
		{"read file contents", []string{"Read", "NotebookRead", "a", "b", "c"}, 7, true},
		{"unmatched nonexistent_keyword", []string{}, 0, false},
	} {
		t.Run(tc.query, func(t *testing.T) {
			result := searchToolSchemas(schemas, "self", tc.query, 0, 0)
			names := make([]string, 0, len(result.Tools))
			for _, tool := range result.Tools {
				names = append(names, tool.Name)
			}
			if result.Total != tc.total || result.PartialMatch != tc.partial || !reflect.DeepEqual(names, tc.want) {
				t.Fatalf("query %q: total=%d names=%v want %d %v", tc.query, result.Total, names, tc.total, tc.want)
			}
			if result.Total == 0 && (!strings.Contains(result.Notice, "no tools were activated") || !strings.Contains(result.Notice, "select:")) {
				t.Fatalf("missing zero-result recovery: %s", result.Notice)
			}
		})
	}
}

func TestDeferredDiscoveryRetainsSchemasOutsideModelContent(t *testing.T) {
	for _, deferred := range []bool{false, true} {
		f := newClaudeFixture(t, Options{DeferToolLoading: deferred})
		result := f.call(t, f.allowed, "ToolSearch", map[string]any{"query": "Read"})
		var visible toolSearchResult
		if err := json.Unmarshal([]byte(result.Content[0].Text), &visible); err != nil || result.IsError || len(visible.Tools) != 1 {
			t.Fatalf("discovery failed: %+v %v", result, err)
		}
		item := visible.Tools[0]
		if !deferred {
			if len(item.InputSchema) == 0 || item.Activated || len(result.Meta) != 0 {
				t.Fatal("non-deferred schema lookup changed")
			}
			continue
		}
		var durable struct {
			Discovery toolSearchResult `json:"discovery"`
		}
		if err := json.Unmarshal(result.Meta, &durable); err != nil || len(durable.Discovery.Tools) != 1 {
			t.Fatalf("missing durable discovery: %s %v", result.Meta, err)
		}
		full := durable.Discovery.Tools[0]
		if len(item.InputSchema) != 0 || !item.SchemaInDeclaration || !item.Activated || item.SchemaOmitted || len(full.InputSchema) == 0 || item.Digest != full.Digest {
			t.Fatalf("invalid discovery projection: visible=%+v durable=%+v", item, full)
		}
	}
}

func TestToolSearchBudgetAndPagination(t *testing.T) {
	var smallSchemas []harness.ToolSchema
	var names []string
	for _, name := range strings.Fields("a b c d e f g h i j k l m n o p q r s t u") {
		smallSchemas = append(smallSchemas, harness.ToolSchema{Name: name, Description: "probe"})
		names = append(names, name)
	}
	for _, tc := range []struct {
		query string
		limit int
		want  int
	}{
		{"probe", 0, 5},
		{"select:" + strings.Join(names, ","), 0, 20},
		{"select:" + strings.Join(names, ","), 2, 2},
	} {
		page := searchToolSchemas(smallSchemas, "self", tc.query, 0, tc.limit)
		if len(page.Tools) != tc.want || page.NextOffset == nil || *page.NextOffset != tc.want {
			t.Fatalf("page size for %q limit=%d: %+v", tc.query, tc.limit, page)
		}
	}
	schemas := []harness.ToolSchema{
		{Name: "b", Description: "probe", InputSchema: json.RawMessage(`{"type":"object"}`)},
		{Name: "a", Description: "probe", InputSchema: json.RawMessage(`{"type":"object","description":"` + strings.Repeat("x", 40000) + `"}`)},
	}
	for _, query := range []string{"probe", "probe nonexistent_keyword", "select:b,a"} {
		page := searchToolSchemas(schemas, "self", query, 0, 1)
		if len(page.Tools) != 1 || page.Tools[0].Name != "a" || !page.Tools[0].SchemaOmitted || page.NextOffset == nil || *page.NextOffset != 1 {
			t.Fatalf("bounded page for %q: %+v", query, page)
		}
		if next := searchToolSchemas(schemas, "self", query, *page.NextOffset, 1); len(next.Tools) != 1 || next.Tools[0].Name != "b" || next.NextOffset != nil {
			t.Fatalf("continuation for %q: %+v", query, next)
		}
	}
}
