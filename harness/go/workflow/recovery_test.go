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

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/plugins"
	"github.com/phodal/pero/harness/go/subagents"
)

func recoveryRuntime(t *testing.T, packages []plugins.Package, adapter harness.Adapter) (*harness.Harness, *App) {
	t.Helper()
	h, err := harness.Boot(t.Context(), harness.Options{EnableSubagents: true, Adapter: adapter, AdapterProviders: []string{"fixture"}})
	if err != nil {
		t.Fatal(err)
	}
	agents, err := subagents.MountClaude(t.Context(), h, nil, subagents.ClaudeOptions{})
	if err != nil {
		t.Fatal(err)
	}
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node required")
	}
	node, err = filepath.Abs(node)
	if err != nil {
		t.Fatal(err)
	}
	app, err := Mount(t.Context(), h, packages, Options{Node: node, Provider: "fixture", Agents: agents})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := h.Dispose(context.Background()); err != nil && !errors.Is(err, harness.ErrHarnessDisposalInProgress) {
			t.Error(err)
		}
		if err := h.Drain(context.Background()); err != nil {
			t.Error(err)
		}
		if err := app.Close(); err != nil {
			t.Error(err)
		}
	})
	return h, app
}

func TestWorkflowNoticeDiskRecoveryWithoutEffectReplay(t *testing.T) {
	root, workspace, packages := selectedPackage(t, map[string]string{"workflows/main.js": `export const meta={name:'disk',description:'Durable actual result'};return await agent('write once',{model:'sonnet'});`})
	var originalCalls atomic.Int32
	f := newWorkflowFixture(t, root, workspace, packages, harness.AdapterFunc(func(_ context.Context, _ harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		if originalCalls.Add(1) == 1 {
			return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, ToolCallID: "disk-write", Name: "Write", Arguments: json.RawMessage(`{"file_path":"disk-proof.txt","content":"original effect"}`)}}}}, nil
		}
		return workflowAnswer("original durable completion"), nil
	}), true, 0)
	directory := t.TempDir()
	disk, err := harness.NewJSONLSessionPersistence(directory)
	if err != nil {
		t.Fatal(err)
	}
	detach, err := disk.Attach(f.ctx, f.parent.Session())
	if err != nil {
		t.Fatal(err)
	}
	// Fault injection at the real terminal-commit boundary: retain the completed
	// task but omit its inbox insertion, just as a process loss in that window.
	unsubscribe := f.parent.Session().Subscribe(func(event harness.Event) {
		if event.Type == taskEnded {
			var end taskTerminal
			if json.Unmarshal(event.Data, &end) != nil {
				return
			}
			f.app.mu.Lock()
			task := f.app.background[end.ID]
			f.app.mu.Unlock()
			if task != nil {
				task.suppressNotice.Store(true)
			}
		}
	})
	result, err := f.app.StartBackground(f.ctx, harness.ToolRequest{Agent: f.parent, CallID: "disk-background"}, Call{ScriptPath: filepath.Join(root, "workflows/main.js"), RunInBackground: true})
	if err != nil {
		t.Fatal(err)
	}
	var receipt struct {
		ID string `json:"task_id"`
	}
	_ = json.Unmarshal([]byte(result.Content[0].Text), &receipt)
	task, found, err := f.app.LookupTask(f.ctx, f.parent, receipt.ID)
	if err != nil || !found {
		t.Fatal(err)
	}
	select {
	case <-task.Done:
	case <-f.ctx.Done():
		t.Fatal("original work did not settle")
	}
	if task.Snapshot(harness.TaskRetrieved).IsError || originalCalls.Load() != 2 || f.approvals.Load() != 1 {
		t.Fatal("missing actual original result/effect")
	}
	unsubscribe()
	if len(f.parent.PendingDurableInbox(harness.InboxNextTurn)) != 0 {
		t.Fatal("fault window did not omit notice")
	}
	if err := detach(); err != nil {
		t.Fatal(err)
	}
	if err := f.h.Dispose(f.ctx); err != nil && !errors.Is(err, harness.ErrHarnessDisposalInProgress) {
		t.Fatal(err)
	}
	if err := f.h.Drain(f.ctx); err != nil {
		t.Fatal(err)
	}
	for restart := 0; restart < 2; restart++ {
		var rootCalls atomic.Int32
		freshDisk, err := harness.NewJSONLSessionPersistence(directory)
		if err != nil {
			t.Fatal(err)
		}
		fresh, app := recoveryRuntime(t, packages, harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
			rootCalls.Add(1)
			if request.Model != "parent-model" {
				t.Error("restart ran workflow member")
			}
			raw, _ := json.Marshal(request.Messages)
			if !strings.Contains(string(raw), "original durable completion") {
				t.Error("recovery omitted real terminal result")
			}
			return workflowAnswer("recovered completion observed"), nil
		}))
		loaded, err := freshDisk.Load(t.Context(), f.parent.ID())
		if err != nil {
			t.Fatal(err)
		}
		parent, err := fresh.Agents().Resume(t.Context(), loaded, harness.AgentOptions{Provider: "fixture", Model: "parent-model"})
		if err != nil {
			t.Fatal(err)
		}
		if rootCalls.Load() != 0 {
			t.Fatal("model ran before persistence/controller readiness")
		}
		detachFresh, err := freshDisk.Attach(t.Context(), parent.Session())
		if err != nil {
			t.Fatal(err)
		}
		if err := parent.ResumeDurableInbox(); err != nil {
			t.Fatal(err)
		}
		if err := parent.WhenIdle(t.Context()); err != nil {
			t.Fatal(err)
		}
		want := int32(1)
		if restart == 1 {
			want = 0
		}
		if rootCalls.Load() != want {
			t.Fatalf("restart=%d calls=%d want=%d", restart, rootCalls.Load(), want)
		}
		restored, found, err := app.LookupTask(t.Context(), parent, receipt.ID)
		if err != nil || !found || restored.Snapshot(harness.TaskRetrieved).IsError {
			t.Fatal("terminal recovery failed")
		}
		starts := 0
		for _, event := range parent.Session().Events() {
			if event.Type == "workflow/start" {
				starts++
			}
		}
		if starts != 1 {
			t.Fatal("restart launched Node workflow again")
		}
		if data, err := os.ReadFile(filepath.Join(workspace, "disk-proof.txt")); err != nil || string(data) != "original effect" {
			t.Fatal("restart changed original artifact")
		}
		if err := detachFresh(); err != nil {
			t.Fatal(err)
		}
		if err := fresh.Dispose(t.Context()); err != nil && !errors.Is(err, harness.ErrHarnessDisposalInProgress) {
			t.Fatal(err)
		}
		if err := fresh.Drain(t.Context()); err != nil {
			t.Fatal(err)
		}
	}
}

