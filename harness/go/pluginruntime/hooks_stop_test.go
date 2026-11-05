//go:build linux || darwin

package pluginruntime

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/plugins"
)

func TestStopFailureReplacesStopForProviderErrors(t *testing.T) {
	root := t.TempDir()
	stop := scriptHook(t, root, "Stop", `printf stop > "$CLAUDE_PLUGIN_ROOT/stop"`)
	failure := scriptHook(t, root, "StopFailure", `cat > "$CLAUDE_PLUGIN_ROOT/failure.json"; printf '%s' '{"decision":"block","reason":"continue anyway","terminalSequence":"\u0007"}'`)
	failure.Matcher = "rate_limit"
	adapter := harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		return harness.Completion{}, harness.NewProviderErrorWithFailure(harness.ProviderFailure{Message: "Rate limit reached", Status: 429}, nil)
	})
	h, _ := testHookHarness(t, adapter, plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{stop, failure}}, 0)
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "stop-failure", CWD: root, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	err = prompt(t, agent, "continue")
	if err == nil || !strings.Contains(err.Error(), "Rate limit reached") || strings.Contains(err.Error(), "continue anyway") {
		t.Fatalf("provider error = %v", err)
	}
	if _, statErr := os.Stat(filepath.Join(root, "stop")); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("Stop ran on a provider failure: %v", statErr)
	}
	payload, err := os.ReadFile(filepath.Join(root, "failure.json"))
	if err != nil || !strings.Contains(string(payload), `"error":"rate_limit"`) || !strings.Contains(string(payload), `"error_details":"429 Too Many Requests"`) || !strings.Contains(string(payload), `"last_assistant_message":"API Error: Rate limit reached"`) {
		t.Fatalf("failure payload=%s error=%v", payload, err)
	}
}

func TestLocalTurnErrorsDoNotEmitStopFailure(t *testing.T) {
	root := t.TempDir()
	failure := scriptHook(t, root, "StopFailure", `printf fired > "$CLAUDE_PLUGIN_ROOT/failure"`)
	adapter := harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		return harness.Completion{}, errors.New("local tool plumbing")
	})
	h, _ := testHookHarness(t, adapter, plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{failure}}, 0)
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "local-failure", CWD: root, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	if err := prompt(t, agent, "continue"); err == nil {
		t.Fatal("local failure was hidden")
	}
	if _, statErr := os.Stat(filepath.Join(root, "failure")); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("StopFailure ran for a non-provider error: %v", statErr)
	}
}
