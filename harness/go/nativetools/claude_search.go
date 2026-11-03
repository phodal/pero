package nativetools

import (
	"context"
	"errors"
	"fmt"
	"path"
	"regexp"
	"sort"
	"strings"

	"github.com/phodal/pero/harness/go/fstools"
)

const claudeResultLimit = 64

type claudeGlobResult struct {
	Files          []string `json:"files"`
	ScannedEntries int      `json:"scanned_entries"`
	Truncated      bool     `json:"truncated"`
	NextOffset     int      `json:"next_offset,omitempty"`
}

type claudeGrepMatch struct {
	Path    string `json:"path"`
	Line    *int   `json:"line,omitempty"`
	Text    string `json:"text"`
	Matched bool   `json:"matched"`
}

type claudeGrepCount struct {
	Path  string `json:"path"`
	Count int    `json:"count"`
}

type claudeGrepResult struct {
	OutputMode   string            `json:"output_mode"`
	Files        []string          `json:"files,omitempty"`
	Matches      []claudeGrepMatch `json:"matches,omitempty"`
	Counts       []claudeGrepCount `json:"counts,omitempty"`
	ScannedFiles int               `json:"scanned_files"`
	SkippedFiles int               `json:"skipped_files"`
	Truncated    bool              `json:"truncated"`
}

type claudeTraversal struct {
	Entries   int
	Truncated bool
}

// Every directory and text read uses the original descriptor-rooted authority.
// A visitor can stop after observing the first record beyond its output bound.
func walkClaudeFiles(ctx context.Context, files *fstools.Workspace, base string, visit func(string) (bool, error)) (claudeTraversal, error) {
	var result claudeTraversal
	if base == "" {
		base = "."
	}
	pending := []string{base}
	for len(pending) > 0 {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		directory := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		listing, err := files.List(ctx, directory)
		if err != nil {
			return result, err
		}
		result.Truncated = result.Truncated || listing.Truncated
		var directories []string
		for _, entry := range listing.Entries {
			result.Entries++
			if result.Entries > 512 {
				result.Truncated = true
				return result, nil
			}
			if entry.Symlink {
				continue
			}
			name := path.Join(directory, entry.Name)
			if entry.Directory {
				if entry.Name != ".git" {
					directories = append(directories, name)
				}
				continue
			}
			more, err := visit(name)
			if err != nil || !more {
				return result, err
			}
		}
		for i := len(directories) - 1; i >= 0; i-- {
			pending = append(pending, directories[i])
		}
	}
	return result, nil
}

func claudeGlob(ctx context.Context, files *fstools.Workspace, input arguments) (claudeGlobResult, error) {
	result := claudeGlobResult{Files: []string{}}
	patterns, err := compileClaudeGlobs(input.Pattern)
	if err != nil {
		return result, err
	}
	base := input.Path
	if base == "" {
		base = "."
	}
	traversal, err := walkClaudeFiles(ctx, files, base, func(name string) (bool, error) {
		relative := strings.TrimPrefix(name, base+"/")
		if base == "." {
			relative = name
		}
		if matchesClaudeGlobs(patterns, relative) {
			result.Files = append(result.Files, name)
		}
		return true, nil
	})
	result.ScannedEntries, result.Truncated = traversal.Entries, traversal.Truncated
	sort.Strings(result.Files)
	limit := claudeResultLimit
	if input.HeadLimit > 0 {
		limit = min(limit, input.HeadLimit)
	}
	start := min(max(0, input.SearchOffset), len(result.Files))
	end := min(start+limit, len(result.Files))
	if end < len(result.Files) {
		result.NextOffset = end
		result.Truncated = true
	}
	result.Files = result.Files[start:end]
	return result, err
}

