package nativetools

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
)

func TestNativeGuidanceTracksOwnedDirectoryAndPreparedCapabilities(t *testing.T) {
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		t.Skip("fixture executes native Bash")
	}
	var systems []string
	var lastMessages []harness.Message
	adapter := &promptContractAdapter{modalities: []string{"text"}}
	adapter.generate = func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		systems = append(systems, request.System)
		lastMessages = request.Messages
		if len(systems) == 1 {
			return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, ToolCallID: "change-directory", Name: "Bash", Arguments: json.RawMessage(`{"command":"cd nested"}`)}}}}, nil
		}
		if len(systems) == 4 {
			return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, ToolCallID: "observe-directory", Name: "Bash", Arguments: json.RawMessage(`{"command":"pwd"}`)}}}}, nil
		}
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "observed"}}}}, nil
	}
	f := newClaudeFixture(t, Options{EnableShell: true, Shell: "/bin/bash", PDFRendererPath: "-"}, adapter)
	workspace := f.allowed.Session().WorkingDirectory()
	nested := filepath.Join(workspace, "nested")
	if err := os.Mkdir(nested, 0700); err != nil {
		t.Fatal(err)
	}
	nested, err := filepath.EvalSymlinks(nested)
	if err != nil {
		t.Fatal(err)
	}
	prompt := func() {
		t.Helper()
		if _, err := f.allowed.Prompt(t.Context(), harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "inspect current execution context"}}}); err != nil {
			t.Fatal(err)
		}
	}
	prompt()
	if len(systems) != 2 {
		t.Fatalf("provider requests=%d want=2", len(systems))
	}
	for index, cwd := range []string{workspace, nested} {
		for _, fact := range []string{
			"OS=" + runtime.GOOS, "architecture=" + runtime.GOARCH,
			fmt.Sprintf("workspace=%q", workspace),
			`Configured shell executable: "/bin/bash"`,
			fmt.Sprintf("Bash default working directory: %q", cwd),
			fmt.Sprintf("New terminal working directory: %q", workspace),
			"preserve their exit status across output filters and cleanup",
		} {
			if !strings.Contains(systems[index], fact) {
				t.Errorf("request %d lost fact %q", index, fact)
			}
		}
	}
	// The adapter's admitted declarations determine executable guidance, even
	// while the native owner still has a configured shell and remembered cwd.
	adapter.strip = true
	prompt()
	if len(systems) != 3 || !strings.Contains(systems[2], fmt.Sprintf("workspace=%q", workspace)) {
		t.Fatalf("host workspace fact missing after tool withdrawal: %v", systems)
	}
	for _, absent := range []string{"Configured shell executable:", "default working directory:", "New terminal working directory:", "preserve their exit status"} {
		if strings.Contains(systems[2], absent) {
			t.Errorf("withdrawn execution capability retained %q", absent)
		}
	}
	adapter.strip = false
	prompt()
	raw, err := json.Marshal(lastMessages)
	if err != nil || len(systems) != 5 || !strings.Contains(string(raw), nested) {
		t.Fatalf("rendering guidance changed the owned Bash directory: messages=%s error=%v", raw, err)
	}
}

func TestNativeGuidancePreservesCheckStatusOnlyForDeclaredExecution(t *testing.T) {
	for _, row := range []struct {
		name string
		want bool
	}{
		{"Read", false}, {"ToolSearch", false}, {"Bash", true},
		{"shell", true}, {"TerminalOpen", true}, {"terminal_open", true},
	} {
		t.Run(row.name, func(t *testing.T) {
			text := nativeGuidance(harness.PromptCapabilities{Tools: []harness.ToolSchema{{Name: row.name}}})
			for _, instruction := range []string{"preserve their exit status across output filters and cleanup", "Inspect both the check output and its final status"} {
				if present := strings.Contains(text, instruction); present != row.want {
					t.Errorf("execution guidance %q present=%t want=%t", instruction, present, row.want)
				}
			}
		})
	}
}
