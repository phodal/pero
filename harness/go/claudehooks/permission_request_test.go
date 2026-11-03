package claudehooks

import (
	"strings"
	"testing"
)

func TestPostToolUseUpdatedOutputParses(t *testing.T) {
	decision, err := ParseDecision("PostToolUse", []byte(`{"hookSpecificOutput":{"hookEventName":"PostToolUse","updatedToolOutput":{"stdout":"[redacted]"}}}`), nil, 0)
	if err != nil || !strings.Contains(string(decision.UpdatedToolOutput), "[redacted]") {
		t.Fatalf("output=%s error=%v", decision.UpdatedToolOutput, err)
	}
	if _, err := ParseDecision("PreToolUse", []byte(`{"hookSpecificOutput":{"hookEventName":"PreToolUse","updatedToolOutput":{"stdout":"x"}}}`), nil, 0); err == nil {
		t.Fatal("updatedToolOutput was accepted for PreToolUse")
	}
}

func TestCompactHooksKeepPlainStdoutAsContext(t *testing.T) {
	for _, event := range []string{"PreCompact", "PostCompact"} {
		decision, err := ParseDecision(event, []byte("keep-this-checkpoint\n"), nil, 0)
		if err != nil || decision.AdditionalContext != "keep-this-checkpoint" || decision.Block {
			t.Fatalf("%s context=%q block=%v error=%v", event, decision.AdditionalContext, decision.Block, err)
		}
	}
}

func TestWorktreeCreateReadsTheLastPathLine(t *testing.T) {
	decision, err := ParseDecision("WorktreeCreate", []byte("banner\n\x1b[31mred\x1b[0m\n/tmp/feature\n"), nil, 0)
	if err != nil || decision.WorktreePath != "/tmp/feature" {
		t.Fatalf("path=%q error=%v", decision.WorktreePath, err)
	}
}

func TestPermissionRequestDecisionAndExit2(t *testing.T) {
	decision, err := ParseDecision("PermissionRequest", []byte(`{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow","updatedInput":{"command":"printf allowed"}}}}`), nil, 0)
	if err != nil || decision.Permission != "allow" || !strings.Contains(string(decision.UpdatedInput), "printf allowed") || decision.Block {
		t.Fatalf("allow=%+v error=%v", decision, err)
	}
	decision, err = ParseDecision("PermissionRequest", []byte(`{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"not this command","interrupt":true}}}`), nil, 0)
	if err != nil || decision.Permission != "deny" || !decision.Block || !decision.Stop || decision.Reason != "not this command" {
		t.Fatalf("deny=%+v error=%v", decision, err)
	}
	decision, err = ParseDecision("PermissionRequest", []byte(`not json`), []byte("ignored"), 2)
	if err != nil || decision.Permission != "" || decision.Block || decision.Stop || decision.Reason != "" || len(decision.UpdatedInput) != 0 {
		t.Fatalf("exit 2 changed the permission flow: %+v %v", decision, err)
	}
}
