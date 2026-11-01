package nativetools

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
	run "github.com/phodal/pero/harness/go/runtime"
	"github.com/phodal/pero/harness/go/shell"
)

func cloneFixture(t *testing.T) (string, string, CloneRequest, *shell.LocalExecutor) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("Unix controlled-clone implementation")
	}
	source, workspace := t.TempDir(), t.TempDir()
	git := func(args ...string) string {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", source}, args...)...)
		cmd.Env = []string{"PATH=/usr/bin:/bin", "HOME=" + t.TempDir(), "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null"}
		out, e := cmd.CombinedOutput()
		if e != nil {
			t.Fatalf("fixture git %v: %s %v", args, out, e)
		}
		return strings.TrimSpace(string(out))
	}
	git("init", "--quiet", "--template=")
	git("config", "user.name", "Fixture")
	git("config", "user.email", "fixture@example.invalid")
	for name, body := range map[string]string{"run.sh": "#!/bin/sh\ntouch MUST_NOT_RUN\n", ".gitattributes": "* filter=lfs\n", ".gitmodules": "[submodule \"bad\"]\npath = bad\nurl = ext::must-not-execute\n"} {
		if e := os.WriteFile(filepath.Join(source, name), []byte(body), 0700); e != nil {
			t.Fatal(e)
		}
	}
	git("-c", "filter.lfs.required=false", "add", ".")
	git("commit", "--quiet", "-m", "owned fixture")
	request := CloneRequest{URL: "https://github.com/example/fixture", Revision: git("rev-parse", "HEAD"), Destination: "acquired", License: "unknown", BundleID: strings.Repeat("a", 64), ResourceID: strings.Repeat("b", 64)}
	executor, e := shell.NewLocalExecutor(shell.LocalOptions{Shell: "/bin/bash", CWD: workspace})
	if e != nil {
		t.Fatal(e)
	}
	return source, workspace, request, executor
}

func TestCloneAcquiresExactCommitWithoutCheckoutOrImplicitExecution(t *testing.T) {
	source, workspace, request, executor := cloneFixture(t)
	receipt, e := executeClone(t.Context(), executor, workspace, request, source)
	if e != nil || receipt.State != "completed" || receipt.ResolvedCommit != request.Revision || receipt.Origin != request.URL || receipt.Checkout {
		t.Fatalf("receipt: %+v %v", receipt, e)
	}
	entries, e := os.ReadDir(filepath.Join(workspace, request.Destination))
	if e != nil {
		t.Fatal(e)
	}
	if len(entries) != 1 || entries[0].Name() != ".git" {
		t.Fatalf("unexpected checkout files %v", entries)
	}
	hooks, e := os.ReadDir(filepath.Join(workspace, request.Destination, ".git", "hooks"))
	if e == nil && len(hooks) != 0 {
		t.Fatalf("installed hooks: %v", hooks)
	}
	again, e := executeClone(t.Context(), executor, workspace, request, source)
	if e == nil || again.State != "not_started" {
		t.Fatalf("existing destination retried %+v %v", again, e)
	}
}

func TestCloneInputAndFailedExecutionNeverProduceSuccess(t *testing.T) {
	source, workspace, request, executor := cloneFixture(t)
	cases := []CloneRequest{}
	for _, url := range []string{"file:///tmp/repo", "https://user@github.com/example/repo", "https://github.com/example/repo?x=1", "https://127.0.0.1/a/b", "https://github.com/example/repo.git"} {
		r := request
		r.URL = url
		cases = append(cases, r)
	}
	for _, destination := range []string{"../outside", "parent/child", ".", "-bad"} {
		r := request
		r.Destination = destination
		cases = append(cases, r)
	}
	r := request
	r.Revision = "main"
	cases = append(cases, r)
	for _, r := range cases {
		if _, e := executeClone(t.Context(), executor, workspace, r, source); e == nil {
			t.Fatalf("accepted %+v", r)
		}
	}
	entries, _ := os.ReadDir(workspace)
	if len(entries) != 0 {
		t.Fatal("invalid requests had effects")
	}
	request.Revision = strings.Repeat("0", 40)
	receipt, e := executeClone(t.Context(), executor, workspace, request, source)
	if e == nil || receipt.State == "completed" || receipt.ResolvedCommit != "" {
		t.Fatalf("failed fetch claimed success: %+v %v", receipt, e)
	}
}

