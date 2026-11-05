package harness

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
)

// toolProgress is turn-local advisory state, owned by the ordered tool-batch
// continuation. It never changes dispatch, success, or replay decisions.
type toolProgress struct {
	turn        int
	key         [32]byte
	result      [32]byte
	count       int
	patterns    toolProgressPatterns
	failures    toolFailureWindow
	diagnostics diagnosticProgress
	discovery   discoveryPhase
}

// Only transport timing is omitted from shell receipts. Actual stdout/stderr,
// exit state, failures and owned task identity remain part of the observation.
type toolProgressShell struct {
	Signal            string             `json:"signal,omitempty"`
	CleanupUncertain  bool               `json:"cleanupUncertain,omitempty"`
	OutputFile        string             `json:"output_file,omitempty"`
	OutputBytes       int64              `json:"output_bytes,omitempty"`
	OutputFilePartial bool               `json:"output_file_partial,omitempty"`
	Enforcement       json.RawMessage    `json:"enforcement,omitempty"`
	ReadIsolated      bool               `json:"readIsolated,omitempty"`
	NetworkIsolated   bool               `json:"networkIsolated,omitempty"`
	Stdout            json.RawMessage    `json:"stdout,omitempty"`
	Stderr            json.RawMessage    `json:"stderr,omitempty"`
	ExitCode          *int               `json:"exitCode,omitempty"`
	TimedOut          bool               `json:"timedOut,omitempty"`
	Aborted           bool               `json:"aborted,omitempty"`
	Status            string             `json:"status,omitempty"`
	TaskID            string             `json:"task_id,omitempty"`
	Error             string             `json:"error,omitempty"`
	Diagnostic        string             `json:"diagnostic,omitempty"`
	Result            *toolProgressShell `json:"result,omitempty"`
}

func (p *toolProgress) observe(turn int, call ContentBlock, result ToolResult) *DeferredContext {
	if p.turn != turn {
		*p = toolProgress{turn: turn}
	}
	advisory := p.discovery.observe(call)
	if failure := p.failures.observe(call, result); failure != nil {
		advisory = failure
	}
	if diagnostic := p.diagnostics.observe(call, result); diagnostic != nil {
		advisory = diagnostic
	}
	// Polling is governed by its existing cursor/wait contract. Mutations reset
	// the read chain, but do not erase recent failed experiments.
	switch call.Name {
	case "TaskOutput", "TaskStop", "TerminalRead", "terminal_read", "TerminalWrite", "terminal_write",
		"Write", "write_file", "Edit", "edit_file", "apply_patch", "NotebookEdit", "notebook_edit":
		*p = toolProgress{turn: turn, failures: p.failures, diagnostics: p.diagnostics, discovery: p.discovery}
		return advisory
	}
	var args any
	decoder := json.NewDecoder(bytes.NewReader(call.Arguments))
	decoder.UseNumber()
	if decoder.Decode(&args) != nil {
		*p = toolProgress{turn: turn, failures: p.failures, diagnostics: p.diagnostics, discovery: p.discovery}
		return advisory
	}
	arguments, _ := json.Marshal(args)
	key := sha256.Sum256(append(append([]byte(call.Name), 0), arguments...))
	observed := cloneContentBlocks(result.Content)
	for i := range observed {
		if observed[i].Type != BlockText {
			*p = toolProgress{turn: turn, failures: p.failures, diagnostics: p.diagnostics, discovery: p.discovery}
			return advisory
		}
		if call.Name == "Bash" || call.Name == "shell" {
			var receipt toolProgressShell
			if json.Unmarshal([]byte(observed[i].Text), &receipt) == nil && (receipt.Stdout != nil || receipt.Stderr != nil || receipt.ExitCode != nil || receipt.Result != nil || receipt.Error != "" || receipt.Status != "") {
				raw, _ := json.Marshal(receipt)
				observed[i].Text = string(raw)
			}
		}
	}
	raw, _ := json.Marshal(struct {
		Content []ContentBlock `json:"content"`
		Failed  bool           `json:"failed"`
	}{observed, result.IsError})
	fingerprint := sha256.Sum256(raw)
	pattern := p.patterns.observe(turn, call, key, fingerprint, result)
	if pattern == nil {
		pattern = advisory
	}
	if p.turn != turn || p.key != key || p.result != fingerprint {
		*p = toolProgress{turn: turn, key: key, result: fingerprint, count: 1, patterns: p.patterns, failures: p.failures, diagnostics: p.diagnostics, discovery: p.discovery}
		return pattern
	}
	p.count++
	if p.count != 3 && p.count != 5 && p.count != 8 {
		return pattern
	}
	source, _ := json.Marshal(struct {
		Kind         string     `json:"kind"`
		Tool         string     `json:"tool"`
		CallID       ToolCallID `json:"callId"`
		Count        int        `json:"count"`
		ResultSHA256 string     `json:"result_sha256"`
	}{"tool-progress-reminder", call.Name, call.ToolCallID, p.count, hex.EncodeToString(fingerprint[:])})
	return &DeferredContext{Role: RoleUser, Source: source, Content: []ContentBlock{{Type: BlockText,
		Text: fmt.Sprintf("The same tool call returned the same observed result %d times consecutively. Inspect that result and change approach if it shows no progress. Preserve changing reads and legitimate polling; reconcile uncertain effects before retrying.", p.count)}}}
}
