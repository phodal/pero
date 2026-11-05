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

func TestBackgroundWorkflowWakesParentWithActualResult(t *testing.T) {
	root, workspace, packages := selectedPackage(t, map[string]string{"workflows/main.js": `export const meta={name:'notice',description:'Real completed result'};return await agent('write proof',{model:'sonnet'});`})
	started, release, notified := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var parentCalls, childCalls atomic.Int32
	adapter := harness.AdapterFunc(func(ctx context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		if request.Model == "fast-model" {
			if childCalls.Add(1) == 1 {
				close(started)
				select {
				case <-release:
				case <-ctx.Done():
					return harness.Completion{}, ctx.Err()
				}
				return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, ToolCallID: "write-proof", Name: "Write", Arguments: json.RawMessage(`{"file_path":"notice-proof.txt","content":"actually written"}`)}}}}, nil
			}
			return workflowAnswer("worker-verified-completion"), nil
		}
		switch parentCalls.Add(1) {
		case 1:
			raw, _ := json.Marshal(Call{ScriptPath: filepath.Join(root, "workflows/main.js"), RunInBackground: true})
			return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, ToolCallID: "start-notice-workflow", Name: "Workflow", Arguments: raw}}}}, nil
		case 2:
			return workflowAnswer("Waiting for background completion."), nil
		case 3:
			raw, _ := json.Marshal(request.Messages)
			if !strings.Contains(string(raw), "worker-verified-completion") || !strings.Contains(string(raw), "Background workflow") {
				t.Error("wake lacked actual workflow result")
			}
			close(notified)
			return workflowAnswer("Completion observed without polling."), nil
		default:
			return harness.Completion{}, errors.New("duplicate completion wake")
		}
	})
	f := newWorkflowFixture(t, root, workspace, packages, adapter, true, 0)
	if _, err := f.parent.Prompt(f.ctx, harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "Start the selected workflow."}}}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-f.ctx.Done():
		t.Fatal("background child never started")
	}
	select {
	case <-notified:
		t.Fatal("unsettled work was reported complete")
	default:
	}
	close(release)
	select {
	case <-notified:
	case <-f.ctx.Done():
		t.Fatal("parent did not wake without another prompt")
	}
	if err := f.parent.WhenIdle(f.ctx); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(workspace, "notice-proof.txt"))
	if err != nil || string(data) != "actually written" || f.approvals.Load() != 1 || childCalls.Load() != 2 {
		t.Fatal("notice replaced actual effects or approvals")
	}
	var task *backgroundTask
	f.app.mu.Lock()
	for _, candidate := range f.app.background {
		task = candidate
	}
	f.app.mu.Unlock()
	select {
	case <-task.done:
	case <-f.ctx.Done():
		t.Fatal("task did not settle")
	}
	task.mu.Lock()
	terminal := *task.terminal
	task.mu.Unlock()
	if err := f.parent.DeliverBackgroundNotice(f.ctx, workflowNotice(terminal)); err != nil {
		t.Fatal(err)
	}
	if err := f.parent.WhenIdle(f.ctx); err != nil {
		t.Fatal(err)
	}
	if parentCalls.Load() != 3 {
		t.Fatalf("stable notice duplicated root requests: %d", parentCalls.Load())
	}
	turns, notices := 0, 0
	for _, event := range f.parent.Session().Events() {
		if event.Type == "turn/end" {
			turns++
		}
		if event.Type == "user/message" && strings.Contains(string(event.Data), "workflow-settled") {
			notices++
		}
	}
	if turns != 2 || notices != 1 {
		t.Fatalf("missing settled follow-up: turns=%d notices=%d", turns, notices)
	}
}

