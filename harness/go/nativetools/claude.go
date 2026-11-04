package nativetools

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"

	"github.com/phodal/pero/harness/go/fstools"
)

// Claude arguments are converted once at the registration boundary. The
// original registry call still owns approval, cancellation and the tool receipt.
type claudeArguments struct {
	Patch              string `json:"patch"`
	FilePath           string `json:"file_path"`
	NotebookPath       string `json:"notebook_path"`
	Path               string `json:"path"`
	Content            string `json:"content"`
	NewSource          string `json:"new_source"`
	OldString          string `json:"old_string"`
	NewString          string `json:"new_string"`
	ReplaceAll         bool   `json:"replace_all"`
	Offset             int    `json:"offset"`
	Limit              int    `json:"limit"`
	Command            string `json:"command"`
	Workdir            string `json:"workdir"`
	Description        string `json:"description"`
	Timeout            int    `json:"timeout"`
	TerminateOnTimeout bool   `json:"terminate_on_timeout"`
	Pattern            string `json:"pattern"`
	Glob               string `json:"glob"`
	FileType           string `json:"type"`
	OutputMode         string `json:"output_mode"`
	IgnoreCase         bool   `json:"-i"`
	LineNumbers        *bool  `json:"-n"`
	Multiline          bool   `json:"multiline"`
	Before             int    `json:"-B"`
	After              int    `json:"-A"`
	Around             int    `json:"-C"`
	Context            int    `json:"context"`
	HeadLimit          int    `json:"head_limit"`
	RunInBackground    bool   `json:"run_in_background"`
	CellID             string `json:"cell_id"`
	CellType           string `json:"cell_type"`
	EditMode           string `json:"edit_mode"`
}

func decodeNativeArguments(raw json.RawMessage, workspace string, claude, allowResource bool, workspaceAliases ...string) (arguments, error) {
	if !claude {
		var value arguments
		err := json.Unmarshal(raw, &value)
		return value, err
	}
	var value claudeArguments
	if err := json.Unmarshal(raw, &value); err != nil {
		return arguments{}, err
	}
	selectedPath := value.Path
	resourcePath := ""
	if value.FilePath != "" {
		selectedPath = value.FilePath
	}
	if value.NotebookPath != "" {
		selectedPath = value.NotebookPath
	}
	content := value.Content
	if value.NewSource != "" || value.NotebookPath != "" {
		content = value.NewSource
	}
	if selectedPath != "" {
		if strings.ContainsRune(selectedPath, 0) {
			return arguments{}, errors.New("file path must not contain NUL")
		}
		if filepath.IsAbs(selectedPath) {
			// The launch path and its canonical descriptor path may differ, for
			// example macOS /var and /private/var. Both roots were selected by the
			// operator; symlinks below the root remain rejected by Workspace.
			var relative string
			for _, root := range append([]string{workspace}, workspaceAliases...) {
				candidate, err := filepath.Rel(root, selectedPath)
				if err == nil && filepath.IsLocal(candidate) {
					relative = candidate
					break
				}
			}
			if relative == "" && allowResource && value.FilePath != "" {
				resourcePath, selectedPath = filepath.Clean(selectedPath), ""
			} else if relative == "" {
				return arguments{}, errors.New("file path must stay inside the configured workspace")
			} else {
				selectedPath = relative
			}
		}
		if selectedPath != "" {
			selectedPath = filepath.Clean(selectedPath)
		}
		if selectedPath != "" && !filepath.IsLocal(selectedPath) {
			return arguments{}, errors.New("file path must stay inside the configured workspace")
		}
		selectedPath = filepath.ToSlash(selectedPath)
	}
	around := value.Around
	if value.Context != 0 {
		around = value.Context
	}
	return arguments{
		Patch: value.Patch,
		Path:  selectedPath, Content: content, OldText: value.OldString,
		NewText: value.NewString, ReplaceAll: value.ReplaceAll, Offset: value.Offset,
		Limit: value.Limit, Command: value.Command, Workdir: value.Workdir, TimeoutMS: value.Timeout,
		Pattern: value.Pattern, Glob: value.Glob, FileType: value.FileType,
		OutputMode: value.OutputMode, IgnoreCase: value.IgnoreCase, Multiline: value.Multiline,
		LineNumbers: value.LineNumbers, Before: value.Before, After: value.After,
		Around: around, HeadLimit: value.HeadLimit, SearchOffset: value.Offset, ResourcePath: resourcePath,
		RunInBackground: value.RunInBackground, Description: value.Description,
		TerminateOnTimeout: value.TerminateOnTimeout,
		CellID:             value.CellID, CellType: value.CellType, EditMode: value.EditMode,
	}, nil
}

