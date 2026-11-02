package nativetools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	goruntime "runtime"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/phodal/pero/harness/go/fstools"
	"github.com/phodal/pero/harness/go/harness"
	runtime "github.com/phodal/pero/harness/go/runtime"
	"github.com/phodal/pero/harness/go/shell"
)

type claudeFixture struct {
	root      string
	app       *App
	harness   *harness.Harness
	allowed   *harness.Agent
	denied    *harness.Agent
	approvals atomic.Int32
}

func newClaudeFixture(t *testing.T, options Options) *claudeFixture {
	t.Helper()
	if goruntime.GOOS != "darwin" && goruntime.GOOS != "linux" && goruntime.GOOS != "windows" {
		t.Skip("native workspace unavailable")
	}
	fixture := &claudeFixture{root: t.TempDir()}
	options.Workspace, options.ClaudeTools = fixture.root, true
	h, err := harness.Boot(t.Context(), harness.Options{ApprovalPolicy: harness.ApprovalAsk})
	if err != nil {
		t.Fatal(err)
	}
	fixture.harness = h
	fixture.app, err = Mount(t.Context(), h, options)
	if err != nil {
		h.Dispose(context.Background())
		h.Drain(context.Background())
		t.Fatal(err)
	}
	t.Cleanup(func() {
		h.Dispose(context.Background())
		h.Drain(context.Background())
		fixture.app.Close()
	})
	for _, allowed := range []bool{true, false} {
		id := "denied"
		if allowed {
			id = "allowed"
		}
		agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: harness.SessionID(id), CWD: fixture.root, Configure: func(_ context.Context, run *runtime.Run, _ *harness.Agent) error {
			_, err := h.Approvals().Register(run, func(context.Context, harness.ApprovalRequest) (harness.ApprovalOutcome, error) {
				fixture.approvals.Add(1)
				if allowed {
					return harness.ApprovalAllowedOnce, nil
				}
				return harness.ApprovalRejected, nil
			})
			return err
		}})
		if err != nil {
			t.Fatal(err)
		}
		agent.Session().Append("turn/start", struct{ Turn int }{1})
		if allowed {
			fixture.allowed = agent
		} else {
			fixture.denied = agent
		}
	}
	return fixture
}

func (f *claudeFixture) call(t *testing.T, agent *harness.Agent, name string, input any) harness.ToolResult {
	t.Helper()
	raw, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	out, err := f.harness.Tools().Execute(t.Context(), harness.ToolRequest{Agent: agent, Name: name, CallID: harness.ToolCallID(name + "-call"), Arguments: raw})
	if err != nil {
		t.Fatal(err)
	}
	return out.Result
}

func TestClaudeFileToolsKeepWorkspaceAndApproval(t *testing.T) {
	f := newClaudeFixture(t, Options{})
	abs := filepath.Join(f.root, "document.txt")
	input := struct {
		FilePath string `json:"file_path"`
		Content  string `json:"content"`
	}{abs, "first\nneedle\nneedle\n"}
	denied := f.call(t, f.denied, "Write", input)
	if !denied.IsError {
		t.Fatal("denied Claude Write succeeded")
	}
	if _, err := os.Stat(abs); !os.IsNotExist(err) {
		t.Fatal("denied Write changed files")
	}
	before := f.approvals.Load()
	written := f.call(t, f.allowed, "Write", input)
	if written.IsError || f.approvals.Load()-before != 1 || !strings.Contains(written.Content[0].Text, `"state":"applied"`) {
		t.Fatalf("Write lost its single approval or mutation receipt: %+v", written)
	}
	read := f.call(t, f.denied, "Read", struct {
		FilePath string `json:"file_path"`
		Offset   int    `json:"offset"`
		Limit    int    `json:"limit"`
	}{abs, 2, 1})
	var window fstools.ReadWindow
	if read.IsError || json.Unmarshal([]byte(read.Content[0].Text), &window) != nil || window.Offset != 2 || window.Content != "     2→needle" || window.Digest == "" || window.NextOffset != 3 {
		t.Fatalf("Read line window or metadata lost: %+v", read)
	}
	if f.app.files.SupportsReplacement() {
		edit := struct {
			FilePath   string `json:"file_path"`
			OldString  string `json:"old_string"`
			NewString  string `json:"new_string"`
			ReplaceAll bool   `json:"replace_all"`
		}{abs, "needle", "fixed", false}
		if !f.call(t, f.allowed, "Edit", edit).IsError {
			t.Fatal("ambiguous Edit accepted without replace_all")
		}
		edit.ReplaceAll = true
		if result := f.call(t, f.allowed, "Edit", edit); result.IsError {
			t.Fatalf("replace_all failed: %+v", result)
		}
		text, err := os.ReadFile(abs)
		if err != nil || string(text) != "first\nfixed\nfixed\n" {
			t.Fatal("Edit did not apply exact replacements")
		}
	}
	outside := filepath.Join(t.TempDir(), "outside.txt")
	for _, name := range []string{outside, "../outside.txt"} {
		input.FilePath = name
		if result := f.call(t, f.allowed, "Write", input); !result.IsError {
			t.Fatal("Claude path mapping widened workspace authority")
		}
	}
	if _, err := os.Stat(outside); !os.IsNotExist(err) {
		t.Fatal("outside Write changed files")
	}
	if result := f.call(t, f.allowed, "Bash", struct {
		Command string `json:"command"`
	}{"true"}); !result.IsError {
		t.Fatal("Bash registered without enable-shell")
	}
}

