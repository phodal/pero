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
	"syscall"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
)

type promotedReceipt struct {
	ID                string `json:"task_id"`
	Promoted          bool   `json:"promoted"`
	Message           string `json:"message"`
	WorkingLog        string `json:"working_log_file"`
	BackgroundTimeout int64  `json:"background_timeout_ms"`
	NoDeadline        bool   `json:"no_deadline"`
}

const gatedBashCommand = `printf x >> effects; printf '%s' $$ > process.pid; printf 'before:%s\n' $$; while [ ! -f release ]; do sleep 0.01; done; printf 'after:%s\n' $$`

func promoteBash(t *testing.T, f *claudeFixture, ctx context.Context, command string) promotedReceipt {
	t.Helper()
	raw, err := json.Marshal(struct {
		Command string `json:"command"`
		Timeout int    `json:"timeout"`
	}{command, 150})
	if err != nil {
		t.Fatal(err)
	}
	outcome, err := f.harness.Tools().Execute(ctx, harness.ToolRequest{Agent: f.allowed, Name: "Bash", CallID: harness.ToolCallID(fmt.Sprintf("promote-%d", f.calls.Add(1))), Arguments: raw})
	if err != nil {
		t.Fatal(err)
	}
	response := outcome.Result
	var receipt promotedReceipt
	if response.IsError || len(response.Content) != 1 || json.Unmarshal([]byte(response.Content[0].Text), &receipt) != nil || !receipt.Promoted || receipt.ID == "" || receipt.WorkingLog == "" || !strings.Contains(receipt.Message, "moved to the background") {
		t.Fatalf("Bash did not promote its live process: %+v", response)
	}
	return receipt
}

