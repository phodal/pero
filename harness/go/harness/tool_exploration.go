package harness

import "encoding/json"

// discoveryPhase observes consecutive native discovery operations, including
// changing queries. It is advisory, not a tool budget or a requirement to edit.
type discoveryPhase struct{ calls int }

func (p *discoveryPhase) observe(call ContentBlock) *DeferredContext {
	switch call.Name {
	case "Read", "read_file", "Glob", "list_directory", "Grep", "search_files",
		"LSP", "ToolSearch", "WebFetch", "WebSearch", "NotebookRead", "notebook_read":
		p.calls++
	default:
		p.calls = 0
		return nil
	}
	if p.calls != 16 {
		return nil
	}
	source, _ := json.Marshal(struct {
		Kind   string     `json:"kind"`
		CallID ToolCallID `json:"callId"`
		Count  int        `json:"count"`
	}{"tool-exploration-reminder", call.ToolCallID, p.calls})
	return &DeferredContext{Role: RoleUser, Source: source, Content: []ContentBlock{{Type: BlockText, Text: "You have made 16 consecutive read/search/discovery calls. Summarize what the evidence establishes and identify the specific missing fact before exploring further. For an implementation task, consider a focused change and targeted verification once there is enough evidence; for a research or review task, synthesize the findings without making unnecessary edits. Continue discovery when the remaining question requires it. This reminder does not limit requests or authorize changes."}}}
}
