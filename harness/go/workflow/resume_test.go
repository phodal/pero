//go:build linux || darwin

package workflow

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
)

func TestWorkflowResumeReturnsRecordedStepsWithoutReplayingEffects(t *testing.T) {
	script := `export const meta={name:'continue',description:'Continue recorded steps'};
const first = await agent('write-first', {label:'first'});
const second = await agent('write-second', {label:'second'});
const third = await agent('write-third', {label:'third'});
return {first, second, third};`
	root, workspace, packages := selectedPackage(t, map[string]string{
		"workflows/main.js":  script,
		"workflows/other.js": `export const meta={name:'other',description:'Different script'}; return await agent('other-step', {label:'other'});`,
	})
	var calls atomic.Int32
	var resuming atomic.Bool
	secondStarted := make(chan struct{})
	adapter := harness.AdapterFunc(func(ctx context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		calls.Add(1)
		text := requestPrompt(request)
		if resuming.Load() {
			if strings.Contains(text, "write-first") || strings.Contains(text, "write-second") {
				t.Errorf("recorded step was invoked again: %s", text)
				return workflowAnswer("replayed"), nil
			}
			if err := os.WriteFile(filepath.Join(workspace, "third.txt"), []byte("once"), 0600); err != nil {
				t.Error(err)
			}
			return workflowAnswer("third-done"), nil
		}
		switch {
		case strings.Contains(text, "write-first"):
			if err := os.WriteFile(filepath.Join(workspace, "first.txt"), []byte("once"), 0600); err != nil {
				t.Error(err)
			}
			return workflowAnswer("first-done"), nil
		case strings.Contains(text, "write-second"):
			close(secondStarted)
			<-ctx.Done()
			return harness.Completion{}, ctx.Err()
		default:
			t.Errorf("unexpected model work before resume: %s", text)
			return workflowAnswer("too-soon"), nil
		}
	})
	f := newWorkflowFixture(t, root, workspace, packages, adapter, true, 0)
	main := filepath.Join(root, "workflows", "main.js")
	operation, cancel := context.WithCancel(f.ctx)
	done := make(chan error, 1)
	go func() {
		_, err := f.app.Execute(operation, f.parent, Call{ScriptPath: main})
		done <- err
	}()
	select {
	case <-secondStarted:
		cancel()
	case <-f.ctx.Done():
		t.Fatal("second step did not start")
	}
	if err := <-done; err == nil {
		t.Fatal("cancelled workflow returned success")
	}
	if calls.Load() != 2 {
		t.Fatalf("cancelled run invoked %d model calls", calls.Load())
	}
	runID := workflowRunID(t, f.parent)
	if _, err := os.ReadFile(filepath.Join(workspace, "third.txt")); err == nil {
		t.Fatal("third effect ran before resume")
	}
	settled := calls.Load()
	if _, err := f.app.Execute(f.ctx, f.parent, Call{ScriptPath: filepath.Join(root, "workflows", "other.js"), ResumeFrom: runID}); err == nil || !strings.Contains(err.Error(), "different script") {
		t.Fatalf("different script resumed: %v", err)
	}
	if _, err := f.app.Execute(f.ctx, f.parent, Call{ScriptPath: main, Args: json.RawMessage(`{"n":1}`), ResumeFrom: runID}); err == nil || !strings.Contains(err.Error(), "args") {
		t.Fatalf("different args resumed: %v", err)
	}
	if calls.Load() != settled {
		t.Fatalf("rejected resume invoked the model: %d", calls.Load()-settled)
	}
	resuming.Store(true)
	before := calls.Load()
	result, err := f.app.Execute(f.ctx, f.parent, Call{ScriptPath: main, ResumeFrom: runID})
	var value struct {
		First, Second, Third *string
	}
	if err != nil || result.StopReason != "completed" || json.Unmarshal(result.Value, &value) != nil || value.First == nil || *value.First != "first-done" || value.Second != nil || value.Third == nil || *value.Third != "third-done" || calls.Load()-before != 1 {
		t.Fatalf("resume result=%+v calls=%d error=%v", result, calls.Load()-before, err)
	}
	if data, err := os.ReadFile(filepath.Join(workspace, "first.txt")); err != nil || string(data) != "once" {
		t.Fatalf("first effect changed: %s %v", data, err)
	}
	if data, err := os.ReadFile(filepath.Join(workspace, "third.txt")); err != nil || string(data) != "once" {
		t.Fatalf("third effect=%s %v", data, err)
	}
	if _, err := f.app.Execute(f.ctx, f.parent, Call{ScriptPath: main, ResumeFrom: runID}); err == nil || !strings.Contains(err.Error(), "completed workflow cannot resume") {
		t.Fatalf("completed run resumed: %v", err)
	}
	if calls.Load()-before != 1 {
		t.Fatalf("refusal invoked the model: %d", calls.Load()-before)
	}
}

