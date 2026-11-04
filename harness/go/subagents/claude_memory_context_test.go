package subagents

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

func TestAgentMemoryContextRetainsSourceAndRefreshesOnResume(t *testing.T) {
	for _, scope := range []string{"project", "local", "user"} {
		t.Run(scope, func(t *testing.T) {
			root := t.TempDir()
			t.Setenv("PERO_PLUGIN_DATA_HOME", t.TempDir())
			definition := AgentDefinition{Name: "reviewer", Description: "Review", Instructions: "Review current code.", Memory: scope}
			directory, err := agentMemoryDirectory(root, definition)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.MkdirAll(directory, 0700); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(directory, "MEMORY.md")
			if err := os.WriteFile(path, []byte("old-memory-fact"), 0600); err != nil {
				t.Fatal(err)
			}
			calls := 0
			adapter := harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
				calls++
				fact := "old-memory-fact"
				if calls > 1 {
					fact = "current-memory-fact"
				}
				if strings.Contains(request.System, fact) || strings.Contains(request.System, "old-memory-fact") {
					t.Error("memory body entered system persona")
				}
				if !strings.Contains(request.System, "supplemental historical data") || request.RuntimeContext == nil || !strings.Contains(request.RuntimeContext.Text, fact) {
					t.Error("missing memory rules or current attributed context")
				}
				found := false
				for _, message := range request.Messages {
					var source struct {
						Kind     string                          `json:"kind"`
						Sections []harness.RuntimeContextSection `json:"sections"`
					}
					if json.Unmarshal(message.Source, &source) != nil || source.Kind != "runtime-context" || message.Role != harness.RoleUser {
						continue
					}
					for _, section := range source.Sections {
						if section.Name == "agent-memory" && strings.Contains(section.Text, fact) && strings.Contains(section.Text, `"scope":"`+scope+`"`) && strings.Contains(section.Text, `"digest":"sha256:`) && strings.Contains(section.Text, "MEMORY.md") {
							found = true
						}
					}
				}
				if !found {
					t.Error("runtime user context lost memory source metadata")
				}
				return answer("checked"), nil
			})
			h, err := harness.Boot(t.Context(), harness.Options{EnableSubagents: true, Adapter: adapter, AdapterProviders: []string{"fixture"}})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) })
			claude, err := MountClaude(t.Context(), h, []AgentDefinition{definition}, ClaudeOptions{MemoryPresentation: MemoryAsContext})
			if err != nil {
				t.Fatal(err)
			}
			parent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "memory-source-parent", CWD: root, Provider: "fixture", Model: "model", MaxSteps: 2})
			if err != nil {
				t.Fatal(err)
			}
			result, err := claude.Invoke(t.Context(), parent, ClaudeInvocation{Definition: definition.Name, Prompt: "review"})
			if err != nil || result.Status != harness.SubagentCompleted {
				t.Fatalf("invoke=%+v err=%v", result, err)
			}
			if err := os.WriteFile(path, []byte("current-memory-fact"), 0600); err != nil {
				t.Fatal(err)
			}
			task, err := claude.service.resume(t.Context(), parent, result.ChildID, "review again", false)
			if err != nil {
				t.Fatal(err)
			}
			select {
			case <-task.done:
			case <-t.Context().Done():
				t.Fatal("memory child did not resume")
			}
			if task.err != nil || task.result.Status != harness.SubagentCompleted || calls != 2 {
				t.Fatalf("resume=%+v err=%v calls=%d", task.result, task.err, calls)
			}
		})
	}
}

func TestAgentMemoryContextReappearsAfterRealCompaction(t *testing.T) {
	root := t.TempDir()
	directory := filepath.Join(root, ".claude", "agent-memory", "reviewer")
	if err := os.MkdirAll(directory, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "MEMORY.md"), []byte("memory-must-survive-compaction"), 0600); err != nil {
		t.Fatal(err)
	}
	calls, summaries := 0, 0
	adapter := harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		if request.Purpose == "compaction" {
			summaries++
			return answer("checkpoint without memory body"), nil
		}
		calls++
		if request.RuntimeContext == nil || !strings.Contains(request.RuntimeContext.Text, "memory-must-survive-compaction") || strings.Contains(request.System, "memory-must-survive-compaction") {
			t.Error("memory did not remain separate after compaction")
		}
		encoded, _ := json.Marshal(request.Messages)
		if !strings.Contains(string(encoded), "memory-must-survive-compaction") {
			t.Error("memory context was not restored to the actual request")
		}
		return answer("done"), nil
	})
	h, err := harness.Boot(t.Context(), harness.Options{Adapter: adapter, AdapterProviders: []string{"fixture"}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) })
	auto, retain := false, 0
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "memory-compaction", CWD: root, Provider: "fixture", Model: "model", Compaction: &harness.BasicCompactionConfig{ContextWindow: 8192, MaxTokens: 128, RetainTokens: &retain, Auto: &auto}, Configure: func(ctx context.Context, run *point.Run, agent *harness.Agent) error {
		memory, err := prepareAgentMemory(agent, AgentDefinition{Name: "reviewer", Memory: "project"}, MemoryAsContext)
		if err != nil {
			return err
		}
		return mountAgentMemory(ctx, h, run, agent, memory, true)
	}})
	if err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{"first task", "continue"} {
		if _, err := agent.Prompt(t.Context(), harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: text}}}); err != nil {
			t.Fatal(err)
		}
	}
	result, err := agent.CompactNow(t.Context(), "compact-memory")
	if err != nil || result == nil || len(result.ShadowedSeqs) == 0 || summaries != 1 {
		t.Fatalf("compaction=%+v err=%v summaries=%d", result, err, summaries)
	}
	if _, err := agent.Prompt(t.Context(), harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "after checkpoint"}}}); err != nil || calls != 3 {
		t.Fatalf("continued calls=%d err=%v", calls, err)
	}
}

