//go:build linux || darwin

package nativetools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
)

func releaseShellFIFO(ctx context.Context, path string) error {
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

func shellAnswer(text string) harness.Completion {
	return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: text}}}}
}

func TestRetrievedBashCompletionDoesNotWakeAgain(t *testing.T) {
	for _, state := range []string{"completed", "failed", "stopped"} {
		t.Run(state, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
			defer cancel()
			var calls atomic.Int32
			var f *claudeFixture
			var id string
			f = newBackgroundFixture(t, harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
				name, raw := "Bash", json.RawMessage(`{"command":"printf x >> effects; IFS= read -r gate < release.fifo; printf retrieved-marker`+map[string]string{"failed": "; exit 7"}[state]+`","run_in_background":true}`)
				switch calls.Add(1) {
				case 1:
				case 2:
					f.app.background.mu.Lock()
					for taskID := range f.app.background.tasks {
						id = taskID
					}
					f.app.background.mu.Unlock()
					name = "TaskStop"
					if state != "stopped" {
						if err := releaseShellFIFO(ctx, filepath.Join(f.root, "release.fifo")); err != nil {
							return harness.Completion{}, err
						}
						name = "TaskOutput"
					}
					raw = json.RawMessage(fmt.Sprintf(`{"task_id":%q}`, id))
				case 3:
					encoded, _ := json.Marshal(request.Messages)
					if state != "stopped" && !strings.Contains(string(encoded), "retrieved-marker") {
						t.Error("terminal output missing from tool result")
					}
					return shellAnswer("terminal result read"), nil
				default:
					return harness.Completion{}, errors.New("already-read completion caused an extra model request")
				}
				return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, ToolCallID: harness.ToolCallID(fmt.Sprint(calls.Load())), Name: name, Arguments: raw}}}}, nil
			}))
			if err := syscall.Mkfifo(filepath.Join(f.root, "release.fifo"), 0600); err != nil {
				t.Fatal(err)
			}
			disk, err := harness.NewJSONLSessionPersistence(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			detach, err := disk.Attach(ctx, f.allowed.Session())
			if err != nil {
				t.Fatal(err)
			}
			if _, err := f.allowed.Prompt(ctx, harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "run and read one job"}}}); err != nil {
				t.Fatal(err)
			}
			if err := f.allowed.WhenIdle(ctx); err != nil {
				t.Fatal(err)
			}
			if calls.Load() != 3 || len(f.allowed.PendingDurableInbox(harness.InboxNextTurn)) != 0 {
				t.Fatal("read result left a completion wake")
			}
			history, err := foldShellTasks(f.allowed.Session().Events(), f.allowed.ID())
			if err != nil || history[id].observedSeq == 0 {
				t.Fatalf("committed read not retained: %v", err)
			}
			if err := detach(); err != nil {
				t.Fatal(err)
			}
			var resumedCalls atomic.Int32
			fresh, _ := noticeRecoveryRuntime(t, f.root, harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
				resumedCalls.Add(1)
				return shellAnswer("unexpected duplicate"), nil
			}))
			loaded, err := disk.Load(ctx, f.allowed.ID())
			if err != nil {
				t.Fatal(err)
			}
			parent, err := fresh.Agents().Resume(ctx, loaded, harness.AgentOptions{})
			if err != nil {
				t.Fatal(err)
			}
			detach, err = disk.Attach(ctx, parent.Session())
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = detach() })
			if err := parent.ResumeDurableInbox(); err != nil {
				t.Fatal(err)
			}
			if err := parent.WhenIdle(ctx); err != nil {
				t.Fatal(err)
			}
			if resumedCalls.Load() != 0 || len(parent.PendingDurableInbox(harness.InboxNextTurn)) != 0 {
				t.Fatal("disk recovery revived an observed notice")
			}
		})
	}
}

