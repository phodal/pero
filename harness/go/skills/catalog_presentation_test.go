package skills

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/model"
)

func TestSkillCatalogPagesPreserveNamesDigestsAndRecoverableMetadata(t *testing.T) {
	requireCatalogPlatform(t)
	root := canonicalTempDir(t)
	for index := range 24 {
		name := fmt.Sprintf("workflow-%02d", index)
		fixture(t, root, name, "---\nname: "+name+"\ndescription: "+strings.Repeat("relevance ", 100)+"\nargument-hint: "+strings.Repeat("argument", 500)+"\n---\nComplete workflow instructions.")
	}
	for _, claude := range []bool{false, true} {
		t.Run(fmt.Sprint(claude), func(t *testing.T) {
			catalog, err := Open(t.Context(), []string{root})
			if err != nil {
				t.Fatal(err)
			}
			h, err := harness.Boot(t.Context(), harness.Options{})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()); _ = catalog.Close() })
			if err := MountCatalog(t.Context(), h, catalog, MountOptions{Claude: claude}); err != nil {
				t.Fatal(err)
			}
			agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "catalog-pages", CWD: root})
			if err != nil {
				t.Fatal(err)
			}
			toolName := "skill"
			if claude {
				toolName = "Skill"
			}
			call := func(input string) harness.ToolResult {
				out, err := h.Tools().Execute(t.Context(), harness.ToolRequest{Agent: agent, Name: toolName, CallID: "catalog", Arguments: json.RawMessage(input)})
				if err != nil || out.Result.IsError {
					t.Fatalf("call: %+v %v", out.Result, err)
				}
				return out.Result
			}
			var found []skillCatalogItem
			input := `{}`
			for {
				result := call(input)
				text := result.Content[0].Text
				if len(text) > harness.DefaultCatalogPageBytes {
					t.Fatal(len(text))
				}
				var page model.CatalogPage[skillCatalogItem]
				if err := json.Unmarshal([]byte(text), &page); err != nil {
					t.Fatal(err)
				}
				found = append(found, page.Items...)
				if page.NextOffset == nil {
					break
				}
				input = fmt.Sprintf(`{"offset":%d,"limit":5}`, *page.NextOffset)
			}
			if len(found) != 24 {
				t.Fatal(len(found))
			}
			for index, item := range found {
				if item.Name != fmt.Sprintf("workflow-%02d", index) || item.Digest == "" || !item.MetadataTruncated {
					t.Fatalf("item=%+v", item)
				}
			}
			var recovered strings.Builder
			for offset := 0; ; {
				input = fmt.Sprintf(`{"summary":"%s","offset":%d}`, found[0].Name, offset)
				result := call(input)
				if len(result.Content[0].Text) > harness.DefaultCatalogPageBytes {
					t.Fatal("unbounded summary read")
				}
				var page model.CatalogTextRange
				if err := json.Unmarshal([]byte(result.Content[0].Text), &page); err != nil {
					t.Fatal(err)
				}
				recovered.WriteString(page.Text)
				if page.NextOffset == nil {
					break
				}
				offset = *page.NextOffset
			}
			var complete Summary
			if err := json.Unmarshal([]byte(recovered.String()), &complete); err != nil || complete.ArgumentHint != strings.Repeat("argument", 500) {
				t.Fatalf("complete metadata not recovered: %+v %v", complete, err)
			}
			schemas, err := h.Tools().SchemasForAgent(t.Context(), agent)
			if err != nil || len(schemas) != 1 || len(schemas[0].Description) > harness.DefaultCatalogPageBytes || !strings.Contains(schemas[0].Description, "omitted") {
				t.Fatalf("schemas: %+v %v", schemas, err)
			}
		})
	}
}