func TestWorkflowResumeDoesNotInvokeAnOpenStep(t *testing.T) {
	root, workspace, packages := selectedPackage(t, map[string]string{"workflows/main.js": `export const meta={name:'open',description:'Skip an open step'};
const first = await agent('open-step', {label:'open-step'});
const second = await agent('new-step', {label:'new-step'});
return {first, second};`})
	var calls atomic.Int32
	f := newWorkflowFixture(t, root, workspace, packages, harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		calls.Add(1)
		text := requestPrompt(request)
		if strings.Contains(text, "open-step") {
			t.Error("open step was invoked")
			return workflowAnswer("replayed"), nil
		}
		if err := os.WriteFile(filepath.Join(workspace, "new.txt"), []byte("once"), 0600); err != nil {
			t.Error(err)
		}
		return workflowAnswer("new-done"), nil
	}), true, 0)
	script := filepath.Join(root, "workflows", "main.js")
	runID := "resume-open-step"
	fingerprint, err := callFingerprint(wireRequest{ScriptPath: script, Prompt: "open-step", Label: "open-step"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.parent.Session().Append("workflow/start", progress{RunID: runID, ScriptPath: script, ArgsHash: hashArgs(nil)}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.parent.Session().Append("workflow/agent-start", progress{RunID: runID, Sequence: 1, ScriptPath: script, Label: "open-step", Fingerprint: fingerprint, Status: harness.SubagentRunning}); err != nil {
		t.Fatal(err)
	}
	result, err := f.app.Execute(f.ctx, f.parent, Call{ScriptPath: script, ResumeFrom: runID})
	var value struct {
		First, Second *string
	}
	if err != nil || result.StopReason != "completed" || json.Unmarshal(result.Value, &value) != nil || value.First != nil || value.Second == nil || *value.Second != "new-done" || calls.Load() != 1 {
		t.Fatalf("open step resumed by invocation: result=%+v calls=%d error=%v", result, calls.Load(), err)
	}
	if data, err := os.ReadFile(filepath.Join(workspace, "new.txt")); err != nil || string(data) != "once" {
		t.Fatalf("new effect=%s %v", data, err)
	}
}

func TestWorkflowResumeRejectsMismatchedStep(t *testing.T) {
	root, workspace, packages := selectedPackage(t, map[string]string{"workflows/main.js": `export const meta={name:'mismatch',description:'Stop on a different step'}; return await agent('actual-step', {label:'actual'});`})
	var calls atomic.Int32
	f := newWorkflowFixture(t, root, workspace, packages, harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		calls.Add(1)
		t.Error("mismatched step was invoked")
		return workflowAnswer("replayed"), nil
	}), true, 0)
	script := filepath.Join(root, "workflows", "main.js")
	runID := "resume-mismatch"
	if _, err := f.parent.Session().Append("workflow/start", progress{RunID: runID, ScriptPath: script, ArgsHash: hashArgs(nil)}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.parent.Session().Append("workflow/agent-start", progress{RunID: runID, Sequence: 1, Fingerprint: "recorded-fingerprint", Status: harness.SubagentRunning}); err != nil {
		t.Fatal(err)
	}
	result, err := f.app.Execute(f.ctx, f.parent, Call{ScriptPath: script, ResumeFrom: runID})
	if err != nil || result.StopReason != "error" || !strings.Contains(result.Error, "does not match") || calls.Load() != 0 {
		t.Fatalf("mismatch result=%+v calls=%d error=%v", result, calls.Load(), err)
	}
}

func requestPrompt(request harness.GenerateRequest) string {
	var text strings.Builder
	for _, message := range request.Messages {
		for _, block := range message.Content {
			text.WriteString(block.Text)
		}
	}
	return text.String()
}

func workflowRunID(t *testing.T, parent *harness.Agent) string {
	t.Helper()
	var runID string
	for _, event := range parent.Session().Events() {
		if event.Type != "workflow/start" {
			continue
		}
		var data progress
		if json.Unmarshal(event.Data, &data) != nil || data.RunID == "" {
			t.Fatal("workflow start has no run id")
		}
		runID = data.RunID
	}
	if runID == "" {
		t.Fatal("missing workflow start")
	}
	return runID
}
