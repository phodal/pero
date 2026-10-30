package acp

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
)

type updateSink chan []byte

func (s updateSink) Write(p []byte) (int, error) { s <- append([]byte(nil), p...); return len(p), nil }
func nextUpdate(t *testing.T, sink updateSink) (string, string) {
	t.Helper()
	select {
	case raw := <-sink:
		var wire struct {
			Params struct {
				Update struct {
					Kind    string `json:"sessionUpdate"`
					Content struct{ Text string }
				}
			}
		}
		if err := json.Unmarshal(raw, &wire); err != nil {
			t.Fatal(err)
		}
		return wire.Params.Update.Kind, wire.Params.Update.Content.Text
	case <-time.After(5 * time.Second):
		t.Fatal("no incremental update before provider completion")
	}
	return "", ""
}

func TestLiveStreamBeforeCompletionAndTerminalBoundaries(t *testing.T) {
	for _, mode := range []string{"success", "failure", "cancel"} {
		t.Run(mode, func(t *testing.T) {
			release := make(chan struct{})
			cancelObserved, finishCancellation := make(chan struct{}), make(chan struct{})
			retained := make(chan func(harness.StreamChunk) error, 1)
			calls := 0
			h, err := harness.Boot(t.Context(), harness.Options{AdapterProviders: []string{"fixture"}, Adapter: harness.AdapterFunc(func(ctx context.Context, _ harness.GenerateRequest, emit func(harness.StreamChunk) error) (harness.Completion, error) {
				calls++
				if calls > 1 {
					return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "next"}}}}, nil
				}
				retained <- emit
				for _, block := range []harness.ContentBlock{{Type: harness.BlockReasoning, Text: "visible thought"}, {Type: harness.BlockToolCall, ToolCallID: "partial", ArgumentsDelta: `{"secret":`}, {Type: harness.BlockText, Text: "early "}} {
					if err := emit(harness.StreamChunk{Content: []harness.ContentBlock{block}}); err != nil {
						return harness.Completion{}, err
					}
				}
				select {
				case <-release:
				case <-ctx.Done():
					close(cancelObserved)
					<-finishCancellation
					if emit(harness.StreamChunk{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "after cancel"}}}) == nil {
						return harness.Completion{}, errors.New("cancelled emitter accepted")
					}
					return harness.Completion{}, ctx.Err()
				}
				if mode == "failure" {
					return harness.Completion{}, errors.New("fixture failure")
				}
				return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockReasoning, Text: "visible thought"}, {Type: harness.BlockText, Text: "early "}, {Type: harness.BlockText, Text: "tail"}}}}, nil
			})})
			if err != nil {
				t.Fatal(err)
			}
			defer func() { h.Dispose(context.Background()); h.Drain(context.Background()) }()
			disk, err := harness.NewJSONLSessionPersistence(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			server, err := NewServer(Options{Harness: h, Persistence: disk, Provider: "fixture", Model: "fixture"})
			if err != nil {
				t.Fatal(err)
			}
			sink := make(updateSink, 100)
			server.writer = &wireWriter{encoder: json.NewEncoder(sink)}
			defer server.closeAll(context.Background())
			cwd := t.TempDir()
			id, err := server.newSession(t.Context(), NewSessionParams{CWD: cwd})
			if err != nil {
				t.Fatal(err)
			}
			done := make(chan error, 1)
			go func() {
				_, err := server.prompt(t.Context(), PromptParams{SessionID: string(id), Prompt: []PromptContent{{Type: "text", Text: "go"}}})
				done <- err
			}()
			oldEmit := <-retained
			if kind, text := nextUpdate(t, sink); kind != "agent_thought_chunk" || text != "visible thought" {
				t.Fatalf("thought %s %q", kind, text)
			}
			if kind, text := nextUpdate(t, sink); kind != "agent_message_chunk" || text != "early " {
				t.Fatalf("text %s %q", kind, text)
			}
			select {
			case err := <-done:
				t.Fatalf("provider completed before release: %v", err)
			default:
			}
			if mode == "cancel" {
				raw, _ := json.Marshal(SessionParams{SessionID: string(id)})
				server.handleNotification(request{Method: "session/cancel", Params: raw})
				if err := oldEmit(harness.StreamChunk{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "after cancel notification"}}}); err == nil {
					t.Fatal("cancelled emitter accepted")
				}
				<-cancelObserved
				// A canceled request still owns the prompt slot until the provider
				// has actually settled; a second request cannot overlap cleanup.
				if _, err := server.prompt(t.Context(), PromptParams{SessionID: string(id), Prompt: []PromptContent{{Type: "text", Text: "too early"}}}); err == nil {
					t.Fatal("prompt admitted before canceled provider settled")
				}
				close(finishCancellation)
			} else {
				close(release)
			}
			select {
			case err := <-done:
				if (err != nil) != (mode == "failure") {
					t.Fatalf("terminal error %v", err)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("prompt did not stop")
			}
			if mode == "success" {
				if kind, text := nextUpdate(t, sink); kind != "agent_message_chunk" || text != "tail" {
					t.Fatalf("final suffix %s %q", kind, text)
				}
			}
			select {
			case raw := <-sink:
				t.Fatalf("duplicate or tool argument leak: %s", raw)
			default:
			}
			if err := oldEmit(harness.StreamChunk{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "late"}}}); err == nil {
				t.Fatal("retired provider emitter accepted")
			}
			if _, err = server.prompt(t.Context(), PromptParams{SessionID: string(id), Prompt: []PromptContent{{Type: "text", Text: "next"}}}); err != nil {
				t.Fatal(err)
			}
			if _, text := nextUpdate(t, sink); text != "next" {
				t.Fatal(text)
			}
			if err = oldEmit(harness.StreamChunk{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "late after new generation"}}}); err == nil {
				t.Fatal("old generation accepted")
			}
			if err = server.closeSession(t.Context(), id); err != nil {
				t.Fatal(err)
			}
			if err = server.resumeSession(t.Context(), ResumeSessionParams{SessionID: string(id), CWD: cwd}); err != nil {
				t.Fatal(err)
			}
			select {
			case raw := <-sink:
				t.Fatalf("resume replayed notifications: %s", raw)
			default:
			}
			if err = server.replaySessionHistory(id); err != nil {
				t.Fatal(err)
			}
			var replay strings.Builder
			for len(sink) > 0 {
				_, text := nextUpdate(t, sink)
				replay.WriteString(text)
			}
			got := replay.String()
			if strings.Contains(got, "late") || strings.Count(got, "early ") > 1 {
				t.Fatalf("bad replay %q", got)
			}
			if mode == "failure" && strings.Contains(got, "early ") {
				t.Fatalf("failed provisional stream replayed %q", got)
			}
			if mode != "failure" && !strings.Contains(got, "early ") {
				t.Fatalf("committed output missing %q", got)
			}
		})
	}
}

