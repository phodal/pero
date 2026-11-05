package harness

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestBackgroundNoticeRespectsInterruptAndIdentity(t *testing.T) {
	var calls atomic.Int32
	h, err := Boot(t.Context(), Options{Adapter: AdapterFunc(func(_ context.Context, request GenerateRequest, _ func(StreamChunk) error) (Completion, error) {
		calls.Add(1)
		raw, _ := json.Marshal(request.Messages)
		if !strings.Contains(string(raw), "actual-completion-evidence") {
			t.Error("committed notice not visible to model")
		}
		return Completion{Finish: FinishStop, Message: Message{Role: RoleAssistant, Content: []ContentBlock{{Type: BlockText, Text: "observed"}}}}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) }()
	agent, err := h.Agents().Create(t.Context(), AgentOptions{Provider: "fixture", Model: "fixture"})
	if err != nil {
		t.Fatal(err)
	}
	message := Message{ID: "stable-background-notice", Role: RoleUser, Source: json.RawMessage(`{"kind":"workflow-settled"}`), Content: []ContentBlock{{Type: BlockText, Text: "actual-completion-evidence"}}}
	if err := agent.InterruptDSH(errors.New("user stop")); err != nil {
		t.Fatal(err)
	}
	if err := agent.DeliverBackgroundNotice(t.Context(), message); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 0 || agent.Status() != AgentIdle || len(agent.PendingDurableInbox(InboxNextTurn)) != 1 {
		t.Fatal("background notice cleared interrupt latch")
	}
	if _, err := agent.Prompt(t.Context(), Message{Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: "resume"}}}); err != nil {
		t.Fatal(err)
	}
	if err := agent.WhenIdle(t.Context()); err != nil {
		t.Fatal(err)
	}
	before := calls.Load()
	if before == 0 {
		t.Fatal("explicit resume did not process accepted input")
	}
	if err := agent.DeliverBackgroundNotice(t.Context(), message); err != nil {
		t.Fatal(err)
	}
	if err := agent.WhenIdle(t.Context()); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != before {
		t.Fatalf("same source identity added model requests: before=%d after=%d", before, calls.Load())
	}
}

func TestBackgroundNoticePersistenceBarrier(t *testing.T) {
	var calls atomic.Int32
	h, err := Boot(t.Context(), Options{Adapter: AdapterFunc(func(context.Context, GenerateRequest, func(StreamChunk) error) (Completion, error) {
		calls.Add(1)
		return Completion{Finish: FinishStop, Message: Message{Role: RoleAssistant}}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) }()
	agent, err := h.Agents().Create(t.Context(), AgentOptions{Provider: "fixture", Model: "fixture"})
	if err != nil {
		t.Fatal(err)
	}
	remove, err := agent.Session().InstallDurabilityCheckpoint(func(context.Context) error { return errors.New("checkpoint failed") })
	if err != nil {
		t.Fatal(err)
	}
	message := Message{ID: "notice-with-barrier", Role: RoleUser, Source: json.RawMessage(`{"kind":"workflow-settled"}`), Content: []ContentBlock{{Type: BlockText, Text: "settled"}}}
	if err := agent.DeliverBackgroundNotice(t.Context(), message); err == nil {
		t.Fatal("failed checkpoint became delivered success")
	}
	if agent.Status() != AgentIdle || calls.Load() != 0 || len(agent.PendingDurableInbox(InboxNextTurn)) != 1 {
		t.Fatal("notice visible before checkpoint")
	}
	remove()
	if err := agent.DeliverBackgroundNotice(t.Context(), message); err != nil {
		t.Fatal(err)
	}
	if err := agent.WhenIdle(t.Context()); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 {
		t.Fatalf("retry repeated model effects: %d", calls.Load())
	}
}

func TestBackgroundNoticeTurnAdmission(t *testing.T) {
	for _, state := range []string{"live", "canceled", "expired", "retired", "scope-canceled"} {
		t.Run(state, func(t *testing.T) {
			var calls atomic.Int32
			h, err := Boot(t.Context(), Options{Adapter: AdapterFunc(func(context.Context, GenerateRequest, func(StreamChunk) error) (Completion, error) {
				calls.Add(1)
				return Completion{Finish: FinishStop, Message: Message{Role: RoleAssistant, Content: []ContentBlock{{Type: BlockText, Text: "observed"}}}}, nil
			})})
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) }()
			agent, err := h.Agents().Create(t.Context(), AgentOptions{Provider: "fixture", Model: "fixture"})
			if err != nil {
				t.Fatal(err)
			}
			message := Message{ID: "pending-completion", Role: RoleUser, Source: json.RawMessage(`{"kind":"bash-settled","taskId":"finished-job"}`), Content: []ContentBlock{{Type: BlockText, Text: "actual result"}}}
			// Stage without waking: drive the turn-entry boundary deterministically,
			// as a worker released from an activity wait after shutdown would do.
			remove, err := agent.Session().InstallDurabilityCheckpoint(func(context.Context) error { return nil })
			if err != nil {
				t.Fatal(err)
			}
			defer remove()
			if err := agent.StageBackgroundNotice(t.Context(), message); err != nil {
				t.Fatal(err)
			}
			ctx := t.Context()
			var expected error
			switch state {
			case "canceled":
				canceled, cancel := context.WithCancel(ctx)
				cancel()
				ctx, expected = canceled, context.Canceled
			case "expired":
				expired, cancel := context.WithDeadline(ctx, time.Time{})
				defer cancel()
				ctx, expected = expired, context.DeadlineExceeded
			case "retired":
				// Model the manager's admission seal before its asynchronous
				// cleanup. Explicit removal separately owns discarding inputs.
				agent.retired.Store(true)
				expected = ErrAgentRetired
			case "scope-canceled":
				agent.operationRootCancel()
				expected = ErrAgentRetired
			}
			agent.inboxClaimMu.Lock()
			locked := true
			result, err := agent.runTurn(ctx, nil, true, func([]Message) {
				locked = false
				agent.inboxClaimMu.Unlock()
			})
			if locked {
				agent.inboxClaimMu.Unlock()
			}
			if !errors.Is(err, expected) {
				t.Fatalf("turn admission error=%v; want %v", err, expected)
			}
			var starts, ends int
			for _, event := range agent.Session().Events() {
				switch event.Type {
				case "turn/start":
					starts++
				case "turn/end":
					ends++
				}
			}
			pending := agent.PendingDurableInbox(InboxNextTurn)
			if expected == nil {
				if result.Turn != 1 || starts != 1 || ends != 1 || calls.Load() != 1 || len(pending) != 0 {
					t.Fatalf("live notice: result=%+v starts=%d ends=%d calls=%d pending=%d", result, starts, ends, calls.Load(), len(pending))
				}
			} else if result.Turn != 0 || starts != 0 || ends != 0 || calls.Load() != 0 || len(pending) != 1 || pending[0].ID != message.ID {
				t.Fatalf("rejected turn consumed work: result=%+v starts=%d ends=%d calls=%d pending=%v", result, starts, ends, calls.Load(), pending)
			}
			if state == "canceled" || state == "expired" {
				if err := agent.WakeDurable(InboxNextTurn); err != nil {
					t.Fatal(err)
				}
				if err := agent.WhenIdle(t.Context()); err != nil {
					t.Fatal(err)
				}
				if calls.Load() != 1 || len(agent.PendingDurableInbox(InboxNextTurn)) != 0 {
					t.Fatal("explicit recovery did not consume the preserved notice once")
				}
			}
		})
	}
}
