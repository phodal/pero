package nativetools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/phodal/pero/harness/go/fstools"
)

type notebookReadCell struct {
	Index          int             `json:"index"`
	ID             string          `json:"cell_id,omitempty"`
	Type           string          `json:"cell_type"`
	Source         string          `json:"source"`
	Outputs        json.RawMessage `json:"outputs,omitempty"`
	ExecutionCount json.RawMessage `json:"execution_count,omitempty"`
	Attachments    json.RawMessage `json:"attachments,omitempty"`
	Truncated      bool            `json:"truncated,omitempty"`
	OriginalBytes  int             `json:"original_cell_bytes,omitempty"`
}

type notebookReadResult struct {
	Path       string             `json:"path"`
	Format     int                `json:"nbformat"`
	Total      int                `json:"total_cells"`
	Cells      []notebookReadCell `json:"cells"`
	NextOffset *int               `json:"next_offset,omitempty"`
	Notice     string             `json:"notice"`
}

func readNotebook(ctx context.Context, files *fstools.Workspace, input arguments) (any, error) {
	if filepath.Ext(input.Path) != ".ipynb" {
		return nil, errors.New("notebook path must end with .ipynb")
	}
	text, err := files.Read(ctx, input.Path)
	if err != nil {
		return nil, err
	}
	var document notebookDocument
	if err := json.Unmarshal([]byte(text.Text), &document); err != nil {
		return nil, fmt.Errorf("invalid notebook JSON: %w", err)
	}
	if document.Nbformat != 4 {
		return nil, errors.New("notebook read supports nbformat 4")
	}
	offset, limit := input.Offset, input.Limit
	if offset == 0 {
		offset = 1
	}
	if limit == 0 {
		limit = 20
	}
	result := notebookReadResult{Path: text.Path, Format: document.Nbformat, Total: len(document.Cells), Cells: []notebookReadCell{}, Notice: "Saved notebook data only: no code was executed, and embedded images/HTML were not visually inspected or rendered. Indices and next_offset are 1-based cell numbers. A truncated cell omits outputs/attachments and shortens source; inspect the original file with an available bounded text reader for omitted data."}
	used := 0
	for i := offset - 1; i < len(document.Cells); i++ {
		if len(result.Cells) >= limit {
			next := i + 1
			result.NextOffset = &next
			break
		}
		cell := document.Cells[i]
		if len(cell.ID) > 64 || (cell.CellType != "code" && cell.CellType != "markdown" && cell.CellType != "raw") {
			return nil, fmt.Errorf("cell %d has invalid v4 identity or type", i+1)
		}
		var source string
		if err := json.Unmarshal(cell.Source, &source); err != nil {
			var lines []string
			if err := json.Unmarshal(cell.Source, &lines); err != nil {
				return nil, fmt.Errorf("cell %d has invalid source: %w", i+1, err)
			}
			source = strings.Join(lines, "")
		}
		item := notebookReadCell{Index: i + 1, ID: cell.ID, Type: cell.CellType, Source: source, Outputs: cell.Outputs, ExecutionCount: cell.ExecutionCount, Attachments: cell.Attachments}
		raw, _ := json.Marshal(item)
		if used+len(raw) > 48<<10 {
			if len(result.Cells) > 0 {
				next := i + 1
				result.NextOffset = &next
				break
			}
			item.Truncated, item.OriginalBytes = true, len(raw)
			item.Outputs, item.Attachments = nil, nil
			item.Source = boundedText(source, 4096)
			// execution_count is a number or null in a valid v4 notebook.
			var count *int
			if err := json.Unmarshal(cell.ExecutionCount, &count); err != nil {
				item.ExecutionCount = nil
			}
			raw, _ = json.Marshal(item)
		}
		used += len(raw)
		result.Cells = append(result.Cells, item)
	}
	return result, nil
}
