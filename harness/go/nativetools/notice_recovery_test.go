//go:build linux || darwin

package nativetools

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/shell"
)

func noticeRecoveryRuntime(t *testing.T, workspace string, adapter harness.Adapter) (*harness.Harness, *App) {
	t.Helper()
	h, err := harness.Boot(t.Context(), harness.Options{Adapter: adapter})
	if err != nil {
		t.Fatal(err)
	}
	app, err := Mount(t.Context(), h, Options{Workspace: workspace, ClaudeTools: true, EnableShell: true, BackgroundNotifications: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = h.Dispose(context.Background())
		if err := h.Drain(context.Background()); err != nil {
			t.Error(err)
		}
		_ = app.Close()
	})
	return h, app
}

func TestRootBashNoticeDiskRecoveryDoesNotReplayCommand(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	var originalCalls atomic.Int32
	f := newBackgroundFixture(t, harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		switch originalCalls.Add(1) {
		case 1:
			return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, ToolCallID: "disk-command", Name: "Bash", Arguments: json.RawMessage(`{"command":"printf x >> effects; printf '%s' $$ > task.pid; IFS= read -r gate < release.fifo; printf actual-disk-completion","run_in_background":true}`)}}}}, nil
		case 2:
			return shellAnswer("waiting for command"), nil
		default:
			return harness.Completion{}, errors.New("fault injection did not suppress the original notice")
		}
	}))
	gate := filepath.Join(f.root, "release.fifo")
	if err := syscall.Mkfifo(gate, 0600); err != nil {
		t.Fatal(err)
	}
	directory := t.TempDir()
	disk, err := harness.NewJSONLSessionPersistence(directory)
	if err != nil {
		t.Fatal(err)
	}
	detach, err := disk.Attach(ctx, f.allowed.Session())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.allowed.Prompt(ctx, harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "run the original command once"}}}); err != nil {
		t.Fatal(err)
	}
	waitShellPID(t, filepath.Join(f.root, "task.pid"))
	var original *shellTask
	f.app.background.mu.Lock()
	for _, task := range f.app.background.tasks {
		original = task
	}
	f.app.background.mu.Unlock()
	// Fault injection at the actual terminal boundary: fence online delivery
	// after the process effect, retaining its source fact for a fresh runtime.
	unsubscribe := f.allowed.Session().Subscribe(func(event harness.Event) {
		if event.Type == shellTaskEnded {
			f.app.background.mu.Lock()
			f.app.background.fenced[f.allowed] = true
			f.app.background.mu.Unlock()
		}
	})
	if err := releaseShellFIFO(ctx, gate); err != nil {
		t.Fatal(err)
	}
	select {
	case <-original.done:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	unsubscribe()
	if err := f.harness.Dispose(ctx); err != nil && !errors.Is(err, harness.ErrHarnessDisposalInProgress) {
		t.Fatal(err)
	}
	if err := f.harness.Drain(ctx); err != nil {
		t.Fatal(err)
	}
	if err := detach(); err != nil {
		t.Fatal(err)
	}
	if len(f.allowed.PendingDurableInbox(harness.InboxNextTurn)) != 0 || originalCalls.Load() != 2 || f.approvals.Load() != 1 {
		t.Fatal("missing real execution or fault window")
	}
	for restart := 0; restart < 2; restart++ {
		var calls atomic.Int32
		fresh, app := noticeRecoveryRuntime(t, f.root, harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
			calls.Add(1)
			raw, _ := json.Marshal(request.Messages)
			if !strings.Contains(string(raw), "actual-disk-completion") {
				t.Error("recovery did not deliver the actual command result")
			}
			return shellAnswer("recovered command result"), nil
		}))
		reader, err := harness.NewJSONLSessionPersistence(directory)
		if err != nil {
			t.Fatal(err)
		}
		loaded, err := reader.Load(ctx, f.allowed.ID())
		if err != nil {
			t.Fatal(err)
		}
		parent, err := fresh.Agents().Resume(ctx, loaded, harness.AgentOptions{})
		if err != nil {
			t.Fatal(err)
		}
		if calls.Load() != 0 {
			t.Fatal("recovery ran before persistence/controller readiness")
		}
		detach, err := reader.Attach(ctx, parent.Session())
		if err != nil {
			t.Fatal(err)
		}
		if err := parent.ResumeDurableInbox(); err != nil {
			t.Fatal(err)
		}
		if err := parent.WhenIdle(ctx); err != nil {
			t.Fatal(err)
		}
		want := int32(1 - restart)
		if calls.Load() != want {
			t.Fatalf("restart=%d model calls=%d want=%d", restart, calls.Load(), want)
		}
		handle, found, err := app.LookupTask(ctx, parent, original.intent.ID)
		if err != nil || !found || restart == 0 && handle.Snapshot(harness.TaskRetrieved).IsError {
			t.Fatalf("actual result unavailable: %v", err)
		}
		starts, notices := 0, 0
		for _, event := range parent.Session().Events() {
			if event.Type == shellTaskStarted {
				starts++
			}
			if event.Type == "user/message" && strings.Contains(string(event.Data), "bash-settled") {
				notices++
			}
		}
		if starts != 1 || notices != 1 {
			t.Fatalf("source or notice replay: starts=%d notices=%d", starts, notices)
		}
		if data, err := os.ReadFile(filepath.Join(f.root, "effects")); err != nil || string(data) != "x" {
			t.Fatal("recovery executed the command again")
		}
		if err := detach(); err != nil {
			t.Fatal(err)
		}
		_ = fresh.Dispose(ctx)
		if err := fresh.Drain(ctx); err != nil {
			t.Fatal(err)
		}
		if restart == 0 {
			// Losing a saved file changes TaskOutput's current availability, not
			// the content of a notice already accepted under its stable ID.
			if err := os.Remove(original.intent.OutputFile); err != nil {
				t.Fatal(err)
			}
		}
	}
}

