//go:build linux || darwin

package nativetools

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
)

func TestTerminalToolsEnforceApprovalIdentityAndRetirement(t *testing.T) {
	f := newClaudeFixture(t, Options{EnableShell: true})
	denied := f.call(t, f.denied, "TerminalOpen", map[string]any{"command": "printf forbidden"})
	if !denied.IsError {
		t.Fatal("terminal started without approval")
	}
	opened := f.call(t, f.allowed, "TerminalOpen", map[string]any{"command": "stty -echo; printf READY; IFS= read -r input; printf '\\nGOT:%s\\n' \"$input\""})
	var receipt terminalReceipt
	if opened.IsError || json.Unmarshal([]byte(opened.Content[0].Text), &receipt) != nil || receipt.ID == "" {
		t.Fatal(opened)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	offset := int64(0)
	for !strings.Contains(receipt.State.Output, "READY") {
		outcome := f.call(t, f.allowed, "TerminalRead", map[string]any{"terminal_id": receipt.ID, "offset": offset, "wait_ms": 1000})
		if outcome.IsError {
			t.Fatalf("read: %+v", outcome)
		}
		if err := json.Unmarshal([]byte(outcome.Content[0].Text), &receipt); err != nil {
			t.Fatal(err)
		}
		offset = receipt.State.NextOffset
	}
	if other := f.call(t, f.denied, "TerminalRead", map[string]any{"terminal_id": receipt.ID}); !other.IsError {
		t.Fatal("terminal crossed exact agent ownership")
	}
	if write := f.call(t, f.allowed, "TerminalWrite", map[string]any{"terminal_id": receipt.ID, "data": "accepted\n"}); write.IsError {
		t.Fatal(write)
	}
	for receipt.State.Running {
		result := f.call(t, f.allowed, "TerminalRead", map[string]any{"terminal_id": receipt.ID, "wait_ms": 1000})
		if result.IsError || json.Unmarshal([]byte(result.Content[0].Text), &receipt) != nil {
			t.Fatal(result)
		}
		if err := ctx.Err(); err != nil {
			t.Fatal(err)
		}
	}
	if !strings.Contains(receipt.State.Output, "GOT:accepted") || receipt.State.Result == nil || receipt.State.Result.ExitCode == nil || *receipt.State.Result.ExitCode != 0 {
		t.Fatalf("lost terminal result: %+v", receipt)
	}
	second := f.call(t, f.allowed, "TerminalOpen", map[string]any{"command": "printf LIVE; IFS= read -r value"})
	if second.IsError {
		t.Fatal(second)
	}
	if err := f.harness.Agents().RemoveExact(ctx, f.allowed); err != nil {
		t.Fatal(err)
	}
	ended := 0
	for _, event := range f.allowed.Session().Events() {
		if event.Type == "terminal/ended" {
			ended++
		}
	}
	if ended != 2 {
		t.Fatalf("retirement did not join terminal receipts: %d", ended)
	}
}

func TestTerminalInterruptionJoinsWithoutFencingNextTurn(t *testing.T) {
	f := newClaudeFixture(t, Options{EnableShell: true})
	opened := f.call(t, f.allowed, "TerminalOpen", map[string]any{"command": "printf '%s' $$ > terminal.pid; IFS= read -r input"})
	var receipt terminalReceipt
	if opened.IsError || json.Unmarshal([]byte(opened.Content[0].Text), &receipt) != nil {
		t.Fatal(opened)
	}
	pid := waitShellPID(t, filepath.Join(f.root, "terminal.pid"))
	if _, err := f.allowed.Session().Append("turn/end", struct {
		Turn   int                `json:"turn"`
		Reason harness.FinishKind `json:"reason"`
	}{1, harness.FinishAborted}); err != nil {
		t.Fatal(err)
	}
	interrupted, cancel := context.WithCancel(t.Context())
	cancel()
	if err := f.harness.Hooks().Status.Emit(interrupted, harness.AgentStatusInput{Agent: f.allowed, Status: harness.AgentIdle}); err != nil {
		t.Fatal(err)
	}
	if err := syscall.Kill(pid, 0); !errors.Is(err, syscall.ESRCH) {
		t.Fatalf("interruption returned before process cleanup: pid=%d error=%v", pid, err)
	}
	ended := f.call(t, f.allowed, "TerminalRead", map[string]any{"terminal_id": receipt.ID})
	if ended.IsError || json.Unmarshal([]byte(ended.Content[0].Text), &receipt) != nil || receipt.State.Running || receipt.State.Result == nil || !receipt.State.Result.Aborted {
		t.Fatalf("interruption lost final terminal state: %+v", ended)
	}
	if _, err := f.allowed.Session().Append("turn/start", struct {
		Turn int `json:"turn"`
	}{2}); err != nil {
		t.Fatal(err)
	}
	if next := f.call(t, f.allowed, "TerminalOpen", map[string]any{"command": "printf next-turn"}); next.IsError {
		t.Fatalf("interruption permanently fenced the parent: %+v", next)
	}
}

func TestTerminalIntentFailureNeverLaunchesOrReplays(t *testing.T) {
	f := newClaudeFixture(t, Options{EnableShell: true})
	detach, err := f.allowed.Session().InstallDurabilityCheckpoint(func(context.Context) error {
		for _, event := range f.allowed.Session().Events() {
			if event.Type == "terminal/intent" {
				return errors.New("injected checkpoint failure")
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	request := harness.ToolRequest{Agent: f.allowed, Name: "TerminalOpen", CallID: "fixed-terminal-intent", Arguments: json.RawMessage(`{"command":"printf effect > forbidden-replay"}`)}
	first, err := f.harness.Tools().Execute(t.Context(), request)
	if err != nil || !first.Result.IsError || !strings.Contains(first.Result.Content[0].Text, "not_started") {
		t.Fatalf("checkpoint failure: %+v %v", first, err)
	}
	detach()
	second, err := f.harness.Tools().Execute(t.Context(), request)
	if err != nil || !second.Result.IsError || !strings.Contains(second.Result.Content[0].Text, "not_restarted") {
		t.Fatalf("replayed intent: %+v %v", second, err)
	}
	if _, err := os.Stat(filepath.Join(f.root, "forbidden-replay")); !os.IsNotExist(err) {
		t.Fatal("terminal command ran despite failed intent checkpoint")
	}
}
