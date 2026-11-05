package harness

import (
	"encoding/json"
	"fmt"

	"github.com/phodal/pero/harness/go/tool"
)

type diagnosticSample struct {
	fingerprint, category, command string
	edits                          int
}
type diagnosticProgress struct {
	window []diagnosticSample
	edits  int
}

func (p *diagnosticProgress) observe(call ContentBlock, result ToolResult) *DeferredContext {
	switch call.Name {
	case "Write", "write_file", "Edit", "edit_file", "apply_patch", "NotebookEdit", "notebook_edit":
		p.edits++
	}
	d := tool.ObserveDiagnostic(call.Name, call.Arguments, result.Content, result.IsError)
	if d.Settled && !d.Failed && d.CommandSHA256 != "" {
		for i, s := range p.window {
			if s.command == d.CommandSHA256 {
				p.window[i] = diagnosticSample{}
			}
		}
	}
	sample := diagnosticSample{edits: p.edits}
	if d.Failed {
		sample.fingerprint, sample.category, sample.command = d.Fingerprint, d.Category, d.CommandSHA256
	}
	p.window = append(p.window, sample)
	if len(p.window) > 24 {
		p.window = p.window[1:]
	}
	if !d.Failed || !d.Settled || d.Fingerprint == "" {
		return nil
	}
	count, categoryCount, firstEdits := 0, 0, p.edits
	for _, s := range p.window {
		if s.fingerprint == d.Fingerprint {
			if count == 0 {
				firstEdits = s.edits
			}
			count++
		}
		if s.category == d.Category {
			categoryCount++
		}
	}
	specific := d.Category == "missing-dependency" || d.Category == "platform" || d.Category == "permission" || d.Category == "tool-input"
	if count != 3 && count != 6 && !(specific && categoryCount == 1) {
		return nil
	}
	source, _ := json.Marshal(struct {
		Kind       string          `json:"kind"`
		CallID     ToolCallID      `json:"callId"`
		Count      int             `json:"count"`
		EditCalls  int             `json:"intervening_edit_calls"`
		Diagnostic tool.Diagnostic `json:"diagnostic"`
	}{"tool-diagnostic-reminder", call.ToolCallID, count, p.edits - firstEdits, d})
	return &DeferredContext{Role: RoleUser, Source: source, Content: []ContentBlock{{Type: BlockText, Text: fmt.Sprintf("Diagnostic text suggests %s. The same visible diagnostic has appeared %d times within recent operations, with %d intervening file-edit calls. %s These observations do not establish unchanged files or a failed public requirement; compare current inputs and independent verification before another broad change.", d.Category, count, p.edits-firstEdits, d.Hint)}}}
}