func TestInterruptedParentIsNotWokenByWorkflow(t *testing.T) {
	root, workspace, packages := selectedPackage(t, map[string]string{"workflows/main.js": `export const meta={name:'interrupt',description:'Respect controller stop'};return await agent('wait',{model:'sonnet'});`})
	childStarted, parentActive := make(chan struct{}), make(chan struct{})
	var parentCalls atomic.Int32
	adapter := harness.AdapterFunc(func(ctx context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		if request.Model == "fast-model" {
			close(childStarted)
			<-ctx.Done()
			return harness.Completion{}, ctx.Err()
		}
		if parentCalls.Add(1) == 1 {
			raw, _ := json.Marshal(Call{ScriptPath: filepath.Join(root, "workflows/main.js"), RunInBackground: true})
			return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, ToolCallID: "cancelled-workflow", Name: "Workflow", Arguments: raw}}}}, nil
		}
		if parentCalls.Load() == 2 {
			close(parentActive)
			<-ctx.Done()
			return harness.Completion{}, ctx.Err()
		}
		return harness.Completion{}, errors.New("stopped parent was woken")
	})
	f := newWorkflowFixture(t, root, workspace, packages, adapter, true, 0)
	done := make(chan error, 1)
	go func() {
		_, err := f.parent.Prompt(f.ctx, harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "Begin background work."}}})
		done <- err
	}()
	for _, ready := range []<-chan struct{}{parentActive, childStarted} {
		select {
		case <-ready:
		case <-f.ctx.Done():
			t.Fatal("real parent/child did not become active")
		}
	}
	if err := f.parent.InterruptDSH(errors.New("user stopped controlling turn")); err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-f.ctx.Done():
		t.Fatal("interrupted prompt failed to settle")
	}
	f.app.mu.Lock()
	var task *backgroundTask
	for _, candidate := range f.app.background {
		task = candidate
	}
	f.app.mu.Unlock()
	select {
	case <-task.done:
	case <-f.ctx.Done():
		t.Fatal("interrupted workflow failed to join")
	}
	if err := f.parent.WhenIdle(f.ctx); err != nil {
		t.Fatal(err)
	}
	if parentCalls.Load() != 2 || len(f.parent.PendingDurableInbox(harness.InboxNextTurn)) != 0 {
		t.Fatal("cancelled workflow reactivated parent or queued completion")
	}
	for _, event := range f.parent.Session().Events() {
		if event.Type == "user/message" && strings.Contains(string(event.Data), "workflow-settled") {
			t.Fatal("cancelled workflow delivered a completion notice")
		}
	}
}

func TestFailedWorkflowNotifiesActualFailure(t *testing.T) {
	root, workspace, packages := selectedPackage(t, map[string]string{"workflows/main.js": `export const meta={name:'failed',description:'Report real error'};throw new Error('verified script failure');`})
	notified := make(chan struct{})
	var calls atomic.Int32
	adapter := harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		if calls.Add(1) != 1 {
			return harness.Completion{}, errors.New("failed workflow notification duplicated")
		}
		raw, _ := json.Marshal(request.Messages)
		if !strings.Contains(string(raw), "verified script failure") || !strings.Contains(string(raw), "finished with status failed") {
			t.Error("notice did not carry actual failed result")
		}
		close(notified)
		return workflowAnswer("Actual failure received."), nil
	})
	f := newWorkflowFixture(t, root, workspace, packages, adapter, true, 0)
	result, err := f.app.StartBackground(f.ctx, harness.ToolRequest{Agent: f.parent, CallID: "failed-workflow"}, Call{ScriptPath: filepath.Join(root, "workflows/main.js"), RunInBackground: true})
	if err != nil {
		t.Fatal(err)
	}
	var receipt struct {
		ID string `json:"task_id"`
	}
	if json.Unmarshal([]byte(result.Content[0].Text), &receipt) != nil || receipt.ID == "" {
		t.Fatal("missing task identity")
	}
	select {
	case <-notified:
	case <-f.ctx.Done():
		t.Fatal("actual failure not delivered")
	}
	if err := f.parent.WhenIdle(f.ctx); err != nil {
		t.Fatal(err)
	}
	task, found, err := f.app.LookupTask(f.ctx, f.parent, receipt.ID)
	if err != nil || !found {
		t.Fatal(err)
	}
	select {
	case <-task.Done:
	case <-f.ctx.Done():
		t.Fatal("failed task did not settle")
	}
	if !task.Snapshot(harness.TaskRetrieved).IsError {
		t.Fatal("failed execution became success after notice")
	}
}
