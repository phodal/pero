package nativetools

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
)

func TestRootPlanningTransitionsAndRestrictions(t *testing.T) {
	f := newClaudeFixture(t, Options{})
	for _, agent := range []*harness.Agent{f.allowed, f.denied} {
		if _, err := harness.SetPermissionMode(agent.Session(), harness.PermissionAutoReview); err != nil {
			t.Fatal(err)
		}
		if result := f.call(t, agent, "EnterPlanMode", map[string]any{}); result.IsError {
			t.Fatalf("enter: %+v", result)
		}
		schemas, err := f.harness.Tools().SchemasForAgent(t.Context(), agent)
		if err != nil {
			t.Fatal(err)
		}
		for _, schema := range schemas {
			if schema.Name == "Write" || schema.Name == "apply_patch" || schema.Name == "Skill" {
				t.Fatalf("mutation visible in plan: %s", schema.Name)
			}
		}
		if result := f.call(t, agent, "Write", map[string]any{"file_path": "blocked", "content": "bad"}); !result.IsError {
			t.Fatal("forced mutation bypassed plan")
		}
		child, err := f.harness.Agents().Create(t.Context(), harness.AgentOptions{Parent: agent, CWD: f.root})
		if err != nil {
			t.Fatal(err)
		}
		if harness.PlanningToolAllowed(child, "Write") || harness.PlanningToolAllowed(child, "ExitPlanMode") {
			t.Fatal("child escaped root planning")
		}
		// Even auto-review cannot silently approve leaving planning.
		if _, err := harness.SetPermissionMode(agent.Session(), harness.PermissionAutoReview); err != nil {
			t.Fatal(err)
		}
		if result := f.call(t, agent, "EnterPlanMode", map[string]any{}); result.IsError {
			t.Fatal(result)
		}
		before := f.approvals.Load()
		result := f.call(t, agent, "ExitPlanMode", map[string]any{"plan": "Change one file, run its focused tests, then report results."})
		if f.approvals.Load() != before+1 {
			t.Fatal("exit skipped existing approval channel")
		}
		state, err := harness.ReadPlanMode(agent.Session().Events())
		if err != nil {
			t.Fatal(err)
		}
		if agent == f.allowed {
			if result.IsError || state.Active {
				t.Fatalf("approved exit failed: %+v", result)
			}
			mode, found, err := harness.PermissionModeOverride(agent.Session().Events())
			if err != nil || !found || mode != harness.PermissionAutoReview {
				t.Fatal("exit did not restore prior permission")
			}
		} else if !result.IsError || !state.Active {
			t.Fatal("denied exit changed mode")
		}
	}
	if _, err := os.Stat(filepath.Join(f.root, "blocked")); !os.IsNotExist(err) {
		t.Fatal("planning changed files")
	}
}
