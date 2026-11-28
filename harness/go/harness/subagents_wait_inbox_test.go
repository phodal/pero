package harness

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"testing/synctest"
	"time"

	point "github.com/phodal/pero/harness/go/runtime"
)

func TestWaitAgentTracksOnlyFreshNextStepInRootCall(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		ctx := t.Context()
		h, err := Boot(ctx, Options{EnableSubagents: true, Adapter: AdapterFunc(func(context.Context, GenerateRequest, func(StreamChunk) error) (Completion, error) {
			return Completion{}, errors.New("wait must not start a turn")
		})})
		if err != nil {
			t.Fatal(err)
		}
		defer h.Dispose(context.Background())
		parent, foreign := capacityParent(t, h, "wait-caller"), capacityParent(t, h, "wait-other")
		lifetime, unload := context.WithCancel(ctx)
		defer unload()
		type outcome struct {
			result ToolResult
			err    error
		}
		wait := func(call context.Context) outcome {
			value, err := h.Tools().Execute(call, ToolRequest{Agent: parent, Name: "wait_agent", CallID: "reused", Arguments: json.RawMessage(`{"timeout_ms":10000}`)})
			return outcome{value.Result, err}
		}
		expect := func(value outcome, timedOut bool) {
			t.Helper()
			if value.err != nil || value.result.IsError || len(value.result.Content) != 1 ||
				value.result.Content[0].Text != fmt.Sprintf(`{"timedOut":%t}`, timedOut) {
				t.Fatalf("wait timedOut=%t, outcome=%+v", timedOut, value)
			}
		}
		seen := make(chan outcome, 4)
		proceed := make(chan struct{})
		mountSubagentControlObserver(t, h, func(run *point.Run) error {
			if _, err := h.Tools().Register(run, h.Subagents().WaitAgentTool(lifetime)); err != nil {
				return err
			}
			_, err := h.Tools().Register(run, Tool{Schema: ToolSchema{Name: "fixture_nested_wait", InputSchema: json.RawMessage(`{"type":"object"}`)},
				ExecuteRequest: func(call context.Context, _ ToolRequest) (ToolResult, error) {
					for i := 0; i < 4; i++ {
						seen <- wait(call)
						if i < 3 {
							select {
							case <-proceed:
							case <-call.Done():
								return ToolResult{}, call.Err()
							}
						}
					}
					return ToolResult{}, nil
				}})
			return err
		})
		message := func(id string) Message {
			return Message{ID: id, Role: RoleUser, Source: json.RawMessage(`{"kind":"fixture"}`), Content: []ContentBlock{{Type: BlockText, Text: id}}}
		}
		if err := parent.Inject(message("already-pending-notice")); err != nil {
			t.Fatal(err)
		}
		finished := make(chan error, 1)
		go func() {
			_, err := h.Tools().Execute(ctx, ToolRequest{Agent: parent, Name: "fixture_nested_wait", CallID: "root", Arguments: json.RawMessage(`{}`)})
			finished <- err
		}()
		expect(<-seen, false)
		// The previous notification remains pending. The exact same logical
		// wait ignores it, foreign next-step input and local next-turn work.
		proceed <- struct{}{}
		synctest.Wait()
		if err := foreign.Inject(message("unrelated")); err != nil {
			t.Fatal(err)
		}
		if _, err := parent.SpliceDurableInbox(ctx, InboxNextTurn, 0, 0, []Message{message("queued")}); err != nil {
			t.Fatal(err)
		}
		synctest.Wait()
		select {
		case v := <-seen:
			t.Fatalf("unrelated input released wait: %+v", v)
		default:
		}
		// This is the same live path used by a waiting tool's managed-child
		// completion notice: an injected (not durable) next-step item.
		if err := parent.Inject(message("new-notice")); err != nil {
			t.Fatal(err)
		}
		expect(<-seen, false)
		// A user steering insert can also satisfy the same root's next wait.
		proceed <- struct{}{}
		synctest.Wait()
		steer := message("steer")
		if _, err := parent.SpliceDurableInbox(ctx, InboxNextStep, 0, 0, []Message{steer}); err != nil {
			t.Fatal(err)
		}
		expect(<-seen, false)
		proceed <- struct{}{}
		synctest.Wait()
		steer.Content[0].Text = "edited in place"
		if _, err := parent.SpliceDurableInbox(ctx, InboxNextStep, 0, 1, []Message{steer}); err != nil {
			t.Fatal(err)
		}
		expect(<-seen, true)
		if err := <-finished; err != nil {
			t.Fatal(err)
		}
		// A fresh root call can see the same pending input without consuming it.
		expect(wait(ctx), false)
		if len(parent.PendingDurableInbox(InboxNextStep)) != 1 || len(parent.PendingDurableInbox(InboxNextTurn)) != 1 {
			t.Fatal("wait consumed queued input")
		}

		report := &nextStepReport{}
		if timedOut, err := parent.waitNextStep(ctx, lifetime, 0, report); err != nil || timedOut {
			t.Fatalf("read pending: %v %v", timedOut, err)
		}
		canceled := make(chan error, 1)
		childCtx, cancel := context.WithCancel(ctx)
		go func() { _, err := parent.waitNextStep(childCtx, lifetime, time.Hour, report); canceled <- err }()
		synctest.Wait()
		cancel()
		if err := <-canceled; !errors.Is(err, context.Canceled) {
			t.Fatalf("cancel: %v", err)
		}
		go func() { _, err := parent.waitNextStep(ctx, lifetime, time.Hour, report); canceled <- err }()
		synctest.Wait()
		unload()
		assertSubagentControlCode(t, <-canceled, "WAIT_UNAVAILABLE")
	})
}

