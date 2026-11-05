package harness

import (
	"encoding/json"
	"sort"
)

type checkpointFileOperation struct {
	Path      string `json:"path"`
	Operation string `json:"operation"`
	ResultSeq uint64 `json:"resultSeq"`
}

// File operations are observed tool successes, not claims that current bytes
// are unchanged. Shell effects and failed calls are deliberately not inferred.
func checkpointFileOperations(events []Event, through uint64) []checkpointFileOperation {
	type fileCall struct{ path, operation string }
	calls := make(map[ToolCallID]fileCall)
	latest := make(map[string]checkpointFileOperation)
	for _, event := range events {
		if event.Seq > through {
			break
		}
		if event.Type == "tool/call" {
			var call struct {
				CallID    ToolCallID      `json:"callId"`
				Name      string          `json:"name"`
				Arguments json.RawMessage `json:"arguments"`
			}
			if json.Unmarshal(event.Data, &call) != nil {
				continue
			}
			operation := ""
			switch call.Name {
			case "Read", "read_file", "NotebookRead", "notebook_read":
				operation = "read"
			case "Write", "write_file", "Edit", "edit_file", "NotebookEdit", "notebook_edit":
				operation = "modified"
			}
			if operation == "" {
				continue
			}
			var args struct {
				Path         string `json:"path"`
				FilePath     string `json:"file_path"`
				NotebookPath string `json:"notebook_path"`
			}
			if json.Unmarshal(call.Arguments, &args) != nil {
				continue
			}
			name := args.Path
			if name == "" {
				name = args.FilePath
			}
			if name == "" {
				name = args.NotebookPath
			}
			if name == "" || len(name) > 1024 {
				continue
			}
			calls[call.CallID] = fileCall{name, operation}
		}
		if event.Type == "tool/result" {
			var block ContentBlock
			if json.Unmarshal(event.Data, &block) != nil {
				continue
			}
			call, ok := calls[block.ToolCallID]
			delete(calls, block.ToolCallID)
			if !ok || block.IsError {
				continue
			}
			latest[call.path+"\x00"+call.operation] = checkpointFileOperation{call.path, call.operation, event.Seq}
		}
	}
	rows := make([]checkpointFileOperation, 0, len(latest))
	for _, row := range latest {
		rows = append(rows, row)
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].ResultSeq > rows[j].ResultSeq })
	// Preserve exact names, bound the tail by actual encoded size.
	if len(rows) > 32 {
		rows = rows[:32]
	}
	for len(rows) > 0 {
		raw, _ := json.Marshal(rows)
		if len(raw) <= 4096 {
			break
		}
		rows = rows[:len(rows)-1]
	}
	return rows
}
