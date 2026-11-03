package skills

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
)

// SummaryBudget is trusted presentation configuration. The zero value keeps
// the original catalog schema and list response. Setting either field enables
// bounded advertisements and paginated discovery; a missing field uses 8 KiB.
type SummaryBudget struct {
	AdvertisementBytes int
	PageBytes          int
}

func (b SummaryBudget) resolve() (SummaryBudget, error) {
	if b == (SummaryBudget{}) {
		return b, nil
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

// SummaryPage contains only model-visible entries from the current catalog.
// A cursor identifies that exact ordered snapshot and never grants authority.
type SummaryPage struct {
	Skills     []Summary `json:"skills"`
	NextCursor string    `json:"nextCursor,omitempty"`
}

type summaryCursor struct {
	Snapshot string `json:"snapshot"`
	Offset   int    `json:"offset"`
}

func encodeSummaryCursor(snapshot string, offset int) string {
	raw, _ := json.Marshal(summaryCursor{Snapshot: snapshot, Offset: offset})
	return base64.RawURLEncoding.EncodeToString(raw)
}

func summaryPage(rows []Summary, cursor string, budget int) (SummaryPage, error) {
	raw, err := json.Marshal(rows)
	if err != nil {
		return SummaryPage{}, err
	}
	digest := sha256.Sum256(raw)
	snapshot := hex.EncodeToString(digest[:])
	offset := 0
	if cursor != "" {
		if len(cursor) > 256 {
			return SummaryPage{}, errors.New("skills: invalid catalog cursor")
		}
		raw, err := base64.RawURLEncoding.DecodeString(cursor)
		var value summaryCursor
		if err != nil || json.Unmarshal(raw, &value) != nil || value.Snapshot != snapshot || value.Offset < 0 || value.Offset >= len(rows) {
			return SummaryPage{}, errors.New("skills: catalog cursor is invalid or stale; restart discovery with {}")
		}
		offset = value.Offset
	}
	page := SummaryPage{Skills: []Summary{}}
	for index := offset; index < len(rows); index++ {
		next := ""
		if index+1 < len(rows) {
			next = encodeSummaryCursor(snapshot, index+1)
		}
		row := rows[index]
		candidate := SummaryPage{Skills: append(append([]Summary(nil), page.Skills...), row), NextCursor: next}
		encoded, _ := json.Marshal(candidate)
		if len(encoded) > budget {
			if len(page.Skills) > 0 {
				page.NextCursor = encodeSummaryCursor(snapshot, index)
				return page, nil
			}
			// Reserve the exact envelope and next cursor, then shorten display
			// fields only. Executable names and digests remain intact.
			empty, _ := json.Marshal(SummaryPage{Skills: []Summary{}, NextCursor: next})
			row, err = fitSummary(row, budget-len(empty))
			if err != nil {
				return SummaryPage{}, err
			}
		}
		page.Skills = append(page.Skills, row)
		page.NextCursor = next
	}
	return page, nil
}

func fitSummary(row Summary, budget int) (Summary, error) {
	raw, _ := json.Marshal(row)
	if len(raw) <= budget {
		return row, nil
	}
	row.ArgumentHint, row.Paths = "", nil
	description := []rune(row.Description)
	row.Description = ""
	raw, _ = json.Marshal(row)
	if len(raw) > budget {
		return Summary{}, errors.New("skills: summary budget cannot hold a catalog identifier")
	}
	low, high := 0, len(description)
	for low < high {
		middle := (low + high + 1) / 2
		row.Description = string(description[:middle])
		raw, _ = json.Marshal(row)
		if len(raw) <= budget {
			low = middle
		} else {
			high = middle - 1
		}
	}
	row.Description = string(description[:low])
	return row, nil
}

func summaryAdvertisement(prefix string, rows []Summary, budget int) string {
	const more = "\nDiscover every available workflow through the catalog's paginated list."
	var result strings.Builder
	result.WriteString(prefix)
	for _, row := range rows {
		row.Digest = ""
		// Advertisements contain display information only. Native discovery
		// still supplies the digest required to authorize a read.
		row, err := fitSummary(row, min(384, budget-len(prefix)-len(more)-1))
		if err != nil {
			break
		}
		data, _ := json.Marshal(struct {
			Name         string   `json:"name"`
			Description  string   `json:"description"`
			ArgumentHint string   `json:"argumentHint,omitempty"`
			Paths        []string `json:"paths,omitempty"`
		}{row.Name, row.Description, row.ArgumentHint, row.Paths})
		if result.Len()+1+len(data)+len(more) > budget {
			break
		}
		result.WriteByte('\n')
		result.Write(data)
	}
	result.WriteString(more)
	return result.String()
}
