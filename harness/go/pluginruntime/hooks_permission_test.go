//go:build linux || darwin

package pluginruntime

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
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
		interrupt                    bool
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
			name:            "deny and interrupt stops the remaining batch",
			script:          `printf '%s' '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","interrupt":true,"message":"stop now"}}}'`,
			interrupt:       true,
			reasonSubstring: "stop now",
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
					calls := []harness.ContentBlock{{Type: harness.BlockToolCall, Name: "Bash", ToolCallID: "bash", Arguments: json.RawMessage(`{"command":"printf original"}`)}}
					if test.interrupt {
						calls = append(calls, harness.ContentBlock{Type: harness.BlockToolCall, Name: "Bash", ToolCallID: "later", Arguments: json.RawMessage(`{"command":"printf later"}`)})
					}
					return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: calls}}, nil
				}
				raw, _ := json.Marshal(request.Messages)
				followed = string(raw)
				return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}}, nil
			})
			h, _ := testHookHarness(t, adapter, plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{hook}}, 0)
			_, err := h.RegisterTool(t.Context(), "fixture-bash", harness.Tool{
				Schema:           harness.ToolSchema{Name: "Bash", InputSchema: json.RawMessage(`{"type":"object","properties":{"command":{"type":"string"}},"required":["command"]}`)},
				RequiresApproval: true, ExecutionMode: harness.ExecutionSerial,
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
			if test.interrupt {
				if calls.Load() != 1 {
					t.Fatalf("model continued after interruption: %d", calls.Load())
				}
				results := 0
				for _, event := range agent.Session().Events() {
					if event.Type == "tool/result" {
						results++
						followed += string(event.Data)
					}
				}
				if results != 2 {
					t.Fatalf("unsettled batch: %d results", results)
				}
			}
			if test.reasonSubstring != "" && !strings.Contains(followed, test.reasonSubstring) {
				t.Fatalf("deny reason missing: %s", followed)
			}
		})
	}
}

func TestHookInputCarriesTheSessionPermissionMode(t *testing.T) {
	root := t.TempDir()
	pre := scriptHook(t, root, "PreToolUse", `cat > "$CLAUDE_PLUGIN_ROOT/pre.json"`)
	start := scriptHook(t, root, "SessionStart", `cat > "$CLAUDE_PLUGIN_ROOT/start.json"`)
	adapter := harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant}}, nil
	})
	h, app := testHookHarness(t, adapter, plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{pre, start}}, 0)
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "hook-mode-input", CWD: root, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.event(t.Context(), agent, claudehooks.Input{Event: "PreToolUse", ToolName: "Write"}); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(filepath.Join(root, "pre.json"))
	if err != nil || !strings.Contains(string(body), `"permission_mode":"default"`) {
		t.Fatalf("default input = %s %v", body, err)
	}
	if _, err := harness.SetClaudePermissionMode(agent.Session(), "acceptEdits"); err != nil {
		t.Fatal(err)
	}
	if _, err := app.event(t.Context(), agent, claudehooks.Input{Event: "PreToolUse", ToolName: "Write"}); err != nil {
		t.Fatal(err)
	}
	if _, err := app.event(t.Context(), agent, claudehooks.Input{Event: "SessionStart", Source: "startup"}); err != nil {
		t.Fatal(err)
	}
	body, err = os.ReadFile(filepath.Join(root, "pre.json"))
	startBody, startErr := os.ReadFile(filepath.Join(root, "start.json"))
	if err != nil || startErr != nil || !strings.Contains(string(body), `"permission_mode":"acceptEdits"`) || strings.Contains(string(startBody), "permission_mode") {
		t.Fatalf("pre=%s start=%s err=%v %v", body, startBody, err, startErr)
	}
}

