package skills

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/phodal/pero/harness/go/harness"
)

func TestSummaryPagesStayBoundedAndDiscoverEverySelectedName(t *testing.T) {
	rows := make([]Summary, MaxSelectedSkills)
	for index := range rows {
		rows[index] = Summary{
			Name: fmt.Sprintf("package:workflow-%03d", index), Digest: "sha256:" + strings.Repeat("f", 64),
			Description: strings.Repeat("中文\n\"\\", 300), ArgumentHint: strings.Repeat("arguments", 100), Paths: []string{strings.Repeat("path", 300)},
		}
	}
	for _, budget := range []int{1024, 8192} {
		t.Run(fmt.Sprint(budget), func(t *testing.T) {
			cursor, count := "", 0
			for {
				page, err := summaryPage(rows, cursor, budget)
				if err != nil {
					t.Fatal(err)
				}
				raw, _ := json.Marshal(page)
				if len(raw) > budget || !utf8.Valid(raw) || len(page.Skills) == 0 {
					t.Fatalf("invalid page: bytes=%d rows=%d", len(raw), len(page.Skills))
				}
				for _, row := range page.Skills {
					if row.Name != rows[count].Name || row.Digest != rows[count].Digest || !utf8.ValidString(row.Description) || !strings.HasPrefix(rows[count].Description, row.Description) {
						t.Fatalf("lost or modified catalog identity: %+v", row)
					}
					count++
				}
				if page.NextCursor == "" {
					break
				}
				if page.NextCursor == cursor || count >= len(rows) {
					t.Fatal("pagination failed to advance")
				}
				cursor = page.NextCursor
			}
			if count != MaxSelectedSkills {
				t.Fatalf("discovered %d of %d", count, MaxSelectedSkills)
			}
		})
	}
	first, err := summaryPage(rows, "", 1024)
	if err != nil || first.NextCursor == "" {
		t.Fatalf("missing continuation: %+v %v", first, err)
	}
	// Visibility or content changes invalidate the old snapshot. A cursor
	// never bypasses the current authorized catalog view.
	for _, changed := range [][]Summary{rows[1:], append([]Summary{{Name: "changed", Digest: "other"}}, rows[1:]...)} {
		if _, err := summaryPage(changed, first.NextCursor, 1024); err == nil {
			t.Fatal("stale cursor accepted")
		}
	}
	for _, cursor := range []string{"not-a-cursor", strings.Repeat("x", 257)} {
		if _, err := summaryPage(rows, cursor, 1024); err == nil {
			t.Fatal("malformed cursor accepted")
		}
	}
}

func TestBudgetedSkillToolsPreserveVisibilityAndReadAuthority(t *testing.T) {
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
				var page SummaryPage
				if got.IsError || len(got.Content) != 1 || len(got.Content[0].Text) > 1024 || json.Unmarshal([]byte(got.Content[0].Text), &page) != nil || len(page.Skills) == 0 {
					t.Fatalf("page: %+v", got)
				}
				for _, row := range page.Skills {
					if strings.Contains(row.Name, "hidden") || row.Digest != first.Definition.Digest {
						t.Fatalf("discovery changed authority: %+v", row)
					}
					count++
				}
				if page.NextCursor == "" {
					break
				}
				raw, _ := json.Marshal(map[string]string{"cursor": page.NextCursor})
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
			for _, bad := range []string{`{"cursor":"bad"}`, `{"cursor":"bad","name":"package:first","digest":"bad"}`, `{"cursor":"bad","skill":"package:first"}`} {
				if !execute(bad).IsError {
					t.Fatalf("mixed/invalid cursor accepted: %s", bad)
				}
			}
		})
	}
}
