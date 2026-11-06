package acp

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
)

func TestSessionTitleGenerationAndReplay(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	requested := make(chan harness.GenerateRequest, 1)
	release := make(chan struct{})
	var titleCalls atomic.Int32
	h, err := harness.Boot(ctx, harness.Options{AdapterProviders: []string{"fixture"}, Adapter: harness.AdapterFunc(func(callCtx context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		text := "已总结论文的主要方法与结论"
		if request.Purpose == "session-title" {
			titleCalls.Add(1)
			requested <- request
			select {
			case <-release:
			case <-callCtx.Done():
				return harness.Completion{}, callCtx.Err()
			}
			text = "**论文方法总结**"
		}
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: text}}}}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { h.Dispose(context.Background()); h.Drain(context.Background()) }()
	disk, err := harness.NewJSONLSessionPersistence(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server, err := NewServer(Options{Harness: h, Persistence: disk, Provider: "fixture", Model: "selected", SessionTitles: true})
	if err != nil {
		t.Fatal(err)
	}
	sink := make(updateSink, 100)
	server.writer = &wireWriter{encoder: json.NewEncoder(sink)}
	defer server.closeAll(context.Background())
	cwd := t.TempDir()
	id, err := server.newSession(ctx, NewSessionParams{CWD: cwd})
	if err != nil {
		t.Fatal(err)
	}
	prompt := func(text string) {
		t.Helper()
		stop, err := server.prompt(ctx, PromptParams{SessionID: string(id), Prompt: []PromptContent{
			{Type: "text", Text: text}, {Type: "text", Text: "User-selected context (data)\n请总结这篇论文的方法和结论"},
		}})
		if err != nil || stop != "end_turn" {
			t.Fatalf("stop=%q, err=%v", stop, err)
		}
	}
	// Main completion remains available while the auxiliary model is blocked.
	prompt("Carry out the frozen App request")
	var titleRequest harness.GenerateRequest
	select {
	case titleRequest = <-requested:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	input := titleRequest.Messages[0].Content[0].Text
	if titleRequest.Provider != "fixture" || titleRequest.Model != "selected" || titleRequest.MaxTokens != 128 || len(titleRequest.Tools) != 0 || !strings.Contains(input, "请总结这篇论文的方法和结论") || !strings.Contains(input, "已总结论文") {
		t.Fatalf("incorrect auxiliary request: %+v", titleRequest)
	}
	prompt("谢谢")
	close(release)
	waitTitle := func() {
		t.Helper()
		for {
			select {
			case raw := <-sink:
				var wire struct {
					Params struct {
						Update struct {
							Kind  string `json:"sessionUpdate"`
							Title string
						}
					}
				}
				if err := json.Unmarshal(raw, &wire); err != nil {
					t.Fatal(err)
				}
				if wire.Params.Update.Kind == "session_info_update" {
					if wire.Params.Update.Title != "论文方法总结" {
						t.Fatalf("title=%q", wire.Params.Update.Title)
					}
					return
				}
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
		}
	}
	waitTitle()
	if err := server.closeSession(ctx, id); err != nil {
		t.Fatal(err)
	}
	if err := server.resumeSession(ctx, ResumeSessionParams{SessionID: string(id), CWD: cwd}); err != nil {
		t.Fatal(err)
	}
	if err := server.replaySessionHistory(id); err != nil {
		t.Fatal(err)
	}
	waitTitle()
	prompt("继续说明")
	if err := server.closeSession(ctx, id); err != nil {
		t.Fatal(err)
	}
	if titleCalls.Load() != 1 {
		t.Fatalf("title calls=%d", titleCalls.Load())
	}
	stored, err := disk.Load(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	requests, titles, turns := 0, 0, 0
	for _, event := range stored.Events() {
		switch event.Type {
		case "session/title-llm-request":
			requests++
		case "session/title":
			titles++
		case "turn/end":
			turns++
		}
	}
	if requests != 1 || titles != 1 || turns != 3 {
		t.Fatalf("requests=%d titles=%d turns=%d", requests, titles, turns)
	}
}

func TestSessionTitleFailurePreservesCompletion(t *testing.T) {
	for _, failure := range []string{"provider error", "output limit"} {
		t.Run(failure, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			defer cancel()
			attempted := make(chan struct{}, 1)
			var titleCalls atomic.Int32
			h, err := harness.Boot(ctx, harness.Options{AdapterProviders: []string{"fixture"}, Adapter: harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
				if request.Purpose == "session-title" {
					titleCalls.Add(1)
					attempted <- struct{}{}
					if failure == "provider error" {
						return harness.Completion{}, errors.New("title unavailable")
					}
					return harness.Completion{Finish: harness.FinishMaxTokens, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "Partial"}}}}, nil
				}
				return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "Retained answer"}}}}, nil
			})})
			if err != nil {
				t.Fatal(err)
			}
			defer func() { h.Dispose(context.Background()); h.Drain(context.Background()) }()
			disk, err := harness.NewJSONLSessionPersistence(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			server, err := NewServer(Options{Harness: h, Persistence: disk, Provider: "fixture", Model: "selected", SessionTitles: true})
			if err != nil {
				t.Fatal(err)
			}
			server.writer = &wireWriter{encoder: json.NewEncoder(io.Discard)}
			defer server.closeAll(context.Background())
			cwd := t.TempDir()
			id, err := server.newSession(ctx, NewSessionParams{CWD: cwd})
			if err != nil {
				t.Fatal(err)
			}
			for attempt := 0; attempt < 2; attempt++ {
				stop, err := server.prompt(ctx, PromptParams{SessionID: string(id), Prompt: []PromptContent{{Type: "text", Text: "Investigate rendering"}}})
				if stop != "end_turn" || err != nil {
					t.Fatalf("stop=%q err=%v", stop, err)
				}
				if attempt == 0 {
					select {
					case <-attempted:
					case <-ctx.Done():
						t.Fatal(ctx.Err())
					}
				}
				if err := server.closeSession(ctx, id); err != nil {
					t.Fatal(err)
				}
				if attempt == 0 {
					if err := server.resumeSession(ctx, ResumeSessionParams{SessionID: string(id), CWD: cwd}); err != nil {
						t.Fatal(err)
					}
				}
			}
			stored, err := disk.Load(ctx, id)
			if err != nil {
				t.Fatal(err)
			}
			if titleCalls.Load() != 1 {
				t.Fatalf("title requests=%d", titleCalls.Load())
			}
			if _, found := stored.LatestEvent("session/title"); found {
				t.Fatal("failed title replaced the provisional title")
			}
		})
	}
}
