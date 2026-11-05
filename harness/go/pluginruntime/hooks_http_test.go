//go:build linux || darwin

package pluginruntime

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/plugins"
)

func TestHTTPHookDeniesAToolAndContinuesAfterAServerError(t *testing.T) {
	for _, test := range []struct {
		name, onFailure string
		status          int
		body            string
		runsBody        bool
	}{
		{name: "json deny blocks the tool", status: 200, body: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"http gate"}}`},
		{name: "server error continues", status: 500, body: "nope", runsBody: true},
		{name: "server error can block", status: 500, body: "nope", onFailure: "block"},
	} {
		t.Run(test.name, func(t *testing.T) {
			var sawAuth, sawOther, sawTool atomic.Bool
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") == "Bearer secret" {
					sawAuth.Store(true)
				}
				if r.Header.Get("X-Other") == "" {
					sawOther.Store(true)
				}
				raw, _ := io.ReadAll(r.Body)
				if strings.Contains(string(raw), `"tool_name":"Write"`) {
					sawTool.Store(true)
				}
				w.WriteHeader(test.status)
				_, _ = w.Write([]byte(test.body))
			}))
			defer server.Close()
			root := t.TempDir()
			state, err := filepath.EvalSymlinks(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			var modelCalls atomic.Int32
			h, err := harness.Boot(t.Context(), harness.Options{Adapter: harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
				if modelCalls.Add(1) == 1 {
					return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, Name: "Write", ToolCallID: "write-1", Arguments: json.RawMessage(`{"file_path":"original.md","content":"original"}`)}}}}, nil
				}
				return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}}, nil
			}), AdapterProviders: []string{"fixture"}})
			if err != nil {
				t.Fatal(err)
			}
			hook := claudehooks.Hook{Event: "PreToolUse", Matcher: "Write", URL: server.URL, Headers: map[string]string{"Authorization": "Bearer $TOKEN", "X-Other": "$OTHER"}, AllowedEnvVars: []string{"TOKEN"}, OnFailure: test.onFailure}
			app, err := MountHooks(t.Context(), h, []plugins.Package{{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{hook}}}, HookOptions{Shell: "/bin/sh", Environment: []string{"PATH=/usr/bin:/bin", "TOKEN=secret", "OTHER=hidden"}, StateDirectory: state})
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
			var bodies atomic.Int32
			if _, err := h.RegisterTool(t.Context(), "fixture-write", harness.Tool{Schema: harness.ToolSchema{Name: "Write", InputSchema: json.RawMessage(`{"type":"object","properties":{"file_path":{"type":"string"},"content":{"type":"string"}},"required":["file_path","content"],"additionalProperties":false}`)}, Execute: func(context.Context, json.RawMessage) (harness.ToolResult, error) {
				bodies.Add(1)
				return harness.ToolResult{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "wrote"}}}, nil
			}}); err != nil {
				t.Fatal(err)
			}
			agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "http-hook", CWD: root, Provider: "fixture", Model: "scripted"})
			if err != nil {
				t.Fatal(err)
			}
			if err := prompt(t, agent, "write"); err != nil {
				t.Fatal(err)
			}
			if (bodies.Load() == 1) != test.runsBody || !sawAuth.Load() || !sawOther.Load() || !sawTool.Load() {
				t.Fatalf("body=%d auth=%v other=%v tool=%v", bodies.Load(), sawAuth.Load(), sawOther.Load(), sawTool.Load())
			}
		})
	}
}
