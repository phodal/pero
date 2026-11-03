package model

import (
	"encoding/json"
	"errors"
	"unicode/utf8"
)

// CatalogPage keeps discovery responses bounded while retaining an exact row
// cursor. Owners supply compact rows and a separate read operation for bodies.
type CatalogPage[T any] struct {
	Items      []T  `json:"items"`
	Offset     int  `json:"offset"`
	Total      int  `json:"total"`
	NextOffset *int `json:"next_offset,omitempty"`
}

func PaginateCatalog[T any](rows []T, offset, limit int) (CatalogPage[T], error) {
	page := CatalogPage[T]{Items: []T{}, Offset: offset, Total: len(rows)}
	if offset < 0 || offset > len(rows) || limit < 0 || limit > 128 {
		return page, errors.New("catalog: offset must be within the catalog and limit must be between 1 and 128")
	}
	if limit == 0 {
		limit = 64
	}
	used := 256 // reserve the page envelope and the owner's attribution
	for index := offset; index < len(rows) && len(page.Items) < limit; index++ {
		encoded, err := json.Marshal(rows[index])
		if err != nil {
			return page, err
		}
		if used+len(encoded)+1 > DefaultCatalogPageBytes {
			if len(page.Items) == 0 {
				return page, errors.New("catalog: row exceeds page budget; use a compact summary and a body read operation")
			}
			break
		}
		page.Items = append(page.Items, rows[index])
		used += len(encoded) + 1
	}
	if next := offset + len(page.Items); next < len(rows) {
		page.NextOffset = &next
	}
	return page, nil
}

// CatalogTextRange uses UTF-8 byte offsets, so exact recovery does not depend
// on line length, newlines, or the number of escaped characters in JSON.
type CatalogTextRange struct {
	Text       string `json:"text"`
	Offset     int    `json:"offset"`
	TotalBytes int    `json:"total_bytes"`
	NextOffset *int   `json:"next_offset,omitempty"`
}

func PaginateCatalogText(text string, offset, limit int) (CatalogTextRange, error) {
	page := CatalogTextRange{Offset: offset, TotalBytes: len(text)}
	if offset < 0 || offset > len(text) || (offset < len(text) && !utf8.RuneStart(text[offset])) || limit < 0 || limit > 8192 {
		return page, errors.New("catalog: offset must be a UTF-8 byte boundary and limit must be between 1 and 8192 bytes")
	}
	if limit == 0 {
		limit = 8192
	}
	end := min(len(text), offset+limit)
	for end > offset && end < len(text) && !utf8.RuneStart(text[end]) {
		end--
	}
	if end == offset && end < len(text) {
		_, size := utf8.DecodeRuneInString(text[offset:])
		end += size
	}
	for {
		page.Text = text[offset:end]
		page.NextOffset = nil
		if end < len(text) {
			next := end
			page.NextOffset = &next
		}
		encoded, err := json.Marshal(page)
		if err != nil {
			return page, err
		}
		if len(encoded) <= DefaultCatalogPageBytes-256 {
			return page, nil
		}
		end = offset + (end-offset)*3/4
		for end > offset && !utf8.RuneStart(text[end]) {
			end--
		}
	}
}
