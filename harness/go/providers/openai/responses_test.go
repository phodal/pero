package openai

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"sync/atomic"
	"testing"

	"github.com/openai/openai-go/v3/responses"
	"github.com/phodal/pero/harness/go/harness"
)

func TestResponsesToolReplay(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/responses" {
			t.Errorf("wrong protocol path: %s", r.URL.Path)
		}
		var wire responseRequest
		if err := json.NewDecoder(r.Body).Decode(&wire); err != nil {
			t.Error(err)
		}
		if wire.Store || wire.Stream || !slices.Contains(wire.Include, "reasoning.encrypted_content") {
			t.Errorf("state policy changed: %+v", wire)
		}
		if len(wire.Tools) != 1 || wire.Tools[0].Strict {
			t.Errorf("tool schema semantics changed: %+v", wire.Tools)
		}
		w.Header().Set("Content-Type", "application/json")
		if calls.Add(1) == 1 {
			fmt.Fprint(w, `{"status":"completed","output":[{"id":"rs_1","type":"reasoning","summary":[],"encrypted_content":"opaque-state"},{"id":"msg_1","type":"message","role":"assistant","status":"completed","phase":"commentary","content":[{"type":"output_text","text":"working","annotations":[]}]},{"id":"fc_1","type":"function_call","call_id":"call_1","name":"Write","arguments":"{\"path\":\"<中文>&\",\"number\":9007199254740993}","status":"completed"}],"usage":{"input_tokens":100,"input_tokens_details":{"cached_tokens":80},"output_tokens":10,"output_tokens_details":{"reasoning_tokens":4},"total_tokens":110}}`)
		} else {
			if len(wire.Input) != 5 || wire.Input[1].EncryptedContent != "opaque-state" || wire.Input[1].Summary == nil || wire.Input[2].Phase != "commentary" || wire.Input[2].Content[0].Annotations == nil || wire.Input[3].ID != "fc_1" || wire.Input[3].CallID != "call_1" || wire.Input[4].CallID != "call_1" || wire.Input[4].Output != "written" {
				t.Errorf("lost durable replay state: %+v", wire.Input)
			}
			fmt.Fprint(w, `{"status":"completed","output":[{"id":"msg_2","type":"message","role":"assistant","phase":"final_answer","content":[{"type":"output_text","text":"done","annotations":[]}]}]}`)
		}
	}))
	defer server.Close()
	config := Config{Endpoint: server.URL + "/v1/responses", APIKey: "fixture", ProviderName: "fixture", Models: []ModelConfig{{ID: "fixture-model"}}, APIFormat: Responses, DisableStreaming: true}
	a, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	req := request()
	req.Tools = []harness.ToolSchema{{Name: "Write", InputSchema: json.RawMessage(`{"type":"object","properties":{"path":{"type":"string"}}}`)}}
	first, err := a.Generate(t.Context(), req, nil)
	if err != nil {
		t.Fatal(err)
	}
	if first.Finish != harness.FinishToolCalls || len(first.Message.Content) != 3 || first.Usage == nil || first.Usage.InputTokens != 20 || first.Usage.CacheReadTokens != 80 || first.Usage.ReasoningTokens != 4 {
		t.Fatalf("lost output or usage: %+v", first)
	}
	// The new adapter has no provider memory. Restoration uses the same JSON
	// representation as the journal, including opaque block extension fields.
	encoded, err := json.Marshal(first.Message)
	if err != nil {
		t.Fatal(err)
	}
	var restored harness.Message
	if err = json.Unmarshal(encoded, &restored); err != nil {
		t.Fatal(err)
	}
	req.Messages = append(req.Messages, restored, harness.Message{Role: harness.RoleTool, Content: []harness.ContentBlock{{Type: harness.BlockToolResult, ToolCallID: "call_1", Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "written"}}}}})
	b, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	final, err := b.Generate(t.Context(), req, nil)
	if err != nil || final.Finish != harness.FinishStop || final.Message.Content[0].Text != "done" || calls.Load() != 2 {
		t.Fatalf("final=%+v attempts=%d error=%v", final, calls.Load(), err)
	}
}

func TestResponsesOutputAdmission(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		invalid    bool
		finish     harness.FinishKind
	}{
		{"truncated function", `{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"output":[{"type":"function_call","call_id":"a","name":"Write","arguments":"{"}]}`, false, harness.FinishMaxTokens},
		{"malformed arguments", `{"status":"completed","output":[{"type":"function_call","call_id":"a","name":"Write","arguments":"[]"}]}`, true, ""},
		{"missing reasoning replay", `{"status":"completed","output":[{"type":"reasoning","id":"rs_1","summary":[]}]}`, true, ""},
		{"unknown tool", `{"status":"completed","output":[{"type":"web_search_call","id":"ws_1"}]}`, true, ""},
		{"failed result", `{"status":"failed","output":[]}`, true, ""},
		{"invalid usage", `{"status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"ok"}]}],"usage":{"input_tokens":1.5,"output_tokens":2,"total_tokens":3}}`, true, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var response responses.Response
			if err := json.Unmarshal([]byte(tc.body), &response); err != nil {
				t.Fatal(err)
			}
			result, err := decodeResponses(&response)
			if (err != nil) != tc.invalid {
				t.Fatalf("result=%+v error=%v", result, err)
			}
			if !tc.invalid && (result.Finish != tc.finish || len(result.Message.Content) != 0) {
				t.Fatalf("truncated call escaped: %+v", result)
			}
		})
	}
	for _, config := range []Config{{APIFormat: "unknown"}, {APIFormat: Responses}, {APIFormat: Responses, DisableStreaming: true, DisableThinking: true}} {
		config.Endpoint, config.APIKey, config.ProviderName, config.Models = "https://fixture.invalid/v1", "fixture", "fixture", []ModelConfig{{ID: "fixture"}}
		if _, err := New(config); err == nil {
			t.Fatalf("unsupported protocol controls admitted: %+v", config)
		}
	}
}

func TestResponsesReplayArguments(t *testing.T) {
	for _, tc := range []struct {
		original, restored string
		equal              bool
	}{
		{`{"text":"<中文>&","n":9007199254740993}`, `{"n":9007199254740993,"text":"\u003c中文\u003e\u0026"}`, true},
		{`{"n":9007199254740993}`, `{"n":9007199254740992}`, false},
		{`{"text":"saved"}`, `{"text":"changed"}`, false},
		{`{}`, `{} {}`, false},
	} {
		if got := sameJSON(tc.original, json.RawMessage(tc.restored)); got != tc.equal {
			t.Errorf("replay equality for %s and %s: got %v", tc.original, tc.restored, got)
		}
	}
}
