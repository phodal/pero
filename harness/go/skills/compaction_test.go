package skills

import (
	"context"
	"encoding/json"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
)

// Exercise the provider boundary, not just SchemasForAgent: the launch-time
// advertisement survives real history replacement, but a loaded body is not
// automatically republished. This deliberately does not assert DSH parity.
func TestSkillAdvertisementAcrossCompaction(t *testing.T) {
	requireCatalogPlatform(t)
	ctx := t.Context()
	root := canonicalTempDir(t)
	const body = "unique-loaded-skill-body-73"
	fixture(t, root, "demo", "---\nname: demo\ndescription: unique-summary-73\n---\n"+body)
	var calls, summaries atomic.Int32
	var compacted atomic.Bool
	var digest string
	adapter := harness.AdapterFunc(func(_ context.Context, req harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		answer := func(text string) harness.Completion {
			return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: text}}}}
		}
		if req.Purpose == "compaction" {
			summaries.Add(1)
			return answer("checkpoint without skill instructions"), nil
		}
		n := calls.Add(1)
		found := false
		for _, schema := range req.Tools {
			if schema.Name == "skill" {
				found = strings.Contains(schema.Description, "unique-summary-73")
				if strings.Contains(schema.Description, body) || strings.Contains(schema.Description, digest) || strings.Contains(schema.Description, root) {
					t.Error("tool advertisement released body, digest or filesystem path")
				}
			}
		}
		if !found {
			t.Error("provider request lost the launch-time skill advertisement")
		}
		encoded, err := json.Marshal(req.Messages)
		if err != nil {
			t.Error(err)
		}
		for _, message := range req.Messages {
			for _, block := range message.Content {
				if strings.Contains(block.Text, "<available_skills>") {
					t.Error("unexpected durable user-role skill catalog; update the documented contract if intentional")
				}
			}
		}
		if compacted.Load() && strings.Contains(string(encoded), body) {
			t.Error("loaded body survived the selected replacement or was silently republished")
		}
		if n == 1 {
			return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, ToolCallID: "read-skill", Name: "skill", Arguments: json.RawMessage(`{"name":"demo","digest":"` + digest + `"}`)}}}}, nil
		}
		if n == 2 && !strings.Contains(string(encoded), body) {
			t.Error("real skill tool result did not reach the next model step")
		}
		return answer("done"), nil
	})
	h, err := harness.Boot(ctx, harness.Options{Adapter: adapter, AdapterProviders: []string{"fixture"}, ApprovalPolicy: harness.ApprovalNever})
	if err != nil {
		t.Fatal(err)
	}
	var catalog *Catalog
	defer func() {
		_ = h.Dispose(context.Background())
		_ = h.Drain(context.Background())
		if catalog != nil {
			_ = catalog.Close()
		}
	}()
	catalog, err = Mount(ctx, h, []string{root})
	if err != nil {
		t.Fatal(err)
	}
	rows, err := catalog.List(ctx)
	if err != nil || len(rows) != 1 {
		t.Fatalf("catalog: %+v %v", rows, err)
	}
	digest = rows[0].Digest
	auto, retain := false, 0
	a, err := h.Agents().Create(ctx, harness.AgentOptions{ID: "skill-compaction", CWD: root, Provider: "fixture", Model: "scripted", Compaction: &harness.BasicCompactionConfig{ContextWindow: 8192, MaxTokens: 128, RetainTokens: &retain, Auto: &auto}})
	if err != nil {
		t.Fatal(err)
	}
	prompt := func(text string) {
		t.Helper()
		if _, err := a.Prompt(ctx, harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: text}}}); err != nil {
			t.Fatal(err)
		}
	}
	prompt("load the selected skill")
	prompt("continue the task")
	result, err := a.CompactNow(ctx, "compact-skills")
	if err != nil || result == nil || len(result.ShadowedSeqs) == 0 || summaries.Load() != 1 {
		t.Fatalf("real compaction did not replace history: %+v %v summaries=%d", result, err, summaries.Load())
	}
	compacted.Store(true)
	prompt("continue from the checkpoint")
	if calls.Load() != 4 {
		t.Fatalf("unexpected model/tool replay: provider calls=%d", calls.Load())
	}
}
