//go:build linux || darwin

package nativetools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/shell"
)

type shellTaskReceipt struct {
	ID                string                 `json:"task_id"`
	Status            shellTaskStatus        `json:"status"`
	Retrieval         harness.TaskRetrieval  `json:"retrieval_status"`
	Diagnostic        string                 `json:"diagnostic"`
	Output            *shell.CollectedOutput `json:"output"`
	Result            *shell.RunResult       `json:"result"`
	OutputFile        string                 `json:"output_file"`
	OutputFilePartial bool                   `json:"output_file_partial"`
	WorkingLogFile    string                 `json:"working_log_file"`
	WorkingLogPartial bool                   `json:"working_log_partial"`
}

func shellReceipt(t *testing.T, result harness.ToolResult) shellTaskReceipt {
	t.Helper()
	var receipt shellTaskReceipt
	if len(result.Content) == 0 || json.Unmarshal([]byte(result.Content[0].Text), &receipt) != nil || receipt.ID == "" {
		t.Fatalf("invalid task receipt: %+v", result)
	}
	return receipt
}

func newBackgroundFixture(t *testing.T) *claudeFixture {
	t.Helper()
	f := newClaudeFixture(t, Options{EnableShell: true})
	for _, tool := range []harness.Tool{harness.TaskOutputTool(f.app.LookupTask), harness.TaskStopTool(f.app.LookupTask)} {
		if _, err := f.harness.RegisterTool(t.Context(), "fixture/"+tool.Schema.Name, tool); err != nil {
			t.Fatal(err)
		}
	}
	return f
}

func startShell(t *testing.T, f *claudeFixture, command string) shellTaskReceipt {
	t.Helper()
	result := f.call(t, f.allowed, "Bash", struct {
		Command    string `json:"command"`
		Background bool   `json:"run_in_background"`
	}{command, true})
	if result.IsError {
		t.Fatalf("background start failed: %+v", result)
	}
	return shellReceipt(t, result)
}

func taskQuery(id string, block bool, timeout int) struct {
	ID      string `json:"task_id"`
	Block   bool   `json:"block"`
	Timeout int    `json:"timeout"`
} {
	return struct {
		ID      string `json:"task_id"`
		Block   bool   `json:"block"`
		Timeout int    `json:"timeout"`
	}{id, block, timeout}
}

func waitShellPID(t *testing.T, path string) int {
	t.Helper()
	timer := time.NewTimer(3 * time.Second)
	defer timer.Stop()
	ticker := time.NewTicker(5 * time.Millisecond)
	defer ticker.Stop()
	for {
		data, _ := os.ReadFile(path)
		pid, _ := strconv.Atoi(strings.TrimSpace(string(data)))
		if pid > 0 {
			return pid
		}
		select {
		case <-timer.C:
			t.Fatal("shell did not publish its process ID")
		case <-ticker.C:
		}
	}
}

