//go:build linux || darwin

package pluginruntime

import (
	"context"
	"testing"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/plugins"
)

func TestHookTerminalSequencesReachTheHostInOrder(t *testing.T) {
	root := t.TempDir()
	first := scriptHook(t, root, "SessionStart", `printf '%s' '{"terminalSequence":"\u0007"}'`)
	second := scriptHook(t, root, "SessionStart", `printf '%s' '{"terminalSequence":"\u001b]0;named\u0007"}'`)
	var got []string
	h, app := testHookHarness(t, harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "ok"}}}}, nil
	}), plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{first, second}}, 0)
	app.options.EmitTerminal = func(sequence string) { got = append(got, sequence) }
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "terminal", CWD: root, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	if err := prompt(t, agent, "go"); err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0] != "\a" || got[1] != "\x1b]0;named\a" {
		t.Fatalf("sequences = %#v", got)
	}
}
