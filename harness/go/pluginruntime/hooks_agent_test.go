//go:build linux || darwin

package pluginruntime

import (
	"context"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/plugins"
)

func TestAgentStopHookFeedsTheRunnerResultBack(t *testing.T) {
	root := t.TempDir()
	var turns atomic.Int32
	var sawReason atomic.Bool
	adapter := harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		var text strings.Builder
		for _, message := range request.Messages {
			for _, block := range message.Content {
				text.WriteString(block.Text)
			}
		}
		if turns.Add(1) > 1 && strings.Contains(text.String(), "finish the work") {
			sawReason.Store(true)
		}
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}}, nil
	})
	h, err := harness.Boot(t.Context(), harness.Options{Adapter: adapter, AdapterProviders: []string{"fixture"}})
	if err != nil {
		t.Fatal(err)
	}
	hook := claudehooks.Hook{Event: "Stop", Prompt: "AGENT-HOOK $ARGUMENTS", Agent: true}
	app, err := MountHooks(t.Context(), h, []plugins.Package{{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{hook}}}, HookOptions{
		Shell: "/bin/sh", StateDirectory: root,
		RunAgent: func(_ context.Context, _ *harness.Agent, prompt, model string) (string, error) {
			if model != "" {
				t.Errorf("model = %q", model)
			}
			if !strings.Contains(prompt, "AGENT-HOOK") {
				t.Errorf("prompt = %s", prompt)
			}
			if strings.Contains(prompt, `"stop_hook_active":true`) {
				return `{"ok":true}`, nil
			}
			return `{"ok":false,"reason":"finish the work"}`, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = h.Dispose(ctx)
		_ = h.Drain(ctx)
		_ = app.Close()
	})
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "agent-hook", CWD: root, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	if err := prompt(t, agent, "finish"); err != nil || turns.Load() != 2 || !sawReason.Load() {
		t.Fatalf("turns=%d reason=%v err=%v", turns.Load(), sawReason.Load(), err)
	}
}
