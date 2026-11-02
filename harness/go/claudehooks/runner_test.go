//go:build linux || darwin

package claudehooks

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestCommandExecution(t *testing.T) {
	t.Setenv("HOOK_AMBIENT_SECRET", "must-not-inherit")
	root := t.TempDir()
	inputPath := filepath.Join(root, "input.json")
	runner := Runner{Shell: "/bin/sh", Environment: []string{"PATH=/usr/bin:/bin", "INPUT_PATH=" + inputPath, "EXPLICIT_VALUE=provided"}}
	input := Input{SessionID: "session-1", CWD: root, ToolName: "Write", ToolUseID: "tool-1", ToolInput: json.RawMessage(`{"file_path":"report.md"}`)}
	decision, err := runner.Run(t.Context(), Hook{Event: "PreToolUse", Command: `cat > "$INPUT_PATH"; test "${HOOK_AMBIENT_SECRET-unset}" = unset && test "$EXPLICIT_VALUE" = provided || exit 9; printf '%s' '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"fixture guard"}}'`}, input)
	if err != nil || decision.Permission != "deny" || decision.Reason != "fixture guard" {
		t.Fatalf("decision=%+v error=%v", decision, err)
	}
	payload, err := os.ReadFile(inputPath)
	if err != nil {
		t.Fatal(err)
	}
	var observed Input
	if err := json.Unmarshal(payload, &observed); err != nil {
		t.Fatal(err)
	}
	if observed.SessionID != input.SessionID || observed.Event != "PreToolUse" || observed.ToolUseID != input.ToolUseID || string(observed.ToolInput) != string(input.ToolInput) {
		t.Fatalf("stdin does not use the hook protocol: %s", payload)
	}
	program := filepath.Join(root, "hook with spaces")
	if err := os.WriteFile(program, []byte("#!/bin/sh\n[ \"$1\" = 'one two' ] && [ \"$2\" = three ] || exit 9\nprintf '%s' '{\"decision\":\"block\",\"reason\":\"argv preserved\"}'\n"), 0700); err != nil {
		t.Fatal(err)
	}
	decision, err = runner.Run(t.Context(), Hook{Event: "Stop", Command: program, Args: []string{"one two", "three"}, ExecForm: true}, Input{CWD: root})
	if err != nil || !decision.Block || decision.Reason != "argv preserved" {
		t.Fatalf("argv decision=%+v error=%v", decision, err)
	}
}

func TestExecutableUsesExplicitPath(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "hook-helper"), []byte("#!/bin/sh\nprintf restored\n"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", root)
	hook := Hook{Event: "SessionStart", Command: "hook-helper", ExecForm: true}
	input := Input{CWD: root}
	if _, err := (Runner{}).Run(t.Context(), hook, input); err == nil || !strings.Contains(err.Error(), "explicit PATH") {
		t.Fatalf("ambient PATH must not select executables: %v", err)
	}
	decision, err := (Runner{Environment: []string{"PATH=" + root}}).Run(t.Context(), hook, input)
	if err != nil || decision.AdditionalContext != "restored" {
		t.Fatalf("decision=%+v error=%v", decision, err)
	}
}

func TestExecutionFailureAndLimits(t *testing.T) {
	root := t.TempDir()
	runner := Runner{Shell: "/bin/sh", Environment: []string{"PATH=/usr/bin:/bin"}}
	for _, test := range []struct {
		name, command, event string
		timeout              time.Duration
		want                 error
		block                bool
	}{
		{name: "blocking exit two", event: "Stop", command: "printf 'gate failure' >&2; exit 2", block: true},
		{name: "nonblocking ordinary exit", event: "Stop", command: "exit 7"},
		{name: "timeout", event: "Stop", command: "sleep 30", timeout: 40 * time.Millisecond, want: context.DeadlineExceeded},
		{name: "bounded stdout", event: "SessionStart", command: "while :; do printf 12345678901234567890123456789012; done", want: ErrOutputLimit},
		{name: "bounded stderr", event: "Stop", command: "while :; do printf 12345678901234567890123456789012 >&2; done", want: ErrOutputLimit},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
			defer cancel()
			decision, err := runner.Run(ctx, Hook{Event: test.event, Command: test.command, Timeout: test.timeout}, Input{CWD: root})
			if test.want != nil {
				if !errors.Is(err, test.want) {
					t.Fatalf("error=%v want %v", err, test.want)
				}
			} else if test.block {
				if err != nil || !decision.Block || decision.Reason != "gate failure" {
					t.Fatalf("decision=%+v error=%v", decision, err)
				}
			} else if err == nil || !strings.Contains(err.Error(), "non-blocking") || decision.Block {
				t.Fatalf("ordinary failure became blocking or disappeared: %+v %v", decision, err)
			}
		})
	}
}

