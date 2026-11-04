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
		isolated   bool
		added      bool
	}{
		{"write then repair", "after-edit", true, false, false},
		{"detached worktree", "after-edit", true, true, false},
		{"added directory", "after-edit", true, false, true},
		{"disabled", "after-edit", false, false, false},
		{"server crash preserves effect", "after-edit-crash", true, false, false},
		{"silent server preserves effect", "after-edit-hang", true, false, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			app, h, agent, root := fixtureApp(t, test.mode, func(config *Config) { config.Diagnostics = test.enabled })
			logRoot := root
			if test.isolated {
				bound, err := nativetools.BindIsolatedWorkspace(t.TempDir())
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { nativetools.ReleaseIsolatedWorkspace(bound) })
				agent, err = h.Agents().Create(t.Context(), harness.AgentOptions{ID: "lsp-worktree", CWD: bound, Provider: "fixture", Model: "scripted"})
				if err != nil {
					t.Fatal(err)
				}
				root = bound
			}

			filePath := "fixture.go"
			if test.added {
				bound, err := nativetools.BindAgentWorkspace(agent, t.TempDir())
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { nativetools.ReleaseAgentWorkspace(agent, bound) })
				root = bound
				filePath = filepath.Join(bound, "fixture.go")
			}
			if _, err := agent.Session().Append("turn/start", struct {
				Turn int `json:"turn"`
			}{1}); err != nil {
				t.Fatal(err)
			}
			native, err := nativetools.Mount(t.Context(), h, nativetools.Options{Workspace: logRoot, ClaudeTools: true})
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
			written := execute("Write", map[string]string{"file_path": filePath, "content": "package fixture\n// BROKEN\n"})
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
			if test.isolated || test.added {
				if !strings.Contains(text, fileURI(filepath.Join(root, "fixture.go"))) {
					t.Fatal("diagnostic did not name the edited worktree file: " + text)
				}
				original, err := os.ReadFile(filepath.Join(logRoot, "fixture.go"))
				if err != nil || strings.Contains(string(original), "BROKEN") {
					t.Fatal("worktree edit changed original source")
				}
			}
			if !strings.Contains(text, "saved file type error") {
				t.Fatal(text)
			}
			repaired := execute("Edit", map[string]string{"file_path": filePath, "old_string": "BROKEN", "new_string": "FIXED"})
			if len(repaired.Result.AdditionalContexts) != 1 || !strings.Contains(repaired.Result.AdditionalContexts[0].Content[0].Text, "empty diagnostic set") {
				t.Fatalf("repair failed to clear diagnostic: %+v", repaired.Result)
			}
			if err := app.Close(); err != nil {
				t.Fatal(err)
			}
			counts := map[string]int{}
			for _, event := range readEvents(t, logRoot) {
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

func TestLaterDiagnosticPublicationReachesNextPrompt(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	h, err := harness.Boot(t.Context(), harness.Options{AdapterProviders: []string{"fixture"}, Adapter: harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		calls++
		messages, _ := json.Marshal(request.Messages)
		text := string(messages)
		if calls == 1 {
			return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, ToolCallID: "write-diagnostic", Name: "Write", Arguments: json.RawMessage(`{"file_path":"fixture.go","content":"package fixture\n// BROKEN\n"}`)}}}}, nil
		}
		if calls == 2 {
			if !strings.Contains(text, "saved file type error") || strings.Contains(text, "follow-up diagnostic") {
				t.Errorf("saved snapshot was not stable: %s", text)
			}
			return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "Saved snapshot recorded."}}}}, nil
		}
		if !strings.Contains(text, "follow-up diagnostic") || !strings.Contains(text, "saved file type error") {
			t.Errorf("later publication missing from the next prompt: %s", text)
		}
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "Follow-up recorded."}}}}, nil
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
	server := fixtureServer(t, root, "after-edit-followup")
	server.Config.Diagnostics = true
	app, err := Mount(t.Context(), h, Options{Workspace: root, Servers: []Selection{{Server: server}}, Environment: []string{"PATH=" + os.Getenv("PATH"), "HOME=" + root}})
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{CWD: root, Provider: "fixture", Model: "scripted", Configure: func(_ context.Context, run *point.Run, _ *harness.Agent) error {
		_, err := h.Approvals().Register(run, func(context.Context, harness.ApprovalRequest) (harness.ApprovalOutcome, error) {
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
	if _, err := agent.Prompt(t.Context(), harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "Write the file."}}}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "protocol.jsonl.release-followup"), []byte("go"), 0600); err != nil {
		t.Fatal(err)
	}
	waitFixtureFile(t, filepath.Join(root, "protocol.jsonl.followup"))
	if _, err := agent.Prompt(t.Context(), harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "Check the later diagnostic."}}}); err != nil {
		t.Fatal(err)
	}
	if calls != 3 {
		t.Fatalf("calls=%d", calls)
	}
}

