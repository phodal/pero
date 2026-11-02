package nativetools

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/shell"
)

const (
	bashDefaultInlineChars         = 30000
	bashFailureInlineChars         = 10000
	bashArtifactPreviewChars       = 2000
	bashArtifactBytes        int64 = 64 << 20
	bashMaximumReadbackChars       = 150000
	bashMaximumInlineChars         = 128000
)

// BashOutputOptions is trusted composition. A nonzero BashOutputMaxChars sizes
// both valid inline output and readback, ignoring BASH_MAX_OUTPUT_LENGTH.
// ReadbackChars is the typed equivalent of that environment setting.
type BashOutputOptions struct {
	ReadbackChars      int
	BashOutputMaxChars int
}

type bashOutputPolicy struct{ inlineChars, readbackChars int }

func resolveBashOutputPolicy(options BashOutputOptions, environment []string) (bashOutputPolicy, error) {
	if options.BashOutputMaxChars < 0 || options.BashOutputMaxChars > bashMaximumInlineChars {
		return bashOutputPolicy{}, errors.New("BashOutputMaxChars must be between 1 and 128000 when set")
	}
	if options.BashOutputMaxChars > 0 {
		return bashOutputPolicy{options.BashOutputMaxChars, options.BashOutputMaxChars}, nil
	}
	readback := options.ReadbackChars
	if readback < 0 || readback > bashMaximumReadbackChars {
		return bashOutputPolicy{}, errors.New("Bash readback must be between 1 and 150000 when set")
	}
	if readback == 0 {
		readback = bashDefaultInlineChars
		for _, entry := range environment {
			name, value, found := strings.Cut(entry, "=")
			if !found || name != "BASH_MAX_OUTPUT_LENGTH" {
				continue
			}
			n, err := strconv.ParseInt(value, 10, 64)
			if err != nil || n < 1 {
				return bashOutputPolicy{}, errors.New("BASH_MAX_OUTPUT_LENGTH must be a positive integer")
			}
			readback = int(min(n, int64(bashMaximumReadbackChars)))
		}
	}
	return bashOutputPolicy{bashDefaultInlineChars, readback}, nil
}

type bashPresentation struct {
	Text                string `json:"text"`
	Truncated           bool   `json:"truncated,omitempty"`
	ReadbackTruncated   bool   `json:"readback_truncated,omitempty"`
	OutputFile          string `json:"output_file,omitempty"`
	OutputFileBytes     int64  `json:"output_file_bytes,omitempty"`
	OutputFileTruncated bool   `json:"output_file_truncated,omitempty"`
}

type bashOutputProjection struct {
	bashPresentation
	artifact bool
}

// Character budgets count Unicode code points and never split UTF-8. Failure
// excerpts come from the readback window, rather than the entire working log.
func projectBashOutput(policy bashOutputPolicy, source []rune, success bool) bashOutputProjection {
	window := source[:min(len(source), policy.readbackChars)]
	projection := bashOutputProjection{bashPresentation: bashPresentation{ReadbackTruncated: len(source) > len(window)}}
	projection.Truncated = projection.ReadbackTruncated
	if success {
		projection.artifact = len(source) > policy.inlineChars
		if projection.artifact {
			window = window[:min(len(window), bashArtifactPreviewChars)]
			projection.Truncated = true
		}
		projection.Text = string(window)
		return projection
	}
	if len(window) > bashFailureInlineChars {
		const separator = "\n...\n"
		head := (bashFailureInlineChars - len([]rune(separator))) / 2
		tail := bashFailureInlineChars - len([]rune(separator)) - head
		projection.Text = string(window[:head]) + separator + string(window[len(window)-tail:])
		projection.Truncated = true
	} else {
		projection.Text = string(window)
	}
	return projection
}

func (p bashOutputPolicy) readPrefix(source io.Reader) ([]rune, error) {
	reader := bufio.NewReader(source)
	limit := max(p.inlineChars, p.readbackChars) + 1
	characters := make([]rune, 0, limit)
	for len(characters) < limit {
		r, _, err := reader.ReadRune()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, err
		}
		characters = append(characters, r)
	}
	return characters, nil
}

