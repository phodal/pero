//go:build linux || darwin

package workflow

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/nativetools"
	"github.com/phodal/pero/harness/go/plugins"
	point "github.com/phodal/pero/harness/go/runtime"
	"github.com/phodal/pero/harness/go/subagents"
)

type workflowFixture struct {
	ctx             context.Context
	h               *harness.Harness
	app             *App
	parent          *harness.Agent
	workspace, root string
	approvals       atomic.Int32
}

func selectedPackage(t *testing.T, scripts map[string]string) (string, string, []plugins.Package) {
	t.Helper()
	base, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	root, workspace := filepath.Join(base, "Selected Package"), filepath.Join(base, "workspace")
	if err := os.MkdirAll(workspace, 0700); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{".claude-plugin/plugin.json": `{"name":"sample"}`}
	for path, source := range scripts {
		files[path] = source
	}
	for path, content := range files {
		absolute := filepath.Join(root, filepath.FromSlash(path))
		if err := os.MkdirAll(filepath.Dir(absolute), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(absolute, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	packages, err := plugins.LoadPackages(t.Context(), []string{root})
	if err != nil {
		t.Fatal(err)
	}
	return root, workspace, packages
}

func newWorkflowFixture(t *testing.T, root, workspace string, packages []plugins.Package, adapter harness.Adapter, allowed bool, total int) *workflowFixture {
	t.Helper()
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node executable is required for workflow integration")
	}
	node, err = filepath.Abs(node)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
	t.Cleanup(cancel)
	metadata, _ := adapter.(harness.ModelInfoResolver)
	h, err := harness.Boot(ctx, harness.Options{EnableSubagents: true, Adapter: adapter, AdapterProviders: []string{"fixture"}, ModelInfo: metadata, ApprovalPolicy: harness.ApprovalAsk})
	if err != nil {
		t.Fatal(err)
	}
	native, err := nativetools.Mount(ctx, h, nativetools.Options{Workspace: workspace, ClaudeTools: true})
	if err != nil {
		t.Fatal(err)
	}
	f := &workflowFixture{ctx: ctx, h: h, workspace: workspace, root: root}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := h.Dispose(cleanup); err != nil {
			t.Error(err)
		}
		if err := h.Drain(cleanup); err != nil {
			t.Error(err)
		}
		if err := f.app.Close(); err != nil {
			t.Error(err)
		}
		_ = native.Close()
	})
	agents, err := subagents.MountClaude(ctx, h, nil, subagents.ClaudeOptions{MaxActive: 3, MaxDepth: 4, ModelRoutes: []subagents.ModelRoute{{Alias: "opus", Provider: "fixture", Model: "senior-model"}, {Alias: "sonnet", Provider: "fixture", Model: "fast-model"}}})
	if err != nil {
		t.Fatal(err)
	}
	f.app, err = Mount(ctx, h, packages, Options{Node: node, Provider: "fixture", Agents: agents, MaxAgentCalls: total})
	if err != nil {
		t.Fatal(err)
	}
	f.parent, err = h.Agents().Create(ctx, harness.AgentOptions{ID: "workflow-parent", CWD: workspace, Provider: "fixture", Model: "parent-model", Configure: func(_ context.Context, owner *point.Run, _ *harness.Agent) error {
		_, err := h.Approvals().Register(owner, func(context.Context, harness.ApprovalRequest) (harness.ApprovalOutcome, error) {
			f.approvals.Add(1)
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
	return f
}

func workflowAnswer(text string) harness.Completion {
	return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: text}}}}
}

func TestWorkflowCombinatorsUseRealChildren(t *testing.T) {
	scripts := map[string]string{"workflows/main.js": `export const meta = {name:'batch',description:'Run bounded stages'};
phase('Build'); log('starting');
const parallelResults = await parallel([()=>agent('one'),()=>{throw new Error('ordinary failure')},()=>agent('failed child')]);
const result = await pipeline([1,2], (value,item,index)=>agent('stage:'+value), (value,item,index)=>({value,item,index}));
return {parallelResults,result};`}
	root, workspace, packages := selectedPackage(t, scripts)
	var calls atomic.Int32
	adapter := harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		calls.Add(1)
		for _, tool := range request.Tools {
			if tool.Name == "Workflow" {
				t.Error("workflow member can recursively start another host workflow")
			}
		}
		for _, message := range request.Messages {
			for _, block := range message.Content {
				if block.Text == "failed child" {
					return harness.Completion{}, errors.New("fixture child failed")
				}
				if strings.HasPrefix(block.Text, "stage:") {
					return workflowAnswer(block.Text), nil
				}
			}
		}
		return workflowAnswer("first child"), nil
	})
	f := newWorkflowFixture(t, root, workspace, packages, adapter, true, 0)
	result, err := f.app.Execute(f.ctx, f.parent, Call{ScriptPath: filepath.Join(root, "workflows", "main.js")})
	if err != nil || result.StopReason != "completed" || calls.Load() != 4 || result.AgentCalls != 4 {
		t.Fatalf("result=%+v calls=%d error=%v", result, calls.Load(), err)
	}
	var value struct {
		ParallelResults []*string `json:"parallelResults"`
		Result          []struct {
			Value       string `json:"value"`
			Item, Index int
		} `json:"result"`
	}
	if err := json.Unmarshal(result.Value, &value); err != nil || len(value.ParallelResults) != 3 || value.ParallelResults[0] == nil || *value.ParallelResults[0] != "first child" || value.ParallelResults[1] != nil || value.ParallelResults[2] != nil || len(value.Result) != 2 || value.Result[0].Value != "stage:1" || value.Result[1].Index != 1 {
		t.Fatalf("ordered combinator result=%s error=%v", result.Value, err)
	}
	var events []string
	for _, event := range f.parent.Session().Events() {
		if strings.HasPrefix(event.Type, "workflow/") {
			events = append(events, event.Type)
		}
	}
	if !strings.Contains(strings.Join(events, ","), "workflow/phase,workflow/log") || events[len(events)-1] != "workflow/end" || len(f.h.Agents().List()) != 1 {
		t.Fatalf("progress or cleanup missing: %v live=%d", events, len(f.h.Agents().List()))
	}
}

