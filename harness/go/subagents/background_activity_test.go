//go:build linux || darwin

package subagents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/nativetools"
)

func activityProcessPID(ctx context.Context, path string) (int, error) {
	tick := time.NewTicker(5 * time.Millisecond)
	defer tick.Stop()
	for {
		data, _ := os.ReadFile(path)
		if pid, err := strconv.Atoi(string(data)); err == nil && pid > 0 {
			return pid, nil
		}
		select {
		case <-ctx.Done():
			return 0, ctx.Err()
		case <-tick.C:
		}
	}
}

func releaseActivityProcess(ctx context.Context, path string) error {
	tick := time.NewTicker(5 * time.Millisecond)
	defer tick.Stop()
	for {
		file, err := os.OpenFile(path, os.O_WRONLY|syscall.O_NONBLOCK, 0)
		if err == nil {
			_, err = file.WriteString("release\n")
			return errors.Join(err, file.Close())
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-tick.C:
		}
	}
}

func TestClaudeBackgroundBashActivityAcrossTurnsAndRetirement(t *testing.T) {
	for _, test := range []struct {
		name       string
		background bool
		promote    bool
		resume     bool
		action     string
	}{
		{"background completion", true, false, false, "complete"},
		{"promoted same process", true, true, false, "complete"},
		{"resumed background completion", true, false, true, "complete"},
		{"foreground stops commands", false, false, false, "foreground"},
		{"background TaskStop", true, false, false, "stop"},
		{"background archive stop", true, false, false, "archive"},
		{"background parent retirement", true, false, false, "retire"},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			gate := filepath.Join(root, "release.fifo")
			if err := syscall.Mkfifo(gate, 0600); err != nil {
				t.Fatal(err)
			}
			command := "printf x >> executions; printf '%s' $$ > command.pid; IFS= read -r gate < release.fifo; printf '%s' $$ > completed.pid; printf completion-marker"
			timeout := 30000
			if test.promote {
				timeout = 100
			}
			arguments, _ := json.Marshal(struct {
				Command    string `json:"command"`
				Background bool   `json:"run_in_background"`
				Timeout    int    `json:"timeout"`
			}{command, !test.promote, timeout})
			encodedArgs, _ := json.Marshal(string(arguments))
			ready, parentNotice := make(chan int, 1), make(chan struct{}, 1)
			var childCalls, parentCalls atomic.Int32
			offset := int32(0)
			if test.resume {
				offset = 1
			}
			f := newClaudeHTTPFixture(t, root, func(w http.ResponseWriter, r *http.Request) {
				var request struct {
					Model    string          `json:"model"`
					Messages json.RawMessage `json:"messages"`
				}
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
					t.Error(err)
				}
				if request.Model == "parent-model" {
					parentCalls.Add(1)
					if !strings.Contains(string(request.Messages), "child-processed-command") {
						t.Error("parent received an earlier answer before command completion was processed")
					}
					claudeTextAnswer(w, "parent received final child result")
					parentNotice <- struct{}{}
					return
				}
				call := childCalls.Add(1)
				if test.resume && call == 1 {
					claudeTextAnswer(w, "original-conversation")
					return
				}
				switch call - offset {
				case 1:
					claudeHTTPAnswer(w, fmt.Sprintf(`{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"launch-owned-command","type":"function","function":{"name":"Bash","arguments":%s}}]},"finish_reason":"tool_calls"}]}`, encodedArgs))
				case 2:
					pid, err := activityProcessPID(r.Context(), filepath.Join(root, "command.pid"))
					if err != nil {
						t.Error(err)
					}
					if test.promote && !strings.Contains(string(request.Messages), "moved to the background") {
						t.Error("command did not promote from foreground")
					}
					ready <- pid
					claudeTextAnswer(w, "waiting-for-command")
				case 3:
					if test.action != "complete" || !strings.Contains(string(request.Messages), "Background Bash") || !strings.Contains(string(request.Messages), "completion-marker") || !strings.Contains(string(request.Messages), "waiting-for-command") {
						t.Error("completion turn omitted the original history or actual Bash result")
					}
					if test.resume && !strings.Contains(string(request.Messages), "original-conversation") {
						t.Error("activity completion lost the resumed conversation")
					}
					claudeTextAnswer(w, "child-processed-command")
				default:
					t.Error("duplicate child execution")
					claudeTextAnswer(w, "unexpected")
				}
			}, true, nil, ClaudeOptions{BackgroundNotifications: test.action == "complete"}, nativetools.Options{Workspace: root, ClaudeTools: true, EnableShell: true})
			input := fmt.Sprintf(`{"subagent_type":"general-purpose","model":"sonnet","description":"owned activity","prompt":"Run the command and process its eventual completion","run_in_background":%t}`, test.background)
			var receipt claudeTaskReceipt
			if test.resume {
				initial := taskReceipt(t, f.call(t, f.parent, "Agent", `{"subagent_type":"general-purpose","model":"sonnet","description":"initial conversation","prompt":"remember the original conversation"}`))
				receipt = taskReceipt(t, f.call(t, f.parent, "SendMessage", fmt.Sprintf(`{"to":%q,"message":"continue with the owned command"}`, initial.ID)))
				if receipt.ID != initial.ID {
					t.Fatal("background continuation replaced the child identity")
				}
			} else {
				receipt = taskReceipt(t, f.call(t, f.parent, "Agent", input))
			}
			var pid int
			select {
			case pid = <-ready:
			case <-f.ctx.Done():
				t.Fatal(f.ctx.Err())
			}
			if test.background {
				child, found := f.h.Agents().Get(harness.SessionID(receipt.ID))
				if !found {
					t.Fatal("background child was removed before its command finished")
				}
				if err := child.WhenIdle(f.ctx); err != nil {
					t.Fatal(err)
				}
				if err := syscall.Kill(pid, 0); err != nil {
					t.Fatalf("command died after the child turn: %v", err)
				}
				query := fmt.Sprintf(`{"task_id":%q,"block":false,"timeout":0}`, receipt.ID)
				if snapshot := taskReceipt(t, f.call(t, f.parent, "TaskOutput", query)); snapshot.Status != harness.SubagentRunning {
					t.Fatalf("unfinished activity published a final result: %+v", snapshot)
				}
				switch test.action {
				case "complete":
					if err := releaseActivityProcess(f.ctx, gate); err != nil {
						t.Fatal(err)
					}
					select {
					case <-parentNotice:
					case <-f.ctx.Done():
						t.Fatal("Bash completion did not resume the original child and notify its parent")
					}
					if err := f.parent.WhenIdle(f.ctx); err != nil {
						t.Fatal(err)
					}
					completed, err := activityProcessPID(f.ctx, filepath.Join(root, "completed.pid"))
					if err != nil || completed != pid || childCalls.Load() != 3+offset || parentCalls.Load() != 1 {
						t.Fatalf("completion identity/counts: %d %d child=%d parent=%d %v", pid, completed, childCalls.Load(), parentCalls.Load(), err)
					}
				case "stop":
					result := f.call(t, f.parent, "TaskStop", fmt.Sprintf(`{"task_id":%q}`, receipt.ID))
					if result.IsError {
						t.Fatal(result)
					}
				case "retire":
					if err := f.h.Agents().RemoveExact(f.ctx, f.parent); err != nil && !errors.Is(err, harness.ErrAgentDisposalInProgress) {
						t.Fatal(err)
					}
					if err := f.h.Agents().WaitRetired(f.ctx, f.parent); err != nil {
						t.Fatal(err)
					}
				case "archive":
					snapshot := f.h.Subagents().CaptureSessionActivity(f.parent.ID())
					if !snapshot.Active {
						t.Fatal("archive missed the retained process")
					}
					if err := snapshot.Stop(f.ctx); err != nil {
						t.Fatal(err)
					}
					query := fmt.Sprintf(`{"task_id":%q,"block":true,"timeout":3000}`, receipt.ID)
					if result := taskReceipt(t, f.call(t, f.parent, "TaskOutput", query)); result.Status != harness.SubagentAborted {
						t.Fatalf("archive did not settle retained activity: %+v", result)
					}
				}
			} else if receipt.Status != harness.SubagentCompleted {
				t.Fatalf("foreground result: %+v", receipt)
			}
			if test.action != "complete" {
				if syscall.Kill(pid, 0) == nil {
					t.Fatal("stopped owner left its command alive")
				}
				if childCalls.Load() != 2 || parentCalls.Load() != 0 {
					t.Fatal("stopped child or parent was unexpectedly resumed")
				}
			}
			data, err := os.ReadFile(filepath.Join(root, "executions"))
			if err != nil || string(data) != "x" || f.approvals.Load() != 1 {
				t.Fatalf("command/approval replay: %q approvals=%d %v", data, f.approvals.Load(), err)
			}
		})
	}
}
