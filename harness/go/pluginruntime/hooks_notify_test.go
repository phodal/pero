//go:build linux || darwin

package pluginruntime

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/plugins"
	point "github.com/phodal/pero/harness/go/runtime"
)

func TestPermissionPromptNotificationWaitsForAnUnansweredPrompt(t *testing.T) {
	previous := permissionNotifyDelay
	permissionNotifyDelay = 40 * time.Millisecond
	t.Cleanup(func() { permissionNotifyDelay = previous })
	for _, test := range []struct {
		name, id   string
		hold, want bool
		disable    bool
	}{
		{name: "unanswered prompt notifies", id: "notify-wait", hold: true, want: true},
		{name: "answered prompt stays quiet", id: "notify-fast"},
		{name: "environment disables the notice", id: "notify-off", hold: true, disable: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			if test.disable {
				t.Setenv("CLAUDE_CODE_DISABLE_PERMISSION_PROMPT_NOTIFY_HOOKS", "1")
			}
			root := t.TempDir()
			hook := scriptHook(t, root, "Notification", `cat > "$CLAUDE_PLUGIN_ROOT/notice.json"`)
			hook.Matcher = "permission_prompt"
			var calls int
			adapter := harness.AdapterFunc(func(_ context.Context, _ harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
				calls++
				if calls == 1 {
					return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, Name: "Bash", ToolCallID: "bash", Arguments: json.RawMessage(`{"command":"printf ok"}`)}}}}, nil
				}
				return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}}, nil
			})
			h, _ := testHookHarness(t, adapter, plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{hook}}, 0)
			if _, err := h.RegisterTool(t.Context(), "fixture-bash", harness.Tool{Schema: harness.ToolSchema{Name: "Bash", InputSchema: json.RawMessage(`{"type":"object","properties":{"command":{"type":"string"}},"required":["command"]}`)}, RequiresApproval: true, Execute: func(context.Context, json.RawMessage) (harness.ToolResult, error) {
				return harness.ToolResult{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "ok"}}}, nil
			}}); err != nil {
				t.Fatal(err)
			}
			release := make(chan struct{})
			agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: harness.SessionID(test.id), CWD: root, Provider: "fixture", Model: "scripted", Configure: func(_ context.Context, run *point.Run, _ *harness.Agent) error {
				_, err := h.Approvals().Register(run, func(context.Context, harness.ApprovalRequest) (harness.ApprovalOutcome, error) {
					if test.hold {
						<-release
					}
					return harness.ApprovalAllowedOnce, nil
				})
				return err
			}})
			if err != nil {
				t.Fatal(err)
			}
			done := make(chan error, 1)
			go func() { done <- prompt(t, agent, "run") }()
			notice := filepath.Join(root, "notice.json")
			if test.hold && !test.disable {
				deadline := time.Now().Add(2 * time.Second)
				for {
					payload, err := os.ReadFile(notice)
					if err == nil && strings.Contains(string(payload), `"notification_type":"permission_prompt"`) && strings.Contains(string(payload), "Claude needs your permission") {
						close(release)
						break
					}
					if time.Now().After(deadline) {
						close(release)
						t.Fatalf("permission prompt notice missing: %s %v", payload, err)
					}
					time.Sleep(15 * time.Millisecond)
				}
			} else if test.hold {
				time.Sleep(120 * time.Millisecond)
				close(release)
			} else {
				time.Sleep(120 * time.Millisecond)
			}
			if err := <-done; err != nil {
				t.Fatal(err)
			}
			_, statErr := os.Stat(notice)
			if test.want && statErr != nil {
				t.Fatal(statErr)
			}
			if !test.want && statErr == nil {
				t.Fatal("notification fired without a waiting prompt")
			}
		})
	}
}
