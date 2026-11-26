package harness

import (
	"context"
	"encoding/json"
	"reflect"
	"slices"
	"strings"
	"testing"

	point "github.com/phodal/pero/harness/go/runtime"
)

func TestCheckpointFileOperations(t *testing.T) {
	var events []Event
	appendEvent := func(kind string, value any) {
		raw, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		events = append(events, Event{Seq: uint64(len(events) + 1), Type: kind, Data: raw})
	}
	appendEvent("tool/call", struct {
		CallID    string `json:"callId"`
		Name      string
		Arguments json.RawMessage
	}{"r", "Read", json.RawMessage(`{"file_path":"src/算法.go"}`)})
	appendEvent("tool/result", ContentBlock{Type: BlockToolResult, ToolCallID: "r"})
	appendEvent("tool/call", struct {
		CallID    string `json:"callId"`
		Name      string
		Arguments json.RawMessage
	}{"w", "Write", json.RawMessage(`{"file_path":"missing"}`)})
	appendEvent("tool/result", ContentBlock{Type: BlockToolResult, ToolCallID: "w", IsError: true})
	appendEvent("tool/call", struct {
		CallID    string `json:"callId"`
		Name      string
		Arguments json.RawMessage
	}{"later", "Edit", json.RawMessage(`{"file_path":"later"}`)})
	appendEvent("tool/result", ContentBlock{Type: BlockToolResult, ToolCallID: "later"})
	rows := checkpointFileOperations(events, 4)
	if len(rows) != 1 || rows[0].Path != "src/算法.go" || rows[0].ResultSeq != 2 || rows[0].Operation != "read" {
		t.Fatalf("rows=%+v", rows)
	}
}