func (s *shellTasks) presentCapture(task *shellTask, success bool) (*bashPresentation, error) {
	source := io.NewSectionReader(task.capture, 0, task.capture.Bytes())
	characters, err := s.outputPolicy.readPrefix(source)
	if err != nil {
		return nil, err
	}
	projection := projectBashOutput(s.outputPolicy, characters, success)
	if !projection.artifact {
		return &projection.bashPresentation, nil
	}
	if task.executor == nil {
		return nil, errors.New("Bash output artifact requires its original workspace authority")
	}
	if err := task.executor.CheckCWD(task.intent.Workdir); err != nil {
		return nil, fmt.Errorf("Bash output artifact workspace changed: %w", err)
	}
	plan, err := shell.PlanOutputFile(s.options.CWD, ".pero/bash-artifacts", task.intent.ID+".txt", bashArtifactBytes)
	if err != nil {
		return nil, err
	}
	artifact := &shell.FileCapture{}
	if err := artifact.Open(plan); err != nil {
		return nil, fmt.Errorf("save Bash output artifact: %w", err)
	}
	bytes, err := utf8ArtifactPrefix(task.capture, min(task.capture.Bytes(), bashArtifactBytes))
	if err != nil {
		return nil, errors.Join(err, artifact.Close(false))
	}
	if _, err := io.CopyN(artifact, io.NewSectionReader(task.capture, 0, bytes), bytes); err != nil {
		return nil, errors.Join(err, artifact.Close(false))
	}
	if err := artifact.Close(true); err != nil {
		return nil, fmt.Errorf("persist Bash output artifact: %w", err)
	}
	projection.OutputFile, projection.OutputFileBytes = plan.Path(), bytes
	projection.OutputFileTruncated = task.capture.Bytes() > bytes
	return &projection.bashPresentation, nil
}

func utf8ArtifactPrefix(source io.ReaderAt, bytes int64) (int64, error) {
	start := max(int64(0), bytes-utf8.UTFMax)
	tail := make([]byte, bytes-start)
	if _, err := source.ReadAt(tail, start); err != nil && !errors.Is(err, io.EOF) {
		return 0, err
	}
	if len(tail) == 0 {
		return bytes, nil
	}
	position := len(tail) - 1
	for position > 0 && !utf8.RuneStart(tail[position]) {
		position--
	}
	if utf8.RuneStart(tail[position]) && !utf8.FullRune(tail[position:]) {
		return start + int64(position), nil
	}
	return bytes, nil
}

type bashPresentedResult struct {
	shell.RunResult
	TotalOutputBytes    int64 `json:"total_output_bytes,omitempty"`
	ReadbackTruncated   bool  `json:"readback_truncated,omitempty"`
	OutputFileTruncated bool  `json:"output_file_truncated,omitempty"`
}

func presentedBashResult(result shell.RunResult, presentation *bashPresentation) bashPresentedResult {
	view := bashPresentedResult{RunResult: result, TotalOutputBytes: result.OutputBytes}
	// The working log is audit state, not a successful returned artifact.
	view.OutputFile, view.OutputBytes, view.OutputFilePartial = "", 0, false
	if presentation != nil {
		view.Stdout = shell.CollectedOutput{Text: presentation.Text, Truncated: presentation.Truncated}
		view.Stderr = shell.CollectedOutput{}
		view.OutputFile, view.OutputBytes = presentation.OutputFile, presentation.OutputFileBytes
		view.ReadbackTruncated, view.OutputFileTruncated = presentation.ReadbackTruncated, presentation.OutputFileTruncated
	}
	return view
}

// The ordinary native renderer's 4 KiB tails and encoded-byte fallback cannot
// replace this profile's explicit Unicode character budgets.
func renderBashResult(result shell.RunResult, presentation *bashPresentation, operationErr error) (harness.ToolResult, error) {
	view := presentedBashResult(result, presentation)
	var value any = view
	if operationErr != nil {
		value = struct {
			Result bashPresentedResult `json:"result"`
			Error  string              `json:"error"`
		}{view, boundedText(operationErr.Error(), 1024)}
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return harness.ToolResult{}, err
	}
	return harness.ToolResult{IsError: operationErr != nil, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: string(raw)}}}, nil
}