func TestWorkflowRecoveryInterruptionAndLostOwner(t *testing.T) {
	for _, aborted := range []bool{false, true} {
		t.Run(map[bool]string{false: "lost owner", true: "stopped controller"}[aborted], func(t *testing.T) {
			root, workspace, packages := selectedPackage(t, map[string]string{"workflows/main.js": `export const meta={name:'not-replayed',description:'Recovery only'};throw new Error('must not execute');`})
			directory := t.TempDir()
			disk, err := harness.NewJSONLSessionPersistence(directory)
			if err != nil {
				t.Fatal(err)
			}
			session := harness.NewSession("recovery-state", workspace)
			_, _ = session.Append("turn/start", struct {
				Turn int `json:"turn"`
			}{1})
			reason := harness.FinishStop
			if aborted {
				reason = harness.FinishAborted
			}
			_, _ = session.Append("turn/end", struct {
				Turn   int                `json:"turn"`
				Reason harness.FinishKind `json:"reason"`
			}{1, reason})
			intent := taskIntent{Version: 1, ID: "workflow-recovery-state", Owner: session.Header().ID, CallID: "historical-call", Turn: 1, Call: Call{ScriptPath: filepath.Join(root, "workflows/main.js")}}
			_, _ = session.Append(taskStarted, intent)
			if aborted {
				_, _ = session.Append(taskEnded, taskTerminal{Version: 1, ID: intent.ID, Owner: intent.Owner, Status: "completed", Result: &Result{Value: json.RawMessage(`"held completion"`), StopReason: "completed"}})
			}
			detach, err := disk.Attach(t.Context(), session)
			if err != nil {
				t.Fatal(err)
			}
			if err := detach(); err != nil {
				t.Fatal(err)
			}
			var calls atomic.Int32
			var noticeSeen atomic.Bool
			fresh, app := recoveryRuntime(t, packages, harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
				calls.Add(1)
				raw, _ := json.Marshal(request.Messages)
				if strings.Contains(string(raw), "workflow-settled") {
					noticeSeen.Store(true)
				}
				return workflowAnswer("Recovery context processed."), nil
			}))
			loaded, err := disk.Load(t.Context(), session.Header().ID)
			if err != nil {
				t.Fatal(err)
			}
			parent, err := fresh.Agents().Resume(t.Context(), loaded, harness.AgentOptions{Provider: "fixture", Model: "parent-model"})
			if err != nil {
				t.Fatal(err)
			}
			detach, err = disk.Attach(t.Context(), parent.Session())
			if err != nil {
				t.Fatal(err)
			}
			defer detach()
			if err := parent.ResumeDurableInbox(); err != nil {
				t.Fatal(err)
			}
			if err := parent.WhenIdle(t.Context()); err != nil {
				t.Fatal(err)
			}
			if aborted {
				if calls.Load() != 0 {
					t.Fatal("stopped controller was auto-woken by recovery")
				}
				if _, err := parent.Prompt(t.Context(), harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "Resume now."}}}); err != nil {
					t.Fatal(err)
				}
				if err := parent.WhenIdle(t.Context()); err != nil {
					t.Fatal(err)
				}
			} else {
				if calls.Load() != 1 {
					t.Fatalf("lost owner notice calls=%d", calls.Load())
				}
				task, found, err := app.LookupTask(t.Context(), parent, intent.ID)
				if err != nil || !found || !task.Snapshot(harness.TaskRetrieved).IsError {
					t.Fatal("lost process reported success")
				}
			}
			if !noticeSeen.Load() {
				t.Fatal("recovery omitted actual terminal/interruption context")
			}
			before := calls.Load()
			if err := parent.ResumeDurableInbox(); err != nil {
				t.Fatal(err)
			}
			if err := parent.WhenIdle(t.Context()); err != nil {
				t.Fatal(err)
			}
			if calls.Load() != before {
				t.Fatal("reconciliation duplicated notice")
			}
			for _, event := range parent.Session().Events() {
				if event.Type == "workflow/start" {
					t.Fatal("recovery executed historical script")
				}
			}
		})
	}
}

