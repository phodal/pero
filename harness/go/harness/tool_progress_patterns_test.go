package harness

import (
	"encoding/json"
	"fmt"
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