func TestWaitAgentLeavesManagedCompletionForNextModelStep(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		ctx := t.Context()
		requests := make(chan GenerateRequest, 2)
		first := true
		h, err := Boot(ctx, Options{EnableSubagents: true, Adapter: AdapterFunc(func(_ context.Context, req GenerateRequest, _ func(StreamChunk) error) (Completion, error) {
			if req.Agent.Parent() == nil {
				requests <- req
				if first {
					first = false
					return Completion{Finish: FinishToolCalls, Message: Message{Role: RoleAssistant, Content: []ContentBlock{{Type: BlockToolCall, ToolCallID: "listen", Name: "wait_agent", Arguments: json.RawMessage(`{"timeout_ms":10000}`)}}}}, nil
				}
			}
			return Completion{Finish: FinishStop, Message: Message{Role: RoleAssistant, Content: []ContentBlock{{Type: BlockText, Text: "fixture result"}}}}, nil
		})})
		if err != nil {
			t.Fatal(err)
		}
		defer h.Dispose(context.Background())
		parent := capacityParent(t, h, "notice-parent")
		mountSubagentControlObserver(t, h, func(run *point.Run) error {
			_, err := h.Tools().Register(run, h.Subagents().WaitAgentTool(run.Context))
			return err
		})
		done := make(chan error, 1)
		go func() {
			_, err := parent.Prompt(ctx, Message{Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: "wait for managed completion"}}})
			done <- err
		}()
		<-requests
		synctest.Wait()
		const childID SessionID = "settled-fixture-child"
		if err := DeliverParentNotice(parent, childID, SubagentCompleted, []ContentBlock{{Type: BlockText, Text: "child result"}}, nil, ""); err != nil {
			t.Fatal(err)
		}
		followup := <-requests
		foundResult, foundNotice := false, false
		for _, message := range followup.Messages {
			for _, content := range message.Content {
				if content.Type == BlockToolResult {
					for _, item := range content.Content {
						foundResult = foundResult || item.Text == `{"timedOut":false}`
					}
				}
				foundNotice = foundNotice || strings.Contains(content.Text, string(childID)+" finished with status")
			}
		}
		if err := <-done; err != nil || !foundResult || !foundNotice {
			t.Fatalf("next step did not see wait receipt and original notice: %v %v %v", err, foundResult, foundNotice)
		}
	})
}
