//go:build windows

package nativetools

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/runtime"
	"github.com/phodal/pero/harness/go/sandbox"
)

func TestWindowsPartialMountKeepsFileBoundaryAndAlwaysAsks(t *testing.T) {
	if os.Getenv("PERO_REQUIRE_WINDOWS_ACL") != "1" {
		t.Skip("requires explicit disposable Windows ACL test authorization")
	}
	pwsh, err := exec.LookPath("pwsh.exe")
	if err != nil {
		t.Fatal(err)
	}
	pwsh, err = filepath.Abs(pwsh)
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	h, err := harness.Boot(t.Context(), harness.Options{ApprovalPolicy: harness.ApprovalAsk})
	if err != nil {
		t.Fatal(err)
	}
	// Keep the catalog independent of optional host-installed PDF renderers.
	app, err := Mount(t.Context(), h, Options{Workspace: root, EnableShell: true, Shell: pwsh, PDFRendererPath: "-", Sandbox: &sandbox.Config{Backend: sandbox.BackendWindowsACL, Mode: sandbox.WorkspaceWrite}})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { h.Dispose(context.Background()); h.Drain(context.Background()); app.Close() }()
	if err := app.CheckCWD(root); err != nil {
		t.Fatal(err)
	}
	if err := app.CheckCWD(t.TempDir()); err == nil {
		t.Fatal("unrelated session cwd accepted")
	}
	asked := false
	a, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "windows-partial", CWD: root, Configure: func(ctx context.Context, run *runtime.Run, _ *harness.Agent) error {
		_, err := h.Approvals().Register(run, func(_ context.Context, request harness.ApprovalRequest) (harness.ApprovalOutcome, error) {
			asked = true
			if request.Native != nil {
				t.Error("partial sandbox advertised a strict native approval descriptor")
			}
			return harness.ApprovalRejected, nil
		})
		return err
	}})
	if err != nil {
		t.Fatal(err)
	}
	schemas, err := h.Tools().SchemasForAgent(t.Context(), a)
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]string{}
	for _, schema := range schemas {
		names[schema.Name] = schema.Description
	}
	wantNames := []string{"read_file", "list_directory", "search_files", "glob_files", "regex_search", "notebook_read", "notebook_image", "EnterPlanMode", "ReadToolOutput", "tool_search", "write_file", "shell"}
	if len(names) != len(wantNames) {
		t.Fatalf("Windows native tool catalog: %+v", names)
	}
	for _, name := range wantNames {
		if names[name] == "" {
			t.Fatalf("missing Windows native tool %q: %+v", name, names)
		}
	}
	if !strings.Contains(names["write_file"], "create-only") || names["edit_file"] != "" || !strings.Contains(names["shell"], "NOT isolated") {
		t.Fatalf("Windows native tools or boundary description: %+v", schemas)
	}
	a.Session().Append("turn/start", map[string]int{"turn": 1})
	args, err := json.Marshal(map[string]string{"command": "[IO.File]::WriteAllText('denied.txt', 'bad')"})
	if err != nil {
		t.Fatal(err)
	}
	out, err := h.Tools().Execute(t.Context(), harness.ToolRequest{Agent: a, Name: "shell", CallID: "deny", Arguments: args})
	if err != nil || !out.Result.IsError || !asked {
		t.Fatalf("approval=%v out=%+v err=%v", asked, out, err)
	}
	if _, err := os.Stat(filepath.Join(root, "denied.txt")); !os.IsNotExist(err) {
		t.Fatalf("denied shell executed: %v", err)
	}
}

func TestWindowsReadOnlyMountOmitsFileMutations(t *testing.T) {
	pwsh, err := exec.LookPath("pwsh.exe")
	if err != nil {
		t.Fatal(err)
	}
	pwsh, err = filepath.Abs(pwsh)
	if err != nil {
		t.Fatal(err)
	}
	h, err := harness.Boot(t.Context(), harness.Options{ApprovalPolicy: harness.ApprovalAsk})
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	// Keep the catalog independent of optional host-installed PDF renderers.
	app, err := Mount(t.Context(), h, Options{Workspace: root, EnableShell: true, Shell: pwsh, PDFRendererPath: "-", Sandbox: &sandbox.Config{Backend: sandbox.BackendWindowsACL, Mode: sandbox.ReadOnly}})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { h.Dispose(context.Background()); h.Drain(context.Background()); app.Close() }()
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "windows-read-only", CWD: root})
	if err != nil {
		t.Fatal(err)
	}
	schemas, err := h.Tools().SchemasForAgent(t.Context(), agent)
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]bool{}
	for _, schema := range schemas {
		names[schema.Name] = true
	}
	wantNames := []string{"read_file", "list_directory", "search_files", "glob_files", "regex_search", "notebook_read", "notebook_image", "EnterPlanMode", "ReadToolOutput", "tool_search", "shell"}
	if len(names) != len(wantNames) {
		t.Fatalf("read-only native tool catalog: %+v", names)
	}
	for _, name := range wantNames {
		if !names[name] {
			t.Fatalf("missing read-only native tool %q: %+v", name, names)
		}
	}
	if names["write_file"] || names["edit_file"] {
		t.Fatalf("read-only mutation capability leaked: %+v", names)
	}
}
