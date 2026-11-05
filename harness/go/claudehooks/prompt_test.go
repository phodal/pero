package claudehooks

import "testing"

func TestRenderPromptSubstitutesArgumentsOnce(t *testing.T) {
	if got := RenderPrompt(`price \$1.00 $ARGUMENTS`, `{"ok":true}`); got != `price $1.00 {"ok":true}` {
		t.Fatalf("rendered %q", got)
	}
	if got := RenderPrompt("check the work", `{"event":"Stop"}`); got != "check the work\n{\"event\":\"Stop\"}" {
		t.Fatalf("appended %q", got)
	}
}

func TestPromptDecisionFollowsTheEvent(t *testing.T) {
	decision, err := PromptDecision("Stop", false, "```json\n{\"ok\":false,\"reason\":\"finish the work\"}\n```")
	if err != nil || !decision.Block || decision.Reason != "finish the work" || decision.EndTurn {
		t.Fatalf("stop decision %+v %v", decision, err)
	}
	decision, err = PromptDecision("Stop", false, `{"ok":false,"reason":"never","impossible":true}`)
	if err != nil || decision.Block || decision.Reason != "" {
		t.Fatalf("impossible stop %+v %v", decision, err)
	}
	decision, err = PromptDecision("PreToolUse", false, `{"ok":false,"reason":"no"}`)
	if err != nil || !decision.EndTurn || decision.Permission != "deny" {
		t.Fatalf("pretool default %+v %v", decision, err)
	}
	decision, err = PromptDecision("PreToolUse", true, `{"ok":false,"reason":"no"}`)
	if err != nil || decision.EndTurn || decision.Permission != "deny" {
		t.Fatalf("pretool continue %+v %v", decision, err)
	}
	if _, err = PromptDecision("Stop", false, "not json"); err == nil {
		t.Fatal("invalid response was accepted")
	}
	decision, err = AgentDecision("Stop", `{"ok":false,"reason":"still going","impossible":true}`)
	if err != nil || !decision.Block || decision.Reason != "still going" {
		t.Fatalf("agent stop %+v %v", decision, err)
	}
	decision, err = AgentDecision("PreToolUse", `{"ok":false,"reason":"no"}`)
	if err != nil || decision.EndTurn || decision.Permission != "deny" {
		t.Fatalf("agent pretool %+v %v", decision, err)
	}
}
