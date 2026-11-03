package nativetools

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/phodal/pero/harness/go/fstools"
)

type notebookDocument struct {
	Cells         []notebookCell  `json:"cells"`
	Metadata      json.RawMessage `json:"metadata"`
	Nbformat      int             `json:"nbformat"`
	NbformatMinor int             `json:"nbformat_minor"`
}

type notebookCell struct {
	ID             string          `json:"id,omitempty"`
	CellType       string          `json:"cell_type"`
	Metadata       json.RawMessage `json:"metadata,omitempty"`
	Source         json.RawMessage `json:"source"`
	Outputs        json.RawMessage `json:"outputs,omitempty"`
	ExecutionCount json.RawMessage `json:"execution_count,omitempty"`
	Attachments    json.RawMessage `json:"attachments,omitempty"`
}

type notebookEditReceipt struct {
	Path     string `json:"path"`
	CellID   string `json:"cell_id"`
	EditMode string `json:"edit_mode"`
	State    string `json:"state"`
}

func editNotebook(ctx context.Context, files *fstools.Workspace, input arguments) (any, error) {
	if files == nil {
		return nil, errors.New("notebook edit requires a workspace")
	}
	path := strings.TrimSpace(input.Path)
	if path == "" {
		return nil, errors.New("notebook_path is required")
	}
	if filepath.Ext(path) != ".ipynb" {
		return nil, errors.New("notebook_path must end with .ipynb")
	}
	mode := strings.TrimSpace(input.EditMode)
	if mode == "" {
		mode = "replace"
	}
	switch mode {
	case "replace", "insert", "delete":
	default:
		return nil, fmt.Errorf("unsupported edit_mode %q", mode)
	}
	cellType := strings.TrimSpace(input.CellType)
	switch cellType {
	case "", "code", "markdown":
	default:
		return nil, fmt.Errorf("unsupported cell_type %q", cellType)
	}
	if mode == "insert" && cellType == "" {
		return nil, errors.New("cell_type is required for insert")
	}
	if mode != "insert" && strings.TrimSpace(input.CellID) == "" {
		return nil, errors.New("cell_id is required for replace and delete")
	}
	if mode == "delete" {
		input.Content = ""
	}

	text, err := files.Read(ctx, path)
	if err != nil {
		return nil, err
	}
	if !utf8.ValidString(text.Text) {
		return nil, errors.New("notebook is not valid UTF-8")
	}
	var document notebookDocument
	if err := json.Unmarshal([]byte(text.Text), &document); err != nil {
		return nil, fmt.Errorf("invalid notebook JSON: %w", err)
	}
	if document.Nbformat == 0 {
		return nil, errors.New("notebook nbformat is required")
	}

	cellID := strings.TrimSpace(input.CellID)
	index := -1
	if cellID != "" {
		for i, cell := range document.Cells {
			if cell.ID == cellID {
				index = i
				break
			}
		}
		if index < 0 {
			return nil, fmt.Errorf("cell_id %q was not found", cellID)
		}
	}

	resultID := cellID
	switch mode {
	case "replace":
		cell := document.Cells[index]
		if cellType != "" {
			cell.CellType = cellType
		}
		if cell.CellType == "" {
			cell.CellType = "code"
		}
		cell.Source = encodeNotebookSource(input.Content)
		if cell.CellType != "code" {
			cell.Outputs = nil
			cell.ExecutionCount = nil
		}
		document.Cells[index] = cell
	case "insert":
		cell := notebookCell{
			ID:       newNotebookCellID(),
			CellType: cellType,
			Metadata: json.RawMessage(`{}`),
			Source:   encodeNotebookSource(input.Content),
		}
		if cell.CellType == "code" {
			cell.Outputs = json.RawMessage(`[]`)
			cell.ExecutionCount = json.RawMessage(`null`)
		}
		resultID = cell.ID
		if index < 0 {
			document.Cells = append([]notebookCell{cell}, document.Cells...)
		} else {
			insertAt := index + 1
			document.Cells = append(document.Cells[:insertAt], append([]notebookCell{cell}, document.Cells[insertAt:]...)...)
		}
	case "delete":
		document.Cells = append(document.Cells[:index], document.Cells[index+1:]...)
	}

	raw, err := json.MarshalIndent(document, "", " ")
	if err != nil {
		return nil, err
	}
	raw = append(raw, '\n')
	receipt, err := files.Write(ctx, path, string(raw))
	if err != nil {
		return nil, err
	}
	return notebookEditReceipt{Path: receipt.Path, CellID: resultID, EditMode: mode, State: "applied"}, nil
}

func encodeNotebookSource(source string) json.RawMessage {
	if source == "" {
		raw, _ := json.Marshal([]string{})
		return raw
	}
	lines := strings.SplitAfter(source, "\n")
	if lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	raw, _ := json.Marshal(lines)
	return raw
}

func newNotebookCellID() string {
	var bytes [8]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return fmt.Sprintf("cell-%d", len(bytes))
	}
	return hex.EncodeToString(bytes[:])
}
