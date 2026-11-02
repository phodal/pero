//go:build linux || darwin

package lsp

import (
	"context"
	"encoding/json"
	"errors"
	point "github.com/phodal/pero/harness/go/runtime"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/nativetools"
)

func TestAutomaticSavedFileDiagnostics(t *testing.T) {
	for _, test := range []struct {
		name, mode string
		enabled    bool
	}{
		{"write then repair", "after-edit", true},
		{"disabled", "after-edit", false},
		{"server crash preserves effect", "after-edit-crash", true},
		{"silent server preserves effect", "after-edit-hang", true},
	} {
		t.Run(test.name, func(t *testing.T) {
			app, h, agent, root := fixtureApp(t, test.mode, func(config *Config) { config.Diagnostics = test.enabled })
			if _, err := agent.Session().Append("turn/start", struct {
				Turn int `json:"turn"`
			}{1}); err != nil {
				t.Fatal(err)
			}
			native, err := nativetools.Mount(t.Context(), h, nativetools.Options{Workspace: root, ClaudeTools: true})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = native.Close() })
			execute := func(name string, args any) harness.ToolOutcome {
				t.Helper()
				raw, _ := json.Marshal(args)
				out, err := h.Tools().Execute(t.Context(), harness.ToolRequest{Agent: agent, CallID: harness.ToolCallID(name), Name: name, Arguments: raw, Preapproved: true})
				if err != nil || out.Result.IsError {
					t.Fatalf("successful file effect became failure: %+v %v", out, err)
				}
				return out
			}
			written := execute("Write", map[string]string{"file_path": "fixture.go", "content": "package fixture\n// BROKEN\n"})
			data, err := os.ReadFile(filepath.Join(root, "fixture.go"))
			if err != nil || !strings.Contains(string(data), "BROKEN") {
				t.Fatal("write did not happen")
			}
			if !test.enabled {
				if len(written.Result.AdditionalContexts) != 0 {
					t.Fatal("disabled diagnostics injected context")
				}
				if _, err := os.Stat(filepath.Join(root, "protocol.jsonl")); !os.IsNotExist(err) {
					t.Fatal("disabled diagnostics started server")
				}
				return
			}
			if len(written.Result.AdditionalContexts) != 1 {
				t.Fatalf("missing automatic context: %+v", written.Result)
			}
			context := written.Result.AdditionalContexts[0]
			text := context.Content[0].Text
			if string(context.Source) != `{"kind":"lsp-diagnostics"}` {
				t.Fatal("diagnostic attribution missing")
			}
			if test.mode != "after-edit" {
				if !strings.Contains(text, "unavailable") {
					t.Fatalf("no diagnostic publication mistaken for clean: %s", text)
				}
				return
			}
			if !strings.Contains(text, "saved file type error") {
				t.Fatal(text)
			}
			repaired := execute("Edit", map[string]string{"file_path": "fixture.go", "old_string": "BROKEN", "new_string": "FIXED"})
			if len(repaired.Result.AdditionalContexts) != 1 || !strings.Contains(repaired.Result.AdditionalContexts[0].Content[0].Text, "empty diagnostic set") {
				t.Fatalf("repair failed to clear diagnostic: %+v", repaired.Result)
			}
			if err := app.Close(); err != nil {
				t.Fatal(err)
			}
			counts := map[string]int{}
			for _, event := range readEvents(t, root) {
				counts[event.Method]++
			}
			if counts["textDocument/didSave"] != 2 || counts["textDocument/didOpen"] != 2 || counts["textDocument/didClose"] != 2 {
				t.Fatalf("missing real saved snapshots: %+v", counts)
			}
		})
	}
}

func TestDiagnosticsConfigurationDefault(t *testing.T) {
	for _, test := range []struct {
		field string
		want  bool
	}{{"", true}, {`,"diagnostics":true`, true}, {`,"diagnostics":false`, false}} {
		servers, err := DecodeServers([]byte(`{"go":{"command":"gopls","extensionToLanguage":{".go":"go"}` + test.field + `}}`))
		if err != nil || servers[0].Config.Diagnostics != test.want {
			t.Fatalf("diagnostic selection mismatch: %v", err)
		}
	}
}

func TestModelReceivesAutomaticDiagnostics(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	h, err := harness.Boot(t.Context(), harness.Options{AdapterProviders: []string{"fixture"}, Adapter: harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		calls++
		messages, _ := json.Marshal(request.Messages)
		name, args := "Write", `{"file_path":"fixture.go","content":"package fixture\n// BROKEN\n"}`
		if calls == 2 {
			if !strings.Contains(string(messages), "saved file type error") {
				t.Error("next model request did not contain diagnostic")
			}
			name, args = "Edit", `{"file_path":"fixture.go","old_string":"BROKEN","new_string":"FIXED"}`
		}
		if calls == 3 {
			if !strings.Contains(string(messages), "empty diagnostic set") {
				t.Error("next model request did not contain cleared diagnostic")
			}
			return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "Repaired with server evidence."}}}}, nil
		}
		if calls > 3 {
			return harness.Completion{}, errors.New("unexpected retry of file effects")
		}
		return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, ToolCallID: harness.ToolCallID(name), Name: name, Arguments: json.RawMessage(args)}}}}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) }()
	native, err := nativetools.Mount(t.Context(), h, nativetools.Options{Workspace: root, ClaudeTools: true})
	if err != nil {
		t.Fatal(err)
	}
	defer native.Close()
	server := fixtureServer(t, root, "after-edit")
	server.Config.Diagnostics = true
	app, err := Mount(t.Context(), h, Options{Workspace: root, Servers: []Selection{{Server: server}}, Environment: []string{"PATH=" + os.Getenv("PATH"), "HOME=" + root}})
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()
	approvals := 0
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{CWD: root, Provider: "fixture", Model: "scripted", Configure: func(_ context.Context, run *point.Run, _ *harness.Agent) error {
		_, err := h.Approvals().Register(run, func(context.Context, harness.ApprovalRequest) (harness.ApprovalOutcome, error) {
			approvals++
			return harness.ApprovalAllowedOnce, nil
		})
		return err
	}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := harness.SetPermissionMode(agent.Session(), harness.PermissionWorkspaceWrite); err != nil {
		t.Fatal(err)
	}
	if _, err := agent.Prompt(t.Context(), harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "Write and repair using actual diagnostics."}}}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(root, "fixture.go"))
	if err != nil || string(data) != "package fixture\n// FIXED\n" || approvals != 2 || calls != 3 {
		t.Fatalf("incomplete real file/model/approval flow: %q %v approvals=%d calls=%d", data, err, approvals, calls)
	}
}
