package skills

import (
	"encoding/json"
	"errors"
	"fmt"
	"unicode/utf8"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/model"
)

// SummaryBudget is trusted presentation configuration. Zero retains the
// existing catalog defaults. Setting either field applies byte ceilings to the
// same advertisement, offset/limit listing and complete-summary read protocol.
type SummaryBudget struct {
	AdvertisementBytes int
	PageBytes          int
}

func (b SummaryBudget) resolve() (SummaryBudget, error) {
	if b == (SummaryBudget{}) {
		return SummaryBudget{PageBytes: harness.DefaultCatalogPageBytes}, nil
	}
	if b.AdvertisementBytes == 0 {
		b.AdvertisementBytes = 8192
	}
	if b.PageBytes == 0 {
		b.PageBytes = 8192
	}
	if b.AdvertisementBytes < 1024 || b.AdvertisementBytes > 65536 || b.PageBytes < 1024 || b.PageBytes > 65536 {
		return SummaryBudget{}, errors.New("skills: summary budgets must be between 1024 and 65536 bytes")
	}
	return b, nil
}

func skillCatalogDescription(header, name string, rows []Summary) *harness.CatalogText {
	text := &harness.CatalogText{Header: header, RecoveryTool: name, Continuation: "Call " + name + " with offset/limit to page the complete catalog; follow next_offset."}
	for _, row := range rows {
		// Relevance metadata never advertises a digest, instruction body or root.
		data, _ := json.Marshal(struct {
			Name         string   `json:"name"`
			Description  string   `json:"description"`
			ArgumentHint string   `json:"argumentHint,omitempty"`
			Paths        []string `json:"paths,omitempty"`
		}{row.Name, row.Description, row.ArgumentHint, row.Paths})
		text.Rows = append(text.Rows, string(data))
	}
	return text
}

type skillCatalogItem struct {
	Summary
	MetadataTruncated bool `json:"metadata_truncated,omitempty"`
}

// Small legacy {} listings keep their array wire format. Large or explicitly
// paged calls use a bounded envelope with the same exact names and digests.
func skillCatalogListing(rows []Summary, offset, limit *int, maxBytes int) (any, error) {
	if offset == nil && limit == nil {
		encoded, err := json.Marshal(rows)
		if err != nil || len(encoded) <= maxBytes {
			return rows, err
		}
	}
	items := make([]skillCatalogItem, 0, len(rows))
	for _, row := range rows {
		item := skillCatalogItem{Summary: row}
		item.Description = catalogField(row.Description, 1024)
		item.ArgumentHint = catalogField(row.ArgumentHint, 512)
		item.Paths = nil
		remaining := 512
		for _, path := range row.Paths {
			encoded, _ := json.Marshal(path)
			if len(encoded)+1 > remaining {
				break
			}
			item.Paths = append(item.Paths, path)
			remaining -= len(encoded) + 1
		}
		item.MetadataTruncated = item.Description != row.Description || item.ArgumentHint != row.ArgumentHint || len(item.Paths) != len(row.Paths)
		// The shared pager owns page boundaries. Compact only display fields
		// here so one row still fits smaller host-selected page ceilings.
		encoded, _ := json.Marshal(item)
		if len(encoded) > maxBytes-257 {
			item.ArgumentHint, item.Paths, item.MetadataTruncated = "", nil, true
			description := []rune(item.Description)
			low, high := 0, len(description)
			for low < high {
				middle := (low + high + 1) / 2
				item.Description = string(description[:middle])
				encoded, _ = json.Marshal(item)
				if len(encoded) <= maxBytes-257 {
					low = middle
				} else {
					high = middle - 1
				}
			}
			item.Description = string(description[:low])
		}
		items = append(items, item)
	}
	start, count := 0, 0
	if offset != nil {
		start = *offset
	}
	if limit != nil {
		count = *limit
	}
	return model.PaginateCatalog(items, start, count, model.CatalogPageBudget{MaxBytes: maxBytes})
}

// Summary reads never load or activate a workflow, including context:fork.
func skillCatalogSummary(rows []Summary, name string, offset, limit *int, maxBytes int) (any, error) {
	for _, row := range rows {
		if row.Name != name {
			continue
		}
		encoded, err := json.Marshal(row)
		if err != nil {
			return nil, err
		}
		start, count := 0, 0
		if offset != nil {
			start = *offset
		}
		if limit != nil {
			count = *limit
		}
		// Keep the owner's attribution inside the same response ceiling.
		attribution, _ := json.Marshal(struct {
			Name     string `json:"name"`
			Encoding string `json:"encoding"`
		}{name, "json"})
		page, err := model.PaginateCatalogText(string(encoded), start, count, model.CatalogPageBudget{MaxBytes: maxBytes - len(attribution)})
		if err != nil {
			return nil, err
		}
		return struct {
			Name     string `json:"name"`
			Encoding string `json:"encoding"`
			model.CatalogTextRange
		}{name, "json", page}, nil
	}
	return nil, fmt.Errorf("skills: unknown summary %q; list this catalog first", name)
}

func catalogField(text string, maxBytes int) string {
	if len(text) <= maxBytes {
		return text
	}
	text = text[:maxBytes]
	for !utf8.ValidString(text) {
		text = text[:len(text)-1]
	}
	return text
}