func TestPermissionHookSetsTheSessionMode(t *testing.T) {
	root := t.TempDir()
	hook := scriptHook(t, root, "PermissionRequest", `printf '%s' '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow","updatedPermissions":[{"type":"setMode","mode":"acceptEdits","destination":"session"},{"type":"setMode","mode":"bypassPermissions","destination":"session"}]}}}'`)
	hook.Matcher = "Read"
	var consulted atomic.Int32
	adapter := harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant}}, nil
	})
	h, app := testHookHarness(t, adapter, plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{hook}}, 0)
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "hook-mode", CWD: root, Provider: "fixture", Model: "scripted", Configure: func(_ context.Context, run *point.Run, _ *harness.Agent) error {
		_, err := h.Approvals().Register(run, func(context.Context, harness.ApprovalRequest) (harness.ApprovalOutcome, error) {
			consulted.Add(1)
			return harness.ApprovalAllowedOnce, nil
		})
		return err
	}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := agent.Session().Append("turn/start", struct {
		Turn int `json:"turn"`
	}{1}); err != nil {
		t.Fatal(err)
	}
	outcome, err := app.permissionRequest(t.Context(), harness.ApprovalRequest{Agent: agent, ToolName: "Read", ToolInput: json.RawMessage(`{"file_path":"note.txt"}`)})
	if err != nil || outcome != harness.ApprovalAllowedOnce {
		t.Fatalf("hook outcome=%s %v", outcome, err)
	}
	write, err := h.Approvals().Request(t.Context(), harness.ApprovalRequest{Agent: agent, ToolName: "Write"})
	bash, bashErr := h.Approvals().Request(t.Context(), harness.ApprovalRequest{Agent: agent, ToolName: "Bash"})
	if err != nil || bashErr != nil || write != harness.ApprovalAllowedOnce || bash != harness.ApprovalAllowedOnce || consulted.Load() != 1 {
		t.Fatalf("write=%s bash=%s consulted=%d err=%v %v", write, bash, consulted.Load(), err, bashErr)
	}
}

func TestSessionPermissionRuleAppliesToTheNextCall(t *testing.T) {
	for _, test := range []struct {
		name, permissions, second string
		want                      []string
		secondReason              string
	}{
		{
			name:        "session allow skips the next prompt",
			permissions: `[{"type":"addRules","behavior":"allow","destination":"session","rules":[{"toolName":"Bash","ruleContent":"printf *"}]}]`,
			second:      "printf later",
			want:        []string{"printf original", "printf later"},
		},
		{
			name:         "settings destination is not stored",
			permissions:  `[{"type":"addRules","behavior":"allow","destination":"userSettings","rules":[{"toolName":"Bash","ruleContent":"printf *"}]}]`,
			second:       "printf later",
			want:         []string{"printf original"},
			secondReason: "second",
		},
		{
			name:         "session deny blocks a matching segment",
			permissions:  `[{"type":"addRules","behavior":"deny","destination":"session","rules":[{"toolName":"Bash","ruleContent":"rm *"}]}]`,
			second:       "rm victim; touch marker",
			want:         []string{"printf original"},
			secondReason: "Session permission rule denied this tool call.",
		},
		{
			name:         "session deny blocks before the hook",
			permissions:  `[{"type":"addRules","behavior":"deny","destination":"session","rules":[{"toolName":"Bash","ruleContent":"printf *"}]}]`,
			second:       "printf later",
			want:         []string{"printf original"},
			secondReason: "Session permission rule denied this tool call.",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			script := `if [ -f "$CLAUDE_PLUGIN_ROOT/once" ]; then printf '%s' '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"second"}}}'; exit 0; fi; touch "$CLAUDE_PLUGIN_ROOT/once"; printf '%s' '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow","updatedPermissions":` + test.permissions + `}}}'`
			hook := scriptHook(t, root, "PermissionRequest", script)
			hook.Matcher = "Bash"
			var calls atomic.Int32
			var prompted atomic.Int32
			var commands []string
			var followed string
			adapter := harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
				switch calls.Add(1) {
				case 1:
					return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, Name: "Bash", ToolCallID: "bash-1", Arguments: json.RawMessage(`{"command":"printf original"}`)}}}}, nil
				case 2:
					raw, _ := json.Marshal(request.Messages)
					followed = string(raw)
					return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, Name: "Bash", ToolCallID: "bash-2", Arguments: json.RawMessage(`{"command":"` + test.second + `"}`)}}}}, nil
				default:
					raw, _ := json.Marshal(request.Messages)
					followed = string(raw)
					return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}}, nil
				}
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
					commands = append(commands, body.Command)
					return harness.ToolResult{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "ran"}}}, nil
				},
			})
			if err != nil {
				t.Fatal(err)
			}
			agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "session-permission", CWD: root, Provider: "fixture", Model: "scripted", Configure: func(_ context.Context, run *point.Run, _ *harness.Agent) error {
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
			if prompted.Load() != 0 || strings.Join(commands, ",") != strings.Join(test.want, ",") || test.secondReason != "" && !strings.Contains(followed, test.secondReason) {
				t.Fatalf("prompted=%d commands=%v followed=%s", prompted.Load(), commands, followed)
			}
		})
	}
}
