//go:build linux || darwin

package shell

import (
	"context"
	"strings"
	"testing"
	"time"
)

func terminalUntil(t *testing.T, ctx context.Context, terminal *Terminal, needle string) TerminalRead {
	t.Helper()
	var receipt TerminalRead
	var err error
	for {
		receipt, err = terminal.Read(ctx, 0, 16<<10, time.Second)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(receipt.Output, needle) {
			return receipt
		}
		if !receipt.Running {
			t.Fatalf("terminal exited before %q: %+v", needle, receipt)
		}
		// Wait on the current end cursor rather than repeatedly rereading a prefix.
		next, err := terminal.Read(ctx, receipt.TotalBytes, 16<<10, time.Second)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(next.Output, needle) {
			return next
		}
	}
}
func TestTerminalInteractiveInputResizeEOFAndExit(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	executor := testExecutor(t, LocalOptions{CWD: t.TempDir(), Grace: 20 * time.Millisecond})
	terminal, err := executor.StartTerminal(ctx, ExecRequest{Command: "stty -echo; printf READY; IFS= read -r value; printf '\nVALUE:%s\n' \"$value\"; stty size; cat; printf '\nEOF-SEEN\n'; exit 7"}, 24, 80)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { terminal.Stop(context.Background()) })
	terminalUntil(t, ctx, terminal, "READY")
	if err := terminal.Resize(37, 91); err != nil {
		t.Fatal(err)
	}
	if _, err := terminal.Write(ctx, "hello\n", false); err != nil {
		t.Fatal(err)
	}
	terminalUntil(t, ctx, terminal, "37 91")
	if _, err := terminal.Write(ctx, "", true); err != nil {
		t.Fatal(err)
	}
	select {
	case <-terminal.Done():
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	receipt, err := terminal.Read(ctx, 0, 16<<10, 0)
	if err != nil || receipt.Running || receipt.Result == nil || receipt.Result.ExitCode == nil || *receipt.Result.ExitCode != 7 || !strings.Contains(receipt.Output, "VALUE:hello") || !strings.Contains(receipt.Output, "EOF-SEEN") {
		t.Fatalf("lost interactive result: %+v %v", receipt, err)
	}
	if _, err := terminal.Write(ctx, "late", false); err == nil {
		t.Fatal("write after exit accepted")
	}
}
func TestTerminalOutputBoundsAndCancellation(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	executor := testExecutor(t, LocalOptions{CWD: t.TempDir(), MaxOutputBytes: 128, Grace: 20 * time.Millisecond})
	terminal, err := executor.StartTerminal(ctx, ExecRequest{Command: "printf '%0300d' 1; printf READY; IFS= read -r value"}, 24, 80)
	if err != nil {
		t.Fatal(err)
	}
	terminalUntil(t, ctx, terminal, "READY")
	receipt, err := terminal.Read(ctx, 0, 128, 0)
	if err != nil || !receipt.Truncated || receipt.AvailableFrom < 1 || len(receipt.Output) > 128 {
		t.Fatalf("unbounded output: %+v %v", receipt, err)
	}
	if err := terminal.Stop(ctx); err != nil {
		t.Fatal(err)
	}
	receipt, err = terminal.Read(ctx, receipt.NextOffset, 128, 0)
	if err != nil || receipt.Running || receipt.Result == nil || !receipt.Result.Aborted {
		t.Fatalf("unobserved cancellation: %+v %v", receipt, err)
	}
}

func TestTerminalDeadlineReportsActualStop(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	executor := testExecutor(t, LocalOptions{CWD: t.TempDir(), Grace: 20 * time.Millisecond})
	terminal, err := executor.StartTerminal(ctx, ExecRequest{Command: "printf READY; IFS= read -r value", Timeout: 500 * time.Millisecond}, 24, 80)
	if err != nil {
		t.Fatal(err)
	}
	terminalUntil(t, ctx, terminal, "READY")
	select {
	case <-terminal.Done():
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	receipt, err := terminal.Read(ctx, 0, 1024, 0)
	if err != nil || receipt.Running || receipt.Result == nil || !receipt.Result.TimedOut || receipt.Result.Aborted {
		t.Fatalf("deadline receipt: %+v %v", receipt, err)
	}
}
