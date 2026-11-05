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
	"github.com/phodal/pero/harness/go/subagents"
)

func TestHooksKeepMainLifecycleSeparateFromSubagentTools(t *testing.T) {
	root := t.TempDir()
	var declarations []claudehooks.Hook
	for _, event := range []string{"SessionStart", "UserPromptSubmit", "SessionEnd", "PreToolUse", "PostToolUse", "PostCompact"} {
		hook := scriptHook(t, root, event, `cat >> "$CLAUDE_PLUGIN_ROOT/`+event+`.jsonl"; printf '\n' >> "$CLAUDE_PLUGIN_ROOT/`+event+`.jsonl"`)
		if event == "PreToolUse" || event == "PostToolUse" {
			hook.Matcher = "Read"
		}
		declarations = append(declarations, hook)
	}
	stop := scriptHook(t, root, "Stop", `body=$(cat); printf '%s\n' "$body" >> "$CLAUDE_PLUGIN_ROOT/Stop.jsonl"; case "$body" in *'child finished'*) printf '%s' '{"decision":"block","reason":"root gate must not inspect child completion"}';; *) printf '{}';; esac`)
	declarations = append(declarations, stop)
	var parentCalls, childCalls, toolCalls atomic.Int32
	var childID harness.SessionID
	var hooks *harness.AgentHooks
	adapter := harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		if request.Agent.Parent() != nil {
			childID = request.Agent.ID()
			if childCalls.Add(1) == 1 {
				// The real child's compaction pipeline must not synthesize a main
				// SessionStart(source=compact) event or context.
				input, err := hooks.PostCompact.Run(t.Context(), harness.CompactionHookInput{Agent: request.Agent, Trigger: "auto"}, nil)
				if err != nil || len(input.Messages) != 0 {
					t.Errorf("child post-compaction emitted main context: %+v %v", input, err)
				}
				return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, Name: "Read", ToolCallID: "child-read", Arguments: json.RawMessage(`{}`)}}}}, nil
			}
			return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "child finished"}}}}, nil
		}
		if parentCalls.Add(1) == 1 {
			return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, Name: "Agent", ToolCallID: "delegate", Arguments: json.RawMessage(`{"subagent_type":"sample:reviewer","description":"Read a fixture","prompt":"child prompt stays in its own transcript"}`)}}}}, nil
		}
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "root finished"}}}}, nil
	})
	h, err := harness.Boot(t.Context(), harness.Options{EnableSubagents: true, Adapter: adapter, AdapterProviders: []string{"fixture"}})
	if err != nil {
		t.Fatal(err)
	}
	hooks = h.Hooks()
	app, err := MountHooks(t.Context(), h, []plugins.Package{{Root: root, Definition: plugins.Plugin{Name: "sample"}, Hooks: declarations}}, HookOptions{Shell: "/bin/sh", Environment: []string{"PATH=/usr/bin:/bin"}, StateDirectory: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()); _ = app.Close() }()
	_, err = h.RegisterTool(t.Context(), "fixture-read", harness.Tool{Schema: harness.ToolSchema{Name: "Read", InputSchema: json.RawMessage(`{"type":"object"}`)}, Execute: func(context.Context, json.RawMessage) (harness.ToolResult, error) {
		toolCalls.Add(1)
		return harness.ToolResult{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "verified resource"}}}, nil
	}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := subagents.MountClaude(t.Context(), h, []subagents.AgentDefinition{{Name: "sample:reviewer", Description: "Read a fixture", Instructions: "Read the selected fixture and report the result.", Tools: []string{"Read"}}}, subagents.ClaudeOptions{}); err != nil {
		t.Fatal(err)
	}
	parent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "main-hook-session", CWD: root, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	if err := prompt(t, parent, "delegate this research"); err != nil {
		t.Fatal(err)
	}
	if err := h.Agents().Remove(t.Context(), parent.ID()); err != nil {
		t.Fatal(err)
	}
	if parentCalls.Load() != 2 || childCalls.Load() != 2 || toolCalls.Load() != 1 {
		t.Fatalf("root stop gate affected child: parent=%d child=%d tools=%d", parentCalls.Load(), childCalls.Load(), toolCalls.Load())
	}
	var transcript string
	for _, event := range []string{"SessionStart", "UserPromptSubmit", "Stop", "SessionEnd", "PreToolUse", "PostToolUse", "PostCompact"} {
		data, err := os.ReadFile(filepath.Join(root, event+".jsonl"))
		if err != nil {
			t.Fatal(err)
		}
		lines := strings.Split(strings.TrimSpace(string(data)), "\n")
		if len(lines) != 1 {
			t.Fatalf("%s events=%d want one: %s", event, len(lines), data)
		}
		var input claudehooks.Input
		if err := json.Unmarshal([]byte(lines[0]), &input); err != nil {
			t.Fatal(err)
		}
		if input.SessionID != string(parent.ID()) {
			t.Fatalf("%s lost main session identity: %+v", event, input)
		}
		if transcript == "" {
			transcript = input.TranscriptPath
		} else if input.TranscriptPath != transcript {
			t.Errorf("%s transcript=%s want main %s", event, input.TranscriptPath, transcript)
		}
		childEvent := event == "PreToolUse" || event == "PostToolUse" || event == "PostCompact"
		if childEvent && (input.AgentID != string(childID) || input.AgentType != "sample:reviewer") {
			t.Errorf("%s lost typed child attribution: %+v", event, input)
		}
		if !childEvent && (input.AgentID != "" || input.AgentType != "") {
			t.Errorf("main event %s was attributed to child: %+v", event, input)
		}
	}
	data, err := os.ReadFile(transcript)
	if err != nil || !strings.Contains(string(data), "delegate this research") || strings.Contains(string(data), "child prompt stays in its own transcript") {
		t.Fatalf("shared transcript does not project main conversation: %s %v", data, err)
	}
}
