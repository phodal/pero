//go:build linux || darwin

package shell

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

func TestManagedExecutionKeepsProcessUntilOwnerDeadline(t *testing.T) {
	started := make(chan struct{})
	executor := testExecutor(t, LocalOptions{Timeout: 20 * time.Millisecond, ProcessStarted: func() { close(started) }})
	spec, err := executor.Resolve(ExecRequest{Command: "printf ready; sleep 30", OnExpiry: ExpiryNone})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancelCause(t.Context())
	defer cancel(context.Canceled)
	type outcome struct {
		result RunResult
		err    error
	}
	done := make(chan outcome, 1)
	go func() { result, err := executor.Run(ctx, spec); done <- outcome{result, err} }()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("process did not start")
	}
	select {
	case result := <-done:
		t.Fatalf("managed process ended at nominal timeout: %+v", result)
	case <-time.After(60 * time.Millisecond):
	}
	cancel(ErrTimeout)
	select {
	case result := <-done:
		if !errors.Is(result.err, ErrTimeout) || !result.result.TimedOut || result.result.Aborted || result.result.Stdout.Text != "ready" {
			t.Fatalf("owner deadline=%+v", result)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("owner deadline did not join process")
	}
}

func TestPrecancelledLifetimeNeverStartsAProcess(t *testing.T) {
	for _, expiry := range []ExpiryPolicy{ExpiryKill, ExpiryNone} {
		t.Run(string(expiry), func(t *testing.T) {
			executor := testExecutor(t, LocalOptions{})
			spec, err := executor.Resolve(ExecRequest{Command: "touch forbidden", OnExpiry: expiry})
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithCancelCause(t.Context())
			cancel(ErrTimeout)
			result, err := executor.Run(ctx, spec)
			want := error(context.Canceled)
			if expiry == ExpiryNone {
				want = ErrTimeout
			}
			if !errors.Is(err, want) || result.TimedOut != (expiry == ExpiryNone) || result.Aborted != (expiry == ExpiryKill) {
				t.Fatalf("expiry=%s result=%+v error=%v", expiry, result, err)
			}
			if _, err := os.Stat(filepath.Join(executor.cwd, "forbidden")); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("cancelled preparation started effects: %v", err)
			}
		})
	}
}

func TestTrustedExtendedTimeoutRetainsConfiguredCap(t *testing.T) {
	executor := testExecutor(t, LocalOptions{Timeout: 3 * time.Hour, MaxTimeout: 4 * time.Hour})
	if spec, err := executor.Resolve(ExecRequest{Command: "true", Timeout: 3 * time.Hour, OnExpiry: ExpiryNone}); err != nil || spec.Timeout != 3*time.Hour {
		t.Fatalf("trusted timeout=%+v error=%v", spec, err)
	}
	if _, err := executor.Resolve(ExecRequest{Command: "true", Timeout: 5 * time.Hour}); err == nil {
		t.Fatal("request exceeded host cap")
	}
	if _, err := executor.Resolve(ExecRequest{Command: "true", OnExpiry: "unknown"}); err == nil {
		t.Fatal("accepted unknown expiry")
	}
}

// Opt-in real Codex transport, independent of the Rust Worker's process cleanup.
func TestExecServerForegroundCancellation(t *testing.T) {
	path := os.Getenv("PERO_TEST_CODEX_EXECUTABLE")
	if path == "" {
		t.Skip("set PERO_TEST_CODEX_EXECUTABLE to the installed Codex binary")
	}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	reader, writer := io.Pipe()
	defer reader.Close()
	defer writer.Close()
	const grace = 200 * time.Millisecond
	executor, err := testExecutor(t, LocalOptions{Grace: grace, OutputSink: writer}).WithExecServer(path)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	var result RunResult
	var runErr error
	go func() {
		defer close(done)
		result, runErr = executor.Run(ctx, ExecSpec{Command: `
trap 'printf "cleanup stdout\n"; printf "cleanup stderr\n" >&2; exit 23' TERM
(trap '' TERM; printf ready > child-ready; exec /bin/sleep 60) &
child=$!
until [[ -s child-ready ]]; do /bin/sleep 0.01; done
echo $$ $child
wait "$child"
`, Timeout: 10 * time.Second})
		writer.Close()
	}()
	// Both PIDs come from the running shell through process/output.
	var parent, child int
	if _, err := fmt.Fscanln(reader, &parent, &child); err != nil {
		t.Fatal(err)
	}
	if parent < 1 || child < 1 {
		t.Fatal("missing process identity")
	}
	cancelledAt := time.Now()
	cancel()
	if _, err := io.Copy(io.Discard, reader); err != nil {
		t.Fatal(err)
	}
	<-done
	if time.Since(cancelledAt) < grace {
		t.Fatal("cancellation returned before the termination grace elapsed")
	}
	if !errors.Is(runErr, context.Canceled) || !result.Aborted || result.TimedOut || result.CleanupUncertain ||
		result.ExitCode == nil || *result.ExitCode != 23 ||
		result.Stdout.Text != fmt.Sprintf("%d %d\ncleanup stdout\n", parent, child) ||
		result.Stderr.Text != "cleanup stderr\n" {
		t.Fatalf("cancelled receipt: %+v, %v", result, runErr)
	}
	for _, pid := range []int{parent, child} {
		if err := syscall.Kill(pid, 0); !errors.Is(err, syscall.ESRCH) {
			t.Fatalf("process %d after cancellation: %v", pid, err)
		}
	}
}