func TestAgentMemoryContextColdResumeKeepsPresentationWithoutLaunchOptIn(t *testing.T) {
	root := t.TempDir()
	disk, err := harness.NewJSONLSessionPersistence(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	directory := filepath.Join(root, ".claude", "agent-memory", "reviewer")
	if err := os.MkdirAll(directory, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "MEMORY.md"), []byte("cold-memory-source"), 0600); err != nil {
		t.Fatal(err)
	}
	calls := 0
	adapter := harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		calls++
		if strings.Contains(request.System, "cold-memory-source") || request.RuntimeContext == nil || !strings.Contains(request.RuntimeContext.Text, "cold-memory-source") {
			t.Error("cold resume lost memory presentation mode")
		}
		return answer("done"), nil
	})
	boot := func(mode MemoryPresentation) (*harness.Harness, *ClaudeContribution) {
		h, err := harness.Boot(t.Context(), harness.Options{EnableSubagents: true, Adapter: adapter, AdapterProviders: []string{"fixture"}})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) })
		claude, err := MountClaude(t.Context(), h, []AgentDefinition{{Name: "reviewer", Description: "Review", Instructions: "Review current code.", Memory: "project"}}, ClaudeOptions{Persistence: disk, MemoryPresentation: mode})
		if err != nil {
			t.Fatal(err)
		}
		return h, claude
	}
	h, claude := boot(MemoryAsContext)
	parent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "cold-memory-parent", CWD: root, Provider: "fixture", Model: "model", MaxSteps: 2})
	if err != nil {
		t.Fatal(err)
	}
	detach, err := disk.Attach(t.Context(), parent.Session())
	if err != nil {
		t.Fatal(err)
	}
	result, err := claude.Invoke(t.Context(), parent, ClaudeInvocation{Definition: "reviewer", Prompt: "review"})
	if err != nil {
		t.Fatal(err)
	}
	if err := detach(); err != nil {
		t.Fatal(err)
	}
	if err := h.Dispose(t.Context()); err != nil && !errors.Is(err, harness.ErrHarnessDisposalInProgress) {
		t.Fatal(err)
	}
	if err := h.Drain(t.Context()); err != nil {
		t.Fatal(err)
	}
	fresh, resumedClaude := boot("")
	loaded, err := disk.Load(t.Context(), parent.ID())
	if err != nil {
		t.Fatal(err)
	}
	resumedParent, err := fresh.Agents().Resume(t.Context(), loaded, harness.AgentOptions{Provider: "fixture", Model: "model", MaxSteps: 2})
	if err != nil {
		t.Fatal(err)
	}
	task, err := resumedClaude.service.resume(t.Context(), resumedParent, result.ChildID, "review cold", false)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-task.done:
	case <-t.Context().Done():
		t.Fatal("cold memory child did not settle")
	}
	if task.err != nil || task.result.Status != harness.SubagentCompleted || calls != 2 {
		t.Fatalf("resume=%+v err=%v calls=%d", task.result, task.err, calls)
	}
}

func TestAgentMemoryTruncationKeepsUTF8(t *testing.T) {
	path := filepath.Join(t.TempDir(), "MEMORY.md")
	text := strings.Repeat("a", agentMemoryLimit-1) + strings.Repeat("字", 10)
	if err := os.WriteFile(path, []byte(text), 0600); err != nil {
		t.Fatal(err)
	}
	body, truncated, err := readAgentMemoryText(path)
	if err != nil || !truncated || !utf8.ValidString(body) || len(body) > agentMemoryLimit+len("\n[memory truncated]") {
		t.Fatalf("bounded memory len=%d truncated=%v valid=%v err=%v", len(body), truncated, utf8.ValidString(body), err)
	}
	if err := os.WriteFile(path, []byte{0xff}, 0600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := readAgentMemoryText(path); err == nil {
		t.Fatal("invalid UTF-8 memory accepted")
	}
}