func TestClaudeReadOnlyResource(t *testing.T) {
	resourceRoot := t.TempDir()
	resource := filepath.Join(resourceRoot, "template.md")
	if err := os.WriteFile(resource, []byte("template\nsecond\n"), 0600); err != nil {
		t.Fatal(err)
	}
	resourceFiles, err := fstools.OpenWorkspace(resourceRoot)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { resourceFiles.Close() })
	var reads atomic.Int32
	f := newClaudeFixture(t, Options{ReadOnlyResource: func(ctx context.Context, selected string) (fstools.ScopedText, error) {
		reads.Add(1)
		if selected != resource {
			return fstools.ScopedText{}, errors.New("resource is not selected")
		}
		return resourceFiles.Read(ctx, "template.md")
	}})
	result := f.call(t, f.allowed, "Read", struct {
		FilePath string `json:"file_path"`
		Offset   int    `json:"offset"`
	}{resource, 2})
	if result.IsError || reads.Load() != 1 || !strings.Contains(result.Content[0].Text, "2→second") || !strings.Contains(result.Content[0].Text, `"digest":`) {
		t.Fatalf("selected resource read failed: %+v", result)
	}
	if result := f.call(t, f.allowed, "Read", struct {
		FilePath string `json:"file_path"`
	}{filepath.Join(resourceRoot, "other.md")}); !result.IsError {
		t.Fatal("unselected resource accepted")
	}
	before := reads.Load()
	if result := f.call(t, f.allowed, "Write", struct {
		FilePath string `json:"file_path"`
		Content  string `json:"content"`
	}{resource, "overwrite"}); !result.IsError || reads.Load() != before {
		t.Fatal("Write borrowed read-only resource authority")
	}
	if result := f.call(t, f.allowed, "Glob", struct {
		Path    string `json:"path"`
		Pattern string `json:"pattern"`
	}{resourceRoot, "**/*"}); !result.IsError || reads.Load() != before {
		t.Fatal("Glob borrowed read-only resource authority")
	}
	if result := f.call(t, f.allowed, "Grep", struct {
		Path    string `json:"path"`
		Pattern string `json:"pattern"`
	}{resourceRoot, "template"}); !result.IsError || reads.Load() != before {
		t.Fatal("Grep borrowed read-only resource authority")
	}
	if f.app.files.SupportsReplacement() {
		if result := f.call(t, f.allowed, "Edit", struct {
			FilePath  string `json:"file_path"`
			OldString string `json:"old_string"`
			NewString string `json:"new_string"`
		}{resource, "template", "overwrite"}); !result.IsError || reads.Load() != before {
			t.Fatal("Edit borrowed read-only resource authority")
		}
	}
}