type localCloneTransport struct {
	shell.Executor
	url, source string
}

func (f localCloneTransport) Resolve(r shell.ExecRequest) (shell.ExecSpec, error) {
	// Only the transport is a fixture seam; execution, observation and receipt are real.
	r.Command = strings.ReplaceAll(r.Command, "protocol.https.allow=always", "protocol.file.allow=always")
	r.Command = strings.Replace(r.Command, "-- '"+f.url+"' ", "-- '"+f.source+"' ", 1)
	return f.Executor.Resolve(r)
}

func TestCloneRegisteredApprovalDenialAndActualToolReceipt(t *testing.T) {
	source, workspace, input, executor := cloneFixture(t)
	h, e := harness.Boot(t.Context(), harness.Options{ApprovalPolicy: harness.ApprovalAsk})
	if e != nil {
		t.Fatal(e)
	}
	defer func() { h.Dispose(context.Background()); h.Drain(context.Background()) }()
	if e = mountResearchClone(t.Context(), h, workspace, localCloneTransport{executor, input.URL, source}); e != nil {
		t.Fatal(e)
	}
	create := func(id string, allow bool) *harness.Agent {
		a, e := h.Agents().Create(t.Context(), harness.AgentOptions{ID: harness.SessionID(id), CWD: workspace, Configure: func(c context.Context, r *run.Run, a *harness.Agent) error {
			if !allow {
				return nil
			}
			_, e := h.Approvals().Register(r, func(context.Context, harness.ApprovalRequest) (harness.ApprovalOutcome, error) {
				return harness.ApprovalAllowedOnce, nil
			})
			return e
		}})
		if e != nil {
			t.Fatal(e)
		}
		a.Session().Append("turn/start", map[string]int{"turn": 1})
		if _, err := harness.SetPermissionMode(a.Session(), harness.PermissionAutoReview); err != nil {
			t.Fatal(err)
		}
		return a
	}
	raw, _ := json.Marshal(input)
	call := func(a *harness.Agent, id string) harness.ToolResult {
		out, e := h.Tools().Execute(t.Context(), harness.ToolRequest{Agent: a, Name: "clone_repository", CallID: harness.ToolCallID(id), Arguments: raw})
		if e != nil {
			t.Fatal(e)
		}
		return out.Result
	}
	denied := call(create("denied", false), "denied-clone")
	if !denied.IsError {
		t.Fatal("approval denial accepted")
	}
	if entries, _ := os.ReadDir(workspace); len(entries) != 0 {
		t.Fatal("denied clone had filesystem effects")
	}
	result := call(create("allowed", true), "allowed-clone")
	if result.IsError {
		t.Fatalf("approved acquisition: %+v", result)
	}
	var receipt CloneReceipt
	if e = json.Unmarshal([]byte(result.Content[0].Text), &receipt); e != nil || receipt.State != "completed" || receipt.ResolvedCommit != input.Revision {
		t.Fatalf("actual tool result: %+v %v", result, e)
	}
}

func TestCloneCancelledBeforeExecutionHasNoCompletedReceipt(t *testing.T) {
	source, workspace, input, executor := cloneFixture(t)
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	receipt, e := executeClone(ctx, executor, workspace, input, source)
	if e == nil || receipt.State == "completed" {
		t.Fatalf("cancelled clone: %+v %v", receipt, e)
	}
}

func TestCloneOptInDoesNotEnableGenericShell(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix controlled clone")
	}
	workspace := t.TempDir()
	h, err := harness.Boot(t.Context(), harness.Options{ApprovalPolicy: harness.ApprovalAsk})
	if err != nil {
		t.Fatal(err)
	}
	app, err := Mount(t.Context(), h, Options{Workspace: workspace, EnableResearchClone: true})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { h.Dispose(context.Background()); h.Drain(context.Background()); app.Close() }()
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "clone-only", CWD: workspace})
	if err != nil {
		t.Fatal(err)
	}
	agent.Session().Append("turn/start", map[string]int{"turn": 1})
	out, err := h.Tools().Execute(t.Context(), harness.ToolRequest{Agent: agent, Name: "shell", CallID: "not-granted", Arguments: json.RawMessage(`{"command":"true"}`)})
	if err != nil {
		t.Fatal(err)
	}
	if !out.Result.IsError {
		t.Fatal("clone opt-in implicitly enabled arbitrary shell")
	}
}
