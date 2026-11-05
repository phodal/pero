//go:build linux || darwin

package workflow

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
)

func backgroundCall(t *testing.T, f *workflowFixture, agent *harness.Agent, name string, args any) harness.ToolResult {
	t.Helper()
	raw, _ := json.Marshal(args)
	out, err := f.h.Tools().Execute(f.ctx, harness.ToolRequest{Agent: agent, CallID: harness.ToolCallID(name), Name: name, Arguments: raw})
	if err != nil {
		t.Fatal(err)
	}
	return out.Result
}
func backgroundID(t *testing.T, result harness.ToolResult) string {
	t.Helper()
	var receipt struct {
		ID string `json:"task_id"`
	}
	if result.IsError || len(result.Content) != 1 || json.Unmarshal([]byte(result.Content[0].Text), &receipt) != nil || receipt.ID == "" {
		t.Fatalf("missing background handle: %+v", result)
	}
	return receipt.ID
}
func TestBackgroundWorkflowUsesOwnedExecutorAndTaskTools(t *testing.T) {
	root, workspace, packages := selectedPackage(t, map[string]string{"workflows/main.js": `export const meta={name:'background',description:'Two real stages'}; const first=await agent('first',{model:'sonnet'}); const second=await agent('write proof',{model:'sonnet'}); return {first,second};`})
	started, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	adapter := harness.AdapterFunc(func(ctx context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		if request.Model == "parent-model" {
			return workflowAnswer("controller turn ended"), nil
		}
		switch calls.Add(1) {
		case 1:
			close(started)
			select {
			case <-release:
			case <-ctx.Done():
				return harness.Completion{}, ctx.Err()
			}
			return workflowAnswer("first complete"), nil
		case 2:
			return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, ToolCallID: "write-proof", Name: "Write", Arguments: json.RawMessage(`{"file_path":"background-proof.txt","content":"executed once"}`)}}}}, nil
		default:
			return workflowAnswer("proof written"), nil
		}
	})
	f := newWorkflowFixture(t, root, workspace, packages, adapter, true, 0)
	toolCtx, cancel := context.WithCancel(f.ctx)
	raw, _ := json.Marshal(Call{ScriptPath: filepath.Join(root, "workflows/main.js"), RunInBackground: true})
	out, err := f.h.Tools().Execute(toolCtx, harness.ToolRequest{Agent: f.parent, CallID: "background-start", Name: "Workflow", Arguments: raw})
	if err != nil {
		t.Fatal(err)
	}
	id := backgroundID(t, out.Result)
	cancel() // Returning/cancelling the admission context must not kill accepted work.
	select {
	case <-started:
	case <-f.ctx.Done():
		t.Fatal("no real background member")
	}
	running := backgroundCall(t, f, f.parent, "TaskOutput", map[string]any{"task_id": id, "block": false})
	if !strings.Contains(running.Content[0].Text, `"status":"running"`) {
		t.Fatal(running)
	}
	other, err := f.h.Agents().Create(f.ctx, harness.AgentOptions{ID: "other", CWD: workspace, Provider: "fixture", Model: "parent-model"})
	if err != nil {
		t.Fatal(err)
	}
	if result := backgroundCall(t, f, other, "TaskOutput", map[string]any{"task_id": id, "block": false}); !result.IsError {
		t.Fatal("another parent accessed workflow")
	}
	replay, err := f.h.Tools().Execute(f.ctx, harness.ToolRequest{Agent: f.parent, CallID: "background-start", Name: "Workflow", Arguments: raw})
	if err != nil || backgroundID(t, replay.Result) != id {
		t.Fatal("duplicate start did not reuse receipt")
	}
	if _, err := f.parent.Prompt(f.ctx, harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "Finish the controlling turn while background work waits."}}}); err != nil {
		t.Fatal(err)
	}
	close(release) // Later stage and approval run after the controlling turn ended.
	result := backgroundCall(t, f, f.parent, "TaskOutput", map[string]any{"task_id": id, "timeout": 5000})
	if result.IsError || !strings.Contains(result.Content[0].Text, `"status":"completed"`) || !strings.Contains(result.Content[0].Text, "proof written") {
		t.Fatalf("not actually settled: %+v", result)
	}
	data, err := os.ReadFile(filepath.Join(workspace, "background-proof.txt"))
	if err != nil || string(data) != "executed once" || calls.Load() != 3 || f.approvals.Load() != 1 {
		t.Fatalf("background effect/approval mismatch: %q %v calls=%d approvals=%d", data, err, calls.Load(), f.approvals.Load())
	}
	f.app.mu.Lock()
	delete(f.app.background, id)
	f.app.mu.Unlock()
	recovered, found, err := f.app.LookupTask(f.ctx, f.parent, id)
	if err != nil || !found || recovered.Snapshot(harness.TaskRetrieved).IsError || calls.Load() != 3 {
		t.Fatal("terminal recovery replayed effects")
	}
	starts, ends := 0, 0
	for _, event := range f.parent.Session().Events() {
		if event.Type == taskStarted {
			starts++
		}
		if event.Type == taskEnded {
			ends++
		}
	}
	if err := f.parent.WhenIdle(f.ctx); err != nil {
		t.Fatal(err)
	}
	if starts != 1 || ends != 1 {
		t.Fatalf("duplicate durable facts: start=%d end=%d", starts, ends)
	}
}