func TestDiagnosticDeliveryOwnershipAndRevision(t *testing.T) {
	owner, other := new(harness.Agent), new(harness.Agent)
	server := &instance{gate: make(chan struct{}, 1), conn: &connection{}}
	server.gate <- struct{}{}
	app := &App{instances: map[instanceKey]*instance{{agent: owner, server: "fixture"}: server}}
	for _, test := range []struct {
		name                string
		version, generation int
		fresh               bool
	}{
		{"initial publication", 1, 1, true},
		{"later publication", 1, 3, true},
		{"duplicate", 1, 3, false},
		{"reopened document", 2, 1, true},
		{"later reopened publication", 2, 2, true},
		{"old document", 1, 4, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			report := &DiagnosticReport{URI: "file:///fixture.go", Version: test.version, Generation: test.generation, Items: []Diagnostic{}}
			server.conn.diagnostics = &documentDiagnostics{report: report}
			if got := app.pendingDiagnostics(other); len(got) != 0 {
				t.Fatal("unrelated agent received diagnostics", got)
			}
			got := app.pendingDiagnostics(owner)
			if (len(got) == 1) != test.fresh {
				t.Fatalf("fresh=%v, messages=%v", test.fresh, got)
			}
			if got := app.pendingDiagnostics(owner); len(got) != 0 {
				t.Fatal("publication was delivered twice", got)
			}
		})
	}
	// A more-specific added-directory root can launch another instance for the
	// same URI. Its first publication must not inherit the old root's cursor.
	replacement := &instance{gate: make(chan struct{}, 1), conn: &connection{diagnostics: &documentDiagnostics{report: &DiagnosticReport{URI: "file:///fixture.go", Version: 1, Generation: 1, Items: []Diagnostic{}}}}}
	replacement.gate <- struct{}{}
	app.instances = map[instanceKey]*instance{{agent: owner, server: "fixture", cwd: "nested"}: replacement}
	if got := app.pendingDiagnostics(owner); len(got) != 1 {
		t.Fatal("new workspace instance inherited an unrelated delivery cursor", got)
	}

}

func TestDiagnosticOwnerDeactivationReclaimsServer(t *testing.T) {
	app, h, agent, _ := fixtureApp(t, "diagnostics")
	if _, err := app.Query(t.Context(), agent, Query{Operation: Hover, FilePath: "fixture.go", Line: 2, Character: 6}); err != nil {
		t.Fatal(err)
	}
	app.mu.Lock()
	var server *instance
	for _, current := range app.instances {
		server = current
	}
	app.mu.Unlock()
	if server == nil {
		t.Fatal("query did not launch a server")
	}
	app.noteDiagnosticDelivery(agent, server, &DiagnosticReport{URI: "file:///fixture.go", Version: 1, Generation: 1})
	if err := h.Agents().Remove(t.Context(), agent.ID()); err != nil {
		t.Fatal(err)
	}
	app.mu.Lock()
	remaining, delivered := len(app.instances), len(app.delivered)
	app.mu.Unlock()
	if remaining != 0 || delivered != 0 {
		t.Fatalf("owner state retained: instances=%d delivered=%d", remaining, delivered)
	}
	if server.conn.live() {
		t.Fatal("deactivated owner's language server is still live")
	}
}
