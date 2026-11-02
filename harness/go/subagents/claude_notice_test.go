package subagents

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
)

func TestSelectedBackgroundNoticeWaitsForActualCompletion(t *testing.T) {
	root := t.TempDir()
	childAtFinal, release, notified := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var parentCalls, childCalls atomic.Int32
	fixture := newClaudeHTTPFixture(t, root, func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Model    string            `json:"model"`
			Messages []json.RawMessage `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if request.Model == "worker-model" {
			if childCalls.Add(1) == 1 {
				arguments, _ := json.Marshal(`{"file_path":"result.json","content":"{\"verified\":true}"}`)
				claudeHTTPAnswer(w, `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"notice-write","type":"function","function":{"name":"Write","arguments":`+string(arguments)+`}}]},"finish_reason":"tool_calls"}]}`)
				return
			}
			close(childAtFinal)
			select {
			case <-release:
			case <-r.Context().Done():
				return
			}
			claudeTextAnswer(w, "worker-verified-report")
			return
		}
		switch parentCalls.Add(1) {
		case 1:
			arguments, _ := json.Marshal(`{"subagent_type":"sample:researcher","description":"research item","prompt":"Write verified result.json","run_in_background":true}`)
			claudeHTTPAnswer(w, `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"background-research","type":"function","function":{"name":"Task","arguments":`+string(arguments)+`}}]},"finish_reason":"tool_calls"}]}`)
		case 2:
			claudeTextAnswer(w, "Waiting for actual research completion.")
		case 3:
			all, _ := json.Marshal(request.Messages)
			if !strings.Contains(string(all), "worker-verified-report") || !strings.Contains(string(all), "Background subagent") {
				t.Errorf("parent wake did not contain the actual terminal notice: %s", all)
			}
			close(notified)
			claudeTextAnswer(w, "Research completion observed.")
		default:
			t.Error("unexpected extra parent model request")
			claudeTextAnswer(w, "done")
		}
	}, true, []AgentDefinition{{Name: "sample:researcher", Description: "research", Instructions: "Write then report.", Model: "sonnet", Tools: []string{"Write"}}}, ClaudeOptions{LegacyTaskAlias: true, BackgroundNotifications: true})
	if _, err := fixture.parent.Prompt(fixture.ctx, harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "Start a research item"}}}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-childAtFinal:
	case <-fixture.ctx.Done():
		t.Fatal("child did not reach its actual final step")
	}
	if data, err := os.ReadFile(filepath.Join(root, "result.json")); err != nil || string(data) != `{"verified":true}` {
		t.Fatalf("real child output was not written: %s %v", data, err)
	}
	select {
	case <-notified:
		t.Fatal("an output file was mistaken for terminal completion")
	default:
	}
	close(release)
	select {
	case <-notified:
	case <-fixture.ctx.Done():
		t.Fatal("parent was not woken after child completion")
	}
	if childCalls.Load() != 2 || parentCalls.Load() != 3 || fixture.approvals.Load() != 1 {
		t.Fatalf("notice started duplicate work: child=%d parent=%d approvals=%d", childCalls.Load(), parentCalls.Load(), fixture.approvals.Load())
	}
}

func TestSelectedBackgroundNoticeCancellation(t *testing.T) {
	for _, mode := range []string{"parent-cancel", "task-stop"} {
		t.Run(mode, func(t *testing.T) {
			childStarted, childCancelled := make(chan struct{}), make(chan struct{})
			parentStarted := make(chan struct{})
			var parentCalls atomic.Int32
			fixture := newClaudeHTTPFixture(t, t.TempDir(), func(w http.ResponseWriter, r *http.Request) {
				var request struct {
					Model    string            `json:"model"`
					Messages []json.RawMessage `json:"messages"`
				}
				if json.NewDecoder(r.Body).Decode(&request) != nil {
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				if request.Model == "worker-model" {
					close(childStarted)
					<-r.Context().Done()
					close(childCancelled)
					return
				}
				call := parentCalls.Add(1)
				if mode == "parent-cancel" && call == 1 {
					close(parentStarted)
					<-r.Context().Done()
					return
				}
				messages, _ := json.Marshal(request.Messages)
				if mode == "parent-cancel" {
					t.Errorf("parent interruption started another model request: %s", messages)
				} else if !strings.Contains(string(messages), "finished with status aborted") {
					t.Errorf("model TaskStop lost its actual terminal notice: %s", messages)
				}
				claudeTextAnswer(w, "Task termination observed.")
			}, true, []AgentDefinition{{Name: "sample:worker", Description: "wait", Instructions: "Wait for work.", Model: "sonnet"}}, ClaudeOptions{BackgroundNotifications: true})
			task := taskReceipt(t, fixture.call(t, fixture.parent, "Agent", `{"subagent_type":"sample:worker","description":"background","prompt":"Wait","run_in_background":true}`))
			select {
			case <-childStarted:
			case <-fixture.ctx.Done():
				t.Fatal("child did not reach its actual provider request")
			}
			if mode == "parent-cancel" {
				done := make(chan error, 1)
				go func() {
					_, err := fixture.parent.Prompt(fixture.ctx, harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "Wait for the child"}}})
					done <- err
				}()
				select {
				case <-parentStarted:
				case <-fixture.ctx.Done():
					t.Fatal("parent did not start its actual provider request")
				}
				fixture.parent.Cancel(context.Canceled)
				select {
				case err := <-done:
					if err == nil {
						t.Fatal("parent cancellation did not abort its turn")
					}
				case <-fixture.ctx.Done():
					t.Fatal("parent cancellation did not settle")
				}
			} else {
				stopped := fixture.call(t, fixture.parent, "TaskStop", fmt.Sprintf(`{"task_id":%q}`, task.ID))
				if stopped.IsError || taskReceipt(t, stopped).Status != harness.SubagentAborted {
					t.Fatalf("model TaskStop did not join its child: %+v", stopped)
				}
			}
			select {
			case <-childCancelled:
			case <-fixture.ctx.Done():
				t.Fatal("actual child provider request was not cancelled")
			}
			result := fixture.call(t, fixture.parent, "TaskOutput", fmt.Sprintf(`{"task_id":%q,"timeout":1000}`, task.ID))
			if got := taskReceipt(t, result); got.Status != harness.SubagentAborted {
				t.Fatalf("cancelled child lost its terminal receipt: %+v", got)
			}
			if _, live := fixture.h.Agents().Get(harness.SessionID(task.ID)); live {
				t.Fatal("terminal task became visible before exact child retirement")
			}
			if err := fixture.parent.WhenIdle(fixture.ctx); err != nil {
				t.Fatal(err)
			}
			if parentCalls.Load() != 1 {
				t.Fatalf("termination made unexpected parent requests: %d", parentCalls.Load())
			}
		})
	}
}

func TestBackgroundNoticeSelection(t *testing.T) {
	for _, test := range []struct {
		name                string
		background, notices bool
		parentCalls         int32
	}{
		{name: "default-background", background: true},
		{name: "selected-background", background: true, notices: true, parentCalls: 1},
		{name: "selected-foreground", notices: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			var parentCalls, childCalls atomic.Int32
			fixture := newClaudeHTTPFixture(t, t.TempDir(), func(w http.ResponseWriter, r *http.Request) {
				var request struct {
					Model string `json:"model"`
				}
				if json.NewDecoder(r.Body).Decode(&request) != nil {
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				if request.Model == "worker-model" {
					childCalls.Add(1)
					claudeTextAnswer(w, "actual child result")
					return
				}
				parentCalls.Add(1)
				claudeTextAnswer(w, "Completion observed.")
			}, true, []AgentDefinition{{Name: "sample:worker", Description: "work", Instructions: "Return a result.", Model: "sonnet"}}, ClaudeOptions{BackgroundNotifications: test.notices})
			result := fixture.call(t, fixture.parent, "Agent", fmt.Sprintf(`{"subagent_type":"sample:worker","description":"work","prompt":"Return","run_in_background":%t}`, test.background))
			if test.background {
				id := taskReceipt(t, result).ID
				result = fixture.call(t, fixture.parent, "TaskOutput", fmt.Sprintf(`{"task_id":%q,"timeout":1000}`, id))
			}
			if result.IsError || taskReceipt(t, result).Status != harness.SubagentCompleted {
				t.Fatalf("task did not complete: %+v", result)
			}
			if err := fixture.parent.WhenIdle(fixture.ctx); err != nil {
				t.Fatal(err)
			}
			if childCalls.Load() != 1 || parentCalls.Load() != test.parentCalls {
				t.Fatalf("notice selection changed execution: child=%d parent=%d want parent=%d", childCalls.Load(), parentCalls.Load(), test.parentCalls)
			}
		})
	}
}
