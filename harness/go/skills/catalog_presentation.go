package skills

import (
	"encoding/json"
	"fmt"
	"unicode/utf8"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/model"
)

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
func skillCatalogListing(rows []Summary, offset, limit *int) (any, error) {
	if offset == nil && limit == nil {
		encoded, err := json.Marshal(rows)
		if err != nil || len(encoded) <= harness.DefaultCatalogPageBytes {
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
		items = append(items, item)
	}
	start, count := 0, 0
	if offset != nil {
		start = *offset
	}
	if limit != nil {
		count = *limit
	}
	return model.PaginateCatalog(items, start, count)
}

// Summary reads never load or activate a workflow, including context:fork.
func skillCatalogSummary(rows []Summary, name string, offset, limit *int) (any, error) {
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
		page, err := model.PaginateCatalogText(string(encoded), start, count)
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