func TestRootBashCompletionWakesWithActualResult(t *testing.T) {
	for _, test := range []struct {
		name       string
		background bool
		promote    bool
		fail       bool
	}{
		{"background success", true, false, false},
		{"background failure", true, false, true},
		{"promoted same PID", false, true, false},
		{"foreground has no notice", false, false, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			defer cancel()
			background := test.background || test.promote
			command := "printf x >> executions; printf '%s' $$ > task.pid; "
			if background {
				command += "IFS= read -r gate < release.fifo; "
			}
			command += "printf '%s' $$ > completed.pid; printf root-completion-marker"
			if test.fail {
				command += "; exit 7"
			}
			timeout := 30000
			if test.promote {
				timeout = 100
			}
			args, _ := json.Marshal(struct {
				Command    string `json:"command"`
				Background bool   `json:"run_in_background"`
				Timeout    int    `json:"timeout"`
			}{command, test.background, timeout})
			var calls atomic.Int32
			notified := make(chan struct{}, 1)
			f := newBackgroundFixture(t, harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
				switch calls.Add(1) {
				case 1:
					return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, ToolCallID: "root-background-command", Name: "Bash", Arguments: args}}}}, nil
				case 2:
					raw, _ := json.Marshal(request.Messages)
					if test.promote && !strings.Contains(string(raw), "moved to the background") {
						t.Error("root command did not promote")
					}
					return shellAnswer("waiting for command completion"), nil
				case 3:
					raw, _ := json.Marshal(request.Messages)
					status := "completed"
					if test.fail {
						status = "failed"
					}
					if !background || !strings.Contains(string(raw), "root-completion-marker") || !strings.Contains(string(raw), "finished with status "+status) {
						t.Error("root notice omitted actual Bash output/status")
					}
					notified <- struct{}{}
					return shellAnswer("actual command result received"), nil
				default:
					return harness.Completion{}, errors.New("duplicate root completion request")
				}
			}))
			gate := filepath.Join(f.root, "release.fifo")
			if background {
				if err := syscall.Mkfifo(gate, 0600); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := f.allowed.Prompt(ctx, harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "run the actual command"}}}); err != nil {
				t.Fatal(err)
			}
			pid := waitShellPID(t, filepath.Join(f.root, "task.pid"))
			if background {
				if syscall.Kill(pid, 0) != nil || calls.Load() != 2 {
					t.Fatal("background process did not survive the root turn")
				}
				if err := releaseShellFIFO(ctx, gate); err != nil {
					t.Fatal(err)
				}
				select {
				case <-notified:
				case <-ctx.Done():
					t.Fatal("root did not resume after Bash completion")
				}
			}
			if err := f.allowed.WhenIdle(ctx); err != nil {
				t.Fatal(err)
			}
			completed := waitShellPID(t, filepath.Join(f.root, "completed.pid"))
			if completed != pid {
				t.Fatal("promotion or notification replaced the original process")
			}
			f.app.background.mu.Lock()
			var task *shellTask
			for _, candidate := range f.app.background.tasks {
				task = candidate
			}
			f.app.background.mu.Unlock()
			if task == nil {
				t.Fatal("actual task disappeared")
			}
			// Repeating completion uses the same inbox identity after consumption.
			f.app.background.notifyRoot(ctx, task, true, nil)
			if err := f.allowed.WhenIdle(ctx); err != nil {
				t.Fatal(err)
			}
			wantCalls, wantTurns, wantNotices := int32(2), 1, 0
			if background {
				wantCalls, wantTurns, wantNotices = 3, 2, 1
			}
			turns, notices := 0, 0
			for _, event := range f.allowed.Session().Events() {
				if event.Type == "turn/end" {
					turns++
				}
				if event.Type == "user/message" && strings.Contains(string(event.Data), "bash-settled") {
					notices++
				}
			}
			data, err := os.ReadFile(filepath.Join(f.root, "executions"))
			if err != nil || string(data) != "x" || f.approvals.Load() != 1 || calls.Load() != wantCalls || turns != wantTurns || notices != wantNotices {
				t.Fatalf("replayed effect/approval/notice: effects=%q approvals=%d calls=%d turns=%d notices=%d %v", data, f.approvals.Load(), calls.Load(), turns, notices, err)
			}
		})
	}
}

