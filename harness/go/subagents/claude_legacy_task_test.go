package subagents

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
)

func TestLegacyTaskSharesRealAgentAuthorityWhenSelected(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		t.Run(fmt.Sprintf("enabled=%t", enabled), func(t *testing.T) {
			root := t.TempDir()
			var calls atomic.Int32
			fixture := newClaudeHTTPFixture(t, root, func(w http.ResponseWriter, _ *http.Request) {
				if calls.Add(1) == 1 {
					input, _ := json.Marshal(`{"file_path":"report.txt","content":"legacy child output"}`)
					claudeHTTPAnswer(w, `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"legacy-write","type":"function","function":{"name":"Write","arguments":`+string(input)+`}}]},"finish_reason":"tool_calls"}]}`)
					return
				}
				claudeTextAnswer(w, "saved by the legacy child")
			}, true, []AgentDefinition{{Name: "sample:writer", Description: "write", Instructions: "Write the requested report.", Model: "sonnet", Tools: []string{"Write"}}}, ClaudeOptions{LegacyTaskAlias: enabled})
			result := fixture.call(t, fixture.parent, "Task", `{"subagent_type":"sample:writer","description":"legacy report","prompt":"Write report.txt"}`)
			if !enabled {
				if !result.IsError || calls.Load() != 0 || fixture.approvals.Load() != 0 {
					t.Fatalf("unselected legacy alias executed work: %+v", result)
				}
				return
			}
			file, err := os.ReadFile(filepath.Join(root, "report.txt"))
			receipt := taskReceipt(t, result)
			if err != nil || string(file) != "legacy child output" || result.IsError || receipt.ID == "" || receipt.Status != harness.SubagentCompleted || calls.Load() != 2 || fixture.approvals.Load() != 1 {
				t.Fatalf("legacy Task bypassed native child execution/approval: %+v calls=%d approvals=%d file=%s err=%v", receipt, calls.Load(), fixture.approvals.Load(), file, err)
			}
		})
	}
}
