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
	"github.com/phodal/pero/harness/go/nativetools"
	"github.com/phodal/pero/harness/go/plugins"
	point "github.com/phodal/pero/harness/go/runtime"
)

func TestShellDirectoryChangeRefreshesTheSessionEnvironment(t *testing.T) {
	root := t.TempDir()
	start := scriptHook(t, root, "SessionStart", `printf 'export PERO_FROM_HOOK=ready\n' >> "$CLAUDE_ENV_FILE"`)
	changed := scriptHook(t, root, "CwdChanged", `body=$(cat); printf '%s' "$body" > "$CLAUDE_PROJECT_DIR/cwd.json"; printf 'export PERO_FROM_HOOK=moved\n' >> "$CLAUDE_ENV_FILE"`)
	pre := scriptHook(t, root, "PreToolUse", `printf '%s' "$CLAUDE_ENV_FILE" > "$CLAUDE_PROJECT_DIR/pre-env"`)
	pre.Matcher = "Bash"
	envA, envB := filepath.Join(root, "env-a"), filepath.Join(root, "env-b")
	var step atomic.Int32
	adapter := harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		command := ""
		n := step.Add(1)
		switch n {
		case 1:
			command = `printf %s "$PERO_FROM_HOOK" > ` + envA
		case 2:
			command = "mkdir -p sub && cd sub"
		case 3:
			command = `printf %s "$PERO_FROM_HOOK" > ` + envB
		default:
			return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}}, nil
		}
		encoded, _ := json.Marshal(command)
		return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, Name: "Bash", ToolCallID: harness.ToolCallID("bash-" + string(rune('0'+n))), Arguments: append(append([]byte(`{"command":`), encoded...), '}')}}}}, nil
	})
	h, err := harness.Boot(t.Context(), harness.Options{Adapter: adapter, AdapterProviders: []string{"fixture"}, ApprovalPolicy: harness.ApprovalAsk})
	if err != nil {
		t.Fatal(err)
	}
	app, err := MountHooks(t.Context(), h, []plugins.Package{{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{start, changed, pre}}}, HookOptions{Shell: "/bin/sh", Environment: []string{"PATH=/usr/bin:/bin"}, StateDirectory: root})
	if err != nil || app == nil {
		t.Fatal(err)
	}
	native, err := nativetools.Mount(t.Context(), h, nativetools.Options{Workspace: root, EnableShell: true, ClaudeTools: true, Shell: "/bin/bash", BashEnvFile: app.BashEnvironmentFile, OnShellDirectory: app.ShellDirectoryChanged})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx := context.Background()
		_ = h.Dispose(ctx)
		_ = h.Drain(ctx)
		_ = native.Close()
		_ = app.Close()
	})
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "cwd-hooks", CWD: root, Provider: "fixture", Model: "scripted", Configure: func(_ context.Context, run *point.Run, _ *harness.Agent) error {
		_, err := h.Approvals().Register(run, func(context.Context, harness.ApprovalRequest) (harness.ApprovalOutcome, error) {
			return harness.ApprovalAllowedOnce, nil
		})
		return err
	}})
	if err != nil {
		t.Fatal(err)
	}
	if err := prompt(t, agent, "move"); err != nil {
		t.Fatal(err)
	}
	first, err := os.ReadFile(envA)
	if err != nil || string(first) != "ready" {
		t.Fatalf("first environment = %q %v", first, err)
	}
	preEnv, err := os.ReadFile(filepath.Join(root, "pre-env"))
	if err != nil || len(preEnv) != 0 {
		t.Fatalf("PreToolUse saw CLAUDE_ENV_FILE %q %v", preEnv, err)
	}
	second, err := os.ReadFile(envB)
	if err != nil || string(second) != "moved" {
		t.Fatalf("environment after the directory change = %q %v", second, err)
	}
	body, err := os.ReadFile(filepath.Join(root, "cwd.json"))
	resolved, _ := filepath.EvalSymlinks(root)
	sub, _ := filepath.EvalSymlinks(filepath.Join(root, "sub"))
	if err != nil || !strings.Contains(string(body), resolved) || !strings.Contains(string(body), sub) || !strings.Contains(string(body), `"hook_event_name":"CwdChanged"`) {
		t.Fatalf("cwd hook = %s err=%v", body, err)
	}
}
