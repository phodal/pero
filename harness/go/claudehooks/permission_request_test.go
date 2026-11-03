package claudehooks

import (
	"strings"
	"testing"
)

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
