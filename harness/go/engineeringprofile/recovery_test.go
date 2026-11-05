package engineeringprofile

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
)

func TestCompactionPreservesReceiptsAndAppDisposal(t *testing.T) {
	longAnswer := answer(harness.FinishStop)
	longAnswer.Message.Content[0].Text = strings.Repeat("observed work ", 128)
	f := setup(t, Observe, 8, checkCall(), longAnswer, answer(harness.FinishStop), answer(harness.FinishStop), answer(harness.FinishStop))
	auto, retain := false, 0
	agent, err := f.h.Agents().Create(f.ctx, harness.AgentOptions{
		ID: "compact-recovery", CWD: f.root, MaxSteps: 8, Provider: "fixture", Model: "model",
		Compaction: &harness.BasicCompactionConfig{ContextWindow: 8192, MaxTokens: 128, RetainTokens: &retain, Auto: &auto},
	})
	if err != nil {
		t.Fatal(err)
	}
	f.agent = agent
	calls := 0
	f.shell(t, `{"exitCode":0}`, false, func() { calls++ })
	c := testContract()
	f.prompt(t, &c)
	before := f.assessment(t)
	if !before.Ready {
		t.Fatalf("initial check did not pass: %+v", before)
	}
	compacted, err := agent.CompactNow(f.ctx, "compact-recovery")
	if err != nil || compacted == nil || len(compacted.ShadowedSeqs) == 0 {
		t.Fatalf("compaction=%+v err=%v", compacted, err)
	}
	if after := f.assessment(t); !after.Ready || after.Fingerprint != before.Fingerprint || calls != 1 {
		t.Fatalf("compaction changed acceptance or reran the check: %+v calls=%d", after, calls)
	}
	followup := func(id string) harness.GenerateRequest {
		t.Helper()
		outcomes, err := agent.FollowupResultContext(f.ctx, contextMessage(id, "continue within the same contract"))
		if err != nil {
			t.Fatal(err)
		}
		if outcome := <-outcomes; outcome.Err != nil {
			t.Fatal(outcome.Err)
		}
		return f.adapter.requests[len(f.adapter.requests)-1]
	}
	request := followup("after-compaction")
	foundCheckpoint := false
	for _, message := range request.Messages {
		if message.ID != "engineering/checkpoint" {
			continue
		}
		var source struct {
			Kind    string `json:"kind"`
			Version string `json:"profileVersion"`
		}
		if err := json.Unmarshal(message.Source, &source); err != nil || source.Kind != "engineeringprofile" || source.Version != Version {
			t.Fatalf("checkpoint lost its source: %s err=%v", message.Source, err)
		}
		foundCheckpoint = true
	}
	if !foundCheckpoint {
		t.Fatal("the actual request omitted the attributed post-compaction checkpoint")
	}
	if err := f.app.Dispose(f.ctx); err != nil {
		t.Fatal(err)
	}
	request = followup("after-dispose")
	if strings.Contains(request.System, "Engineering task contract:") {
		t.Fatal("profile guidance survived App.Dispose")
	}
	for _, tool := range request.Tools {
		if tool.Name == "engineering_check" {
			t.Fatal("check tool survived App.Dispose")
		}
	}
	if calls != 1 {
		t.Fatalf("recovery or disposal reran the check: calls=%d", calls)
	}
}
