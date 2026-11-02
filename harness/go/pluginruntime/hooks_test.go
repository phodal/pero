//go:build linux || darwin

package pluginruntime

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/plugins"
	point "github.com/phodal/pero/harness/go/runtime"
)

func scriptHook(t *testing.T, root, event, body string) claudehooks.Hook {
	t.Helper()
	file, err := os.CreateTemp(root, "hook-*.sh")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.WriteString("#!/bin/sh\n" + body + "\n"); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	return claudehooks.Hook{Event: event, Command: "/bin/sh", Args: []string{file.Name()}, ExecForm: true}
}

func testHookHarness(t *testing.T, adapter harness.Adapter, pkg plugins.Package, budget int) (*harness.Harness, *HookApp) {
	t.Helper()
	h, err := harness.Boot(t.Context(), harness.Options{Adapter: adapter, AdapterProviders: []string{"fixture"}})
	if err != nil {
		t.Fatal(err)
	}
	app, err := MountHooks(t.Context(), h, []plugins.Package{pkg}, HookOptions{Shell: "/bin/sh", Environment: []string{"PATH=/usr/bin:/bin"}, StateDirectory: t.TempDir(), MaxStopBlocks: budget})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = h.Dispose(ctx)
		if err := h.Drain(ctx); err != nil {
			t.Errorf("harness cleanup: %v", err)
		}
		if err := app.Close(); err != nil {
			t.Errorf("hook cleanup: %v", err)
		}
	})
	return h, app
}

func prompt(t *testing.T, agent *harness.Agent, text string) error {
	t.Helper()
	_, err := agent.Prompt(t.Context(), harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: text}}})
	return err
}

func TestHookSessionLifecycle(t *testing.T) {
	root := t.TempDir()
	start := scriptHook(t, root, "SessionStart", `body=$(cat); printf '%s\n' "$body" >> "$CLAUDE_PLUGIN_ROOT/lifecycle.jsonl"; case "$body" in *'"source":"resume"'*) printf '%s' '{"hookSpecificOutput":{"additionalContext":"resumed hook context"}}';; *) printf '%s' '{"hookSpecificOutput":{"additionalContext":"startup hook context"}}';; esac`)
	start.Matcher = "startup|resume"
	end := scriptHook(t, root, "SessionEnd", `cat >> "$CLAUDE_PLUGIN_ROOT/lifecycle.jsonl"`)
	var calls atomic.Int32
	adapter := harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		call := calls.Add(1)
		want := "startup hook context"
		if call == 3 {
			want = "resumed hook context"
		}
		found := false
		for _, message := range request.Messages {
			found = found || strings.Contains(messageText(message), want)
		}
		if !found {
			t.Errorf("provider request preceded SessionStart context: want %q", want)
		}
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}}, nil
	})
	h, _ := testHookHarness(t, adapter, plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{start, end}}, 0)
	options := harness.AgentOptions{ID: "lifecycle", CWD: root, Provider: "fixture", Model: "scripted"}
	agent, err := h.Agents().Create(t.Context(), options)
	if err != nil {
		t.Fatal(err)
	}
	if err := prompt(t, agent, "first"); err != nil {
		t.Fatal(err)
	}
	if err := prompt(t, agent, "second"); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(root, "lifecycle.jsonl"))
	if err != nil || strings.Count(string(data), "SessionStart") != 1 || strings.Contains(string(data), "SessionEnd") {
		t.Fatalf("turn completion was confused with session lifecycle: %s, %v", data, err)
	}
	restored, err := harness.RestoreSession(agent.Session().Header(), agent.Session().Events())
	if err != nil {
		t.Fatal(err)
	}
	if err := h.Agents().Remove(t.Context(), agent.ID()); err != nil {
		t.Fatal(err)
	}
	agent, err = h.Agents().Resume(t.Context(), restored, options)
	if err != nil {
		t.Fatal(err)
	}
	if err := prompt(t, agent, "third"); err != nil {
		t.Fatal(err)
	}
	data, err = os.ReadFile(filepath.Join(root, "lifecycle.jsonl"))
	if err != nil || strings.Count(string(data), "SessionStart") != 2 || strings.Count(string(data), "SessionEnd") != 1 || !strings.Contains(string(data), `"source":"resume"`) {
		t.Fatalf("resume/retirement hooks were lost: %s, %v", data, err)
	}
}

