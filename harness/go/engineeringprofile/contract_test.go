package engineeringprofile

import (
	"testing"

	"github.com/phodal/pero/harness/go/tasks"
)

func testContract() Contract {
	return Contract{ID: "fix", Revision: 1, MessageID: "human-1", Kind: Change, Goal: "Fix and check the declared input", Checks: []CheckSpec{{ID: "unit", Tool: "shell", Command: "check", Required: true, Files: []string{"input.txt"}}}}
}

func TestAcceptanceDecision(t *testing.T) {
	for _, row := range []struct {
		name     string
		status   CheckStatus
		optional bool
		open     bool
		ready    bool
	}{
		{"missing", Missing, false, false, false}, {"failed", Failed, false, false, false}, {"running", Unverified, false, false, false},
		{"stale", Stale, false, false, false}, {"passed", Passed, false, false, true}, {"optional failed", Failed, true, false, true}, {"open task", Passed, false, true, false},
	} {
		t.Run(row.name, func(t *testing.T) {
			c := testContract()
			c.Checks[0].Required = !row.optional
			var open []tasks.TaskID
			if row.open {
				open = []tasks.TaskID{"1"}
			}
			// Task IDs remain owned by tasks; the decision only receives references.
			assessment := Assess(c, []CheckAssessment{{ID: "unit", Status: row.status}}, open)
			if assessment.Ready != row.ready {
				t.Fatalf("assessment = %+v", assessment)
			}
		})
	}
}
