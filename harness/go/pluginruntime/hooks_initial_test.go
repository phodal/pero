//go:build linux || darwin

package pluginruntime

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/plugins"
)

func TestStartupInitialUserMessagePrecedesTheSuppliedPrompt(t *testing.T) {
	root := t.TempDir()
	hook := scriptHook(t, root, "SessionStart", `printf x >> "$CLAUDE_PLUGIN_ROOT/starts"; printf '%s' '{"hookSpecificOutput":{"hookEventName":"SessionStart","initialUserMessage":"begin","additionalContext":"startup-context"}}'`)
	var requests []string
	h, app := testHookHarness(t, harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		var text string
		for _, message := range request.Messages {
			text += messageText(message) + "\n"
		}
		requests = append(requests, text)
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "printed"}}}}, nil
	}), plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{hook}}, 0)
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "print-start", CWD: root, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	initial, err := app.Startup(t.Context(), agent)
	if err != nil || initial != "begin" {
		t.Fatalf("initial = %q %v", initial, err)
	}
	if err := prompt(t, agent, initial); err != nil {
		t.Fatal(err)
	}
	if err := prompt(t, agent, "follow"); err != nil {
		t.Fatal(err)
	}
	starts, err := os.ReadFile(filepath.Join(root, "starts"))
	if err != nil || string(starts) != "x" || len(requests) != 2 || !strings.Contains(requests[0], "startup-context") || !strings.Contains(requests[0], "begin") || !strings.Contains(requests[1], "follow") {
		t.Fatalf("starts=%s requests=%v err=%v", starts, requests, err)
	}
}
