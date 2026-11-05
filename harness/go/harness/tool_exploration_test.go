package harness

import (
	"encoding/json"
	"fmt"
	"testing"
)

func TestDiscoveryPhaseReminders(t *testing.T) {
	for _, tt := range []struct {
		name, barrier string
		newTurn       bool
		want          int
	}{
		{"mixed changing queries", "", false, 1},
		{"edit resets", "Edit", false, 2},
		{"check resets", "Bash", false, 2},
		{"poll resets", "TaskOutput", false, 2},
		{"unknown semantics", "mcp_search", false, 2},
		{"new turn", "", true, 2},
	} {
		t.Run(tt.name, func(t *testing.T) {
			var p toolProgress
			warnings, turn := 0, 1
			for i := 0; i < 40; i++ {
				if i == 20 {
					if tt.newTurn {
						turn = 2
					}
					if tt.barrier != "" {
						p.observe(turn, ContentBlock{Name: tt.barrier, Arguments: json.RawMessage(`{}`)}, ToolResult{})
					}
				}
				names := []string{"Read", "Grep", "Glob", "ToolSearch", "LSP"}
				call := ContentBlock{Name: names[i%len(names)], ToolCallID: ToolCallID(fmt.Sprint(i)), Arguments: json.RawMessage(fmt.Sprintf(`{"query":"%d"}`, i))}
				reminder := p.observe(turn, call, ToolResult{Content: []ContentBlock{{Type: BlockText, Text: fmt.Sprint(i)}}})
				if reminder != nil {
					var source struct {
						Kind string `json:"kind"`
					}
					if err := json.Unmarshal(reminder.Source, &source); err != nil {
						t.Fatal(err)
					}
					if source.Kind == "tool-exploration-reminder" {
						warnings++
					}
				}
			}
			if warnings != tt.want {
				t.Fatalf("warnings=%d want=%d", warnings, tt.want)
			}
		})
	}
}