// Profile selection replaces native definitions, rather than dispatching a
// second tool call through aliases. Read-only and Windows exclusions run first.
func claudeToolDefinition(definition toolDefinition, files *fstools.Workspace, resourceReader func(context.Context, string) (fstools.ScopedText, error)) toolDefinition {
	filePath := `"file_path":{"type":"string","minLength":1}`
	switch definition.name {
	case "notebook_read":
		definition.name = "NotebookRead"
		definition.properties = `"notebook_path":{"type":"string","minLength":1},"offset":{"type":"integer","minimum":1},"limit":{"type":"integer","minimum":1,"maximum":100}`
		definition.required = `"notebook_path"`
	case "read_file":
		definition.name = "Read"
		definition.description = "Read bounded UTF-8 text with line numbers, or PNG/JPEG/GIF/WebP images (at most 20 MiB source, 64 million pixels), normalized to PNG/JPEG at most 2048 pixels per side and 4 MiB. Animated images show the first frame only. Text-only models receive an explicit unread-pixels limitation. file_path may be absolute inside the configured workspace or workspace-relative; offset is 1-based for text. This tool does not render PDFs."
		if resourceReader != nil {
			definition.description += " Explicitly selected read-only plugin resource files can also be read as text."
		}
		definition.properties = filePath + `,"offset":{"type":"integer","minimum":1},"limit":{"type":"integer","minimum":1,"maximum":2000}`
		definition.required = `"file_path"`
		definition.run = func(ctx context.Context, input arguments) (any, error) {
			return readClaudeFile(ctx, workspaceFrom(ctx, files), resourceReader, input)
		}
	case "write_file":
		definition.name = "Write"
		definition.description = "Create or replace bounded UTF-8 text inside the configured workspace, creating missing parent directories. Requires approval."
		definition.properties = filePath + `,"content":{"type":"string","maxLength":1048576}`
		definition.required = `"file_path","content"`
		definition.run = func(ctx context.Context, input arguments) (any, error) {
			return workspaceFrom(ctx, files).WriteCreatingParents(ctx, input.Path, input.Content)
		}
	case "edit_file":
		definition.name = "Edit"
		definition.description = "Replace exact old_string with new_string in an existing workspace text file; the old string must match once unless replace_all is true. Requires approval."
		definition.properties = filePath + `,"old_string":{"type":"string","minLength":1,"maxLength":1048576},"new_string":{"type":"string","maxLength":1048576},"replace_all":{"type":"boolean"}`
		definition.required = `"file_path","old_string","new_string"`
	case "notebook_edit":
		definition.name = "NotebookEdit"
		definition.description = "Modify one cell in a UTF-8 Jupyter notebook (.ipynb). replace overwrites source, insert adds a cell after cell_id (or at the start), delete removes the cell. Requires approval."
		definition.properties = `"notebook_path":{"type":"string","minLength":1},"cell_id":{"type":"string"},"new_source":{"type":"string","maxLength":1048576},"cell_type":{"type":"string","enum":["code","markdown"]},"edit_mode":{"type":"string","enum":["replace","insert","delete"]}`
		definition.required = `"notebook_path","new_source"`
		definition.run = func(ctx context.Context, input arguments) (any, error) {
			return editNotebook(ctx, workspaceFrom(ctx, files), input)
		}
	case "list_directory":
		definition.name = "Glob"
		definition.description = "Find workspace files by relative glob pattern, including **, ?, character classes and brace alternatives. path selects a workspace directory. Results are sorted by path; symlinks and .git directories are skipped. Traversal and results are bounded and truncation is explicit."
		definition.properties = `"pattern":{"type":"string","minLength":1,"maxLength":4096},"path":{"type":"string"}`
		definition.required = `"pattern"`
		definition.run = func(ctx context.Context, input arguments) (any, error) {
			return claudeGlob(ctx, workspaceFrom(ctx, files), input)
		}
	case "search_files":
		definition.name = "Grep"
		definition.description = "Search workspace UTF-8 files with a Go/RE2 regular expression. Optional glob/type filters, case-insensitive and multiline matching, content/files_with_matches/count modes, context and pagination. Defaults to files_with_matches. At most 512 entries, 8 MiB text and 64 result records; symlinks/.git are skipped. Unsupported regex syntax returns an error."
		definition.properties = `"pattern":{"type":"string","minLength":1,"maxLength":4096},"path":{"type":"string"},"glob":{"type":"string","maxLength":4096},"type":{"type":"string"},"output_mode":{"type":"string","enum":["content","files_with_matches","count"]},"-i":{"type":"boolean"},"-n":{"type":"boolean"},"multiline":{"type":"boolean"},"-A":{"type":"integer","minimum":0,"maximum":20},"-B":{"type":"integer","minimum":0,"maximum":20},"-C":{"type":"integer","minimum":0,"maximum":20},"context":{"type":"integer","minimum":0,"maximum":20},"head_limit":{"type":"integer","minimum":0},"offset":{"type":"integer","minimum":0}`
		definition.required = `"pattern"`
		definition.run = func(ctx context.Context, input arguments) (any, error) {
			return claudeGrep(ctx, workspaceFrom(ctx, files), input)
		}
	case "shell":
		definition.name = "Bash"
		definition.description = "Run an approved shell command. Foreground timeout defaults to 120000ms; host timeout configuration sets the default and cap. A live command reaching its foreground timeout moves to the background, except sleep commands or when background execution is disabled. run_in_background starts detached immediately. Both return a durable task_id for TaskOutput/TaskStop. Unattended background runs default to 1800000ms and cap at 7200000ms, measured from entering the background; trusted host configuration may raise them. Interactive background runs have no deadline. Parent cancellation and retirement stop owned jobs; cold recovery never replays commands. The configured sandbox and existing approval policy apply to both forms."
		definition.description += " Output merges stdout/stderr: valid results inline up to 30000 characters by default, then output_file names a capped 64 MiB artifact with a 2000-character preview. Failure output is a bounded head/tail excerpt. TaskOutput separately exposes working_log_file for the original background log."
		definition.description += " Set workdir instead of using cd: relative paths resolve against the session workspace. Explicit workdir applies only to this invocation and does not change the remembered Bash directory."
		definition.description += " For bounded checks set a short timeout and terminate_on_timeout=true to stop the owned process instead of promoting it; cannot combine with run_in_background."
		definition.properties = `"command":{"type":"string","minLength":1,"maxLength":16384},"workdir":{"type":"string","minLength":1},"timeout":{"type":"integer","minimum":1},"terminate_on_timeout":{"type":"boolean"},"description":{"type":"string"},"run_in_background":{"type":"boolean"}`
		definition.required = `"command"`
	}
	return definition
}
