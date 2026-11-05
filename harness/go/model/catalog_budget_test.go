package model

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestCatalogBudgetKeepsWholeRowsAndExplainsOmission(t *testing.T) {
	rows := []string{`{"name":"first"}`, `{"name":"第二"}`, `{"name":"last","description":"` + strings.Repeat("x", 200) + `"}`}
	for _, size := range []int{0, 1, 42, 80, 100, 4096} {
		budget := CatalogBudget{Remaining: size}
		text := budget.Render(CatalogText{Header: "Available:", Rows: rows, Continuation: "Call List."})
		if len(text) > size || !utf8.ValidString(text) {
			t.Fatalf("size %d: %q", size, text)
		}
		for _, line := range strings.Split(text, "\n") {
			if strings.HasPrefix(line, "{") && !json.Valid([]byte(line)) {
				t.Fatalf("partial row: %q", line)
			}
		}
		if size == 100 && (!strings.Contains(text, "omitted") || !strings.Contains(text, "Call List")) {
			t.Fatalf("no continuation: %q", text)
		}
		if size == 4096 && !strings.Contains(text, rows[2]) {
			t.Fatal(text)
		}
	}
}

func TestCatalogPagesRecoverRowsAndEscapedUTF8Text(t *testing.T) {
	for _, budget := range []CatalogPageBudget{{}, {MaxBytes: 8192}} {
		maxBytes := budget.MaxBytes
		if maxBytes == 0 {
			maxBytes = DefaultCatalogPageBytes
		}

		rows := make([]string, 90)
		for index := range rows {
			rows[index] = strings.Repeat("metadata界", 250)
		}
		var all []string
		for offset := 0; ; {
			page, err := PaginateCatalog(rows, offset, 40, budget)
			if err != nil {
				t.Fatal(err)
			}
			encoded, _ := json.Marshal(page)
			if len(encoded) > maxBytes {
				t.Fatal(len(encoded))
			}
			all = append(all, page.Items...)
			if page.NextOffset == nil {
				break
			}
			if *page.NextOffset <= offset {
				t.Fatal("page made no progress")
			}
			offset = *page.NextOffset
		}
		if len(all) != len(rows) {
			t.Fatal(len(all))
		}
		text := strings.Repeat("\x00\"\\界🙂\n", 4000)
		var recovered strings.Builder
		for offset := 0; ; {
			page, err := PaginateCatalogText(text, offset, 8192, budget)
			if err != nil {
				t.Fatal(err)
			}
			encoded, _ := json.Marshal(page)
			if len(encoded) > maxBytes || !utf8.ValidString(page.Text) {
				t.Fatal(len(encoded))
			}
			recovered.WriteString(page.Text)
			if page.NextOffset == nil {
				break
			}
			offset = *page.NextOffset
		}
		if recovered.String() != text {
			t.Fatal("text pages lost content")
		}
		for _, input := range []struct{ Offset, Limit int }{{-1, 1}, {len(text) + 1, 1}, {5, 1}, {0, -1}, {0, 8193}} {
			if _, err := PaginateCatalogText(text, input.Offset, input.Limit); err == nil {
				t.Fatalf("accepted invalid range: %+v", input)
			}
		}

	}
}

func TestCatalogCeilingUsesTheSharedRemainingBudget(t *testing.T) {
	for _, remaining := range []int{128, 8192, DefaultCatalogBytes} {
		budget := CatalogBudget{Remaining: remaining}
		first := budget.Render(CatalogText{Header: "Catalog", Rows: []string{strings.Repeat("x", 16384)}, Continuation: "Call List.", MaxBytes: 8192})
		if len(first) > min(remaining, 8192) {
			t.Fatalf("catalog exceeded its ceiling: %d", len(first))
		}
		second := budget.Render(CatalogText{Header: "Another catalog", Rows: []string{strings.Repeat("y", 32768)}, Continuation: "Call List."})
		if len(first)+len(second) > remaining || budget.Remaining != remaining-len(first)-len(second) {
			t.Fatal("per-catalog ceiling bypassed the shared budget")
		}
	}
}