func TestRootBashRecoveryStagesTerminalOrderAndLostOwners(t *testing.T) {
	for _, interrupted := range []bool{false, true} {
		t.Run(map[bool]string{false: "terminal FIFO", true: "stopped root and lost owner"}[interrupted], func(t *testing.T) {
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			defer cancel()
			workspace, directory := t.TempDir(), t.TempDir()
			session := harness.NewSession("notice-recovery", workspace)
			_, _ = session.Append("turn/start", struct {
				Turn int `json:"turn"`
			}{1})
			reason := harness.FinishStop
			if interrupted {
				reason = harness.FinishAborted
			}
			_, _ = session.Append("turn/end", struct {
				Turn   int                `json:"turn"`
				Reason harness.FinishKind `json:"reason"`
			}{1, reason})
			for _, id := range []string{"bash-first", "bash-second"} {
				_, _ = session.Append(shellTaskStarted, shellTaskIntent{Version: 1, ID: id, Owner: session.Header().ID, Command: "printf replayed > forbidden-replay", Workdir: workspace, TimeoutMS: 30000, Background: true})
			}
			if !interrupted {
				zero := 0
				for _, id := range []string{"bash-second", "bash-first"} {
					_, _ = session.Append(shellTaskEnded, shellTaskTerminal{Version: 1, ID: id, Owner: session.Header().ID, Status: shellTaskCompleted, Result: &shell.RunResult{ExitCode: &zero}})
				}
			}
			disk, _ := harness.NewJSONLSessionPersistence(directory)
			detach, err := disk.Attach(ctx, session)
			if err != nil {
				t.Fatal(err)
			}
			if err := detach(); err != nil {
				t.Fatal(err)
			}
			var calls atomic.Int32
			h, _ := noticeRecoveryRuntime(t, workspace, harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
				call := calls.Add(1)
				raw, _ := json.Marshal(request.Messages)
				text := string(raw)
				if !interrupted {
					second, first := strings.Index(text, "bash-second"), strings.Index(text, "bash-first")
					if second < 0 || call == 1 && first >= 0 || call == 2 && first < second {
						t.Error("recovery did not consume notices in terminal FIFO order")
					}
				}
				return shellAnswer("recovery observed"), nil
			}))
			loaded, err := disk.Load(ctx, session.Header().ID)
			if err != nil {
				t.Fatal(err)
			}
			parent, err := h.Agents().Resume(ctx, loaded, harness.AgentOptions{})
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
			if interrupted {
				if calls.Load() != 0 || len(parent.PendingDurableInbox(harness.InboxNextTurn)) != 0 {
					t.Fatal("stopped controlling turn resumed automatically")
				}
				if _, err := parent.Prompt(ctx, harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "inspect prior task results"}}}); err != nil {
					t.Fatal(err)
				}
				if err := parent.WhenIdle(ctx); err != nil {
					t.Fatal(err)
				}
			} else if calls.Load() != 2 {
				t.Fatalf("two FIFO notices opened %d model turns", calls.Load())
			}
			history, err := foldShellTasks(parent.Session().Events(), parent.ID())
			if err != nil || interrupted && (history["bash-first"].terminal.Status != shellTaskInterrupted || history["bash-second"].terminal.Status != shellTaskInterrupted) {
				t.Fatal("lost owner was presented as a completed command")
			}
			if _, err := os.Stat(filepath.Join(workspace, "forbidden-replay")); !os.IsNotExist(err) {
				t.Fatal("recovery replayed a historical intent")
			}
		})
	}
}