func claudeGrep(ctx context.Context, files *fstools.Workspace, input arguments) (claudeGrepResult, error) {
	result := claudeGrepResult{OutputMode: input.OutputMode}
	if err := ctx.Err(); err != nil {
		return result, err
	}
	if result.OutputMode == "" {
		result.OutputMode = "files_with_matches"
	}
	if result.OutputMode != "content" && result.OutputMode != "files_with_matches" && result.OutputMode != "count" {
		return result, errors.New("output_mode must be content, files_with_matches or count")
	}
	if input.Pattern == "" || len(input.Pattern) > 4096 {
		return result, errors.New("pattern must be a regular expression of 1..4096 bytes")
	}
	pattern := input.Pattern
	if input.IgnoreCase {
		pattern = "(?i)" + pattern
	}
	if input.Multiline {
		pattern = "(?ms)" + pattern
	}
	expression, err := regexp.Compile(pattern)
	if err != nil {
		return result, fmt.Errorf("invalid or unsupported Go/RE2 regular expression: %w", err)
	}
	var globs []string
	if input.Glob != "" {
		glob := input.Glob
		if !strings.Contains(glob, "/") {
			glob = "**/" + glob
		}
		globs, err = compileClaudeGlobs(glob)
		if err != nil {
			return result, err
		}
	}
	typeGlobs, err := claudeTypeGlobs(input.FileType)
	if err != nil {
		return result, err
	}
	limit := claudeResultLimit
	if input.HeadLimit > 0 && input.HeadLimit < limit {
		limit = input.HeadLimit
	}
	before, after := input.Before, input.After
	if input.Around > 0 {
		before, after = input.Around, input.Around
	}
	seen, emitted, totalBytes := 0, 0, 0
	admit := func() (bool, bool) {
		if seen < input.SearchOffset {
			seen++
			return false, true
		}
		seen++
		if emitted >= limit {
			result.Truncated = true
			return false, false
		}
		emitted++
		return true, true
	}
	base := input.Path
	if base == "" {
		base = "."
	}
	visit := func(name string, direct bool) (bool, error) {
		relative := strings.TrimPrefix(name, base+"/")
		if base == "." || direct {
			relative = name
		}
		if (len(globs) > 0 && !matchesClaudeGlobs(globs, relative)) || (len(typeGlobs) > 0 && !matchesClaudeGlobs(typeGlobs, name)) {
			return true, nil
		}
		text, err := files.Read(ctx, name)
		if err != nil {
			if direct {
				return false, err
			}
			if err := ctx.Err(); err != nil {
				return false, err
			}
			if err := files.CheckCWD(files.Path()); err != nil {
				return false, err
			}
			result.SkippedFiles++
			return true, nil
		}
		result.ScannedFiles++
		totalBytes += len(text.Text)
		if totalBytes > 8*fstools.MaxFileBytes {
			result.Truncated = true
			return false, nil
		}
		lines, matched := matchingClaudeLines(expression, text.Text, input.Multiline)
		if len(matched) == 0 {
			return true, nil
		}
		if result.OutputMode != "content" {
			keep, more := admit()
			if keep && result.OutputMode == "count" {
				result.Counts = append(result.Counts, claudeGrepCount{Path: name, Count: len(matched)})
			} else if keep {
				result.Files = append(result.Files, name)
			}
			return more, nil
		}
		matchSet, display := make([]bool, len(lines)), make([]bool, len(lines))
		for _, line := range matched {
			matchSet[line] = true
			for i := max(0, line-before); i <= min(len(lines)-1, line+after); i++ {
				display[i] = true
			}
		}
		for i, line := range lines {
			if !display[i] {
				continue
			}
			keep, more := admit()
			if !more {
				return false, nil
			}
			if keep {
				match := claudeGrepMatch{Path: name, Text: boundedText(strings.TrimSuffix(line, "\r"), 512), Matched: matchSet[i]}
				if len(line) > 512 {
					result.Truncated = true
				}
				if input.LineNumbers == nil || *input.LineNumbers {
					number := i + 1
					match.Line = &number
				}
				result.Matches = append(result.Matches, match)
			}
		}
		return true, nil
	}
	if _, err := files.List(ctx, base); err != nil {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		if err := files.CheckCWD(files.Path()); err != nil {
			return result, err
		}
		_, readErr := visit(base, true)
		return result, readErr
	}
	traversal, err := walkClaudeFiles(ctx, files, base, func(name string) (bool, error) { return visit(name, false) })
	result.Truncated = result.Truncated || traversal.Truncated
	return result, err
}