func TestLiveProjectionAttemptAndContentLanes(t *testing.T) {
	h, err := harness.Boot(t.Context(), harness.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { h.Dispose(context.Background()); h.Drain(context.Background()) }()
	disk, err := harness.NewJSONLSessionPersistence(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server, err := NewServer(Options{Harness: h, Persistence: disk})
	if err != nil {
		t.Fatal(err)
	}
	sink := make(updateSink, 100)
	server.writer = &wireWriter{encoder: json.NewEncoder(sink)}
	defer server.closeAll(context.Background())
	id, err := server.newSession(t.Context(), NewSessionParams{CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	record := server.sessions[id]
	event := func(kind string, payload any) {
		raw, _ := json.Marshal(payload)
		server.projectLive(record, harness.Event{Type: kind, Data: raw})
	}
	chunk := func(text string) {
		event("assistant/chunk", map[string]any{"turn": 1, "step": 1, "chunk": harness.StreamChunk{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: text}}}})
	}
	final := func(blocks ...harness.ContentBlock) {
		event("assistant/message", map[string]any{"turn": 1, "step": 1, "message": harness.Message{Role: harness.RoleAssistant, Content: blocks}})
	}
	text := func(s string) harness.ContentBlock { return harness.ContentBlock{Type: harness.BlockText, Text: s} }
	chunk("failed attempt")
	event("assistant/attempt", map[string]int{"turn": 1, "step": 1})
	chunk("new prefix")
	final(text("new "), text("prefix"), text(" suffix"))
	for _, want := range []string{"failed attempt", "new prefix", " suffix"} {
		if kind, got := nextUpdate(t, sink); kind != "agent_message_chunk" || got != want {
			t.Fatalf("%s %q want %q", kind, got, want)
		}
	}
	// No-stream providers and committed tool output remain supported.
	final(text("nonstream"))
	if _, got := nextUpdate(t, sink); got != "nonstream" {
		t.Fatal(got)
	}
	event("tool/result", harness.ContentBlock{Type: harness.BlockToolResult, ToolCallID: "tool", Content: []harness.ContentBlock{text("tool output")}})
	raw := <-sink
	if !strings.Contains(string(raw), `"sessionUpdate":"tool_call_update"`) || !strings.Contains(string(raw), "tool output") {
		t.Fatalf("tool output crossed lanes: %s", raw)
	}
	// A revised final cannot retract already emitted bytes; do not duplicate it.
	chunk("original")
	final(text("revised"))
	if _, got := nextUpdate(t, sink); got != "original" {
		t.Fatal(got)
	}
	select {
	case raw := <-sink:
		t.Fatalf("duplicate final: %s", raw)
	default:
	}
}

type cancellationRetryAdapter struct {
	harness.AdapterFunc
	policy harness.ResolvedRetryPolicy
}

func (a cancellationRetryAdapter) RetryPolicyForProvider(string) (harness.ResolvedRetryPolicy, bool) {
	return a.policy, true
}

func TestPromptAdmissionCancellation(t *testing.T) {
	policy, err := harness.ResolveRetryPolicy(nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, phase := range []struct {
		name, event string
		wantCalls   int32
	}{
		{"admission", "agent/inbox/spliced", 0},
		{"retry_backoff", "llm/retry", 1},
	} {
		for _, action := range []string{"cancel", "close"} {
			t.Run(phase.name+"/"+action, func(t *testing.T) {
				var calls atomic.Int32
				h, err := harness.Boot(t.Context(), harness.Options{AdapterProviders: []string{"fixture"}, Adapter: cancellationRetryAdapter{policy: policy, AdapterFunc: func(ctx context.Context, _ harness.GenerateRequest, emit func(harness.StreamChunk) error) (harness.Completion, error) {
					if calls.Add(1) == 1 && phase.wantCalls == 1 {
						return harness.Completion{}, harness.NewProviderError("fixture transport failure", "TRANSPORT", nil)
					}
					return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "next turn"}}}}, nil
				}}})
				if err != nil {
					t.Fatal(err)
				}
				defer func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) }()
				disk, err := harness.NewJSONLSessionPersistence(t.TempDir())
				if err != nil {
					t.Fatal(err)
				}
				server, err := NewServer(Options{Harness: h, Persistence: disk, Provider: "fixture", Model: "fixture"})
				if err != nil {
					t.Fatal(err)
				}
				sink := make(updateSink, 100)
				server.writer = &wireWriter{encoder: json.NewEncoder(sink)}
				defer server.closeAll(context.Background())
				id, err := server.newSession(t.Context(), NewSessionParams{CWD: t.TempDir()})
				if err != nil {
					t.Fatal(err)
				}
				record, err := server.currentRecord(id)
				if err != nil {
					t.Fatal(err)
				}
				var cancelled atomic.Bool
				detach := record.agent.Session().Subscribe(func(event harness.Event) {
					if event.Type == phase.event && cancelled.CompareAndSwap(false, true) {
						raw, _ := json.Marshal(SessionParams{SessionID: string(id)})
						if action == "close" {
							server.requestRecordClose(record)
						} else {
							server.handleNotification(request{Method: "session/cancel", Params: raw})
						}
					}
				})
				defer detach()
				stop, err := server.prompt(t.Context(), PromptParams{SessionID: string(id), Prompt: []PromptContent{{Type: "text", Text: "cancel at the selected execution boundary"}}})
				if err != nil {
					t.Fatal(err)
				}
				if stop != "cancelled" {
					t.Fatalf("stop = %q", stop)
				}
				if err := record.agent.WhenIdle(t.Context()); err != nil {
					t.Fatal(err)
				}
				if got := calls.Load(); got != phase.wantCalls {
					t.Fatalf("provider calls after cancellation = %d, want %d", got, phase.wantCalls)
				}
				var scheduled, started int32
				for _, event := range record.agent.Session().Events() {
					switch event.Type {
					case "llm/retry":
						scheduled++
					case "llm/retry-started":
						started++
					}
				}
				if scheduled != phase.wantCalls || started != 0 {
					t.Fatalf("retry receipts: scheduled=%d started=%d", scheduled, started)
				}
				if action == "close" {
					if err := waitRecordClose(t.Context(), record); err != nil {
						t.Fatal(err)
					}
					return
				}
				stop, err = server.prompt(t.Context(), PromptParams{SessionID: string(id), Prompt: []PromptContent{{Type: "text", Text: "next turn"}}})
				if err != nil || stop != "end_turn" || calls.Load() != phase.wantCalls+1 {
					t.Fatalf("next prompt: stop=%q err=%v provider calls=%d", stop, err, calls.Load())
				}
			})
		}
	}
}