func TestClaudeGlobAndGrep(t *testing.T) {
	f := newClaudeFixture(t, Options{})
	for name, text := range map[string]string{
		"root.go":         "package root\nfunc Start() {}\n",
		"src/one.ts":      "before\nconst Foo = 42;\nafter\n",
		"src/two.tsx":     "const foo = 7;\n",
		"src/no.txt":      "const Foo = 9;\n",
		"src/multi.go":    "func Start(\n  value int,\n) {}\n",
		".git/private.go": "secret\n",
		"binary.dat":      "bad\x00text",
	} {
		file := filepath.Join(f.root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	for _, test := range []struct {
		pattern string
		files   []string
	}{
		{"**/*.{ts,tsx}", []string{"src/one.ts", "src/two.tsx"}},
		{"*.go", []string{"root.go"}},
		{"**/m?lti.[g]o", []string{"src/multi.go"}},
	} {
		result := f.call(t, f.allowed, "Glob", struct {
			Pattern string `json:"pattern"`
		}{test.pattern})
		var got claudeGlobResult
		if result.IsError || json.Unmarshal([]byte(result.Content[0].Text), &got) != nil || !reflect.DeepEqual(got.Files, test.files) {
			t.Fatalf("glob %s: %+v", test.pattern, result)
		}
	}
	for _, test := range []struct {
		name      string
		input     string
		files     []string
		matches   int
		counts    []claudeGrepCount
		truncated bool
		wantError bool
	}{
		{name: "regex glob and ignore case", input: `{"pattern":"const\\s+foo\\s*=\\s*\\d+", "glob":"*.{ts,tsx}","-i":true}`, files: []string{"src/one.ts", "src/two.tsx"}},
		{name: "content context", input: `{"pattern":"Foo", "path":"src/one.ts", "output_mode":"content", "-C":1}`, matches: 3},
		{name: "multiline type", input: `{"pattern":"Start\\(.*value", "type":"go", "multiline":true}`, files: []string{"src/multi.go"}},
		{name: "count matching lines", input: `{"pattern":"Foo", "output_mode":"count", "glob":"*.ts"}`, counts: []claudeGrepCount{{Path: "src/one.ts", Count: 1}}},
		{name: "pagination", input: `{"pattern":"const", "glob":"*.{ts,tsx}","head_limit":1,"offset":1}`, files: []string{"src/two.tsx"}},
		{name: "limit explicit", input: `{"pattern":"const", "glob":"*.{ts,tsx}","head_limit":1}`, files: []string{"src/one.ts"}, truncated: true},
		{name: "unsupported regex", input: `{"pattern":"(?<=const) Foo"}`, wantError: true},
		{name: "invalid glob", input: `{"pattern":"const", "glob":"["}`, wantError: true},
		{name: "unknown type", input: `{"pattern":"const", "type":"unknown-fixture"}`, wantError: true},
		{name: "outside", input: `{"pattern":"const", "path":"../outside"}`, wantError: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			result := f.call(t, f.allowed, "Grep", json.RawMessage(test.input))
			if result.IsError != test.wantError {
				t.Fatalf("error mismatch: %+v", result)
			}
			if test.wantError {
				return
			}
			var got claudeGrepResult
			if err := json.Unmarshal([]byte(result.Content[0].Text), &got); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got.Files, test.files) || len(got.Matches) != test.matches || !reflect.DeepEqual(got.Counts, test.counts) || got.Truncated != test.truncated {
				t.Fatalf("grep: %+v", got)
			}
		})
	}
}

func TestClaudeBashKeepsSingleApprovalAndStatus(t *testing.T) {
	if goruntime.GOOS != "linux" && goruntime.GOOS != "darwin" {
		t.Skip("Unix shell contract")
	}
	f := newClaudeFixture(t, Options{EnableShell: true})
	before := f.approvals.Load()
	result := f.call(t, f.allowed, "Bash", json.RawMessage(`{"command":"printf output; printf failure >&2; exit 7","timeout":1000,"description":"fixture"}`))
	var got struct {
		Result shell.RunResult `json:"result"`
	}
	if !result.IsError || f.approvals.Load()-before != 1 || json.Unmarshal([]byte(result.Content[0].Text), &got) != nil || got.Result.ExitCode == nil || *got.Result.ExitCode != 7 || got.Result.Stdout.Text != "output" || got.Result.Stderr.Text != "failure" {
		t.Fatalf("Bash lost approval/status: %+v", result)
	}
	if _, err := harness.SetPermissionMode(f.allowed.Session(), harness.PermissionWorkspaceWrite); err != nil {
		t.Fatal(err)
	}
	before = f.approvals.Load()
	if result := f.call(t, f.allowed, "Bash", json.RawMessage(`{"command":"touch forbidden"}`)); !result.IsError || f.approvals.Load() != before {
		t.Fatal("Bash bypassed workspace permission mode")
	}
	if _, err := os.Stat(filepath.Join(f.root, "forbidden")); !os.IsNotExist(err) {
		t.Fatal("denied Bash had effects")
	}
}

func TestClaudeSearchBoundsAndCancellation(t *testing.T) {
	f := newClaudeFixture(t, Options{})
	for i := 0; i < claudeResultLimit+2; i++ {
		if err := os.WriteFile(filepath.Join(f.root, fmt.Sprintf("match-%03d.go", i)), []byte("needle\n"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"Glob", "Grep"} {
		pattern := "*.go"
		if name == "Grep" {
			pattern = "needle"
		}
		result := f.call(t, f.allowed, name, struct {
			Pattern string `json:"pattern"`
		}{pattern})
		var output struct {
			Files     []string `json:"files"`
			Truncated bool     `json:"truncated"`
		}
		if result.IsError || json.Unmarshal([]byte(result.Content[0].Text), &output) != nil || !output.Truncated || len(output.Files) != claudeResultLimit {
			t.Fatalf("%s did not report its result bound: %+v", name, result)
		}
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := claudeGlob(ctx, f.app.files, arguments{Pattern: "**/*"}); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled Glob: %v", err)
	}
	if _, err := claudeGrep(ctx, f.app.files, arguments{Pattern: "needle"}); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled Grep: %v", err)
	}
}