func TestBackgroundShellOutputWaitAndOwnership(t *testing.T) {
	f := newBackgroundFixture(t)
	task := startShell(t, f, "printf '%s' $$ > task.pid; printf started; while [ ! -f release ]; do sleep .01; done; printf finished")
	waitShellPID(t, filepath.Join(f.root, "task.pid"))
	query := taskQuery(task.ID, false, 0)
	ready := false
	deadline := time.NewTimer(3 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(5 * time.Millisecond)
	defer ticker.Stop()
	for !ready {
		receipt := shellReceipt(t, f.call(t, f.allowed, "TaskOutput", query))
		ready = receipt.Status == shellTaskRunning && receipt.Retrieval == harness.TaskNotReady && receipt.Output != nil && strings.Contains(receipt.Output.Text, "started")
		if !ready {
			select {
			case <-deadline.C:
				t.Fatal("running output was not observable")
			case <-ticker.C:
			}
		}
	}
	if denied := f.call(t, f.denied, "TaskOutput", query); !denied.IsError {
		t.Fatal("another exact parent read the task")
	}
	if receipt := shellReceipt(t, f.call(t, f.allowed, "TaskOutput", taskQuery(task.ID, true, 1))); receipt.Status != shellTaskRunning || receipt.Retrieval != harness.TaskTimedOut {
		t.Fatalf("read timeout changed the task: %+v", receipt)
	}
	if err := os.WriteFile(filepath.Join(f.root, "release"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	result := f.call(t, f.allowed, "TaskOutput", taskQuery(task.ID, true, 2000))
	receipt := shellReceipt(t, result)
	if result.IsError || receipt.Status != shellTaskCompleted || receipt.Result == nil || receipt.Result.Stdout.Text != "startedfinished" {
		t.Fatalf("join lost actual result: %+v %+v", receipt, result)
	}
	stopped := shellReceipt(t, f.call(t, f.allowed, "TaskStop", struct {
		ID string `json:"task_id"`
	}{task.ID}))
	if stopped.Status != shellTaskCompleted || stopped.Result == nil || stopped.Result.Stdout.Text != "startedfinished" {
		t.Fatalf("stop changed a completed result: %+v", stopped)
	}
	intents, err := foldShellTasks(f.allowed.Session().Events(), f.allowed.ID())
	if err != nil || intents[task.ID].intent.TimeoutMS != backgroundShellDefault.Milliseconds() || intents[task.ID].terminal == nil {
		t.Fatalf("durable intent or terminal missing: %+v %v", intents, err)
	}
}

func TestBackgroundShellCancellationJoinsRealProcess(t *testing.T) {
	for _, action := range []string{"TaskStop", "parent retirement", "parent interruption"} {
		t.Run(action, func(t *testing.T) {
			f := newBackgroundFixture(t)
			task := startShell(t, f, "printf '%s' $$ > task.pid; printf running; sleep 30")
			pid := waitShellPID(t, filepath.Join(f.root, "task.pid"))
			ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
			defer cancel()
			switch action {
			case "TaskStop":
				result := f.call(t, f.allowed, "TaskStop", struct {
					ID string `json:"task_id"`
				}{task.ID})
				receipt := shellReceipt(t, result)
				if result.IsError || receipt.Status != shellTaskStopped || receipt.Result == nil || !receipt.Result.Aborted {
					t.Fatalf("stop did not report settled cancellation: %+v %+v", receipt, result)
				}
			case "parent retirement":
				if err := f.harness.Agents().RemoveExact(ctx, f.allowed); err != nil {
					t.Fatal(err)
				}
			case "parent interruption":
				if _, err := f.allowed.Session().Append("turn/end", struct {
					Turn   int                `json:"turn"`
					Reason harness.FinishKind `json:"reason"`
				}{1, harness.FinishAborted}); err != nil {
					t.Fatal(err)
				}
				if err := f.harness.Hooks().Status.Emit(ctx, harness.AgentStatusInput{Agent: f.allowed, Status: harness.AgentIdle}); err != nil {
					t.Fatal(err)
				}
				// A later turn can start another job after interruption.
				if _, err := f.allowed.Session().Append("turn/start", struct {
					Turn int `json:"turn"`
				}{2}); err != nil {
					t.Fatal(err)
				}
				next := startShell(t, f, "printf next-turn")
				if got := shellReceipt(t, f.call(t, f.allowed, "TaskOutput", taskQuery(next.ID, true, 2000))); got.Status != shellTaskCompleted {
					t.Fatalf("interruption permanently fenced the parent: %+v", got)
				}
			}
			if err := syscall.Kill(pid, 0); !errors.Is(err, syscall.ESRCH) {
				t.Fatalf("task returned before process cleanup: pid=%d error=%v", pid, err)
			}
		})
	}
}

func TestBackgroundShellApprovalAndDurabilityBeforeEffect(t *testing.T) {
	for _, failure := range []string{"approval denied", "intent flush failed"} {
		t.Run(failure, func(t *testing.T) {
			f := newBackgroundFixture(t)
			agent := f.denied
			if failure == "intent flush failed" {
				agent = f.allowed
				detach, err := agent.Session().InstallDurabilityCheckpoint(func(context.Context) error { return errors.New("fixture persistence unavailable") })
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(detach)
			}
			result := f.call(t, agent, "Bash", struct {
				Command    string `json:"command"`
				Background bool   `json:"run_in_background"`
			}{"touch forbidden", true})
			if !result.IsError {
				t.Fatal("unapproved or non-durable command launched")
			}
			if _, err := os.Stat(filepath.Join(f.root, "forbidden")); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("unapproved/non-durable side effect: %v", err)
			}
			if failure == "approval denied" {
				for _, event := range agent.Session().Events() {
					if event.Type == shellTaskStarted {
						t.Fatal("denied Bash recorded a runnable intent")
					}
				}
			}
		})
	}
}

func TestBackgroundShellIntentSurvivesRepeatedCallIdentity(t *testing.T) {
	f := newBackgroundFixture(t)
	command := "printf x >> effects; printf once"
	call := func(command string) harness.ToolResult {
		raw, _ := json.Marshal(struct {
			Command    string `json:"command"`
			Background bool   `json:"run_in_background"`
		}{command, true})
		out, err := f.harness.Tools().Execute(t.Context(), harness.ToolRequest{Agent: f.allowed, Name: "Bash", CallID: "same-admitted-call", Arguments: raw})
		if err != nil {
			t.Fatal(err)
		}
		return out.Result
	}
	first := shellReceipt(t, call(command))
	if result := f.call(t, f.allowed, "TaskOutput", taskQuery(first.ID, true, 2000)); result.IsError {
		t.Fatal(result)
	}
	repeated := shellReceipt(t, call(command))
	if repeated.ID != first.ID || repeated.Status != shellTaskCompleted {
		t.Fatalf("repeated call lost its durable task: %+v %+v", first, repeated)
	}
	conflict := call("touch forbidden")
	if !conflict.IsError {
		t.Fatal("same call identity replaced its durable command")
	}
	effects, err := os.ReadFile(filepath.Join(f.root, "effects"))
	if err != nil || string(effects) != "x" {
		t.Fatalf("same admitted call replayed effects: %q %v", effects, err)
	}
	if _, err := os.Stat(filepath.Join(f.root, "forbidden")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("conflicting intent executed: %v", err)
	}
}

func TestBackgroundShellTerminalOutcomes(t *testing.T) {
	for _, test := range []struct {
		name, command string
		timeout       int
		status        shellTaskStatus
		exit          int
		timedOut      bool
	}{
		{"command failure", "printf failure; printf diagnostic >&2; exit 7", 0, shellTaskFailed, 7, false},
		{"benign search comparison status", "test one = two", 0, shellTaskCompleted, 1, false},
		{"background execution timeout", "sleep 30", 30, shellTaskFailed, -1, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			f := newBackgroundFixture(t)
			started := f.call(t, f.allowed, "Bash", struct {
				Command    string `json:"command"`
				Background bool   `json:"run_in_background"`
				Timeout    int    `json:"timeout,omitempty"`
			}{test.command, true, test.timeout})
			id := shellReceipt(t, started).ID
			result := f.call(t, f.allowed, "TaskOutput", taskQuery(id, true, 2000))
			receipt := shellReceipt(t, result)
			if receipt.Status != test.status || result.IsError != (test.status == shellTaskFailed) || receipt.Result == nil || receipt.Result.TimedOut != test.timedOut {
				t.Fatalf("terminal outcome changed: %+v %+v", receipt, result)
			}
			if test.exit >= 0 && (receipt.Result.ExitCode == nil || *receipt.Result.ExitCode != test.exit) {
				t.Fatalf("lost actual exit status: %+v", receipt)
			}
			if test.exit == 7 && (!strings.Contains(receipt.Result.Stdout.Text, "failure") || !strings.Contains(receipt.Result.Stdout.Text, "diagnostic") || receipt.Result.Stderr.Text != "") {
				t.Fatalf("lost failure output: %+v", receipt)
			}
		})
	}
}

func TestClaudeShellTimeoutSelection(t *testing.T) {
	for _, test := range []struct {
		background      bool
		requested, want int
	}{{false, 0, 0}, {false, 700000, 600000}, {true, 600000, 600000}, {true, 999999999, 7200000}} {
		raw := json.RawMessage(fmt.Sprintf(`{"command":"printf fixture","timeout":%d,"run_in_background":%t}`, test.requested, test.background))
		input, err := decodeNativeArguments(raw, t.TempDir(), true, false)
		if err != nil || input.TimeoutMS != test.want {
			t.Fatalf("timeout selection: %+v %v", input, err)
		}
	}
	f := newBackgroundFixture(t)
	result := f.call(t, f.allowed, "Bash", struct {
		Command string `json:"command"`
	}{"printf foreground"})
	if result.IsError {
		t.Fatal(result)
	}
	spec, err := f.app.shell.Resolve(shell.ExecRequest{Command: "true"})
	if err != nil || spec.Timeout != 120*time.Second {
		t.Fatalf("foreground default: %+v %v", spec, err)
	}
	if _, err := f.app.shell.Resolve(shell.ExecRequest{Command: "true", Timeout: 600 * time.Second}); err != nil {
		t.Fatal(err)
	}
}