func TestWorkflowRejectsChangedAndUnselectedScripts(t *testing.T) {
	root, workspace, packages := selectedPackage(t, map[string]string{"workflows/main.js": `export const meta={name:'selected',description:'Read selected source'}; return args;`})
	adapter := harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		t.Error("unexpected model call")
		return workflowAnswer(""), nil
	})
	f := newWorkflowFixture(t, root, workspace, packages, adapter, true, 0)
	for _, call := range []Call{
		{ScriptPath: filepath.Join(workspace, "unselected.js")},
		{ScriptPath: filepath.Join(root, "workflows", "main.js"), RunInBackground: true},
	} {
		if _, err := f.app.Execute(f.ctx, f.parent, call); err == nil {
			t.Fatal("unselected or unsupported execution was accepted")
		}
	}
	if err := os.WriteFile(filepath.Join(root, "workflows", "main.js"), []byte(`export const meta={name:'changed',description:'Changed'}; return 'wrong';`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := f.app.Execute(f.ctx, f.parent, Call{ScriptPath: filepath.Join(root, "workflows", "main.js")}); err == nil || !strings.Contains(err.Error(), "changed") {
		t.Fatalf("changed source was executed: %v", err)
	}
}

func TestWorkflowAgentBudgetCannotBecomePerItemNull(t *testing.T) {
	root, workspace, packages := selectedPackage(t, map[string]string{"workflows/main.js": `export const meta={name:'cap',description:'Keep total agent budget'}; return parallel(Array.from({length:4},()=>()=>agent('work')));`})
	var calls atomic.Int32
	f := newWorkflowFixture(t, root, workspace, packages, harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		calls.Add(1)
		return workflowAnswer("done"), nil
	}), true, 2)
	result, err := f.app.Execute(f.ctx, f.parent, Call{ScriptPath: filepath.Join(root, "workflows", "main.js")})
	if err != nil || result.StopReason != "error" || !strings.Contains(result.Error, "budget") || calls.Load() > 2 {
		t.Fatalf("agent cap dissolved into success: %+v calls=%d error=%v", result, calls.Load(), err)
	}
}

func TestWorkflowArgsAndMeta(t *testing.T) {
	root, workspace, packages := selectedPackage(t, map[string]string{"workflows/main.js": "// initial comment\nexport const meta={name:'args',description:'Pass JSON unchanged',phases:[{title:'One',detail:'braces { in text }'}]};\nreturn {kind:typeof args,value:args};"})
	f := newWorkflowFixture(t, root, workspace, packages, harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		return workflowAnswer(""), nil
	}), true, 0)
	for _, test := range []struct{ input, kind string }{{`{"value":1}`, "object"}, {`"{\"value\":1}"`, "string"}} {
		result, err := f.app.Execute(f.ctx, f.parent, Call{ScriptPath: filepath.Join(root, "workflows", "main.js"), Args: json.RawMessage(test.input), Meta: &Meta{Name: "args", Description: "Pass JSON unchanged", Phases: []Phase{{Title: "One", Detail: "braces { in text }"}}}})
		var output struct {
			Kind  string          `json:"kind"`
			Value json.RawMessage `json:"value"`
		}
		if err != nil || result.StopReason != "completed" || json.Unmarshal(result.Value, &output) != nil || output.Kind != test.kind || string(output.Value) != test.input {
			t.Fatalf("JSON args=%s result=%+v error=%v", test.input, result, err)
		}
	}
	result, err := f.app.Execute(f.ctx, f.parent, Call{ScriptPath: filepath.Join(root, "workflows", "main.js"), Meta: &Meta{Name: "wrong", Description: "mismatch"}})
	if err != nil || result.StopReason != "error" || !strings.Contains(result.Error, "differs") {
		t.Fatalf("metadata drift accepted: %+v %v", result, err)
	}
}