func TestStoppedRootDoesNotReceiveBashCompletion(t *testing.T) {
	for _, interrupt := range []bool{true, false} {
		t.Run(fmt.Sprint("interrupt=", interrupt), func(t *testing.T) {
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			defer cancel()
			active := make(chan struct{})
			var calls atomic.Int32
			f := newBackgroundFixture(t, harness.AdapterFunc(func(ctx context.Context, _ harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
				if calls.Add(1) == 1 {
					return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, ToolCallID: "cancelled-command", Name: "Bash", Arguments: json.RawMessage(`{"command":"printf x >> executions; printf '%s' $$ > task.pid; IFS= read -r gate < release.fifo","run_in_background":true}`)}}}}, nil
				}
				if calls.Load() != 2 {
					return harness.Completion{}, errors.New("stopped root was reactivated")
				}
				close(active)
				if interrupt {
					<-ctx.Done()
					return harness.Completion{}, ctx.Err()
				}
				return shellAnswer("idle until owner retires"), nil
			}))
			if err := syscall.Mkfifo(filepath.Join(f.root, "release.fifo"), 0600); err != nil {
				t.Fatal(err)
			}
			promptDone := make(chan error, 1)
			go func() {
				_, err := f.allowed.Prompt(ctx, harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "start command"}}})
				promptDone <- err
			}()
			select {
			case <-active:
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
			pid := waitShellPID(t, filepath.Join(f.root, "task.pid"))
			if interrupt {
				if err := f.allowed.InterruptDSH(errors.New("user stopped root turn")); err != nil {
					t.Fatal(err)
				}
			}
			select {
			case <-promptDone:
			case <-ctx.Done():
				t.Fatal("root prompt did not stop")
			}
			if err := f.allowed.WhenIdle(ctx); err != nil {
				t.Fatal(err)
			}
			if !interrupt {
				if err := f.harness.Agents().RemoveExact(ctx, f.allowed); err != nil && !errors.Is(err, harness.ErrAgentDisposalInProgress) {
					t.Fatal(err)
				}
				if err := f.harness.Agents().WaitRetired(ctx, f.allowed); err != nil {
					t.Fatal(err)
				}
			}
			if syscall.Kill(pid, 0) == nil || calls.Load() != 2 || len(f.allowed.PendingDurableInbox(harness.InboxNextTurn)) != 0 {
				t.Fatal("root stop left a live process or queued a completion wake")
			}
		})
	}
}

func TestRootBashUnconfirmedTerminalDoesNotWake(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	var calls atomic.Int32
	f := newBackgroundFixture(t, harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		calls.Add(1)
		return shellAnswer("must not see unconfirmed terminal"), nil
	}))
	var ended atomic.Bool
	if _, err := f.allowed.Session().Append("turn/start", struct {
		Turn int `json:"turn"`
	}{1}); err != nil {
		t.Fatal(err)
	}
	unsubscribe := f.allowed.Session().Subscribe(func(event harness.Event) {
		if event.Type == shellTaskEnded {
			ended.Store(true)
		}
	})
	defer unsubscribe()
	remove, err := f.allowed.Session().InstallDurabilityCheckpoint(func(context.Context) error {
		if ended.Load() {
			return errors.New("terminal checkpoint failed")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	defer remove()
	receipt := startShell(t, f, "printf x >> effects; printf actual-unconfirmed-result")
	handle, found, err := f.app.LookupTask(ctx, f.allowed, receipt.ID)
	if err != nil || !found {
		t.Fatal(err)
	}
	select {
	case <-handle.Done:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	if err := f.app.background.reconcileNotices(ctx, f.allowed, false); err != nil {
		t.Fatal(err)
	}
	remove() // End fault injection before verifying ordinary owner cleanup.
	if err := f.harness.Dispose(ctx); err != nil {
		t.Fatal(err)
	}
	if err := f.harness.Drain(ctx); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 0 || len(f.allowed.PendingDurableInbox(harness.InboxNextTurn)) != 0 || !handle.Snapshot(harness.TaskRetrieved).IsError {
		t.Fatal("unconfirmed completion became an automatic root request")
	}
	data, err := os.ReadFile(filepath.Join(f.root, "effects"))
	if err != nil || string(data) != "x" || f.approvals.Load() != 1 {
		t.Fatal("completion failure hid or replayed the actual command effect")
	}
}
