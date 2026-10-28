package harness

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"unicode/utf16"

	point "github.com/phodal/pero/harness/go/runtime"
)

func TestSubagentActivationSettlementMessageUsesCurrentStatusAndTextContract(t *testing.T) {
	for _, tc := range []struct {
		name   string
		reason FinishKind
		status SubagentStatus
		local  bool
		want   string
	}{
		{"completed-local", FinishStop, SubagentCompleted, true, "Background subagent child finished and will do no further work unless you send it more."},
		{"completed-external", FinishStop, SubagentCompleted, false, "Background subagent child finished. It cannot receive follow-up messages."},
		{"aborted", FinishAborted, SubagentAborted, true, "Background subagent child was stopped before it finished."},
		{"max-tokens", FinishMaxTokens, SubagentFailed, true, "Background subagent child ran out of room before it finished."},
		{"refusal", FinishRefusal, SubagentFailed, true, "Background subagent child declined the task."},
		{"error", FinishError, SubagentFailed, true, "Background subagent child failed before it finished."},
		{"unknown", FinishKind("backend-limit"), SubagentCompleted, true, "Background subagent child ended abnormally (backend-limit) before it finished."},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := SubagentResult{Status: tc.status, Reason: tc.reason, Output: []ContentBlock{{Type: BlockText}, {Type: BlockReasoning, Text: "private reasoning"}, {Type: BlockImage, Data: []byte("image")}, {Type: BlockToolResult, Content: []ContentBlock{{Type: BlockText, Text: "tool output"}}}, {Type: BlockText, Text: "closing <answer>"}}, Structured: map[string]any{"answer": "<ok>"}, Diagnostic: "detail"}
			message, err := newSubagentSettlementMessage("child", result, tc.local)
			if err != nil {
				t.Fatal(err)
			}
			want := []ContentBlock{{Type: BlockText, Text: tc.want}, {Type: BlockText, Text: "Its closing message:"}, {Type: BlockText, Text: "closing <answer>"}, {Type: BlockText, Text: `Structured result: {"answer":"<ok>"}`}, {Type: BlockText, Text: "detail"}}
			if message.ID == "" || message.Role != RoleUser || !reflect.DeepEqual(message.Content, want) {
				t.Fatalf("settlement = %+v", message)
			}
			var source struct{ Kind, Form, Summary, SenderSessionID string }
			if err = json.Unmarshal(message.Source, &source); err != nil {
				t.Fatal(err)
			}
			if source.Kind != "subagent-settled" || source.Form != "notice" || source.Summary != tc.want || source.SenderSessionID != "child" {
				t.Fatalf("source=%s", message.Source)
			}
			message.Content[2].Text = "changed"
			if result.Output[4].Text != "closing <answer>" {
				t.Fatal("settlement mutated terminal output")
			}
		})
	}
}

func TestSubagentActivationSettlementMessageBoundsSourceAndPreservesFallback(t *testing.T) {
	message, err := newSubagentSettlementMessage(SessionID(strings.Repeat("😀", 80)), SubagentResult{Status: SubagentCompleted, Output: []ContentBlock{{Type: BlockText}, {Type: BlockFile}}}, true)
	if err != nil {
		t.Fatal(err)
	}
	var source struct{ Summary string }
	if err = json.Unmarshal(message.Source, &source); err != nil {
		t.Fatal(err)
	}
	if len(utf16.Encode([]rune(source.Summary))) > 120 || !strings.HasSuffix(source.Summary, "…") || len(message.Content) != 2 || message.Content[1].Text != "It left no closing message." || !strings.Contains(message.Content[0].Text, strings.Repeat("😀", 80)) {
		t.Fatalf("message=%+v source=%s", message, message.Source)
	}
	if _, err = newSubagentSettlementMessage("", SubagentResult{}, true); err == nil {
		t.Fatal("missing child identity accepted")
	}
	if _, err = newSubagentSettlementMessage("child", SubagentResult{Structured: make(chan int)}, true); err == nil {
		t.Fatal("unserializable structured output accepted")
	}
}

func TestSubagentActivationParentNoticeOwnsCleanupAndCurrentMessage(t *testing.T) {
	h := subagentTestHarness(t)
	ctx := activationTestContext(t)
	parent, err := h.Agents().Create(ctx, AgentOptions{ID: "current-notice-parent", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	terminal := make(chan SubagentResult, 1)
	var cleaned atomic.Bool
	var notices atomic.Int32
	observed := make(chan Message, 1)
	provider := retirementSubagentProvider{prepare: func(context.Context, SubagentRequest) (SubagentProviderRun, error) {
		return SubagentProviderRun{ChildID: "current-notice-child", Result: terminal, Begin: func() {}, Cancel: func(error) {}, Dispose: func(context.Context) error { cleaned.Store(true); return nil }}, nil
	}}
	mountRetirementHooks(t, h, func(run *point.Run) error {
		if _, err := h.Subagents().RegisterProvider(run, provider); err != nil {
			return err
		}
		_, err := h.Hooks().InboxInserted.On(run, func(_ context.Context, in InboxInsertedInput) error {
			if in.Agent != parent || !strings.Contains(string(in.Message.Source), "subagent-settled") {
				return nil
			}
			if !cleaned.Load() {
				return errors.New("notice preceded provider cleanup")
			}
			notices.Add(1)
			select {
			case observed <- in.Message:
			default:
				return errors.New("duplicate settlement notice")
			}
			return nil
		})
		return err
	})
	activation, err := h.Subagents().StartActivation(ctx, provider.Name(), SubagentRequest{Parent: parent, Prompt: "work", MaxDepth: 2}, "parent")
	if err != nil {
		t.Fatal(err)
	}
	terminal <- SubagentResult{ChildID: activation.ChildID, Status: SubagentFailed, Reason: FinishMaxTokens, Output: []ContentBlock{{Type: BlockReasoning, Text: "private"}, {Type: BlockText, Text: "partial answer"}}, Structured: map[string]any{"partial": true}}
	close(terminal)
	if err = activation.Wait(ctx); err != nil {
		t.Fatal(err)
	}
	message := activationReceive(t, ctx, observed)
	if notices.Load() != 1 || len(message.Content) != 4 || message.Content[0].Text != "Background subagent current-notice-child ran out of room before it finished." || message.Content[2].Text != "partial answer" || message.Content[3].Text != `Structured result: {"partial":true}` {
		t.Fatalf("notice=%+v count=%d", message, notices.Load())
	}
	result := activationReceive(t, ctx, activation.Result)
	if len(result.Output) != 2 || result.Output[0].Type != BlockReasoning {
		t.Fatal("parent conversion discarded full caller-visible terminal output")
	}
}
