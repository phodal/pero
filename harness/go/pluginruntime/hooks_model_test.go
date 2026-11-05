//go:build linux || darwin

package pluginruntime

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/plugins"
)

func TestModelSwitchHookRefusesThenGuidesTheNextRequest(t *testing.T) {
	root := t.TempDir()
	pre := scriptHook(t, root, "PreModelSwitch", `body=$(cat); printf '%s' "$body" > "$CLAUDE_PLUGIN_ROOT/pre.json"; if [ ! -f "$CLAUDE_PLUGIN_ROOT/allow" ]; then printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreModelSwitch","permissionDecision":"ask","permissionDecisionReason":"model gate"}}'; fi`)
	pre.Matcher = "other"
	post := scriptHook(t, root, "PostModelSwitch", `printf '%s' 'model guidance'`)
	post.Matcher = "other"
	var sawGuidance, sawModel bool
	adapter := harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		sawModel = request.Model == "other"
		encoded, _ := json.Marshal(request.Messages)
		sawGuidance = strings.Contains(string(encoded), "model guidance")
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}}, nil
	})
	h, _ := testHookHarness(t, adapter, plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{pre, post}}, 0)
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "model-switch", CWD: root, Provider: "fixture", Model: "fixture"})
	if err != nil {
		t.Fatal(err)
	}
	err = agent.SelectModel(t.Context(), harness.AgentModelSelection{Provider: "fixture", Model: "other"})
	var rejected *harness.ModelSwitchRejectedError
	if !errors.As(err, &rejected) || !strings.Contains(err.Error(), "model gate") || agent.ModelSelection().Model != "fixture" {
		t.Fatalf("blocked switch err=%v model=%s", err, agent.ModelSelection().Model)
	}
	payload, err := os.ReadFile(filepath.Join(root, "pre.json"))
	if err != nil || !strings.Contains(string(payload), `"from_model":"fixture"`) || !strings.Contains(string(payload), `"to_model":"other"`) || !strings.Contains(string(payload), `"source":"sdk"`) || !strings.Contains(string(payload), `"requested_model":"other"`) || !strings.Contains(string(payload), `"context_tokens":0`) {
		t.Fatalf("switch input=%s error=%v", payload, err)
	}
	if err := os.WriteFile(filepath.Join(root, "allow"), []byte("1"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := agent.SelectModel(t.Context(), harness.AgentModelSelection{Provider: "fixture", Model: "other"}); err != nil || agent.ModelSelection().Model != "other" {
		t.Fatalf("allowed switch err=%v model=%s", err, agent.ModelSelection().Model)
	}
	if err := prompt(t, agent, "continue"); err != nil || !sawModel || !sawGuidance {
		t.Fatalf("next request err=%v model=%v guidance=%v", err, sawModel, sawGuidance)
	}
}
