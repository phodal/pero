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
	"time"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/nativetools"
	"github.com/phodal/pero/harness/go/plugins"
	point "github.com/phodal/pero/harness/go/runtime"
)

func TestAddDirGrantsTheDirectoryAndNotifies(t *testing.T) {
	root := t.TempDir()
	other := t.TempDir()
	if err := os.WriteFile(filepath.Join(other, "note.txt"), []byte("outside"), 0o600); err != nil {
		t.Fatal(err)
	}
	hook := scriptHook(t, root, "DirectoryAdded", `cat > "$CLAUDE_PLUGIN_ROOT/added.json"`)
	hook.Matcher = "slash_command"
	var step atomic.Int32
	where := filepath.Join(root, "where")
	h, err := harness.Boot(t.Context(), harness.Options{Adapter: harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		command := ""
		n := step.Add(1)
		switch n {
		case 1:
			command = "cd " + other
		case 2:
			command = "pwd -P > " + where
		default:
			return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}}, nil
		}
		encoded, _ := json.Marshal(command)
		return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, Name: "Bash", ToolCallID: harness.ToolCallID("bash-" + string(rune('0'+n))), Arguments: append(append([]byte(`{"command":`), encoded...), '}')}}}}, nil
	}), AdapterProviders: []string{"fixture"}, ApprovalPolicy: harness.ApprovalAsk})
	if err != nil {
		t.Fatal(err)
	}
	app, err := MountHooks(t.Context(), h, []plugins.Package{{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{hook}}}, HookOptions{Shell: "/bin/sh", Environment: []string{"PATH=/usr/bin:/bin"}, StateDirectory: root})
	if err != nil || app == nil {
		t.Fatal(err)
	}
	native, err := nativetools.Mount(t.Context(), h, nativetools.Options{Workspace: root, EnableShell: true, ClaudeTools: true, Shell: "/bin/bash", OnShellDirectory: app.ShellDirectoryChanged})
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
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "add-dir", CWD: root, Provider: "fixture", Model: "scripted", Configure: func(_ context.Context, run *point.Run, _ *harness.Agent) error {
		_, err := h.Approvals().Register(run, func(context.Context, harness.ApprovalRequest) (harness.ApprovalOutcome, error) {
			return harness.ApprovalAllowedOnce, nil
		})
		return err
	}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.AddDirectory(agent, filepath.Join(root, "missing")); err == nil {
		t.Fatal("missing directory was added")
	}
	if _, err := app.AddDirectory(agent, root); err == nil {
		t.Fatal("workspace was added again")
	}
	added, ok, err := h.Commands().Execute(t.Context(), agent, "/add-dir "+other)
	if err != nil || !ok || added.Result.Kind != harness.CommandSuccess {
		t.Fatalf("add-dir %+v %v", added.Result, err)
	}
	if _, err := app.AddDirectory(agent, other); err == nil {
		t.Fatal("directory was added twice")
	}
	deadline := time.Now().Add(2 * time.Second)
	var body []byte
	for {
		body, err = os.ReadFile(filepath.Join(root, "added.json"))
		if err == nil && strings.Contains(string(body), `"source":"slash_command"`) && strings.Contains(string(body), other) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("directory hook = %s %v", body, err)
		}
		time.Sleep(15 * time.Millisecond)
	}
	addedRoot := strings.TrimPrefix(added.Result.Text, "Added ")
	read, err := h.Tools().Execute(t.Context(), harness.ToolRequest{Agent: agent, Name: "Read", Arguments: json.RawMessage(`{"file_path":"` + filepath.Join(addedRoot, "note.txt") + `"}`)})
	if err != nil || read.Result.IsError || !strings.Contains(toolResultText(read.Result), "outside") {
		t.Fatalf("read %+v %v added=%s path=%s", read.Result, err, added.Result.Text, filepath.Join(other, "note.txt"))
	}
	if err := prompt(t, agent, "enter the added directory"); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(where)
	resolved, _ := filepath.EvalSymlinks(other)
	if err != nil || strings.TrimSpace(string(got)) != resolved {
		t.Fatalf("shell stayed at %q, want %s (%v)", got, resolved, err)
	}
}
