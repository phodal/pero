package subagents

import (
	"context"
	"encoding/json"
	"fmt"
	point "github.com/phodal/pero/harness/go/runtime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
)

func TestClaudeResumeKeepsHistoryIdentityAndCurrentPermissions(t *testing.T) {
	root := t.TempDir()
	var children, parents atomic.Int32
	notified := make(chan struct{})
	f := newClaudeHTTPFixture(t, root, func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Model    string          `json:"model"`
			Messages json.RawMessage `json:"messages"`
		}
		if json.NewDecoder(r.Body).Decode(&request) != nil {
			t.Error("invalid model input")
		}
		if request.Model == "parent-model" {
			parents.Add(1)
			if !strings.Contains(string(request.Messages), "message-final") {
				t.Error("parent notice omitted resumed result")
			}
			close(notified)
			claudeTextAnswer(w, "notice observed")
			return
		}
		switch children.Add(1) {
		case 1:
			claudeHTTPAnswer(w, `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"initial-write","type":"function","function":{"name":"Write","arguments":"{\"file_path\":\"proof.txt\",\"content\":\"original effect\"}"}}]},"finish_reason":"tool_calls"}]}`)
		case 2:
			claudeTextAnswer(w, "initial-history-marker")
		case 3:
			if !strings.Contains(string(request.Messages), "initial-history-marker") || !strings.Contains(string(request.Messages), "initial-write") || !strings.Contains(string(request.Messages), "resume-followup") {
				t.Error("resume lost prior tool/message history")
			}
			claudeHTTPAnswer(w, `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"denied-write","type":"function","function":{"name":"Write","arguments":"{\"file_path\":\"proof.txt\",\"content\":\"must be denied\"}"}}]},"finish_reason":"tool_calls"}]}`)
		case 4:
			if !strings.Contains(string(request.Messages), "denied") {
				t.Error("resumed child widened current parent permission")
			}
			claudeTextAnswer(w, "resumed-with-history")
		case 5:
			if !strings.Contains(string(request.Messages), "resumed-with-history") || !strings.Contains(string(request.Messages), "send-followup") {
				t.Error("SendMessage lost resumed history")
			}
			claudeTextAnswer(w, "message-final")
		default:
			t.Error("unexpected child request")
			claudeTextAnswer(w, "unexpected")
		}
	}, true, []AgentDefinition{{Name: "sample:worker", Description: "Keep context", Instructions: "Operate inside the selected workspace.", Model: "sonnet", Tools: []string{"Write", "Read"}}}, ClaudeOptions{})
	initial := taskReceipt(t, f.call(t, f.parent, "Agent", `{"subagent_type":"sample:worker","description":"initial","prompt":"create proof"}`))
	if initial.Status != harness.SubagentCompleted || initial.ID == "" {
		t.Fatal(initial)
	}
	other, err := f.h.Agents().Create(f.ctx, harness.AgentOptions{ID: "unrelated", CWD: root, Provider: "fixture", Model: "parent-model"})
	if err != nil {
		t.Fatal(err)
	}
	if result := f.call(t, other, "Agent", fmt.Sprintf(`{"resume":%q,"description":"foreign","prompt":"not authorized"}`, initial.ID)); !result.IsError {
		t.Fatal("foreign parent resumed child")
	}
	if _, err := harness.SetPermissionMode(f.parent.Session(), harness.PermissionReadOnly); err != nil {
		t.Fatal(err)
	}
	resumedResult := f.call(t, f.parent, "Agent", fmt.Sprintf(`{"resume":%q,"description":"resume","prompt":"resume-followup"}`, initial.ID))
	resumed := taskReceipt(t, resumedResult)
	resumedJSON, _ := json.Marshal(resumedResult.Content)
	if resumed.ID != initial.ID || resumed.Status != harness.SubagentCompleted || !strings.Contains(string(resumedJSON), "resumed-with-history") {
		t.Fatalf("resume changed identity or lost result: %+v", resumed)
	}
	if data, err := os.ReadFile(filepath.Join(root, "proof.txt")); err != nil || string(data) != "original effect" || f.approvals.Load() != 1 {
		t.Fatal("resume replayed original write or widened permission")
	}
	result := f.call(t, f.parent, "SendMessage", fmt.Sprintf(`{"to":%q,"message":"send-followup"}`, initial.ID))
	if result.IsError {
		t.Fatal(result)
	}
	select {
	case <-notified:
	case <-f.ctx.Done():
		t.Fatal("resumed completion notice never reached parent")
	}
	if err := f.parent.WhenIdle(f.ctx); err != nil {
		t.Fatal(err)
	}
	if children.Load() != 5 || parents.Load() != 1 {
		t.Fatalf("duplicate resumed execution: child=%d parent=%d", children.Load(), parents.Load())
	}
	session, found := f.h.Sessions().Get(harness.SessionID(initial.ID))
	if !found {
		t.Fatal("child history disappeared")
	}
	turns := 0
	for _, event := range session.Events() {
		if event.Type == "turn/end" {
			turns++
		}
	}
	if turns != 3 {
		t.Fatalf("expected three turns on one child, got %d", turns)
	}
}

