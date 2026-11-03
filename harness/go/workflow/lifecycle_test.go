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
	"sync"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
)

func TestWorkflowCancellationJoinsProcessAndChildren(t *testing.T) {
	for _, mode := range []string{"cancel child", "dispose app", "asynchronous CPU loop"} {
		t.Run(mode, func(t *testing.T) {
			source := `export const meta={name:'cancel',description:'Own child cleanup'}; await agent('wait for cancellation'); return 'unreachable';`
			if mode == "asynchronous CPU loop" {
				source = `export const meta={name:'cancel-cpu',description:'Cancel async synchronous work'}; await Promise.resolve(); log('cpu-ready'); while(true) {}`
			}
			root, workspace, packages := selectedPackage(t, map[string]string{"workflows/main.js": source})
			started, stopped := make(chan struct{}), make(chan struct{})
			var startOnce sync.Once
			adapter := harness.AdapterFunc(func(ctx context.Context, _ harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
				startOnce.Do(func() { close(started) })
				<-ctx.Done()
				close(stopped)
				return harness.Completion{}, ctx.Err()
			})
			f := newWorkflowFixture(t, root, workspace, packages, adapter, true, 0)
			if mode == "asynchronous CPU loop" {
				unsubscribe := f.parent.Session().Subscribe(func(event harness.Event) {
					if event.Type == "workflow/log" && strings.Contains(string(event.Data), "cpu-ready") {
						startOnce.Do(func() { close(started) })
					}
				})
				defer unsubscribe()
			}
			operation, cancel := context.WithCancel(f.ctx)
			defer cancel()
			done := make(chan error, 1)
			go func() {
				_, err := f.app.Execute(operation, f.parent, Call{ScriptPath: filepath.Join(root, "workflows", "main.js")})
				done <- err
			}()
			select {
			case <-started:
			case <-f.ctx.Done():
				t.Fatal("workflow did not start owned work")
			}
			if mode == "dispose app" {
				cleanup, stop := context.WithTimeout(t.Context(), 5*time.Second)
				defer stop()
				if err := f.app.Dispose(cleanup); err != nil {
					t.Fatal(err)
				}
			} else {
				cancel()
			}
			select {
			case err := <-done:
				if !errors.Is(err, context.Canceled) {
					t.Fatalf("cancelled workflow error=%v", err)
				}
			case <-f.ctx.Done():
				t.Fatal("workflow cancellation did not join Node and child cleanup")
			}
			if mode != "asynchronous CPU loop" {
				select {
				case <-stopped:
				default:
					t.Error("workflow returned before child provider cancellation")
				}
				cancelled := 0
				for _, event := range f.parent.Session().Events() {
					if event.Type != "workflow/agent-end" {
						continue
					}
					var member progress
					if json.Unmarshal(event.Data, &member) == nil && member.Outcome == "cancelled" && member.Status == harness.SubagentAborted && member.ChildID != "" {
						cancelled++
					}
				}
				if cancelled != 1 {
					t.Fatalf("cancelled child terminal records=%d want one", cancelled)
				}
			}
			if len(f.h.Agents().List()) != 1 {
				t.Fatal("cancelled workflow leaked a child")
			}
			if mode == "dispose app" {
				schemas, err := f.h.Tools().SchemasForAgent(f.ctx, f.parent)
				if err != nil {
					t.Fatal(err)
				}
				for _, schema := range schemas {
					if schema.Name == "Workflow" {
						t.Error("disposed workflow registration remains visible")
					}
				}
			}
		})
	}
}

