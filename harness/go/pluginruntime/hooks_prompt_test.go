//go:build linux || darwin

package pluginruntime

import (
	"context"
	"encoding/json"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/plugins"
)

func TestPromptStopHookFeedsABlockedReasonBack(t *testing.T) {
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
		body := text.String()
		if request.Purpose == "hook" || strings.Contains(body, "PROMPT-HOOK") {
			if strings.Contains(body, `"stop_hook_active":true`) {
				return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: `{"ok":true}`}}}}, nil
			}
			return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: `{"ok":false,"reason":"finish the work"}`}}}}, nil
		}
		if turns.Add(1) > 1 && strings.Contains(body, "finish the work") {
			sawReason.Store(true)
		}
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}}, nil
	})
	hook := claudehooks.Hook{Event: "Stop", Prompt: "PROMPT-HOOK $ARGUMENTS"}
	h, _ := testHookHarness(t, adapter, plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{hook}}, 0)
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "prompt-stop", CWD: root, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	if err := prompt(t, agent, "finish"); err != nil || turns.Load() != 2 || !sawReason.Load() {
		t.Fatalf("turns=%d reason=%v err=%v", turns.Load(), sawReason.Load(), err)
	}
}

func TestPromptPreToolUseEndsTheTurnUnlessToldToContinue(t *testing.T) {
	for _, test := range []struct {
		name            string
		continueOnBlock bool
		turns           int32
	}{
		{name: "default ends the turn", turns: 1},
		{name: "continue returns the denial", continueOnBlock: true, turns: 2},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			var turns, bodies atomic.Int32
			adapter := harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
				var text strings.Builder
				for _, message := range request.Messages {
					for _, block := range message.Content {
						text.WriteString(block.Text)
					}
				}
				if request.Purpose == "hook" || strings.Contains(text.String(), "PROMPT-HOOK") {
					return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: `{"ok":false,"reason":"not this file"}`}}}}, nil
				}
				if turns.Add(1) == 1 {
					return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, Name: "Write", ToolCallID: "write-1", Arguments: json.RawMessage(`{"file_path":"original.md","content":"original"}`)}}}}, nil
				}
				return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}}, nil
			})
			hook := claudehooks.Hook{Event: "PreToolUse", Matcher: "Write", Prompt: "PROMPT-HOOK $ARGUMENTS", ContinueOnBlock: test.continueOnBlock}
			h, _ := testHookHarness(t, adapter, plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{hook}}, 0)
			if _, err := h.RegisterTool(t.Context(), "fixture-write", harness.Tool{Schema: harness.ToolSchema{Name: "Write", InputSchema: json.RawMessage(`{"type":"object","properties":{"file_path":{"type":"string"},"content":{"type":"string"}},"required":["file_path","content"],"additionalProperties":false}`)}, Execute: func(context.Context, json.RawMessage) (harness.ToolResult, error) {
				bodies.Add(1)
				return harness.ToolResult{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "wrote"}}}, nil
			}}); err != nil {
				t.Fatal(err)
			}
			agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "prompt-tool", CWD: root, Provider: "fixture", Model: "scripted"})
			if err != nil {
				t.Fatal(err)
			}
			if err := prompt(t, agent, "write"); err != nil || bodies.Load() != 0 || turns.Load() != test.turns {
				t.Fatalf("turns=%d body=%d err=%v", turns.Load(), bodies.Load(), err)
			}
		})
	}
}