func TestRecoveryStagesTerminalOrderBeforeWake(t *testing.T) {
	root, workspace, packages := selectedPackage(t, map[string]string{"workflows/main.js": `export const meta={name:'order',description:'No execution'};return 1;`})
	h, app := recoveryRuntime(t, packages, harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		t.Error("staging woke model before controller readiness")
		return workflowAnswer("unexpected"), nil
	}))
	parent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "ordered", CWD: workspace, Provider: "fixture", Model: "parent-model"})
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"workflow-a", "workflow-z"} {
		_, err := parent.Session().Append(taskStarted, taskIntent{Version: 1, ID: id, Owner: parent.ID(), CallID: harness.ToolCallID(id), Call: Call{ScriptPath: filepath.Join(root, "workflows/main.js")}})
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, id := range []string{"workflow-z", "workflow-a"} {
		_, err := parent.Session().Append(taskEnded, taskTerminal{Version: 1, ID: id, Owner: parent.ID(), Status: "completed", Result: &Result{Value: json.RawMessage(`null`), StopReason: "completed"}})
		if err != nil {
			t.Fatal(err)
		}
	}
	disk, err := harness.NewJSONLSessionPersistence(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	detach, err := disk.Attach(t.Context(), parent.Session())
	if err != nil {
		t.Fatal(err)
	}
	defer detach()
	if err := app.reconcileNotices(t.Context(), parent, stageRecovery); err != nil {
		t.Fatal(err)
	}
	pending := parent.PendingDurableInbox(harness.InboxNextTurn)
	if len(pending) != 2 || pending[0].ID != "workflow-notice-workflow-z" || pending[1].ID != "workflow-notice-workflow-a" || parent.Status() != harness.AgentIdle {
		t.Fatal("recovery reordered terminal facts or started before staging completed")
	}
}
