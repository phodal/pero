package nativetools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/phodal/pero/harness/go/fstools"
	"github.com/phodal/pero/harness/go/harness"
	runtime "github.com/phodal/pero/harness/go/runtime"
	"github.com/phodal/pero/harness/go/shell"
)

func TestNativeToolApprovalAndWorkspaceBoundary(t *testing.T) {
	if goruntime.GOOS != "linux" && goruntime.GOOS != "darwin" {
		t.Skip("positive native workspace contract requires Linux or Darwin")
	}
	root := t.TempDir()
	ctx := t.Context()
	h, e := harness.Boot(ctx, harness.Options{ApprovalPolicy: harness.ApprovalAsk})
	if e != nil {
		t.Fatal(e)
	}
	app, e := Mount(ctx, h, Options{Workspace: root})
	if e != nil {
		t.Fatal(e)
	}
	if err := app.CheckCWD(root); err != nil {
		t.Fatal(err)
	}
	if err := app.CheckCWD(t.TempDir()); err == nil {
		t.Fatal("mismatched session workspace accepted")
	}
	defer func() { h.Dispose(context.Background()); h.Drain(context.Background()); app.Close() }()
	create := func(id string, grant bool) *harness.Agent {
		a, e := h.Agents().Create(ctx, harness.AgentOptions{ID: harness.SessionID(id), CWD: root, Configure: func(c context.Context, r *runtime.Run, a *harness.Agent) error {
			if !grant {
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
		return a
	}
	denied := create("denied", false)
	allowed := create("allowed", true)
	execute := func(a *harness.Agent, name, input string) harness.ToolResult {
		out, e := h.Tools().Execute(ctx, harness.ToolRequest{Agent: a, Name: name, CallID: harness.ToolCallID(name + "-call"), Arguments: json.RawMessage(input)})
		if e != nil {
			t.Fatal(e)
		}
		return out.Result
	}
	result := execute(denied, "write_file", `{"path":"file.txt","content":"test"}`)
	if !result.IsError {
		t.Fatal("unanswered approval allowed write")
	}
	if _, e := os.Stat(filepath.Join(root, "file.txt")); !os.IsNotExist(e) {
		t.Fatal("denied write had side effect")
	}
	result = execute(allowed, "write_file", `{"path":"file.txt","content":"needle"}`)
	if result.IsError {
		t.Fatalf("approved write: %+v", result)
	}
	result = execute(denied, "read_file", `{"path":"file.txt"}`)
	if result.IsError || !strings.Contains(result.Content[0].Text, "needle") {
		t.Fatalf("workspace read: %+v", result)
	}
	result = execute(denied, "regex_search", `{"pattern":"^NEED.*$","ignore_case":true,"glob":"*.txt","output_mode":"content"}`)
	if result.IsError || !strings.Contains(result.Content[0].Text, "needle") {
		t.Fatalf("regex search without shell: %+v", result)
	}
	result = execute(denied, "glob_files", `{"pattern":"**/*.txt","limit":1}`)
	if result.IsError || !strings.Contains(result.Content[0].Text, "file.txt") {
		t.Fatalf("glob without shell: %+v", result)
	}
	result = execute(denied, "regex_search", `{"pattern":"(?<=unsupported)lookbehind"}`)
	if !result.IsError {
		t.Fatal("unsupported regex silently accepted")
	}
	result = execute(allowed, "write_file", `{"path":"../outside","content":"bad"}`)
	if !result.IsError {
		t.Fatal("approval widened path authority")
	}
	result = execute(allowed, "shell", `{"command":"true"}`)
	if !result.IsError {
		t.Fatal("shell installed without explicit opt-in")
	}
}

func TestOutputBudgetPreservesFailedShellAndUnknownReceipt(t *testing.T) {
	code := 9
	value := shell.RunResult{ExitCode: &code, TimedOut: true, Aborted: true, Stdout: shell.CollectedOutput{Text: strings.Repeat("\x01", 16384)}, Stderr: shell.CollectedOutput{Text: strings.Repeat("\x02", 16384)}}
	out, e := renderResult(value, errors.New(strings.Repeat("\x03", 4096)))
	if e != nil || !out.IsError || len(out.Content[0].Text) > fstools.MaxOutputBytes {
		t.Fatalf("render: %+v %v", out, e)
	}
	var decoded struct {
		Result shell.RunResult `json:"result"`
	}
	if e = json.Unmarshal([]byte(out.Content[0].Text), &decoded); e != nil {
		t.Fatal(e)
	}
	if decoded.Result.ExitCode == nil || *decoded.Result.ExitCode != 9 || !decoded.Result.TimedOut || !decoded.Result.Aborted || !decoded.Result.Stdout.Truncated || !decoded.Result.Stderr.Truncated {
		t.Fatalf("status lost: %+v", decoded.Result)
	}
	out, e = renderResult(fstools.ScopedTextReceipt{Path: "file", State: "unknown"}, errors.New("partial commit"))
	if e != nil || !out.IsError || !strings.Contains(out.Content[0].Text, `"state":"unknown"`) {
		t.Fatalf("receipt lost %+v %v", out, e)
	}
}

func TestEarlyCWDCheckRejectsReplacedWorkspace(t *testing.T) {
	if goruntime.GOOS != "linux" && goruntime.GOOS != "darwin" {
		t.Skip("positive native workspace contract requires Linux or Darwin")
	}
	root := t.TempDir()
	files, err := fstools.OpenWorkspace(root)
	if err != nil {
		t.Fatal(err)
	}
	app := &App{files: files}
	defer app.Close()
	if err = app.CheckCWD(root); err != nil {
		t.Fatal(err)
	}
	moved := root + "-old"
	if err = os.Rename(root, moved); err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(moved)
	if err = os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	if err = app.CheckCWD(root); err == nil {
		t.Fatal("replaced workspace admitted")
	}
}

func TestShellOutputBudgetRetainsTail(t *testing.T) {
	for _, fill := range []string{"progress\n", "界", "\x01"} {
		t.Run(fmt.Sprintf("byte-%x", []byte(fill)), func(t *testing.T) {
			const final = "FINAL_FAILURE_DETAIL"
			code := 1
			text := strings.Repeat(fill, 6000) + final
			result, err := renderResult(shell.RunResult{ExitCode: &code, Stdout: shell.CollectedOutput{Text: text}, Stderr: shell.CollectedOutput{Text: text}}, errors.New("shell failed"))
			if err != nil {
				t.Fatal(err)
			}
			var got struct {
				Result shell.RunResult `json:"result"`
			}
			if err = json.Unmarshal([]byte(result.Content[0].Text), &got); err != nil {
				t.Fatal(err)
			}
			for _, output := range []shell.CollectedOutput{got.Result.Stdout, got.Result.Stderr} {
				if !strings.HasSuffix(output.Text, final) || !output.Truncated || len(output.Text) > 4096 || !utf8.ValidString(output.Text) {
					t.Fatalf("tail lost or unbounded: %+v", output)
				}
			}
			if !result.IsError || got.Result.ExitCode == nil || *got.Result.ExitCode != 1 {
				t.Fatal("failure status lost")
			}
		})
	}
}

func TestUnsupportedNativeMount(t *testing.T) {
	if goruntime.GOOS == "linux" || goruntime.GOOS == "darwin" || goruntime.GOOS == "windows" {
		t.Skip("unsupported-platform contract")
	}
	h, err := harness.Boot(t.Context(), harness.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { h.Dispose(context.Background()); h.Drain(context.Background()) }()
	app, err := Mount(t.Context(), h, Options{Workspace: t.TempDir()})
	if app != nil || err == nil || !strings.Contains(err.Error(), "supported descriptor-rooted Unix") {
		t.Fatalf("native mount: %v %v", app, err)
	}
}
