//go:build linux || darwin

package pluginruntime

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/plugins"
)

func TestStopCapCountsConsecutiveContinuations(t *testing.T) {
	for _, test := range []struct {
		name     string
		cap      int
		toolAt   int32
		feedback bool
		calls    int32
		active   []bool
	}{
		{name: "default eight", calls: 9, active: []bool{false, true, true, true, true, true, true, true, true}},
		{name: "explicit cap", cap: 2, calls: 3, active: []bool{false, true, true}},
		{name: "feedback follows same cap", cap: 2, feedback: true, calls: 3, active: []bool{false, true, true}},
		{name: "tool call resets count", cap: 2, toolAt: 3, calls: 6, active: []bool{false, true, false, true, true}},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			output := `{"decision":"block","reason":"continue the fixture"}`
			if test.feedback {
				output = `{"hookSpecificOutput":{"additionalContext":"continue the fixture"}}`
			}
			stop := scriptHook(t, root, "Stop", `body=$(cat); printf '%s\n' "$body" >> "$CLAUDE_PLUGIN_ROOT/stops.jsonl"; printf '%s' '`+output+`'`)
			var calls atomic.Int32
			adapter := harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
				call := calls.Add(1)
				if call == test.toolAt {
					return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, Name: "Read", ToolCallID: "reset-stop-count", Arguments: json.RawMessage(`{}`)}}}}, nil
				}
				return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "fixture answer"}}}}, nil
			})
			h, _ := testHookHarness(t, adapter, plugins.Package{Root: root, Definition: plugins.Plugin{Name: "sample"}, Hooks: []claudehooks.Hook{stop}}, test.cap)
			_, err := h.RegisterTool(t.Context(), "fixture-reset-count", harness.Tool{Schema: harness.ToolSchema{Name: "Read", InputSchema: json.RawMessage(`{"type":"object"}`)}, Execute: func(context.Context, json.RawMessage) (harness.ToolResult, error) { return harness.ToolResult{}, nil }})
			if err != nil {
				t.Fatal(err)
			}
			agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "consecutive-stop-cap", CWD: root, Provider: "fixture", Model: "scripted"})
			if err != nil {
				t.Fatal(err)
			}
			if err := prompt(t, agent, "run the bounded fixture"); err != nil || calls.Load() != test.calls {
				t.Fatalf("cap should finish normally: calls=%d want=%d error=%v", calls.Load(), test.calls, err)
			}
			data, err := os.ReadFile(filepath.Join(root, "stops.jsonl"))
			if err != nil {
				t.Fatal(err)
			}
			var active []bool
			for _, line := range strings.Split(strings.TrimSpace(string(data)), "\n") {
				var input claudehooks.Input
				if err := json.Unmarshal([]byte(line), &input); err != nil {
					t.Fatal(err)
				}
				active = append(active, input.StopHookActive)
			}
			if !reflect.DeepEqual(active, test.active) {
				t.Fatalf("consecutive continuation state=%v want=%v", active, test.active)
			}
		})
	}
}
