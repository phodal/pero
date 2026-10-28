package subagents

import (
	"context"
	"encoding/json"
	"sync/atomic"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
)

// This is a real JSONL clean-restart test, not a simulated crash checkpoint.
// Historical one-shot children do not become resumable jobs after restart.
func TestCleanRestartRetainsHistoricalChildWithoutReplayingEffects(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	var models, effects atomic.Int32
	var childID harness.SessionID
	adapter := harness.AdapterFunc(func(_ context.Context, r harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		models.Add(1)
		if r.Agent.Parent() != nil {
			childID = r.Agent.ID()
			if r.Step == 1 {
				return harness.Completion{Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, ToolCallID: "child-effect", Name: "record_effect", Arguments: json.RawMessage(`{}`)}}}, Finish: harness.FinishToolCalls}, nil
			}
			return answer("historical-child-result"), nil
		}
		if r.Step == 1 {
			return harness.Completion{Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, ToolCallID: "delegate", Name: "subagent", Arguments: json.RawMessage(`{"description":"once","prompt":"perform synthetic effect once"}`)}}}, Finish: harness.FinishToolCalls}, nil
		}
		return answer("historical-parent-result"), nil
	})
	dir := t.TempDir()
	persistence, err := harness.NewJSONLSessionPersistence(dir)
	if err != nil {
		t.Fatal(err)
	}
	boot := func(p harness.SessionPersistence) *harness.Harness {
		h, err := harness.Boot(ctx, harness.Options{EnableSubagents: true, Adapter: adapter})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) })
		if _, err := MountInProcess(ctx, h, InProcessOptions{Persistence: p}); err != nil {
			t.Fatal(err)
		}
		if _, err := MountTool(ctx, h, ToolOptions{Provider: "spawn", MaxDepth: 1}); err != nil {
			t.Fatal(err)
		}
		if _, err := h.RegisterTool(ctx, "restart-effect", harness.Tool{Schema: harness.ToolSchema{Name: "record_effect", InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false}`)}, Execute: func(context.Context, json.RawMessage) (harness.ToolResult, error) {
			effects.Add(1)
			return harness.ToolResult{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "effect-recorded"}}}, nil
		}}); err != nil {
			t.Fatal(err)
		}
		return h
	}
	h := boot(persistence)
	parent, err := h.Agents().Create(ctx, harness.AgentOptions{ID: "durable-parent", CWD: t.TempDir(), MaxSteps: 4})
	if err != nil {
		t.Fatal(err)
	}
	detach, err := persistence.Attach(ctx, parent.Session())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := parent.Prompt(ctx, harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "run once"}}}); err != nil {
		t.Fatal(err)
	}
	if err := detach(); err != nil {
		t.Fatal(err)
	}
	if effects.Load() != 1 || models.Load() != 4 || childID == "" {
		t.Fatalf("first run models=%d effects=%d child=%q", models.Load(), effects.Load(), childID)
	}
	if err := h.Dispose(ctx); err != nil {
		t.Fatal(err)
	}
	if err := h.Drain(ctx); err != nil {
		t.Fatal(err)
	}

	// New persistence object and entirely new runtime. Nothing uses the old parent.
	freshPersistence, err := harness.NewJSONLSessionPersistence(dir)
	if err != nil {
		t.Fatal(err)
	}
	fresh := boot(freshPersistence)
	persistedChild, err := freshPersistence.Load(ctx, childID)
	if err != nil {
		t.Fatal(err)
	}
	descriptor, found, err := harness.FoldSubagentDescriptor(persistedChild)
	if err != nil || !found || descriptor.Mode != harness.SubagentDescriptorOneShot {
		t.Fatalf("historical descriptor: %+v %v %v", descriptor, found, err)
	}
	if persistedChild.Header().ParentSession != parent.ID() {
		t.Fatal("lost historical lineage")
	}
	// Reading a durable descriptor does not manufacture a live child or catalog.
	if _, live := fresh.Agents().Get(childID); live {
		t.Fatal("historical child auto-mounted")
	}
	provider, err := fresh.Subagents().Provider(fresh.Runtime().Root(), "spawn")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := provider.(harness.SubagentContinuationProvider); ok {
		t.Fatal("continuation unexpectedly provided")
	}
	if _, ok := provider.(harness.SubagentContinuationResumer); ok {
		t.Fatal("cold resume unexpectedly provided")
	}
	if _, ok := provider.(harness.SubagentCatalogProvider); ok {
		t.Fatal("historical provider catalog unexpectedly provided")
	}
	loadedParent, err := freshPersistence.Load(ctx, parent.ID())
	if err != nil {
		t.Fatal(err)
	}
	resumedParent, err := fresh.Agents().Resume(ctx, loadedParent, harness.AgentOptions{MaxSteps: 4})
	if err != nil {
		t.Fatal(err)
	}
	if got := fresh.Subagents().ListChildren(resumedParent, true); len(got) != 0 {
		t.Fatalf("historical child falsely advertised live: %+v", got)
	}
	if _, err := fresh.Subagents().ActivateContinuable(ctx, resumedParent, childID); err == nil {
		t.Fatal("one-shot historical child resumed")
	}
	if _, err := fresh.Agents().Resume(ctx, persistedChild, harness.AgentOptions{}); err == nil {
		t.Fatal("historical child silently promoted to root")
	}
	if _, err := fresh.Subagents().WaitForChildren(ctx, resumedParent); err != nil {
		t.Fatal(err)
	}
	// Final drain joins any admitted work before checking effects: this is not a
	// sleep-based assertion, and it cannot hide a delayed automatic replay.
	if err := fresh.Dispose(ctx); err != nil {
		t.Fatal(err)
	}
	if err := fresh.Drain(ctx); err != nil {
		t.Fatal(err)
	}
	if models.Load() != 4 || effects.Load() != 1 {
		t.Fatalf("restart replayed effects: models=%d effects=%d", models.Load(), effects.Load())
	}
}
