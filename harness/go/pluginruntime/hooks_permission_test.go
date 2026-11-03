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
	point "github.com/phodal/pero/harness/go/runtime"
)

func TestPermissionRequestHookDecidesBeforeThePrompt(t *testing.T) {
	for _, test := range []struct {
		name, script                 string
		prompted                     bool
		runs                         bool
		wantCommand, reasonSubstring string
	}{
		{
			name:        "allow replaces the command and skips the prompt",
			script:      `printf '%s' '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow","updatedInput":{"command":"printf allowed"}}}}'`,
			runs:        true,
			wantCommand: "printf allowed",
		},
		{
			name:            "deny answers without asking",
			script:          `printf '%s' '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"not this command"}}}'`,
			reasonSubstring: "not this command",
		},
		{
			name:     "exit 2 leaves the prompt in place",
			script:   `printf 'ignored' >&2; exit 2`,
			prompted: true,
			runs:     true,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			hook := scriptHook(t, root, "PermissionRequest", test.script)
			hook.Matcher = "Bash"
			var calls atomic.Int32
			var prompted atomic.Int32
			var command string
			var followed string
			adapter := harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
				if calls.Add(1) == 1 {
					return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, Name: "Bash", ToolCallID: "bash", Arguments: json.RawMessage(`{"command":"printf original"}`)}}}}, nil
				}
				raw, _ := json.Marshal(request.Messages)
				followed = string(raw)
				return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}}, nil
			})
			h, _ := testHookHarness(t, adapter, plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{hook}}, 0)
			_, err := h.RegisterTool(t.Context(), "fixture-bash", harness.Tool{
				Schema:           harness.ToolSchema{Name: "Bash", InputSchema: json.RawMessage(`{"type":"object","properties":{"command":{"type":"string"}},"required":["command"]}`)},
				RequiresApproval: true,
				Execute: func(_ context.Context, arguments json.RawMessage) (harness.ToolResult, error) {
					var body struct {
						Command string `json:"command"`
					}
					if err := json.Unmarshal(arguments, &body); err != nil {
						return harness.ToolResult{}, err
					}
					command = body.Command
					return harness.ToolResult{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "ran"}}}, nil
				},
			})
			if err != nil {
				t.Fatal(err)
			}
			agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "permission-hook", CWD: root, Provider: "fixture", Model: "scripted", Configure: func(_ context.Context, run *point.Run, _ *harness.Agent) error {
				_, err := h.Approvals().Register(run, func(context.Context, harness.ApprovalRequest) (harness.ApprovalOutcome, error) {
					prompted.Add(1)
					return harness.ApprovalAllowedOnce, nil
				})
				return err
			}})
			if err != nil {
				t.Fatal(err)
			}
			if err := prompt(t, agent, "run"); err != nil {
				t.Fatal(err)
			}
			if (prompted.Load() == 1) != test.prompted || (command != "") != test.runs || command != test.wantCommand && test.wantCommand != "" {
				t.Fatalf("prompted=%d command=%q want prompted=%v runs=%v command=%q", prompted.Load(), command, test.prompted, test.runs, test.wantCommand)
			}
			if test.reasonSubstring != "" && !strings.Contains(followed, test.reasonSubstring) {
				t.Fatalf("deny reason missing: %s", followed)
			}
		})
	}
}