func TestBackgroundWorkflowCancellationJoinsMembers(t *testing.T) {
	for _, mode := range []string{"TaskStop", "dispose", "interruption", "retirement"} {
		t.Run(mode, func(t *testing.T) {
			root, workspace, packages := selectedPackage(t, map[string]string{"workflows/main.js": `export const meta={name:'wait',description:'Owned cancellation'}; return await agent('wait');`})
			started, stopped := make(chan struct{}), make(chan struct{})
			adapter := harness.AdapterFunc(func(ctx context.Context, _ harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
				close(started)
				<-ctx.Done()
				close(stopped)
				return harness.Completion{}, ctx.Err()
			})
			f := newWorkflowFixture(t, root, workspace, packages, adapter, true, 0)
			id := backgroundID(t, backgroundCall(t, f, f.parent, "Workflow", Call{ScriptPath: filepath.Join(root, "workflows/main.js"), RunInBackground: true}))
			select {
			case <-started:
			case <-f.ctx.Done():
				t.Fatal("member never started")
			}
			task, found, err := f.app.LookupTask(f.ctx, f.parent, id)
			if err != nil || !found {
				t.Fatal(err)
			}
			switch mode {
			case "retirement":
				if err := f.h.Agents().RemoveExact(f.ctx, f.parent); err != nil && !errors.Is(err, harness.ErrAgentDisposalInProgress) {
					t.Fatal(err)
				}
				if err := f.h.Agents().WaitRetired(f.ctx, f.parent); err != nil {
					t.Fatal(err)
				}
				select {
				case <-task.Done:
				case <-f.ctx.Done():
					t.Fatal("retired workflow failed to settle after parent retirement")
				}
			case "TaskStop":
				if result := backgroundCall(t, f, f.parent, "TaskStop", map[string]string{"task_id": id}); result.IsError {
					t.Fatal(result)
				}
			case "dispose":
				if err := f.app.Dispose(f.ctx); err != nil {
					t.Fatal(err)
				}
			case "interruption":
				_, _ = f.parent.Session().Append("turn/end", struct {
					Turn   int                `json:"turn"`
					Reason harness.FinishKind `json:"reason"`
				}{f.parent.CurrentTurn(), harness.FinishAborted})
				if err := f.h.Hooks().Status.Emit(f.ctx, harness.AgentStatusInput{Agent: f.parent, Status: harness.AgentIdle}); err != nil {
					t.Fatal(err)
				}
			}
			select {
			case <-task.Done:
			default:
				t.Fatal("cleanup returned before task settlement")
			}
			select {
			case <-stopped:
			default:
				t.Fatal("member was not joined")
			}
			if text := task.Snapshot(harness.TaskRetrieved).Content[0].Text; !strings.Contains(text, `"status":"stopped"`) {
				t.Fatal(text)
			}
		})
	}
}

func TestBackgroundWorkflowLostOwnerDoesNotReplay(t *testing.T) {
	root, workspace, packages := selectedPackage(t, map[string]string{"workflows/main.js": `export const meta={name:'no-replay',description:'No replay'}; return 1;`})
	f := newWorkflowFixture(t, root, workspace, packages, harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		t.Error("cold task ran model")
		return workflowAnswer("unexpected"), nil
	}), true, 0)
	intent := taskIntent{Version: 1, ID: "workflow-lost", Owner: f.parent.ID(), CallID: "lost", Call: Call{ScriptPath: filepath.Join(root, "workflows/main.js")}}
	_, _ = f.parent.Session().Append(taskStarted, intent)
	for i := 0; i < 2; i++ {
		task, found, err := f.app.LookupTask(f.ctx, f.parent, intent.ID)
		if err != nil || !found || !strings.Contains(task.Snapshot(harness.TaskRetrieved).Content[0].Text, `"status":"interrupted"`) {
			t.Fatalf("lost owner replayed or pretended success: %v", err)
		}
	}
	ends := 0
	for _, event := range f.parent.Session().Events() {
		if event.Type == taskEnded {
			ends++
		}
	}
	if ends != 1 {
		t.Fatalf("recovery repeated terminal: %d", ends)
	}
}

func TestBackgroundWorkflowIntentBarrierPreventsReplay(t *testing.T) {
	root, workspace, packages := selectedPackage(t, map[string]string{"workflows/main.js": `export const meta={name:'barrier',description:'No effect before flush'};return await agent('must not run');`})
	var calls atomic.Int32
	f := newWorkflowFixture(t, root, workspace, packages, harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		calls.Add(1)
		return workflowAnswer("unexpected"), nil
	}), true, 0)
	remove, err := f.parent.Session().InstallDurabilityCheckpoint(func(context.Context) error { return errors.New("fixture checkpoint failed") })
	if err != nil {
		t.Fatal(err)
	}
	request := harness.ToolRequest{Agent: f.parent, CallID: "barrier-call"}
	call := Call{ScriptPath: filepath.Join(root, "workflows/main.js"), RunInBackground: true}
	if _, err := f.app.StartBackground(f.ctx, request, call); err == nil {
		t.Fatal("task admitted despite failed intent persistence")
	}
	remove()
	result, err := f.app.StartBackground(f.ctx, request, call)
	if err != nil || !result.IsError || !strings.Contains(result.Content[0].Text, `"status":"interrupted"`) {
		t.Fatalf("uncertain intent replayed: %+v %v", result, err)
	}
	if calls.Load() != 0 {
		t.Fatal("model ran before durable admission")
	}
	for _, event := range f.parent.Session().Events() {
		if event.Type == "workflow/start" {
			t.Fatal("Node executor admitted despite failed persistence")
		}
	}
}
