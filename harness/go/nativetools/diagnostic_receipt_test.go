package nativetools

import (
	"context"
	"encoding/json"
	"runtime"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/tool"
)

func TestForegroundDiagnosticEligibility(t *testing.T) {
	f := newClaudeFixture(t, Options{EnableShell: true, BashOutput: BashOutputOptions{BashOutputMaxChars: 1024}})
	for _, row := range []struct {
		name, command string
		dedup         bool
	}{
		{"complete foreground failure", "printf 'error: invalid input\\n' >&2; exit 1", true},
		{"truncated foreground failure", "printf 'error: '; printf '%05000d' 0; exit 1", false},
	} {
		t.Run(row.name, func(t *testing.T) {
			args := struct {
				Command string `json:"command"`
			}{row.command}
			result := f.call(t, f.allowed, "Bash", args)
			raw, _ := json.Marshal(args)
			d := tool.ObserveDiagnostic("Bash", raw, result.Content, result.IsError)
			if !d.Settled || !d.Failed || d.Fingerprint == "" || d.Deduplicable != row.dedup {
				t.Fatalf("diagnostic=%+v result=%+v", d, result)
			}
		})
	}
}

func TestMaskedValidationWarningReachesModel(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX shell fixture")
	}
	requests := 0
	adapter := harness.AdapterFunc(func(_ context.Context, req harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		requests++
		if requests == 1 {
			return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{
				{Type: harness.BlockToolCall, Name: "Bash", ToolCallID: "masked", Arguments: json.RawMessage(`{"command":"(printf 'FAILED (failures=1)\\n' >&2; exit 1); echo $?"}`)},
				{Type: harness.BlockToolCall, Name: "Bash", ToolCallID: "clean", Arguments: json.RawMessage(`{"command":"true"}`)},
			}}}, nil
		}
		messages := req.Messages
		last := messages[len(messages)-1]
		var source struct {
			Kind string `json:"kind"`
		}
		if json.Unmarshal(last.Source, &source) != nil || source.Kind != "tool-validation-warning" {
			t.Fatalf("no warning: %+v", last)
		}
		if messages[len(messages)-2].Content[0].ToolCallID != "clean" || messages[len(messages)-3].Content[0].ToolCallID != "masked" {
			t.Fatal("warning interrupted batch")
		}
		block := messages[len(messages)-3].Content[0]
		var receipt struct {
			Exit int `json:"exitCode"`
		}
		if block.IsError || json.Unmarshal([]byte(block.Content[0].Text), &receipt) != nil || receipt.Exit != 0 {
			t.Fatal("warning fabricated failed process")
		}
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "observed"}}}}, nil
	})
	f := newClaudeFixture(t, Options{EnableShell: true}, adapter)
	if _, err := f.allowed.Prompt(t.Context(), harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "check"}}}); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, e := range f.allowed.Session().Events() {
		if e.Type == "tool/diagnostic" && strings.Contains(string(e.Data), `"validation_signal":"test-failure-summary"`) {
			found = true
		}
	}
	if !found || requests != 2 {
		t.Fatal("warning missing from trace")
	}
}
