package model

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// CatalogText retains complete discovery rows independently of the bounded
// description sent to a model. It is runtime metadata, never wire schema.
type CatalogText struct {
	Header       string
	Rows         []string
	Continuation string
	RecoveryTool string
	// MaxBytes is an optional per-catalog ceiling within the shared budget.
	MaxBytes int
}

const DefaultCatalogBytes = 64 << 10
const DefaultCatalogPageBytes = 16 << 10

type CatalogBudget struct{ Remaining int }

func (b *CatalogBudget) Render(c CatalogText) string {
	if b.Remaining <= 0 {
		return ""
	}
	limit := b.Remaining
	if c.MaxBytes > 0 {
		limit = min(limit, c.MaxBytes)
	}
	marker := func(count int) string {
		return fmt.Sprintf("\n[Catalog budget: %d rows omitted. %s]", count, c.Continuation)
	}
	text := c.Header
	kept := 0
	for _, row := range c.Rows {
		reserve := 0
		if kept+1 < len(c.Rows) {
			reserve = len(marker(len(c.Rows) - kept - 1))
		}
		if len(text)+1+len(row)+reserve > limit {
			break
		}
		text += "\n" + row
		kept++
	}
	if kept < len(c.Rows) {
		text += marker(len(c.Rows) - kept)
	}
	if len(text) > limit {
		// Tiny remaining shares still explain the omission without emitting a
		// partial JSON row or splitting a Unicode code point.
		text = marker(len(c.Rows))
		if len(text) > limit {
			text = "[Catalog omitted: shared budget exhausted.]"
		}
		if len(text) > limit {
			text = text[:limit]
			for !utf8.ValidString(text) {
				text = text[:len(text)-1]
			}
		}
	}
	b.Remaining -= len(text)
	return strings.TrimSpace(text)
}

func CloneCatalogText(c *CatalogText) *CatalogText {
	if c == nil {
		return nil
	}
	copy := *c
	copy.Rows = append([]string(nil), c.Rows...)
	return &copy
}