func TestForegroundPromotionKeepsOneRealProcessAndDurableIdentity(t *testing.T) {
	f := newBackgroundFixture(t)
	persistence, err := harness.NewJSONLSessionPersistence(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	detach, err := persistence.Attach(t.Context(), f.allowed.Session())
	if err != nil {
		t.Fatal(err)
	}
	defer detach()
	callContext, cancelCall := context.WithCancel(t.Context())
	defer cancelCall()
	receipt := promoteBash(t, f, callContext, gatedBashCommand)
	cancelCall()
	pid := waitShellPID(t, filepath.Join(f.root, "process.pid"))
	if err := syscall.Kill(pid, 0); err != nil {
		t.Fatalf("promoted process already died: %v", err)
	}
	loaded, err := persistence.Load(t.Context(), f.allowed.ID())
	if err != nil {
		t.Fatal(err)
	}
	history, err := foldShellTasks(loaded.Events(), f.allowed.ID())
	if err != nil || history[receipt.ID].promotion == nil || history[receipt.ID].terminal != nil || history[receipt.ID].intent.Background {
		t.Fatalf("promotion did not preserve its foreground intent: %+v error=%v", history, err)
	}
	if err := os.WriteFile(filepath.Join(f.root, "release"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	result := f.call(t, f.allowed, "TaskOutput", taskQuery(receipt.ID, true, 2000))
	terminal := shellReceipt(t, result)
	if result.IsError || terminal.Status != shellTaskCompleted || terminal.Result == nil || terminal.Result.Stdout.Text != fmt.Sprintf("before:%d\nafter:%d\n", pid, pid) {
		t.Fatalf("promotion changed/restarted the process: %+v", terminal)
	}
	if effects, err := os.ReadFile(filepath.Join(f.root, "effects")); err != nil || string(effects) != "x" || f.approvals.Load() != 1 {
		t.Fatalf("promotion repeated effects/approval: %q %d %v", effects, f.approvals.Load(), err)
	}
}

func TestPromotionFlushFailureCancelsAndJoinsWithoutRetry(t *testing.T) {
	f := newBackgroundFixture(t)
	detach, err := f.allowed.Session().InstallDurabilityCheckpoint(func(context.Context) error {
		for _, event := range f.allowed.Session().Events() {
			if event.Type == shellTaskPromoted {
				return errors.New("fixture promotion flush failure")
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	defer detach()
	response := f.call(t, f.allowed, "Bash", struct {
		Command string `json:"command"`
		Timeout int    `json:"timeout"`
	}{gatedBashCommand, 150})
	if !response.IsError || !strings.Contains(response.Content[0].Text, "persist Bash promotion") {
		t.Fatalf("promotion flush failure was hidden: %+v", response)
	}
	pid := waitShellPID(t, filepath.Join(f.root, "process.pid"))
	if err := syscall.Kill(pid, 0); !errors.Is(err, syscall.ESRCH) {
		t.Fatalf("failed promotion left its process alive: %v", err)
	}
	if effects, err := os.ReadFile(filepath.Join(f.root, "effects")); err != nil || string(effects) != "x" {
		t.Fatalf("failed promotion replayed effects: %q %v", effects, err)
	}
}

func TestPromotedBashStopsWithItsExactOwner(t *testing.T) {
	for _, action := range []string{"TaskStop", "owner retirement"} {
		t.Run(action, func(t *testing.T) {
			f := newBackgroundFixture(t)
			receipt := promoteBash(t, f, t.Context(), gatedBashCommand)
			pid := waitShellPID(t, filepath.Join(f.root, "process.pid"))
			if action == "TaskStop" {
				response := f.call(t, f.allowed, "TaskStop", struct {
					ID string `json:"task_id"`
				}{receipt.ID})
				if response.IsError {
					t.Fatal(response)
				}
			} else if err := f.harness.Agents().RemoveExact(t.Context(), f.allowed); err != nil {
				t.Fatal(err)
			}
			if err := syscall.Kill(pid, 0); !errors.Is(err, syscall.ESRCH) {
				t.Fatalf("promoted process outlived its owner/stop: %v", err)
			}
			if effects, err := os.ReadFile(filepath.Join(f.root, "effects")); err != nil || string(effects) != "x" {
				t.Fatalf("ownership cleanup replayed effects: %q %v", effects, err)
			}
		})
	}
}

func TestBashPromotionExceptionsAndBackgroundHostModes(t *testing.T) {
	for _, test := range []struct {
		name        string
		options     BashTimingOptions
		environment []string
		command     string
	}{
		{"sleep", BashTimingOptions{}, nil, "sleep 30"},
		{"disabled", BashTimingOptions{DisableBackground: true}, nil, gatedBashCommand},
		{"bare", BashTimingOptions{Bare: true}, nil, gatedBashCommand},
		{"environment", BashTimingOptions{}, []string{"CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1"}, gatedBashCommand},
	} {
		t.Run(test.name, func(t *testing.T) {
			f := newClaudeFixture(t, Options{EnableShell: true, BashTiming: test.options, PluginEnvironment: test.environment})
			response := f.call(t, f.allowed, "Bash", struct {
				Command string `json:"command"`
				Timeout int    `json:"timeout"`
			}{test.command, 100})
			if !response.IsError || !strings.Contains(response.Content[0].Text, `"timedOut":true`) {
				t.Fatalf("exception did not stop at foreground deadline: %+v", response)
			}
			history, err := foldShellTasks(f.allowed.Session().Events(), f.allowed.ID())
			if err != nil {
				t.Fatal(err)
			}
			for _, task := range history {
				if task.promotion != nil {
					t.Fatal("exception manufactured promotion")
				}
			}
		})
	}
	for _, mode := range []BashHostMode{BashUnattended, BashInteractive} {
		t.Run(string(mode), func(t *testing.T) {
			f := newBackgroundFixture(t)
			f.app.background.timingPolicy.mode = mode
			f.app.background.timingPolicy.backgroundDefault = 50 * time.Millisecond
			receipt := promoteBash(t, f, t.Context(), gatedBashCommand)
			if mode == BashUnattended {
				result := f.call(t, f.allowed, "TaskOutput", taskQuery(receipt.ID, true, 2000))
				terminal := shellReceipt(t, result)
				if !result.IsError || terminal.Result == nil || !terminal.Result.TimedOut || receipt.BackgroundTimeout != 50 {
					t.Fatalf("promoted background deadline=%+v receipt=%+v", terminal, receipt)
				}
			} else {
				if !receipt.NoDeadline || receipt.BackgroundTimeout != 0 {
					t.Fatalf("interactive background acquired a deadline: %+v", receipt)
				}
				waiting := shellReceipt(t, f.call(t, f.allowed, "TaskOutput", taskQuery(receipt.ID, true, 100)))
				if waiting.Status != shellTaskRunning || waiting.Retrieval != harness.TaskTimedOut {
					t.Fatalf("interactive run expired at unattended deadline: %+v", waiting)
				}
				f.call(t, f.allowed, "TaskStop", struct {
					ID string `json:"task_id"`
				}{receipt.ID})
			}
		})
	}
}

func TestBoundedBashCheckTerminatesOwnedProcess(t *testing.T) {
	f := newBackgroundFixture(t)
	response := f.call(t, f.allowed, "Bash", map[string]any{
		"command": gatedBashCommand, "timeout": 150, "terminate_on_timeout": true,
	})
	if !response.IsError || !strings.Contains(response.Content[0].Text, `"timedOut":true`) {
		t.Fatalf("bounded check did not time out: %+v", response)
	}
	pid := waitShellPID(t, filepath.Join(f.root, "process.pid"))
	if err := syscall.Kill(pid, 0); !errors.Is(err, syscall.ESRCH) {
		t.Fatalf("bounded check left its process alive: %v", err)
	}
	history, err := foldShellTasks(f.allowed.Session().Events(), f.allowed.ID())
	if err != nil || len(history) != 1 {
		t.Fatalf("invalid bounded check journal: %+v %v", history, err)
	}
	for _, task := range history {
		if !task.intent.TerminateOnTimeout || task.promotion != nil || task.terminal == nil {
			t.Fatalf("bounded check promoted or lost terminal receipt: %+v", task)
		}
	}
	if effects, err := os.ReadFile(filepath.Join(f.root, "effects")); err != nil || string(effects) != "x" {
		t.Fatalf("bounded check replayed effects: %q %v", effects, err)
	}
	response = f.call(t, f.allowed, "Bash", map[string]any{
		"command": "printf forbidden > forbidden", "run_in_background": true, "terminate_on_timeout": true,
	})
	if !response.IsError {
		t.Fatal("incompatible background check was admitted")
	}
	if _, err := os.Stat(filepath.Join(f.root, "forbidden")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("invalid bounded check executed")
	}
}
