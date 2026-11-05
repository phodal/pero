package tool

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"

	"github.com/phodal/pero/harness/go/model"
)

// Diagnostic is an observation of returned text, not an authoritative cause or
// a validation verdict. Fingerprints cover complete visible diagnostic text;
// changing diagnostics must never be reported as unchanged.
type Diagnostic struct {
	Category      string `json:"category,omitempty"`
	Fingerprint   string `json:"diagnostic_sha256,omitempty"`
	CommandSHA256 string `json:"command_sha256,omitempty"`
	ExitCode      *int   `json:"exit_code,omitempty"`
	Settled       bool   `json:"settled"`
	Failed        bool   `json:"failed"`
	Hint          string `json:"hint,omitempty"`
	// Deduplicable excludes incomplete/spilled output and task identities.
	Deduplicable bool `json:"-"`
}

type diagnosticReceipt struct {
	Stdout           json.RawMessage    `json:"stdout"`
	Stderr           json.RawMessage    `json:"stderr"`
	ExitCode         *int               `json:"exitCode"`
	TimedOut         bool               `json:"timedOut"`
	Aborted          bool               `json:"aborted"`
	CleanupUncertain bool               `json:"cleanupUncertain"`
	Signal           string             `json:"signal"`
	Status           string             `json:"status"`
	TaskID           string             `json:"task_id"`
	OutputFile       string             `json:"output_file"`
	OutputPartial    bool               `json:"output_file_partial"`
	Error            string             `json:"error"`
	Diagnostic       string             `json:"diagnostic"`
	Result           *diagnosticReceipt `json:"result"`
}

func diagnosticHash(text string) string {
	hash := sha256.Sum256([]byte(text))
	return hex.EncodeToString(hash[:])
}

func diagnosticText(raw json.RawMessage) string {
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return text
	}
	var block struct {
		Text string `json:"text"`
	}
	_ = json.Unmarshal(raw, &block)
	return block.Text
}

