package skills

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"unicode/utf8"

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

func TestSkillCatalogBudgetPreservesVisibilityAndReadAuthority(t *testing.T) {
	requireCatalogPlatform(t)
	for _, claude := range []bool{false, true} {
		t.Run(fmt.Sprint(claude), func(t *testing.T) {
			root := canonicalTempDir(t)
			first := selectedFixture(t, root, "package:first")
			first.Definition.Description = strings.Repeat("描述\n\"", 400)
			second, hidden := first, first
			second.Definition.Name, hidden.Definition.Name = "package:second", "package:hidden"
			hidden.ModelInvocable = false
			catalog, err := OpenSelected(t.Context(), nil, []FileSelection{first, second, hidden})
			if err != nil {
				t.Fatal(err)
			}
			h, err := harness.Boot(t.Context(), harness.Options{})
			if err != nil {
				catalog.Close()
				t.Fatal(err)
			}
			t.Cleanup(func() { h.Dispose(context.Background()); h.Drain(context.Background()); catalog.Close() })
			if err := MountCatalog(t.Context(), h, catalog, MountOptions{Claude: claude, SummaryBudget: SummaryBudget{AdvertisementBytes: 1024, PageBytes: 1024}}); err != nil {
				t.Fatal(err)
			}
			agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "budgeted", CWD: root})
			if err != nil {
				t.Fatal(err)
			}
			schemas, err := h.Tools().SchemasForAgent(t.Context(), agent)
			if err != nil || len(schemas) != 1 || len(schemas[0].Description) > 1024 || !utf8.ValidString(schemas[0].Description) || strings.Contains(schemas[0].Description, "package:hidden") || strings.Contains(schemas[0].Description, first.Definition.Digest) {
				t.Fatalf("advertisement: %+v %v", schemas, err)
			}
			execute := func(input string) harness.ToolResult {
				t.Helper()
				outcome, err := h.Tools().Execute(t.Context(), harness.ToolRequest{Agent: agent, Name: schemas[0].Name, CallID: "catalog", Arguments: json.RawMessage(input)})
				if err != nil {
					t.Fatal(err)
				}
				return outcome.Result
			}
			read := func(name, digest string) harness.ToolResult {
				fields := map[string]string{"name": name, "digest": digest}
				if claude {
					fields = map[string]string{"skill": name}
				}
				raw, _ := json.Marshal(fields)
				return execute(string(raw))
			}
			if claude {
				// An exactly known selected name needs no list round trip.
				if got := read(first.Definition.Name, ""); got.IsError || !strings.Contains(got.Content[0].Text, "Compiled") {
					t.Fatalf("direct load: %+v", got)
				}
			}
			count, input := 0, "{}"
			for {
				got := execute(input)
				var page model.CatalogPage[skillCatalogItem]
				if got.IsError || len(got.Content) != 1 || len(got.Content[0].Text) > 1024 || json.Unmarshal([]byte(got.Content[0].Text), &page) != nil || len(page.Items) == 0 {
					t.Fatalf("page: %+v", got)
				}
				for _, row := range page.Items {
					if strings.Contains(row.Name, "hidden") || row.Digest != first.Definition.Digest {
						t.Fatalf("discovery changed authority: %+v", row)
					}
					count++
				}
				if page.NextOffset == nil {
					break
				}
				raw, _ := json.Marshal(map[string]int{"offset": *page.NextOffset})
				input = string(raw)
			}
			if count != 2 {
				t.Fatalf("discovered %d visible skills", count)
			}
			if got := read(first.Definition.Name, first.Definition.Digest); got.IsError || !strings.Contains(got.Content[0].Text, "Compiled") {
				t.Fatalf("read: %+v", got)
			}
			if got := read(hidden.Definition.Name, hidden.Definition.Digest); !got.IsError {
				t.Fatal("hidden workflow was model-invocable")
			}
			if !claude && !read(first.Definition.Name, "sha256:"+strings.Repeat("0", 64)).IsError {
				t.Fatal("guessed digest accepted")
			}
			for _, bad := range []string{`{"cursor":"unsupported"}`, `{"offset":1,"name":"package:first","digest":"bad"}`, `{"offset":1,"skill":"package:first"}`} {
				if !execute(bad).IsError {
					t.Fatalf("mixed/unsupported paging accepted: %s", bad)
				}
			}
		})
	}
}

func TestSkillCatalogPagesReachAllSelectedNamesWithinHostBudget(t *testing.T) {
	rows := make([]Summary, MaxSelectedSkills)
	for index := range rows {
		rows[index] = Summary{Name: fmt.Sprintf("package:workflow-%03d", index), Digest: "sha256:" + strings.Repeat("f", 64), Description: strings.Repeat("描述 ", 20)}
	}
	for _, maxBytes := range []int{1024, 8192} {
		count := 0
		for offset := 0; ; {
			limit := 128
			value, err := skillCatalogListing(rows, &offset, &limit, maxBytes)
			if err != nil {
				t.Fatal(err)
			}
			page := value.(model.CatalogPage[skillCatalogItem])
			raw, _ := json.Marshal(page)
			if len(raw) > maxBytes || !utf8.Valid(raw) || len(page.Items) == 0 {
				t.Fatalf("invalid page bytes=%d rows=%d", len(raw), len(page.Items))
			}
			for _, item := range page.Items {
				if item.Name != rows[count].Name || item.Digest != rows[count].Digest {
					t.Fatalf("catalog identity changed: %+v", item)
				}
				count++
			}
			if page.NextOffset == nil {
				break
			}
			if *page.NextOffset <= offset {
				t.Fatal("page did not advance")
			}
			offset = *page.NextOffset
		}
		if count != MaxSelectedSkills {
			t.Fatal(count)
		}
	}
	rows[0].Description = strings.Repeat("中文\n\"\\", 300)
	rows[0].ArgumentHint = strings.Repeat("argument", 100)
	rows[0].Paths = []string{strings.Repeat("path", 300)}
	offset, limit := 0, 1
	value, err := skillCatalogListing(rows, &offset, &limit, 1024)
	if err != nil {
		t.Fatal(err)
	}
	page := value.(model.CatalogPage[skillCatalogItem])
	raw, _ := json.Marshal(page)
	if len(raw) > 1024 || !page.Items[0].MetadataTruncated || page.Items[0].Name != rows[0].Name || page.Items[0].Digest != rows[0].Digest {
		t.Fatalf("large metadata was not compacted safely: %+v", page)
	}
	var recovered strings.Builder
	for offset := 0; ; {
		value, err := skillCatalogSummary(rows, rows[0].Name, &offset, nil, 1024)
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := json.Marshal(value)
		var page model.CatalogTextRange
		if len(raw) > 1024 || json.Unmarshal(raw, &page) != nil {
			t.Fatalf("invalid summary page bytes=%d", len(raw))
		}
		recovered.WriteString(page.Text)
		if page.NextOffset == nil {
			break
		}
		if *page.NextOffset <= offset {
			t.Fatal("summary did not advance")
		}
		offset = *page.NextOffset
	}
	var complete Summary
	if err := json.Unmarshal([]byte(recovered.String()), &complete); err != nil || complete.Description != rows[0].Description || complete.ArgumentHint != rows[0].ArgumentHint || len(complete.Paths) != 1 || complete.Paths[0] != rows[0].Paths[0] {
		t.Fatal("complete summary recovery lost metadata", err)
	}
}