func matchingClaudeLines(expression *regexp.Regexp, text string, multiline bool) ([]string, []int) {
	lines := strings.Split(text, "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	var matched []int
	if !multiline {
		for i, line := range lines {
			if expression.MatchString(line) {
				matched = append(matched, i)
			}
		}
		return lines, matched
	}
	starts := make([]int, len(lines))
	for i := 1; i < len(lines); i++ {
		starts[i] = starts[i-1] + len(lines[i-1]) + 1
	}
	selected := make([]bool, len(lines))
	for _, span := range expression.FindAllStringIndex(text, -1) {
		start := sort.Search(len(starts), func(i int) bool { return starts[i] > span[0] }) - 1
		end := sort.Search(len(starts), func(i int) bool { return starts[i] > max(span[0], span[1]-1) }) - 1
		for i := max(0, start); i <= end && i < len(lines); i++ {
			selected[i] = true
		}
	}
	for i, selected := range selected {
		if selected {
			matched = append(matched, i)
		}
	}
	return lines, matched
}

func compileClaudeGlobs(pattern string) ([]string, error) {
	if pattern == "" || len(pattern) > 4096 || strings.HasPrefix(pattern, "/") {
		return nil, errors.New("glob must be a relative pattern of 1..4096 bytes; choose the directory with path")
	}
	pattern = strings.TrimPrefix(pattern, "./")
	patterns := []string{pattern}
	for i := 0; i < len(patterns); {
		value := patterns[i]
		left := strings.IndexByte(value, '{')
		if left < 0 {
			i++
			continue
		}
		right := strings.IndexByte(value[left:], '}')
		if right < 0 {
			return nil, errors.New("glob has an unclosed brace alternative")
		}
		right += left
		alternatives := strings.Split(value[left+1:right], ",")
		if len(alternatives) < 2 || strings.Contains(value[left+1:right], "{") {
			return nil, errors.New("glob braces require comma-separated, non-nested alternatives")
		}
		patterns = append(patterns[:i], patterns[i+1:]...)
		for _, alternative := range alternatives {
			patterns = append(patterns, value[:left]+alternative+value[right+1:])
		}
		if len(patterns) > 32 {
			return nil, errors.New("glob supports at most 32 brace alternatives")
		}
	}
	for _, value := range patterns {
		for _, segment := range strings.Split(value, "/") {
			if segment == ".." || segment == "" {
				return nil, errors.New("glob must not contain empty or parent-directory segments")
			}
			if _, err := path.Match(segment, ""); err != nil {
				return nil, errors.New("glob has an invalid wildcard or character class")
			}
		}
	}
	return patterns, nil
}

func matchesClaudeGlobs(patterns []string, name string) bool {
	for _, pattern := range patterns {
		parts, names := strings.Split(pattern, "/"), strings.Split(name, "/")
		type position struct{ pattern, name int }
		seen, matched := make(map[position]bool), make(map[position]bool)
		var match func(int, int) bool
		match = func(p, n int) bool {
			key := position{p, n}
			if seen[key] {
				return matched[key]
			}
			seen[key] = true
			ok := false
			if p == len(parts) {
				ok = n == len(names)
			} else if parts[p] == "**" {
				ok = match(p+1, n) || (n < len(names) && match(p, n+1))
			} else if n < len(names) {
				segment, _ := path.Match(parts[p], names[n])
				ok = segment && match(p+1, n+1)
			}
			matched[key] = ok
			return ok
		}
		if match(0, 0) {
			return true
		}
	}
	return false
}

func claudeTypeGlobs(fileType string) ([]string, error) {
	var extensions []string
	switch fileType {
	case "":
		return nil, nil
	case "go":
		extensions = []string{"go"}
	case "js":
		extensions = []string{"js", "jsx", "mjs", "cjs"}
	case "ts":
		extensions = []string{"ts", "tsx", "mts", "cts"}
	case "py", "python":
		extensions = []string{"py", "pyi"}
	case "rust":
		extensions = []string{"rs"}
	case "c":
		extensions = []string{"c", "h"}
	case "cpp":
		extensions = []string{"cpp", "cc", "cxx", "hpp", "h"}
	case "java", "json", "css", "html", "toml", "sh", "swift", "xml":
		extensions = []string{fileType}
	case "md", "markdown":
		extensions = []string{"md", "markdown"}
	case "yaml":
		extensions = []string{"yaml", "yml"}
	default:
		return nil, errors.New("unsupported file type; use glob to select file extensions")
	}
	patterns := make([]string, len(extensions))
	for i, extension := range extensions {
		patterns[i] = "**/*." + extension
	}
	return patterns, nil
}
