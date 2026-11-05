package shell

import (
	"bufio"
	"errors"
	"io"
	"strconv"
	"strings"
	"unicode/utf8"
)

const (
	ClaudeInlineChars                = 30000
	ClaudeFailureInlineChars         = 10000
	ClaudePreviewChars               = 2000
	ClaudeMaximumReadbackChars       = 150000
	ClaudeArtifactBytes        int64 = 64 << 20
)

// ClaudeCommandProjection is the character budget shared by Bash results and
// skill command substitution. Counts are Unicode code points.
type ClaudeCommandProjection struct {
	Text              string
	Truncated         bool
	ReadbackTruncated bool
	Artifact          bool
}

// ResolveClaudeReadback applies BASH_MAX_OUTPUT_LENGTH. The inline budget
// stays at ClaudeInlineChars unless a caller overrides both.
func ResolveClaudeReadback(environment []string) (int, error) {
	readback := ClaudeInlineChars
	for _, entry := range environment {
		name, value, found := strings.Cut(entry, "=")
		if !found || name != "BASH_MAX_OUTPUT_LENGTH" {
			continue
		}
		n, err := strconv.ParseInt(value, 10, 64)
		if err != nil || n < 1 {
			return 0, errors.New("BASH_MAX_OUTPUT_LENGTH must be a positive integer")
		}
		readback = int(min(n, int64(ClaudeMaximumReadbackChars)))
	}
	return readback, nil
}

// ProjectClaudeCommandOutput windows source to the readback budget. Success
// above the inline budget keeps a short prefix and asks for an artifact.
// Failure excerpts stay inside the readback window.
func ProjectClaudeCommandOutput(source []rune, inlineChars, readbackChars int, success bool) ClaudeCommandProjection {
	window := source[:min(len(source), readbackChars)]
	projection := ClaudeCommandProjection{ReadbackTruncated: len(source) > len(window), Truncated: len(source) > len(window)}
	if success {
		projection.Artifact = len(source) > inlineChars
		if projection.Artifact {
			window = window[:min(len(window), ClaudePreviewChars)]
			projection.Truncated = true
		}
		projection.Text = string(window)
		return projection
	}
	if len(window) > ClaudeFailureInlineChars {
		const separator = "\n...\n"
		head := (ClaudeFailureInlineChars - len([]rune(separator))) / 2
		tail := ClaudeFailureInlineChars - len([]rune(separator)) - head
		projection.Text = string(window[:head]) + separator + string(window[len(window)-tail:])
		projection.Truncated = true
		return projection
	}
	projection.Text = string(window)
	return projection
}

// ClaudeOutputReadLimit is one past the larger budget so a projection can see
// that more output exists without loading the artifact.
func ClaudeOutputReadLimit(inlineChars, readbackChars int) int {
	return max(inlineChars, readbackChars) + 1
}

// ReadClaudeOutputRunes reads at most limit Unicode code points.
func ReadClaudeOutputRunes(source io.Reader, limit int) ([]rune, error) {
	reader := bufio.NewReader(source)
	characters := make([]rune, 0, min(limit, 4096))
	for len(characters) < limit {
		character, _, err := reader.ReadRune()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, err
		}
		characters = append(characters, character)
	}
	return characters, nil
}

// UTF8PrefixLength returns the longest valid UTF-8 prefix that fits in maximum.
func UTF8PrefixLength(source io.ReaderAt, maximum int64) (int64, error) {
	if maximum <= 0 {
		return 0, nil
	}
	start := max(int64(0), maximum-int64(utf8.UTFMax))
	tail := make([]byte, maximum-start)
	n, err := source.ReadAt(tail, start)
	if err != nil && !errors.Is(err, io.EOF) {
		return 0, err
	}
	tail = tail[:n]
	if len(tail) == 0 {
		return maximum, nil
	}
	position := len(tail) - 1
	for position > 0 && !utf8.RuneStart(tail[position]) {
		position--
	}
	if utf8.RuneStart(tail[position]) && !utf8.FullRune(tail[position:]) {
		return start + int64(position), nil
	}
	return maximum, nil
}
