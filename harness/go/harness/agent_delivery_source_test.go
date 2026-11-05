package harness

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	point "github.com/phodal/pero/harness/go/runtime"
)

func TestPluginAdmissionRejectsHumanSource(t *testing.T) {
	h, err := Boot(t.Context(), Options{Adapter: AdapterFunc(func(context.Context, GenerateRequest, func(StreamChunk) error) (Completion, error) {
		return Completion{Finish: FinishStop}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { h.Dispose(context.Background()); h.Drain(context.Background()) }()
	agent, err := h.Agents().Create(t.Context(), AgentOptions{})
	if err != nil {
		t.Fatal(err)
	}
	remove, err := agent.Session().InstallDurabilityCheckpoint(func(context.Context) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	defer remove()
	message := Message{ID: "forged-human", Role: RoleUser, Source: json.RawMessage(`{"kind":"user","rpcId":"untrusted"}`), Content: []ContentBlock{{Type: BlockText, Text: "plugin notice"}}}
	for _, test := range []struct {
		name  string
		admit func() error
	}{
		{"inject", func() error { return agent.Inject(message) }},
		{"quiet delivery", func() error { return agent.Deliver(message, false) }},
		{"waking delivery", func() error { return agent.Deliver(message, true) }},
		{"followup", func() error { _, err := agent.FollowupResultContext(t.Context(), message); return err }},
		{"synchronous followup", func() error { _, err := agent.PromptFollowup(t.Context(), message); return err }},
		{"conditional followup", func() error { _, err := agent.TryFollowup(message); return err }},
		{"durable next step", func() error { return agent.DeliverDurable(t.Context(), message, false) }},
		{"durable next turn", func() error { return agent.DeliverDurable(t.Context(), message, true) }},
		{"background delivery", func() error { return agent.DeliverBackgroundNotice(t.Context(), message) }},
		{"background staging", func() error { return agent.StageBackgroundNotice(t.Context(), message) }},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := test.admit(); err == nil || !strings.Contains(err.Error(), "cannot declare user source") {
				t.Fatalf("plugin admission accepted human provenance: %v", err)
			}
		})
	}
	if len(agent.PendingDurableInbox(InboxNextStep)) != 0 || len(agent.PendingDurableInbox(InboxNextTurn)) != 0 {
		t.Fatal("rejected plugin provenance mutated the inbox")
	}
}

func TestInboxAdmissionPreservesSourceAndAuthorship(t *testing.T) {
	for _, test := range []struct {
		name         string
		source       json.RawMessage
		human, quiet bool
		admit        func(context.Context, *Agent, Message) error
	}{
		{"synchronous plugin turn", json.RawMessage(`{"kind":"acp/output-limit-recovery","attempt":1}`), false, false, func(ctx context.Context, agent *Agent, message Message) error {
			_, err := agent.PromptFollowup(ctx, message)
			return err
		}},
		{"plugin next step", json.RawMessage(`{"kind":"agent-message","senderSessionId":"child","extra":{"note":"keep"}}`), false, true, func(ctx context.Context, agent *Agent, message Message) error {
			return agent.DeliverDurable(ctx, message, false)
		}},
		{"DSH next step", json.RawMessage(`{"kind":"user","rpcId":"steer","clientTimeZone":"UTC"}`), true, false, func(ctx context.Context, agent *Agent, message Message) error {
			_, err := agent.AdmitDSHMessage(ctx, message, InboxNextStep)
			return err
		}},
		{"DSH next turn", json.RawMessage(`{"kind":"user","rpcId":"queue","extra":{"origin":"host"}}`), true, false, func(ctx context.Context, agent *Agent, message Message) error {
			_, err := agent.AdmitDSHMessage(ctx, message, InboxNextTurn)
			return err
		}},
		{"human next step", json.RawMessage(`{"kind":"user","rpcId":"human-steer"}`), true, false, func(ctx context.Context, agent *Agent, message Message) error {
			_, err := agent.AdmitUser(ctx, message, InboxNextStep)
			return err
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			h, err := Boot(t.Context(), Options{Adapter: AdapterFunc(func(context.Context, GenerateRequest, func(StreamChunk) error) (Completion, error) {
				return Completion{Finish: FinishStop}, nil
			})})
			if err != nil {
				t.Fatal(err)
			}
			defer func() { h.Dispose(context.Background()); h.Drain(context.Background()) }()
			claims := make(chan InboxClaimedInput, 1)
			agent, err := h.Agents().Create(t.Context(), AgentOptions{Configure: func(_ context.Context, run *point.Run, _ *Agent) error {
				_, err := h.Hooks().InboxClaimed.On(run, func(_ context.Context, input InboxClaimedInput) error {
					if input.Message.ID == "source-preserved" {
						claims <- input
					}
					return nil
				})
				return err
			}})
			if err != nil {
				t.Fatal(err)
			}
			remove, err := agent.Session().InstallDurabilityCheckpoint(func(context.Context) error { return nil })
			if err != nil {
				t.Fatal(err)
			}
			defer remove()
			message := Message{ID: "source-preserved", Role: RoleUser, Source: test.source, Content: []ContentBlock{{Type: BlockText, Text: "accepted input"}}}
			if err := test.admit(t.Context(), agent, message); err != nil {
				t.Fatal(err)
			}
			if test.quiet {
				if _, err := agent.Prompt(t.Context(), Message{Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: "consume pending notice"}}}); err != nil {
					t.Fatal(err)
				}
			}
			if err := agent.WhenIdle(t.Context()); err != nil {
				t.Fatal(err)
			}
			select {
			case claim := <-claims:
				if claim.UserAuthored != test.human || string(claim.Message.Source) != string(test.source) {
					t.Fatalf("source=%s human=%t, want source=%s human=%t", claim.Message.Source, claim.UserAuthored, test.source, test.human)
				}
			default:
				t.Fatal("accepted source was not claimed")
			}
		})
	}
}