func TestPreCancelledAndAsyncDoNotStart(t *testing.T) {
	root := t.TempDir()
	runner := Runner{Shell: "/bin/sh"}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := runner.Run(ctx, Hook{Event: "Stop", Command: "touch started"}, Input{CWD: root}); !errors.Is(err, context.Canceled) {
		t.Fatalf("error=%v", err)
	}
	if _, err := runner.Run(t.Context(), Hook{Event: "Stop", Command: "touch started", Async: true}, Input{CWD: root}); err == nil || !strings.Contains(err.Error(), "asynchronous") {
		t.Fatalf("error=%v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "started")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("rejected execution started a hook: %v", err)
	}
}

func TestCancellationCleansOwnedDescendant(t *testing.T) {
	root := t.TempDir()
	pidPath := filepath.Join(root, "child.pid")
	runner := Runner{Shell: "/bin/sh", Environment: []string{"PATH=/usr/bin:/bin", "PID_PATH=" + pidPath}}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		_, err := runner.Run(ctx, Hook{Event: "Stop", Command: `sleep 30 & printf '%s' "$!" > "$PID_PATH"; wait`}, Input{CWD: root})
		done <- err
	}()
	pid := readReadyPID(t, pidPath, done)
	if err := syscall.Kill(pid, 0); err != nil {
		t.Fatalf("descendant must be live before cancellation: %v", err)
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancellation error=%v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("hook did not settle after cancellation")
	}
	awaitProcessExit(t, pid)
}

func TestLeaderExitCleansOwnedDescendant(t *testing.T) {
	root := t.TempDir()
	pidPath := filepath.Join(root, "child.pid")
	runner := Runner{Shell: "/bin/sh", Environment: []string{"PATH=/usr/bin:/bin", "PID_PATH=" + pidPath}}
	_, err := runner.Run(t.Context(), Hook{Event: "Stop", Command: `sleep 30 & printf '%s' "$!" > "$PID_PATH"; printf '{}'`}, Input{CWD: root})
	if err == nil || !errors.Is(err, exec.ErrWaitDelay) {
		t.Fatalf("descendant-held pipes must not remain unowned: %v", err)
	}
	data, err := os.ReadFile(pidPath)
	if err != nil {
		t.Fatal(err)
	}
	pid, err := strconv.Atoi(string(data))
	if err != nil {
		t.Fatal(err)
	}
	awaitProcessExit(t, pid)
}

func readReadyPID(t *testing.T, path string, done <-chan error) int {
	t.Helper()
	deadline := time.NewTimer(3 * time.Second)
	defer deadline.Stop()
	tick := time.NewTicker(5 * time.Millisecond)
	defer tick.Stop()
	for {
		if data, err := os.ReadFile(path); err == nil {
			if pid, err := strconv.Atoi(string(data)); err == nil {
				return pid
			}
		}
		select {
		case err := <-done:
			t.Fatalf("hook stopped before readiness: %v", err)
		case <-deadline.C:
			t.Fatal("hook did not publish a descendant PID")
		case <-tick.C:
		}
	}
}

func awaitProcessExit(t *testing.T, pid int) {
	t.Helper()
	deadline := time.NewTimer(3 * time.Second)
	defer deadline.Stop()
	tick := time.NewTicker(5 * time.Millisecond)
	defer tick.Stop()
	for {
		if errors.Is(syscall.Kill(pid, 0), syscall.ESRCH) {
			return
		}
		state, err := exec.Command("/bin/ps", "-p", strconv.Itoa(pid), "-o", "stat=").Output()
		if err == nil && strings.HasPrefix(strings.TrimSpace(string(state)), "Z") {
			return // An exited orphan may await reaping by the OS or container PID 1.
		}
		var exitError *exec.ExitError
		if errors.As(err, &exitError) && exitError.ExitCode() == 1 && len(state) == 0 {
			return
		}
		select {
		case <-deadline.C:
			_ = syscall.Kill(pid, syscall.SIGKILL)
			t.Fatalf("descendant is still executing: PID %d, state=%s, error=%v", pid, state, err)
		case <-tick.C:
		}
	}
}
