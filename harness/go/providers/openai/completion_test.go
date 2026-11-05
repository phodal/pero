package openai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
)

func TestJSONCompletionWire(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		finish     harness.FinishKind
		calls      int
		invalid    bool
	}{
		{"text and usage", `{"choices":[{"index":0,"message":{"role":"assistant","content":"ready","reasoning_content":"checked"},"finish_reason":"stop"}],"usage":{"prompt_tokens":11,"completion_tokens":3,"total_tokens":14}}`, harness.FinishStop, 0, false},
		{"two tool calls", `{"choices":[{"index":0,"message":{"role":"assistant","tool_calls":[{"id":"a","type":"function","function":{"name":"Write","arguments":"{\"x\":1}"}},{"id":"b","type":"function","function":{"name":"Read","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}`, harness.FinishToolCalls, 2, false},
		{"truncated call", `{"choices":[{"index":0,"message":{"role":"assistant","tool_calls":[{"id":"a","type":"function","function":{"name":"Write","arguments":"{"}}]},"finish_reason":"length"}]}`, harness.FinishMaxTokens, 0, false},
		{"malformed arguments", `{"choices":[{"index":0,"message":{"role":"assistant","tool_calls":[{"id":"a","type":"function","function":{"name":"Write","arguments":"[1]"}}]},"finish_reason":"tool_calls"}]}`, "", 0, true},
		{"no choice", `{"choices":[]}`, "", 0, true},
		{"missing finish", `{"choices":[{"index":0,"message":{"role":"assistant","content":"incomplete"}}]}`, "", 0, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var attempts atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				attempts.Add(1)
				var controls struct {
					Stream        *bool           `json:"stream"`
					StreamOptions json.RawMessage `json:"stream_options"`
				}
				if err := json.NewDecoder(r.Body).Decode(&controls); err != nil || controls.Stream == nil || *controls.Stream || controls.StreamOptions != nil {
					t.Errorf("incorrect JSON transport controls: %+v %v", controls, err)
				}
				w.Header().Set("Content-Type", "application/json")
				fmt.Fprint(w, tc.body)
			}))
			defer server.Close()
			a, err := New(Config{Endpoint: server.URL, APIKey: "fixture", ProviderName: "fixture", Models: []ModelConfig{{ID: "fixture-model"}}, DisableStreaming: true, MaxRequests: 1})
			if err != nil {
				t.Fatal(err)
			}
			result, err := a.Generate(t.Context(), request(), nil)
			if (err != nil) != tc.invalid {
				t.Fatalf("completion=%+v error=%v", result, err)
			}
			if !tc.invalid {
				calls := 0
				for _, block := range result.Message.Content {
					if block.Type == harness.BlockToolCall {
						calls++
					}
				}
				if result.Finish != tc.finish || calls != tc.calls {
					t.Fatalf("completion=%+v tool calls=%d", result, calls)
				}
				if tc.name == "text and usage" && (result.Usage == nil || result.Usage.TotalTokens != 14 || len(result.Message.Content) != 2) {
					t.Fatalf("lost text/reasoning/usage: %+v", result)
				}
				if tc.name == "two tool calls" && (result.Usage != nil || result.Message.Content[1].ToolCallID != "b") {
					t.Fatalf("lost call identity or invented usage: %+v", result)
				}
			}
			if _, err := a.Generate(t.Context(), request(), nil); err == nil || attempts.Load() != 1 {
				t.Fatalf("JSON transport bypassed shared attempt budget: attempts=%d error=%v", attempts.Load(), err)
			}
		})
	}
}

func TestJSONCompletionCancellation(t *testing.T) {
	ready, released := make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		close(ready)
		<-r.Context().Done()
		close(released)
	}))
	defer server.Close()
	a, err := New(Config{Endpoint: server.URL, APIKey: "fixture", ProviderName: "fixture", Models: []ModelConfig{{ID: "fixture-model"}}, DisableStreaming: true})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	done := make(chan error, 1)
	go func() { _, err := a.Generate(ctx, request(), nil); done <- err }()
	<-ready
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("JSON cancellation became success: %v", err)
	}
	<-released
}