func TestHookToolAdmissionAndResult(t *testing.T) {
	for _, test := range []struct {
		name, pre, post, postEvent, expectedPath string
		policy                                   harness.ApprovalPolicy
		requiresApproval                         bool
		bodyCalls, approvals                     int32
	}{
		{name: "deny blocks the body", pre: `{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"gate denied"}}`, post: "failure context", postEvent: "PostToolUseFailure"},
		{name: "ask uses existing approval broker", pre: `{"hookSpecificOutput":{"permissionDecision":"ask","permissionDecisionReason":"check write"}}`, bodyCalls: 1, approvals: 1, expectedPath: "original.md"},
		{name: "allow can preapprove an ordinary gate", pre: `{"hookSpecificOutput":{"permissionDecision":"allow"}}`, requiresApproval: true, bodyCalls: 1, expectedPath: "original.md", post: "success context", postEvent: "PostToolUse"},
		{name: "allow does not bypass never", pre: `{"hookSpecificOutput":{"permissionDecision":"allow"}}`, requiresApproval: true, policy: harness.ApprovalNever},
		{name: "updated input reaches the body", pre: `{"hookSpecificOutput":{"updatedInput":{"file_path":"changed.md","content":"changed"}}}`, bodyCalls: 1, expectedPath: "changed.md"},
		{name: "updated input is schema checked again", pre: `{"hookSpecificOutput":{"updatedInput":{"file_path":5}}}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			pre := scriptHook(t, root, "PreToolUse", `cat > "$CLAUDE_PLUGIN_ROOT/tool-input.json"; printf '%s' '`+test.pre+`'`)
			pre.Matcher = "Write"
			hooks := []claudehooks.Hook{pre}
			if test.post != "" {
				hooks = append(hooks, scriptHook(t, root, test.postEvent, `printf '%s' '{"hookSpecificOutput":{"additionalContext":"`+test.post+`"}}'`))
			}
			var calls, bodies, approvals atomic.Int32
			adapter := harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
				if calls.Add(1) == 1 {
					return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, Name: "Write", ToolCallID: "write-1", Arguments: json.RawMessage(`{"file_path":"original.md","content":"original"}`)}}}}, nil
				}
				if test.post != "" {
					found := false
					for _, message := range request.Messages {
						found = found || strings.Contains(messageText(message), test.post)
					}
					if !found {
						t.Errorf("tool hook context did not reach provider: %s", test.post)
					}
				}
				return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}}, nil
			})
			h, _ := testHookHarness(t, adapter, plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: hooks}, 0)
			_, err := h.RegisterTool(t.Context(), "fixture-write", harness.Tool{Schema: harness.ToolSchema{Name: "Write", InputSchema: json.RawMessage(`{"type":"object","properties":{"file_path":{"type":"string"},"content":{"type":"string"}},"required":["file_path","content"],"additionalProperties":false}`)}, RequiresApproval: test.requiresApproval, Execute: func(_ context.Context, arguments json.RawMessage) (harness.ToolResult, error) {
				bodies.Add(1)
				var value struct {
					Path string `json:"file_path"`
				}
				if err := json.Unmarshal(arguments, &value); err != nil {
					return harness.ToolResult{}, err
				}
				if value.Path != test.expectedPath {
					t.Errorf("body received path=%q, expected %q", value.Path, test.expectedPath)
				}
				return harness.ToolResult{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "written"}}}, nil
			}})
			if err != nil {
				t.Fatal(err)
			}
			agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "tool-hooks", CWD: root, Provider: "fixture", Model: "scripted", Configure: func(_ context.Context, run *point.Run, _ *harness.Agent) error {
				_, err := h.Approvals().Register(run, func(context.Context, harness.ApprovalRequest) (harness.ApprovalOutcome, error) {
					approvals.Add(1)
					return harness.ApprovalAllowedOnce, nil
				})
				return err
			}})
			if err != nil {
				t.Fatal(err)
			}
			if test.policy != "" {
				if err := h.Approvals().SetPolicy(agent, test.policy); err != nil {
					t.Fatal(err)
				}
			}
			if err := prompt(t, agent, "write a report"); err != nil {
				t.Fatal(err)
			}
			if bodies.Load() != test.bodyCalls || approvals.Load() != test.approvals {
				t.Fatalf("body=%d approvals=%d", bodies.Load(), approvals.Load())
			}
			data, err := os.ReadFile(filepath.Join(root, "tool-input.json"))
			if err != nil || !strings.Contains(string(data), `"tool_name":"Write"`) || !strings.Contains(string(data), `"tool_input":{"file_path":"original.md"`) {
				t.Fatalf("standard tool payload missing: %s %v", data, err)
			}
		})
	}
}

func TestStopHookContinuationAndBudget(t *testing.T) {
	for _, bounded := range []bool{false, true} {
		t.Run(map[bool]string{false: "continues once", true: "finite continuation budget"}[bounded], func(t *testing.T) {
			root := t.TempDir()
			body := `body=$(cat); case "$body" in *'"stop_hook_active":true'*) printf '{}';; *) printf '%s' '{"decision":"block","reason":"finish the next step"}';; esac`
			if bounded {
				body = `printf '%s' '{"decision":"block","reason":"still blocked"}'`
			}
			stop := scriptHook(t, root, "Stop", body)
			var calls atomic.Int32
			adapter := harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
				if calls.Add(1) > 1 {
					found := false
					for _, message := range request.Messages {
						found = found || strings.Contains(messageText(message), "finish the next step") || strings.Contains(messageText(message), "still blocked")
					}
					if !found {
						t.Error("blocked Stop did not inject a continuation")
					}
				}
				return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}}, nil
			})
			h, _ := testHookHarness(t, adapter, plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{stop}}, 2)
			agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "stop", CWD: root, Provider: "fixture", Model: "scripted"})
			if err != nil {
				t.Fatal(err)
			}
			err = prompt(t, agent, "start")
			if bounded {
				if err != nil || calls.Load() != 3 {
					t.Fatalf("budget was not enforced: calls=%d error=%v", calls.Load(), err)
				}
			} else if err != nil || calls.Load() != 2 {
				t.Fatalf("continuation did not settle: calls=%d error=%v", calls.Load(), err)
			}
		})
	}
}

func TestHookTranscriptOnlyProjectsRealUserText(t *testing.T) {
	root := t.TempDir()
	stop := scriptHook(t, root, "Stop", `cat > "$CLAUDE_PLUGIN_ROOT/stop-input.json"; printf '{}'`)
	adapter := harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockReasoning, Text: "reasoning must not be exported"}, {Type: harness.BlockText, Text: "assistant response"}}}}, nil
	})
	h, _ := testHookHarness(t, adapter, plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{stop}}, 0)
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "transcript", CWD: root, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	if err := agent.Inject(hookMessage("fixture", "synthetic user-role instructions")); err != nil {
		t.Fatal(err)
	}
	if err := prompt(t, agent, "remember that examples help"); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(root, "stop-input.json"))
	if err != nil {
		t.Fatal(err)
	}
	var input claudehooks.Input
	if err := json.Unmarshal(data, &input); err != nil {
		t.Fatal(err)
	}
	file, err := os.Open(input.TranscriptPath)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("transcript must be private: %v %v", info, err)
	}
	var roles []string
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		var record transcriptRecord
		if err := json.Unmarshal(scanner.Bytes(), &record); err != nil {
			t.Fatal(err)
		}
		roles = append(roles, record.Message.Role)
		if strings.Contains(scanner.Text(), "synthetic") || strings.Contains(scanner.Text(), "reasoning must") {
			t.Errorf("non-user instructions or reasoning entered transcript: %s", scanner.Text())
		}
	}
	if scanner.Err() != nil || strings.Join(roles, ",") != "user,assistant" {
		t.Fatalf("unexpected transcript roles: %v %v", roles, scanner.Err())
	}
}

func TestPromptRejectionAndCompactionHooks(t *testing.T) {
	root := t.TempDir()
	submit := scriptHook(t, root, "UserPromptSubmit", `body=$(cat); printf '%s\n' "$body" >> "$CLAUDE_PLUGIN_ROOT/prompts.jsonl"; case "$body" in *'"prompt":"blocked"'*) printf '%s' '{"decision":"block","reason":"prompt gate"}';; *) printf '{}';; esac`)
	compact := scriptHook(t, root, "PreCompact", `printf '%s' '{"decision":"block","reason":"checkpoint required"}'`)
	var calls atomic.Int32
	adapter := harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		calls.Add(1)
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant}}, nil
	})
	h, _ := testHookHarness(t, adapter, plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{submit, compact}}, 0)
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "prompt", CWD: root, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	if err := prompt(t, agent, "blocked"); err == nil || !strings.Contains(err.Error(), "prompt gate") || calls.Load() != 0 {
		t.Fatalf("blocked prompt reached provider or lost its reason: %d %v", calls.Load(), err)
	}
	if err := prompt(t, agent, "allowed"); err != nil || calls.Load() != 1 {
		t.Fatalf("rejected prompt was replayed: %d %v", calls.Load(), err)
	}
	if err := agent.Inject(hookMessage("fixture", "plugin followup")); err != nil {
		t.Fatal(err)
	}
	done, err := agent.FollowupResult(hookMessage("fixture", "another plugin turn"))
	if err != nil {
		t.Fatal(err)
	}
	if outcome := <-done; outcome.Err != nil {
		t.Fatal(outcome.Err)
	}
	data, err := os.ReadFile(filepath.Join(root, "prompts.jsonl"))
	if err != nil || strings.Count(string(data), "UserPromptSubmit") != 2 {
		t.Fatalf("plugin contexts retriggered prompt submission: %s %v", data, err)
	}
	compaction, err := h.Hooks().PreCompact.Run(t.Context(), harness.CompactionHookInput{Agent: agent, Trigger: "manual"}, nil)
	if err != nil || !compaction.Reject || compaction.Reason != "checkpoint required" {
		t.Fatalf("PreCompact did not reach the core decision: %+v %v", compaction, err)
	}
}

func TestUnsupportedHookCannotMount(t *testing.T) {
	h, err := harness.Boot(t.Context(), harness.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Dispose(context.Background())
	for _, hook := range []claudehooks.Hook{{Event: "FutureEvent"}, {Event: "Stop", Async: true}} {
		app, err := MountHooks(t.Context(), h, []plugins.Package{{Hooks: []claudehooks.Hook{hook}}}, HookOptions{StateDirectory: t.TempDir()})
		if err == nil || app != nil {
			t.Fatalf("unsupported hook silently mounted: %+v %v", app, err)
		}
	}
}

func TestClosingHooksCancelsAndDrainsActiveProcess(t *testing.T) {
	root := t.TempDir()
	start := scriptHook(t, root, "SessionStart", `printf ready > "$CLAUDE_PLUGIN_ROOT/ready"; sleep 30`)
	adapter := harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		t.Error("provider must not run after its SessionStart hook was cancelled")
		return harness.Completion{}, nil
	})
	h, app := testHookHarness(t, adapter, plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{start}}, 0)
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "cleanup", CWD: root, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		_, err := agent.Prompt(t.Context(), harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "start"}}})
		done <- err
	}()
	deadline := time.NewTimer(3 * time.Second)
	defer deadline.Stop()
	tick := time.NewTicker(5 * time.Millisecond)
	defer tick.Stop()
	for {
		if _, err := os.Stat(filepath.Join(root, "ready")); err == nil {
			break
		}
		select {
		case <-deadline.C:
			t.Fatal("hook did not publish readiness")
		case err := <-done:
			t.Fatalf("hook stopped before readiness: %v", err)
		case <-tick.C:
		}
	}
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	if err := app.Dispose(ctx); err != nil {
		t.Fatalf("hook disposal failed to drain: %v", err)
	}
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("expected owner cancellation, got %v", err)
		}
	case <-ctx.Done():
		t.Fatal("turn did not settle after hook owner disposal")
	}
}

func TestNonBlockingHookFailureAllowsProviderDispatch(t *testing.T) {
	root := t.TempDir()
	start := scriptHook(t, root, "SessionStart", "printf 'fixture warning' >&2; exit 7")
	var calls atomic.Int32
	adapter := harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		calls.Add(1)
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant}}, nil
	})
	h, _ := testHookHarness(t, adapter, plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{start}}, 0)
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "nonblocking", CWD: root, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	if err := prompt(t, agent, "continue"); err != nil || calls.Load() != 1 {
		t.Fatalf("non-blocking hook prevented dispatch: calls=%d error=%v", calls.Load(), err)
	}
}
