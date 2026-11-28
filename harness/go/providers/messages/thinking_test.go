package messages

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/model"
)

func TestSignedThinkingSurvivesCommittedHistoryWithLocalScope(t *testing.T) {
	const thinking = `{"type":"content_block_start","index":1,"content_block":{"type":"thinking","thinking":"","signature":""}}`
	const partA = `{"type":"content_block_delta","index":1,"delta":{"type":"thinking_delta","thinking":"local "}}`
	const partB = `{"type":"content_block_delta","index":1,"delta":{"type":"thinking_delta","thinking":"reasoning"}}`
	const sigA = `{"type":"content_block_delta","index":1,"delta":{"type":"signature_delta","signature":"opaque-"}}`
	const sigB = `{"type":"content_block_delta","index":1,"delta":{"type":"signature_delta","signature":"handle"}}`
	const ended = `{"type":"content_block_stop","index":1}`
	route := ReplayRoute{Scope: "fixture-account-1", Model: "fixture-model"}
	for _, tc := range []struct {
		name        string
		frames      []string
		wantSuccess bool
	}{
		{"full", []string{partA, partB, sigA, sigB}, true},
		{"unsigned", []string{partA, partB}, false},
		{"thinking-after-signature", []string{partA, sigA, partB, sigB}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			frames := append([]string{start, thinking}, tc.frames...)
			frames = append(frames, ended, toolStart, argumentsPart1, argumentsPart2, toolEnd, toolFinish, stop)
			wire := sse(frames...)
			completion, err := ReadSignedStream(strings.NewReader(wire), route, func(chunk model.StreamChunk) error {
				for _, b := range chunk.Content {
					if b.Type == model.BlockReasoning || len(b.Extensions) != 0 {
						t.Fatal("partial reasoning leaked")
					}
				}
				return nil
			})
			if !tc.wantSuccess {
				if err == nil || len(completion.Message.Content) != 0 {
					t.Fatalf("unsafe completion: %v, %v", completion, err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if _, err := ReadStream(strings.NewReader(wire), nil); err == nil {
				t.Fatal("default decoder accepted signed thinking")
			}
			msg, err := json.Marshal(completion.Message)
			if err != nil {
				t.Fatal(err)
			}
			var durable model.Message
			if err := json.Unmarshal(msg, &durable); err != nil {
				t.Fatal(err)
			}
			history := []model.Message{
				{Role: model.RoleUser, Content: []model.ContentBlock{{Type: model.BlockText, Text: "read"}}},
				durable,
				{Role: model.RoleTool, Content: []model.ContentBlock{{Type: model.BlockToolResult, ToolCallID: "call-1", Content: []model.ContentBlock{{Type: model.BlockText, Text: "result"}}}}},
			}
			if _, err := Encode(route.Model, "", 128, nil, nil, history, nil); err == nil {
				t.Fatal("text-only encoder accepted reasoning")
			}
			for _, target := range []ReplayRoute{route, {Scope: route.Scope, Model: "another-model"}, {Scope: "another-account", Model: route.Model}} {
				r, err := EncodeSigned(target, "", 128, nil, nil, history, nil)
				if err != nil {
					t.Fatal(err)
				}
				wireJSON, err := json.Marshal(r)
				if err != nil {
					t.Fatal(err)
				}
				if target != route && (strings.Contains(string(wireJSON), "opaque-handle") || strings.Contains(string(wireJSON), "local reasoning")) {
					t.Fatal("another route carried private reasoning bytes")
				}
				if len(r.Messages) != 3 || r.Thinking.Type != "enabled" {
					t.Fatalf("unexpected Messages request shape")
				}
				assistant, result := r.Messages[1], r.Messages[2]
				if target == route {
					b := assistant.Content[0]
					if len(assistant.Content) != 2 || b.Type != "thinking" || b.Thinking == nil || *b.Thinking != "local reasoning" || b.Signature != "opaque-handle" {
						t.Fatal("signed block did not round trip")
					}
				} else if len(assistant.Content) != 1 {
					t.Fatal("another route retained thinking")
				}
				call := assistant.Content[len(assistant.Content)-1]
				if call.Type != "tool_use" || call.ID != "call-1" || result.Role != model.RoleUser || len(result.Content) != 1 || result.Content[0].ToolUseID != call.ID {
					t.Fatal("tool ID/order changed")
				}
			}
		})
	}
}