func TestClaudeManagedStructuredCaptureAndOneShotBoundaries(t *testing.T) {
	t.Run("managed structured", func(t *testing.T) {
		f := newClaudeHTTPFixture(t, t.TempDir(), func(w http.ResponseWriter, r *http.Request) {
			claudeHTTPAnswer(w, `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"managed-structured","type":"function","function":{"name":"structured_output","arguments":"{\"answer\":\"managed result\"}"}}]},"finish_reason":"tool_calls"}]}`)
		}, true, nil, ClaudeOptions{})
		result, err := f.claude.Invoke(f.ctx, f.parent, ClaudeInvocation{Prompt: "produce structured result", Model: "sonnet", OutputSchema: json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{"answer":{"type":"string"}},"required":["answer"]}`)})
		if err != nil || result.Status != harness.SubagentCompleted || result.Structured == nil {
			t.Fatalf("managed gate lost committed structured capture: %+v %v", result, err)
		}
	})
	for _, name := range []string{"Explore", "Plan", "configured child"} {
		t.Run(name, func(t *testing.T) {
			var calls atomic.Int32
			f := newClaudeHTTPFixture(t, t.TempDir(), func(w http.ResponseWriter, r *http.Request) { calls.Add(1); claudeTextAnswer(w, "one-shot complete") }, true, nil, ClaudeOptions{})
			var id harness.SessionID
			if name == "configured child" {
				result, err := f.claude.Invoke(f.ctx, f.parent, ClaudeInvocation{Prompt: "temporary composition", ConfigureChild: func(context.Context, *point.Run, *harness.Agent) error { return nil }})
				if err != nil {
					t.Fatal(err)
				}
				id = result.ChildID
			} else {
				receipt := taskReceipt(t, f.call(t, f.parent, "Agent", fmt.Sprintf(`{"subagent_type":%q,"description":"one shot","prompt":"inspect"}`, name)))
				id = harness.SessionID(receipt.ID)
			}
			result := f.call(t, f.parent, "Agent", fmt.Sprintf(`{"resume":%q,"description":"must not resume","prompt":"continue"}`, id))
			if !result.IsError || calls.Load() != 1 {
				t.Fatal("one-shot composition silently resumed without its original policy")
			}
		})
	}
}

func TestSendMessageQueuesOnRunningManagedAgent(t *testing.T) {
	started, release, notified := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var children, parents atomic.Int32
	f := newClaudeHTTPFixture(t, t.TempDir(), func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Model    string          `json:"model"`
			Messages json.RawMessage `json:"messages"`
		}
		_ = json.NewDecoder(r.Body).Decode(&request)
		if request.Model == "parent-model" {
			parents.Add(1)
			close(notified)
			claudeTextAnswer(w, "received live message completion")
			return
		}
		if children.Add(1) == 1 {
			close(started)
			select {
			case <-release:
			case <-r.Context().Done():
				return
			}
			claudeTextAnswer(w, "first live turn")
			return
		}
		if !strings.Contains(string(request.Messages), "queued-live-prompt") {
			t.Error("running agent did not receive queued message")
		}
		claudeTextAnswer(w, "queued prompt completed")
	}, true, nil, ClaudeOptions{})
	receipt := taskReceipt(t, f.call(t, f.parent, "Agent", `{"description":"live","prompt":"wait","model":"sonnet","run_in_background":true}`))
	select {
	case <-started:
	case <-f.ctx.Done():
		t.Fatal("child did not start")
	}
	if result := f.call(t, f.parent, "SendMessage", fmt.Sprintf(`{"to":%q,"message":"queued-live-prompt"}`, receipt.ID)); result.IsError {
		t.Fatal(result)
	}
	close(release)
	select {
	case <-notified:
	case <-f.ctx.Done():
		t.Fatal("queued completion notice missing")
	}
	if err := f.parent.WhenIdle(f.ctx); err != nil {
		t.Fatal(err)
	}
	if children.Load() != 2 || parents.Load() != 1 {
		t.Fatalf("unexpected running continuation turns: %d/%d", children.Load(), parents.Load())
	}
}