func TestCompactionRouteAndRetainedSource(t *testing.T) {
	for _, tc := range []struct {
		name, configured, dispatched string
		reroute                      bool
	}{
		{"latest request is current Go default", "", "model-b", false},
		{"explicit summary override", "model-a", "model-a", false},
		{"receipt follows adapter dispatch", "model-a", "model-b", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := t.Context()
			var calls []GenerateRequest
			h, err := Boot(ctx, Options{AdapterProviders: []string{"fixture"}, Adapter: AdapterFunc(
				func(_ context.Context, request GenerateRequest, _ func(StreamChunk) error) (Completion, error) {
					calls = append(calls, request)
					return Completion{Finish: FinishStop, Message: Message{
						Role: RoleAssistant, Content: []ContentBlock{{Type: BlockText, Text: "short synthetic checkpoint"}},
					}}, nil
				},
			)})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				_ = h.Dispose(context.Background())
				_ = h.Drain(context.Background())
			})
			auto, headroom, summaryCap := false, 2048, 97
			cfg := BasicCompactionConfig{
				Auto: &auto, HeadroomTokens: &headroom,
				ModelPolicies: []ModelCompactionPolicy{{Provider: "fixture", Model: "model-b", MaxTokens: &summaryCap}},
			}
			if tc.configured != "" {
				cfg.SummarizationProvider, cfg.SummarizationModel = "fixture", tc.configured
			}
			agent, err := h.Agents().Create(ctx, AgentOptions{
				Provider: "fixture", Model: "model-a", Compaction: &cfg,
				Configure: func(_ context.Context, run *point.Run, _ *Agent) error {
					if !tc.reroute {
						return nil
					}
					_, err := h.Hooks().Request.Use(run, func(_ context.Context, request GenerateRequest, next point.Next[GenerateRequest]) (GenerateRequest, error) {
						if request.Purpose == "compaction" && request.Provider == "fixture" && request.Model == tc.configured {
							request.Model = tc.dispatched
						}
						return next(request)
					})
					return err
				},
			})
			if err != nil {
				t.Fatal(err)
			}
			session := agent.Session()
			appendEvent := func(kind string, value any) Event {
				t.Helper()
				event, err := session.Append(kind, value)
				if err != nil {
					t.Fatal(err)
				}
				return event
			}
			appendEvent("turn/start", struct{ Turn int }{1})
			appendEvent("step/start", struct{ Turn, Step int }{1, 1})
			appendEvent("user/message", Message{Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: strings.Repeat("synthetic old history ", 700)}}})
			appendEvent("request/header", RequestHeaderEvent{Turn: 1, Step: 1, Provider: "fixture", Model: "model-a"})
			appendEvent("request/context", RequestContext{Provider: "fixture", Model: "model-a", ContextWindow: 128000})
			appendEvent("assistant/message", struct {
				Message Message `json:"message"`
			}{Message{
				Role: RoleAssistant, Content: []ContentBlock{{Type: BlockText, Text: "answer from A"}},
				Source: json.RawMessage(`{"kind":"model","provider":"fixture","model":"model-a"}`),
			}})
			appendEvent("step/end", struct{ Turn, Step int }{1, 1})
			appendEvent("turn/end", struct{ Turn int }{1})
			appendEvent("turn/start", struct{ Turn int }{2})
			appendEvent("step/start", struct{ Turn, Step int }{2, 1})
			source := &FileAttachmentRef{AttachmentID: "sha256:" + strings.Repeat("1", 64), Name: "fixture-page-4.pdf", Bytes: 123}
			sourceEvent := appendEvent("user/message", Message{Role: RoleUser, Content: []ContentBlock{{Type: BlockFile, FileAttachment: source}}})
			appendEvent("request/header", RequestHeaderEvent{Turn: 2, Step: 1, Provider: "fixture", Model: "model-b", MaxTokens: 512})
			appendEvent("step/end", struct{ Turn, Step int }{2, 1})
			appendEvent("turn/end", struct{ Turn int }{2})

			engine := agent.compaction.(*BasicCompactor)
			_, target, outputReserve, found, err := engine.routedPolicySnapshot(agent)
			if err != nil || !found || target.Provider != "fixture" || target.Model != "model-b" || target.ContextWindow != 0 || outputReserve != 512 {
				t.Fatalf("pressure must use B's route and reservation, never A's capacity: target=%+v reserve=%d found=%v err=%v", target, outputReserve, found, err)
			}
			result, err := agent.CompactNow(ctx)
			if err != nil || result == nil {
				t.Fatalf("manual compaction result=%+v err=%v", result, err)
			}
			if len(calls) != 1 || calls[0].Purpose != "compaction" || calls[0].Provider != "fixture" ||
				calls[0].Model != tc.dispatched || calls[0].MaxTokens != summaryCap {
				t.Fatalf("unexpected summary dispatch: %+v", calls)
			}
			if !slices.Contains(session.SurfaceSeqs(), sourceEvent.Seq) || slices.Contains(result.ShadowedSeqs, sourceEvent.Seq) {
				t.Fatal("the pinned source was shadowed")
			}
			retained, err := session.ProjectedSurfaceMessages([]uint64{sourceEvent.Seq})
			if err != nil || len(retained) != 1 || !reflect.DeepEqual(retained[0].Content[0].FileAttachment, source) {
				t.Fatalf("source reference changed: %+v err=%v", retained, err)
			}
			count := 0
			for _, event := range session.Events() {
				if event.Type != "compaction/response" && event.Type != "compaction/summary" {
					continue
				}
				count++
				var recorded struct{ Provider, Model string }
				if err := json.Unmarshal(event.Data, &recorded); err != nil {
					t.Fatal(err)
				}
				if recorded.Provider != calls[0].Provider || recorded.Model != calls[0].Model {
					t.Fatalf("%s recorded %+v, dispatched %s/%s", event.Type, recorded, calls[0].Provider, calls[0].Model)
				}
			}
			if count != 2 {
				t.Fatalf("got %d route receipts, want response and summary", count)
			}
		})
	}
}