func ObserveDiagnostic(name string, arguments json.RawMessage, content []model.ContentBlock, isError bool) Diagnostic {
	var args struct {
		Command string `json:"command"`
	}
	_ = json.Unmarshal(arguments, &args)
	d := Diagnostic{}
	if args.Command != "" {
		d.CommandSHA256 = diagnosticHash(strings.TrimSpace(args.Command))
	}
	if len(content) != 1 || content[0].Type != model.BlockText {
		return d
	}
	text := content[0].Text
	if name == "Bash" || name == "shell" {
		var r diagnosticReceipt
		if json.Unmarshal([]byte(text), &r) != nil {
			return d
		}
		uncertain := r.uncertain()
		identity := r.TaskID != "" || r.OutputFile != "" || r.OutputPartial
		if r.Result != nil {
			r = *r.Result
			uncertain = uncertain || r.uncertain()
			identity = identity || r.TaskID != "" || r.OutputFile != "" || r.OutputPartial
		}
		d.ExitCode = r.ExitCode
		if r.ExitCode == nil || uncertain || r.Status == "running" || r.Status == "starting" {
			return d
		}
		d.Settled, d.Failed = true, isError || *r.ExitCode != 0
		// Exclude transport duration, retaining exact stdout/stderr, exit and
		// error text. No diagnostic lines or changing numbers are discarded.
		raw, _ := json.Marshal(struct {
			Stdout, Stderr    json.RawMessage
			Error, Diagnostic string
			ExitCode          int
		}{r.Stdout, r.Stderr, r.Error, r.Diagnostic, *r.ExitCode})
		text = diagnosticText(r.Stdout) + "\n" + diagnosticText(r.Stderr) + "\n" + r.Error + "\n" + r.Diagnostic
		if strings.TrimSpace(text) != "" {
			d.Fingerprint = diagnosticHash(string(raw))
		}
		d.Deduplicable = d.Failed && !identity && d.CommandSHA256 != "" && d.Fingerprint != "" && completeDiagnosticReceipt([]byte(content[0].Text))
	} else if isError {
		d.Settled, d.Failed, d.Fingerprint = true, true, diagnosticHash(text)
	}
	if !d.Failed {
		return d
	}
	lower := strings.ToLower(text)
	switch {
	case strings.Contains(lower, "rosetta") || strings.Contains(lower, "exec format error") || strings.Contains(lower, "function not implemented"):
		d.Category, d.Hint = "platform", "Check architecture and supported system calls against the actual runtime; repeated code edits may not resolve this environment diagnostic."
	case strings.Contains(lower, "permission denied") || strings.Contains(lower, "operation not permitted"):
		d.Category, d.Hint = "permission", "Inspect the denied path or operation and existing permissions; do not expand authority or repeat uncertain mutations."
	case strings.Contains(lower, "command not found") || strings.Contains(lower, "no module named") || strings.Contains(lower, "not recognized as"):
		d.Category, d.Hint = "missing-dependency", "Check the exact executable/module and configured environment before retrying; use the project's documented setup within existing authority."
	case strings.Contains(lower, "syntax error") || strings.Contains(lower, "unexpected eof") || strings.Contains(lower, "unterminated"):
		d.Category, d.Hint = "syntax", "Inspect quoting and syntax at the reported location; use a small complete file edit rather than growing shell-embedded source."
	case strings.Contains(lower, "assertionerror") || strings.Contains(lower, "assertion failed") || strings.Contains(lower, "failed test") || strings.Contains(lower, "failures=") || strings.Contains(lower, "test failed"):
		d.Category, d.Hint = "assertion", "Reconcile the failing assertion with the public specification and current implementation; preserve independent test expectations."
	case strings.Contains(lower, "error:") || strings.Contains(lower, "compilation failed") || strings.Contains(lower, "undefined reference"):
		d.Category, d.Hint = "compiler", "Inspect the first relevant compiler/linker diagnostic, make a focused change and rerun the same check."
	case strings.Contains(lower, "old_text") || strings.Contains(lower, "old_string") || strings.Contains(lower, "schema") || strings.Contains(lower, "invalid argument"):
		d.Category, d.Hint = "tool-input", "Read the current file or declared input schema and correct the next complete call; do not blindly replay the rejected arguments."
	default:
		d.Category, d.Hint = "unclassified", "Inspect the actual returned diagnostic before retrying; a nonzero exit alone does not identify the cause."
	}
	return d
}

// Only the known complete foreground receipt is eligible for projection.
// Unknown receipt fields, nested process identities and truncated streams retain
// their full context rather than equating their visible previews.
func completeDiagnosticReceipt(raw []byte) bool {
	var r struct {
		Stdout           json.RawMessage `json:"stdout"`
		Stderr           json.RawMessage `json:"stderr"`
		ExitCode         *int            `json:"exitCode"`
		TimedOut         bool            `json:"timedOut"`
		Aborted          bool            `json:"aborted"`
		CleanupUncertain bool            `json:"cleanupUncertain"`
		Signal           string          `json:"signal"`
		ReadIsolated     bool            `json:"readIsolated"`
		NetworkIsolated  bool            `json:"networkIsolated"`
		Enforcement      json.RawMessage `json:"enforcement"`
		DurationMS       float64         `json:"durationMs"`
		ElapsedMS        float64         `json:"elapsed_ms"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&r) != nil || r.ExitCode == nil {
		return false
	}
	for _, stream := range []json.RawMessage{r.Stdout, r.Stderr} {
		if len(stream) == 0 || string(stream) == "null" {
			continue
		}
		var text string
		if json.Unmarshal(stream, &text) == nil {
			continue
		}
		var output struct {
			Text      string `json:"text"`
			Truncated bool   `json:"truncated"`
		}
		d := json.NewDecoder(bytes.NewReader(stream))
		d.DisallowUnknownFields()
		if d.Decode(&output) != nil || output.Truncated {
			return false
		}
	}
	return true
}

func (r diagnosticReceipt) uncertain() bool {
	return r.TimedOut || r.Aborted || r.CleanupUncertain || r.Signal != "" || r.Status != "" && r.Status != "completed"
}
