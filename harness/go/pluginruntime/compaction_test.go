//go:build linux || darwin

package pluginruntime

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/plugins"
)

func TestPreCompactPlainTextSurvivesCompaction(t *testing.T) {
	root := t.TempDir()
	const marker = "keep-this-checkpoint"
	hook := scriptHook(t, root, "PreCompact", "printf '%s\\n' "+marker)
	h, _ := testHookHarness(t, harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		text := "done"
		if request.Purpose == "compaction" {
			text = "short checkpoint"
		}
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: text}}}}, nil
	}), plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{hook}}, 0)
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "precompact-text", CWD: root, Provider: "fixture", Model: "scripted", Compaction: &harness.BasicCompactionConfig{ContextWindow: 8192, MaxTokens: 128}})
	if err != nil {
		t.Fatal(err)
	}
	if err := prompt(t, agent, strings.Repeat("historical requirements detail ", 200)); err != nil {
		t.Fatal(err)
	}
	if result, err := agent.CompactNow(t.Context()); err != nil || result == nil {
		t.Fatalf("manual compaction: %+v %v", result, err)
	}
	messages, err := agent.Session().DeriveMessages()
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, message := range messages {
		count += strings.Count(messageText(message), marker)
	}
	if count != 1 {
		t.Fatalf("pre-compact checkpoint copies=%d", count)
	}
}

func TestCompactionHooksReceiveInstructionsAndSummary(t *testing.T) {
	root := t.TempDir()
	pre := scriptHook(t, root, "PreCompact", `cat > "$CLAUDE_PLUGIN_ROOT/pre.json"`)
	post := scriptHook(t, root, "PostCompact", `cat > "$CLAUDE_PLUGIN_ROOT/post.json"`)
	h, _ := testHookHarness(t, harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		text := "done"
		if request.Purpose == "compaction" {
			text = "short checkpoint"
		}
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: text}}}}, nil
	}), plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{pre, post}}, 0)
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "compact-fields", CWD: root, Provider: "fixture", Model: "scripted", Compaction: &harness.BasicCompactionConfig{ContextWindow: 8192, MaxTokens: 128}})
	if err != nil {
		t.Fatal(err)
	}
	if err := prompt(t, agent, strings.Repeat("historical requirements detail ", 200)); err != nil {
		t.Fatal(err)
	}
	if result, err := agent.CompactWithInstructions(t.Context(), "focus on the goal"); err != nil || result == nil {
		t.Fatalf("manual compaction: %+v %v", result, err)
	}
	preInput, err := os.ReadFile(filepath.Join(root, "pre.json"))
	postInput, postErr := os.ReadFile(filepath.Join(root, "post.json"))
	if err != nil || postErr != nil || !strings.Contains(string(preInput), `"custom_instructions":"focus on the goal"`) || !strings.Contains(string(postInput), `"compact_summary":"short checkpoint"`) {
		t.Fatalf("pre=%s post=%s errors=%v %v", preInput, postInput, err, postErr)
	}
}

func TestCompactionSessionStartContextPrecedesNextRequest(t *testing.T) {
	for _, trigger := range []string{"manual", "overflow"} {
		t.Run(trigger, func(t *testing.T) {
			root := t.TempDir()
			const marker = "restored-plugin-context-after-compact"
			post := scriptHook(t, root, "PostCompact", `cat > "$CLAUDE_PLUGIN_ROOT/post.json"; printf 'post\n' >> "$CLAUDE_PLUGIN_ROOT/order"`)
			start := scriptHook(t, root, "SessionStart", `cat > "$CLAUDE_PLUGIN_ROOT/start.json"; printf 'session\n' >> "$CLAUDE_PLUGIN_ROOT/order"; printf '%s' '{"hookSpecificOutput":{"additionalContext":"`+marker+`"}}'`)
			start.Matcher = "compact"
			var calls, summaries atomic.Int32
			adapter := harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
				answer := func(text string) harness.Completion {
					return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: text}}}}
				}
				if request.Purpose == "compaction" {
					summaries.Add(1)
					return answer("short checkpoint"), nil
				}
				call := calls.Add(1)
				if trigger == "overflow" && call == 2 {
					return harness.Completion{}, harness.NewProviderErrorWithFailure(harness.ProviderFailure{Code: harness.ContextWindowExceededCode, Message: "fixture context overflow"}, errors.New("fixture context overflow"))
				}
				if call > 1 {
					count := 0
					for _, message := range request.Messages {
						count += strings.Count(messageText(message), marker)
					}
					if count != 1 {
						t.Errorf("first request after compaction has %d contexts, want exactly one", count)
					}
				}
				return answer("done"), nil
			})
			h, _ := testHookHarness(t, adapter, plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: []claudehooks.Hook{post, start}}, 0)
			auto, retain := trigger == "overflow", 0
			agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: harness.SessionID("compact-" + trigger), CWD: root, Provider: "fixture", Model: "scripted", Compaction: &harness.BasicCompactionConfig{ContextWindow: 8192, MaxTokens: 128, RetainTokens: &retain, Auto: &auto}})
			if err != nil {
				t.Fatal(err)
			}
			persistence, err := harness.NewJSONLSessionPersistence(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			detach, err := persistence.Attach(t.Context(), agent.Session())
			if err != nil {
				t.Fatal(err)
			}
			defer detach()
			if err := prompt(t, agent, strings.Repeat("historical requirements detail ", 200)); err != nil {
				t.Fatal(err)
			}
			if trigger == "manual" {
				if result, err := agent.CompactNow(t.Context()); err != nil || result == nil {
					t.Fatalf("manual compaction: %+v %v", result, err)
				}
			}
			if err := prompt(t, agent, "continue with restored context"); err != nil {
				t.Fatal(err)
			}
			wantCalls := int32(2)
			if trigger == "overflow" {
				wantCalls++
			}
			if calls.Load() != wantCalls || summaries.Load() != 1 {
				t.Fatalf("provider requests=%d summaries=%d", calls.Load(), summaries.Load())
			}
			order, err := os.ReadFile(filepath.Join(root, "order"))
			if err != nil || string(order) != "post\nsession\n" {
				t.Fatalf("compact lifecycle order=%q error=%v", order, err)
			}
			startInput, err := os.ReadFile(filepath.Join(root, "start.json"))
			if err != nil || !strings.Contains(string(startInput), `"source":"compact"`) {
				t.Fatalf("SessionStart source payload=%s error=%v", startInput, err)
			}
			loaded, err := persistence.Load(t.Context(), agent.ID())
			if err != nil {
				t.Fatal(err)
			}
			messages, err := loaded.DeriveMessages()
			if err != nil {
				t.Fatal(err)
			}
			count := 0
			for _, message := range messages {
				count += strings.Count(messageText(message), marker)
			}
			if count != 1 {
				t.Fatalf("durable context copies=%d, want one", count)
			}
			var endSeq uint64
			for _, event := range loaded.Events() {
				if event.Type == "compaction/end" {
					endSeq = event.Seq
				}
				if strings.Contains(string(event.Data), marker) && (event.Type != "user/message" || endSeq == 0 || event.Seq <= endSeq) {
					t.Error("compact context was not persisted after compaction/end")
				}
			}
		})
	}
}