func TestWorkflowUnawaitedAgentRecordsJoinedCancellation(t *testing.T) {
	root, workspace, packages := selectedPackage(t, map[string]string{"workflows/main.js": `export const meta={name:'early-return',description:'Return while another member is active'}; const long=agent('long-running',{label:'long'}); await agent('quick',{label:'quick'}); return {approved:true};`})
	started, stopped := make(chan struct{}), make(chan struct{})
	identity := make(chan harness.SessionID, 1)
	adapter := harness.AdapterFunc(func(ctx context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		for _, message := range request.Messages {
			for _, block := range message.Content {
				if block.Text == "long-running" {
					identity <- request.Agent.ID()
					close(started)
					<-ctx.Done()
					close(stopped)
					return harness.Completion{}, ctx.Err()
				}
				if block.Text == "quick" {
					select {
					case <-started:
						return workflowAnswer("quick completed"), nil
					case <-ctx.Done():
						return harness.Completion{}, ctx.Err()
					}
				}
			}
		}
		return harness.Completion{}, errors.New("unexpected workflow member")
	})
	f := newWorkflowFixture(t, root, workspace, packages, adapter, true, 0)
	persistence, err := harness.NewJSONLSessionPersistence(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	detach, err := persistence.Attach(f.ctx, f.parent.Session())
	if err != nil {
		t.Fatal(err)
	}
	defer detach()
	result, err := f.app.Execute(f.ctx, f.parent, Call{ScriptPath: filepath.Join(root, "workflows", "main.js")})
	if err != nil || result.StopReason != "completed" || string(result.Value) != `{"approved":true}` || result.AgentCalls != 2 {
		t.Fatalf("script return semantics changed: %+v error=%v", result, err)
	}
	select {
	case <-stopped:
	default:
		t.Fatal("workflow returned before unawaited provider cancellation")
	}
	if len(f.h.Agents().List()) != 1 {
		t.Fatal("unawaited workflow member was not reclaimed")
	}
	longID := <-identity
	loaded, err := persistence.Load(f.ctx, f.parent.ID())
	if err != nil {
		t.Fatal(err)
	}
	completed, cancelled := 0, 0
	var lastMemberSeq, endSeq uint64
	for _, event := range loaded.Events() {
		if event.Type == "workflow/end" {
			endSeq = event.Seq
		}
		if event.Type != "workflow/agent-end" {
			continue
		}
		lastMemberSeq = event.Seq
		var member progress
		if err := json.Unmarshal(event.Data, &member); err != nil {
			t.Fatal(err)
		}
		if member.ChildID == longID && member.Status == harness.SubagentAborted && member.Outcome == "cancelled" {
			cancelled++
		} else if member.Status == harness.SubagentCompleted && member.Outcome == "completed" {
			completed++
		}
	}
	if cancelled != 1 || completed != 1 || endSeq <= lastMemberSeq {
		t.Fatalf("durable member settlement missing: completed=%d cancelled=%d memberSeq=%d endSeq=%d", completed, cancelled, lastMemberSeq, endSeq)
	}
}

func TestWorkflowFailuresStayExplicit(t *testing.T) {
	for _, test := range []struct{ name, body, error string }{
		{"schema rejected", `return agent('work',{schema:{type:'string'}});`, "schema"},
		{"unknown option", `return parallel([()=>agent('work',{color:'blue'})]);`, "unsupported field"},
		{"remote isolation", `return agent('work',{isolation:'remote'});`, "isolation"},
		{"undeclared provider", `return agent('work',{provider:'unconfigured'});`, "provider"},
		{"nested unselected", `return workflow({scriptPath:'/unselected/workflows/other.js'},{});`, "outside"},
		{"non JSON output", `return {value:undefined};`, "lossless JSON"},
		{"extra array property", `const value=[]; value.extra=1; return value;`, "extra array"},
	} {
		t.Run(test.name, func(t *testing.T) {
			root, workspace, packages := selectedPackage(t, map[string]string{"workflows/main.js": `export const meta={name:'failure',description:'Report invalid operations'}; ` + test.body})
			f := newWorkflowFixture(t, root, workspace, packages, harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
				t.Error("invalid workflow reached model")
				return workflowAnswer(""), nil
			}), true, 0)
			result, err := f.app.Execute(f.ctx, f.parent, Call{ScriptPath: filepath.Join(root, "workflows", "main.js"), Args: json.RawMessage(`{}`)})
			if err != nil || result.StopReason != "error" || !strings.Contains(strings.ToLower(result.Error), strings.ToLower(test.error)) {
				t.Fatalf("failure became null/success: %+v error=%v", result, err)
			}
		})
	}
}

func TestWorkflowAgentWorktreeStaysOutsideTheParentCheckout(t *testing.T) {
	root, workspace, packages := selectedPackage(t, map[string]string{"workflows/main.js": `export const meta={name:'isolated',description:'Run one isolated agent'}; return agent('work',{isolation:'worktree'});`})
	if err := os.WriteFile(filepath.Join(workspace, "seed.txt"), []byte("seed\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	git := func(args ...string) {
		t.Helper()
		command := exec.Command("git", append([]string{"-C", workspace}, args...)...)
		command.Env = append(os.Environ(), "GIT_AUTHOR_NAME=fixture", "GIT_AUTHOR_EMAIL=fixture@example.com", "GIT_COMMITTER_NAME=fixture", "GIT_COMMITTER_EMAIL=fixture@example.com")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("git %s: %v %s", strings.Join(args, " "), err, output)
		}
	}
	git("init", "-b", "master", "--template=")
	git("add", "seed.txt")
	git("commit", "-m", "seed")
	parent, err := filepath.EvalSymlinks(workspace)
	if err != nil {
		t.Fatal(err)
	}
	var child string
	var listed bool
	f := newWorkflowFixture(t, root, workspace, packages, harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		if request.Agent != nil && request.Agent.Session() != nil {
			resolved, err := filepath.EvalSymlinks(request.Agent.Session().WorkingDirectory())
			if err == nil {
				child = resolved
			}
			list, err := exec.Command("git", "-C", workspace, "worktree", "list", "--porcelain").Output()
			listed = err == nil && strings.Contains(string(list), child)
		}
		return workflowAnswer("isolated"), nil
	}), true, 0)
	result, err := f.app.Execute(f.ctx, f.parent, Call{ScriptPath: filepath.Join(root, "workflows", "main.js"), Args: json.RawMessage(`{}`)})
	if err != nil || result.StopReason != "completed" || string(result.Value) != `"isolated"` {
		t.Fatalf("result=%+v error=%v", result, err)
	}
	if child == "" || child == parent || !listed {
		t.Fatalf("child checkout = %q parent = %q listed=%v", child, parent, listed)
	}
	list, err := exec.Command("git", "-C", workspace, "worktree", "list", "--porcelain").Output()
	if err != nil || strings.Count(string(list), "worktree ") != 1 {
		t.Fatalf("worktree left behind: %v %s", err, list)
	}
}
