package harness

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestToolProgressPatterns(t *testing.T) {
	for _, row := range []struct {
		name, tool                    string
		alternating, changing, failed bool
		want                          bool
	}{
		{"alternating unchanged", "Read", true, false, false, true},
		{"alternating changed results", "Read", true, true, false, false},
		{"varying failed commands", "Bash", false, false, true, true},
		{"productive commands", "Bash", false, true, false, false},
		{"legitimate polling", "TaskOutput", true, false, false, false},
		{"mutations", "Edit", true, false, false, false},
	} {
		t.Run(row.name, func(t *testing.T) {
			var p toolProgress
			found := false
			for i := 0; i < 8; i++ {
				arg := i
				if row.alternating {
					arg = i % 2
				}
				args, _ := json.Marshal(struct {
					Command string `json:"command"`
				}{fmt.Sprintf("command-%d", arg)})
				text := "same"
				if row.changing {
					text = fmt.Sprint(i)
				}
				if row.failed {
					text = `{"exitCode":1,"stdout":{"text":"error"}}`
				}
				reminder := p.observe(1, ContentBlock{Name: row.tool, Arguments: args, ToolCallID: ToolCallID(fmt.Sprint(i))}, ToolResult{Content: []ContentBlock{{Type: BlockText, Text: text}}})
				found = found || reminder != nil
			}
			if found != row.want {
				t.Fatalf("reminder=%t want=%t", found, row.want)
			}
		})
	}
}

func TestToolFailureWindow(t *testing.T) {
	for _, row := range []struct {
		name, receipt string
		spacing       int
		newTurn       bool
		want          bool
	}{
		{"edits between failed experiments", `{"exitCode":1}`, 3, false, true},
		{"changing compiler errors", `{"result":{"exitCode":2}}`, 3, false, true},
		{"productive sparse failures", `{"exitCode":1}`, 4, false, false},
		{"successful checks", `{"exitCode":0}`, 3, false, false},
		{"uncertain cleanup", `{"exitCode":1,"cleanupUncertain":true}`, 3, false, false},
		{"outer uncertain cleanup", `{"cleanupUncertain":true,"result":{"exitCode":1}}`, 3, false, false},
		{"timeout", `{"exitCode":1,"timedOut":true}`, 3, false, false},
		{"cancelled", `{"exitCode":1,"aborted":true}`, 3, false, false},
		{"polling errors", `{"status":"running","task_id":"job"}`, 3, false, false},
		{"new turn clears history", `{"exitCode":1}`, 3, true, false},
	} {
		t.Run(row.name, func(t *testing.T) {
			var p toolProgress
			found := false
			for i := 0; i < 8*row.spacing; i++ {
				turn := 1
				if row.newTurn && i >= 4*row.spacing {
					turn = 2
				}
				name, text := "Read", fmt.Sprint(i)
				if i%row.spacing == 0 {
					name, text = "Bash", row.receipt
				} else if i%row.spacing == 1 {
					name = "Edit"
				}
				args, _ := json.Marshal(struct {
					Command string `json:"command"`
				}{fmt.Sprintf("experiment-%d", i)})
				advisory := p.observe(turn, ContentBlock{Name: name, Arguments: args}, ToolResult{Content: []ContentBlock{{Type: BlockText, Text: text}}})
				found = found || advisory != nil
			}
			if found != row.want {
				t.Fatalf("advisory=%t want=%t", found, row.want)
			}
		})
	}
}

func TestDiagnosticProgress(t *testing.T) {
	for _, row := range []struct {
		name                    string
		changing, success, turn bool
		want                    bool
	}{
		{"same diagnostic after edits", false, false, false, true},
		{"changing diagnostics", true, false, false, false},
		{"successful command breaks recurrence", false, true, false, false},
		{"new turn", false, false, true, false},
	} {
		t.Run(row.name, func(t *testing.T) {
			var p toolProgress
			found := false
			for i := 0; i < 3; i++ {
				turn := 1
				if row.turn && i == 2 {
					turn = 2
				}
				p.observe(turn, ContentBlock{Name: "Edit", Arguments: json.RawMessage(`{}`)}, ToolResult{})
				if row.success && i == 2 {
					p.observe(turn, ContentBlock{Name: "Bash", Arguments: json.RawMessage(`{"command":"check"}`)}, ToolResult{Content: []ContentBlock{{Type: BlockText, Text: `{"exitCode":0}`}}})
				}
				diagnostic := "same"
				if row.changing {
					diagnostic = fmt.Sprint(i)
				}
				raw, _ := json.Marshal(struct {
					ExitCode int    `json:"exitCode"`
					Stderr   string `json:"stderr"`
				}{1, "main.c: error: " + diagnostic})
				reminder := p.observe(turn, ContentBlock{Name: "Bash", Arguments: json.RawMessage(`{"command":"check"}`)}, ToolResult{Content: []ContentBlock{{Type: BlockText, Text: string(raw)}}})
				if reminder != nil && strings.Contains(string(reminder.Source), "tool-diagnostic-reminder") {
					found = true
				}
			}
			if found != row.want {
				t.Fatalf("diagnostic reminder=%t want=%t", found, row.want)
			}
		})
	}
}
