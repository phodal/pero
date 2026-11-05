package nativetools

import (
	"context"

	"github.com/phodal/pero/harness/go/fstools"
)

// Both profiles use the same bounded traversal and matching core. Literal
// search_files retains its original contract.
func genericSearchDefinitions(files *fstools.Workspace) []toolDefinition {
	return []toolDefinition{
		{"glob_files", "Find workspace-relative files by glob (**, ?, character classes and brace alternatives). Sorted paths; symlinks and .git skipped. At most 512 scanned entries and 64 results. offset is a zero-based result offset, limit at most 64. If scanning is truncated, narrow path/pattern.",
			`"pattern":{"type":"string","minLength":1,"maxLength":4096},"path":{"type":"string"},"offset":{"type":"integer","minimum":0},"limit":{"type":"integer","minimum":1,"maximum":64}`, `"pattern"`, false,
			func(ctx context.Context, input arguments) (any, error) {
				input.SearchOffset, input.HeadLimit = input.Offset, input.Limit
				return claudeGlob(ctx, workspaceFrom(ctx, files), input)
			}},
		{"regex_search", "Search workspace UTF-8 files with Go/RE2 regex (no lookaround/backreferences). Supports glob, ignore_case, multiline and content/files_with_matches/count modes (default files_with_matches). offset is zero-based, limit at most 64. Scans at most 512 entries and 8 MiB; narrow scope when traversal is truncated. Symlinks/.git skipped.",
			`"pattern":{"type":"string","minLength":1,"maxLength":4096},"path":{"type":"string"},"glob":{"type":"string","maxLength":4096},"ignore_case":{"type":"boolean"},"multiline":{"type":"boolean"},"output_mode":{"type":"string","enum":["content","files_with_matches","count"]},"offset":{"type":"integer","minimum":0},"limit":{"type":"integer","minimum":1,"maximum":64}`, `"pattern"`, false,
			func(ctx context.Context, input arguments) (any, error) {
				input.SearchOffset, input.HeadLimit = input.Offset, input.Limit
				return claudeGrep(ctx, workspaceFrom(ctx, files), input)
			}},
	}
}
