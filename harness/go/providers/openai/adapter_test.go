package openai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/llm"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestSSELineBufferIsBounded(t *testing.T) {
	b := &doneCheckingBody{ReadCloser: io.NopCloser(bytes.NewReader(bytes.Repeat([]byte{'x'}, 1024*1024+1)))}
	_, err := io.Copy(io.Discard, b)
	if err == nil || !strings.Contains(err.Error(), "bounded output") {
		t.Fatalf("missing stream bound: %v", err)
	}
}

func TestCallbackCancellationCannotBecomeSuccess(t *testing.T) {
	a, _ := fixture(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		event(w, `{"choices":[{"index":0,"delta":{"content":"hello"},"finish_reason":"stop"}]}`)
		event(w, "[DONE]")
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	_, err := a.Generate(ctx, request(), func(harness.StreamChunk) error { cancel(); return nil })
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled response became success: %v", err)
	}
}

func fixture(t *testing.T, h http.HandlerFunc) (*Adapter, *httptest.Server) {
	t.Helper()
	s := httptest.NewServer(h)
	t.Cleanup(s.Close)
	a, err := New(Config{Endpoint: s.URL + "/v1", APIKey: "fixture-not-a-real-key", ProviderName: "fixture", Models: []ModelConfig{{ID: "fixture-model", ContextWindow: 8192}}, StreamIdleTimeoutMS: 500})
	if err != nil {
		t.Fatal(err)
	}
	return a, s
}
func request() harness.GenerateRequest {
	return harness.GenerateRequest{Provider: "fixture", Model: "fixture-model", Messages: []harness.Message{{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "fixture prompt"}}}}}
}
func event(w http.ResponseWriter, s string) {
	fmt.Fprintf(w, "data: %s\n\n", s)
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
}

func TestHTTPAttemptAuditGatesNetwork(t *testing.T) {
	var received, recorded atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received.Add(1)
		w.Header().Set("Content-Type", "text/event-stream")
		event(w, `{"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}`)
		event(w, "[DONE]")
	}))
	defer server.Close()
	deny := true
	a, err := New(Config{Endpoint: server.URL, APIKey: "fixture", ProviderName: "fixture", Models: []ModelConfig{{ID: "fixture-model"}}, BeforeHTTPAttempt: func() error {
		if deny {
			return errors.New("audit unavailable")
		}
		recorded.Add(1)
		return nil
	}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.Generate(context.Background(), request(), nil); err == nil || received.Load() != 0 {
		t.Fatalf("failed audit reached provider: error=%v requests=%d", err, received.Load())
	}
	deny = false
	if _, err := a.Generate(context.Background(), request(), nil); err != nil {
		t.Fatal(err)
	}
	if recorded.Load() != 1 || received.Load() != 1 {
		t.Fatalf("recorded=%d received=%d", recorded.Load(), received.Load())
	}
}
func TestExplicitConfiguration(t *testing.T) {
	for _, c := range []Config{{}, {Endpoint: "https://example.com", APIKey: "test", ProviderName: "x"}, {Endpoint: "http://example.com", APIKey: "test", ProviderName: "x", Models: []ModelConfig{{ID: "m"}}}, {Endpoint: "https://u:p@example.com", APIKey: "test", ProviderName: "x", Models: []ModelConfig{{ID: "m"}}}, {Endpoint: "https://example.com", APIKey: "test", ProviderName: "x", Models: []ModelConfig{{ID: "m", InputModalities: []string{"image"}}}}} {
		if _, err := New(c); err == nil {
			t.Fatalf("accepted unsafe/implicit configuration %+v", c)
		}
	}
}
func TestTextStreamNoProductHeadersOrPayload(t *testing.T) {
	a, _ := fixture(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("path %s", r.URL.Path)
		}
		for k := range r.Header {
			if strings.Contains(strings.ToLower(k), "deepseek") || strings.Contains(strings.ToLower(k), "point") {
				t.Errorf("product header %s", k)
			}
		}
		var b map[string]any
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			t.Error(err)
		}
		if _, ok := b["dsh_session_log"]; ok {
			t.Error("session log uploaded")
		}
		if b["model"] != "fixture-model" {
			t.Error("wrong model")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		event(w, `{"choices":[{"index":0,"delta":{"content":"hello"},"finish_reason":null}]}`)
		event(w, `{"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`)
		event(w, "[DONE]")
	})
	var chunks int
	c, err := a.Generate(context.Background(), request(), func(harness.StreamChunk) error { chunks++; return nil })
	if err != nil {
		t.Fatal(err)
	}
	if c.Message.Content[0].Text != "hello" || chunks == 0 || c.Finish != harness.FinishStop {
		t.Fatalf("bad completion %+v", c)
	}
}
func TestToolArgumentsAssemble(t *testing.T) {
	a, _ := fixture(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		event(w, `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"fixture_tool","arguments":"{\"x\":"}}]}}]}`)
		event(w, `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]},"finish_reason":"tool_calls"}]}`)
		event(w, "[DONE]")
	})
	c, err := a.Generate(context.Background(), request(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if c.Finish != harness.FinishToolCalls || string(c.Message.Content[0].Arguments) != `{"x":1}` {
		t.Fatalf("bad tools %+v", c)
	}
}
func TestRejectUnsupportedWithoutNetwork(t *testing.T) {
	var calls atomic.Int32
	a, _ := fixture(t, func(w http.ResponseWriter, r *http.Request) { calls.Add(1) })
	for _, kind := range []harness.BlockType{harness.BlockImage, harness.BlockFile, "unknown"} {
		r := request()
		r.Messages[0].Content[0].Type = kind
		if _, err := a.Generate(context.Background(), r, nil); err == nil {
			t.Errorf("accepted %s", kind)
		}
	}
	r := request()
	r.Model = "unknown"
	if _, err := a.Generate(context.Background(), r, nil); err == nil {
		t.Error("accepted unknown model")
	}
	r = request()
	r.PrepareExtensions = func(context.Context, json.RawMessage) (*harness.PreparedRequestExtensions, error) {
		t.Error("extension invoked")
		return nil, nil
	}
	if _, err := a.Generate(context.Background(), r, nil); err == nil {
		t.Error("accepted extension")
	}
	if calls.Load() != 0 {
		t.Fatal("unexpected network")
	}
}
func TestCancellationStopsStream(t *testing.T) {
	stopped := make(chan struct{})
	a, _ := fixture(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(200)
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		close(stopped)
	})
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_, err := a.Generate(ctx, request(), nil)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected cancellation, got %v", err)
	}
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("request remained active")
	}
}
func TestTruncatedStreamAndMalformedToolFail(t *testing.T) {
	for _, data := range []string{`{"choices":[{"index":0,"delta":{"content":"partial"}}]}`, `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"c","function":{"name":"tool","arguments":"not-json"}}]},"finish_reason":"tool_calls"}]}`} {
		a, _ := fixture(t, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/event-stream")
			event(w, data)
			if strings.Contains(data, "not-json") {
				event(w, "[DONE]")
			}
		})
		if _, err := a.Generate(context.Background(), request(), nil); err == nil {
			t.Error("accepted malformed/incomplete stream")
		}
	}
}
func TestHTTPErrorAndRedirectNeverRetry(t *testing.T) {
	for _, status := range []int{http.StatusTooManyRequests, http.StatusTemporaryRedirect} {
		var calls atomic.Int32
		a, _ := fixture(t, func(w http.ResponseWriter, r *http.Request) {
			calls.Add(1)
			w.Header().Set("Location", "http://127.0.0.1:1/forbidden")
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(status)
			fmt.Fprint(w, `{"error":{"message":"fixture failure","type":"rate_limit"}}`)
		})
		if _, err := a.Generate(context.Background(), request(), nil); err == nil {
			t.Error("accepted HTTP failure")
		}
		if calls.Load() != 1 {
			t.Fatalf("retried %d times", calls.Load())
		}
	}
}

func TestProviderErrorsDoNotEchoRemoteSecrets(t *testing.T) {
	a, _ := fixture(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
		fmt.Fprint(w, `{"error":{"message":"fixture-not-a-real-key private-prompt","type":"auth"}}`)
	})
	_, err := a.Generate(context.Background(), request(), nil)
	if err == nil || strings.Contains(err.Error(), "fixture-not-a-real-key") || strings.Contains(err.Error(), "private-prompt") {
		t.Fatalf("unsafe error %v", err)
	}
}

func TestDoneWithoutFinishAndIncompleteToolsFail(t *testing.T) {
	for _, data := range []string{`{"choices":[{"index":0,"delta":{"content":"partial"}}]}`, `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]},"finish_reason":"tool_calls"}]}`} {
		a, _ := fixture(t, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/event-stream")
			event(w, data)
			event(w, "[DONE]")
		})
		if _, err := a.Generate(context.Background(), request(), nil); err == nil {
			t.Fatal("accepted incomplete response")
		}
	}
}

func TestHardBudgetConcurrentAndTokenClamp(t *testing.T) {
	var received atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received.Add(1)
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if thinking, ok := body["thinking"].(map[string]any); !ok || thinking["type"] != "disabled" {
			t.Error("explicit thinking disable absent")
		}
		if body["reasoning_effort"] != "none" {
			t.Errorf("reasoning default missing: %v", body["reasoning_effort"])
		}
		if body["max_tokens"] != float64(512) {
			t.Errorf("token limit missing: %v", body["max_tokens"])
		}
		w.Header().Set("Content-Type", "text/event-stream")
		event(w, `{"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}`)
		event(w, "[DONE]")
	}))
	defer server.Close()
	zero := 0
	a, err := New(Config{Endpoint: server.URL, APIKey: "fixture", ProviderName: "fixture", Models: []ModelConfig{{ID: "fixture-model", Reasoning: &llm.ModelReasoningInfo{Efforts: []llm.ReasoningEffortInfo{{ID: "none"}}, DefaultEffort: "none"}}}, DisableThinking: true, MaxRequests: 4, MaxOutputTokens: 512, RetryPolicy: &llm.RetryPolicyConfig{Mode: llm.RetryNormal, MaxRetries: &zero}})
	if err != nil {
		t.Fatal(err)
	}
	policy, _ := a.RetryPolicyForProvider("fixture")
	if policy.MaxRetries != 0 {
		t.Fatal("retry enabled")
	}
	results := make(chan error, 12)
	for i := 0; i < 12; i++ {
		go func() {
			r := request()
			r.MaxTokens = 10000
			_, err := a.Generate(context.Background(), r, nil)
			results <- err
		}()
	}
	successes := 0
	for i := 0; i < 12; i++ {
		if <-results == nil {
			successes++
		}
	}
	if received.Load() != 4 || successes != 4 {
		t.Fatalf("requests=%d successes=%d", received.Load(), successes)
	}
}
func TestFailedHTTPConsumesBudgetWithoutSDKRetry(t *testing.T) {
	var received atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received.Add(1)
		w.WriteHeader(500)
		fmt.Fprint(w, `{"error":{"message":"fixture"}}`)
	}))
	defer server.Close()
	a, err := New(Config{Endpoint: server.URL, APIKey: "fixture", ProviderName: "fixture", Models: []ModelConfig{{ID: "fixture-model"}}, MaxRequests: 1, MaxOutputTokens: 512})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if _, err := a.Generate(context.Background(), request(), nil); err == nil {
			t.Fatal("expected error")
		}
	}
	if received.Load() != 1 {
		t.Fatalf("hidden retry or exceeded budget: %d", received.Load())
	}
}
func TestNegativeBudgetRejected(t *testing.T) {
	for _, c := range []Config{{MaxRequests: -1}, {MaxOutputTokens: -1}} {
		if _, err := New(c); err == nil {
			t.Fatal("negative budget accepted")
		}
	}
}

func TestProxyRequiresExplicitOptInAndPreservesTLS(t *testing.T) {
	direct := configuredTransport(false)
	proxy := configuredTransport(true)
	if direct.Proxy != nil || proxy.Proxy == nil {
		t.Fatal("proxy opt-in incorrect")
	}
	for _, tr := range []*http.Transport{direct, proxy} {
		if tr.TLSClientConfig != nil && tr.TLSClientConfig.InsecureSkipVerify {
			t.Fatal("TLS validation disabled")
		}
		if tr.TLSClientConfig != nil && tr.TLSClientConfig.RootCAs != nil {
			t.Fatal("unexpected new trust roots")
		}
	}
}

func TestExplicitCatalogIsDetachedAndNeverCallsProvider(t *testing.T) {
	a, _ := fixture(t, func(http.ResponseWriter, *http.Request) { t.Error("catalog invoked HTTP") })
	entries, err := a.ListModels(context.Background(), "fixture")
	if err != nil || len(entries) != 1 || entries[0].ID != "fixture-model" {
		t.Fatal(entries, err)
	}
	entries[0].Name = "changed"
	entries[0].InputModalities[0] = "image"
	next, err := a.ListModels(context.Background(), "fixture")
	if err != nil || next[0].Name == "changed" || next[0].InputModalities[0] != "text" {
		t.Fatal(next, err)
	}
	if _, err := a.ListModels(context.Background(), "unknown"); err == nil {
		t.Fatal("unknown provider accepted")
	}
}

func TestMaxTokensDropsToolCallsAndKeepsSafeContent(t *testing.T) {
	t.Run("empty output limit", func(t *testing.T) {
		a, _ := fixture(t, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/event-stream")
			event(w, `{"choices":[{"index":0,"delta":{},"finish_reason":"length"}]}`)
			event(w, "[DONE]")
		})
		completion, err := a.Generate(context.Background(), request(), nil)
		if err != nil || completion.Finish != harness.FinishMaxTokens || len(completion.Message.Content) != 0 {
			t.Fatalf("empty output limit was not preserved: completion=%+v error=%v", completion, err)
		}
	})
	for _, tc := range []struct {
		name, prefix, arguments string
		wantBlocks              int
	}{
		{"partial JSON with text", `"content":"partial answer",`, `{"path":`, 1},
		{"complete JSON with reasoning", `"reasoning_content":"partial thought",`, `{}`, 1},
		{"only truncated tool", "", `{`, 0},
		{"only complete tool", "", `{}`, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a, _ := fixture(t, func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				arguments, _ := json.Marshal(tc.arguments)
				event(w, fmt.Sprintf(`{"choices":[{"index":0,"delta":{%s"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"write_file","arguments":%s}}]},"finish_reason":"length"}]}`, tc.prefix, arguments))
				event(w, "[DONE]")
			})
			completion, err := a.Generate(context.Background(), request(), nil)
			if err != nil || completion.Finish != harness.FinishMaxTokens || len(completion.Message.Content) != tc.wantBlocks {
				t.Fatalf("output limit was not preserved: completion=%+v error=%v", completion, err)
			}
			for _, block := range completion.Message.Content {
				if block.Type == harness.BlockToolCall || block.Text == "" {
					t.Fatalf("unsafe or missing retained content: %+v", block)
				}
			}
		})
	}
}

func TestContextOverflowClassificationPreservesRecovery(t *testing.T) {
	for _, tc := range []struct {
		name         string
		status       int
		detail, want string
	}{
		{"413 explicit context", 413, "context_length_exceeded", harness.ContextWindowExceededCode},
		{"400 explicit context", 400, "maximum context length exceeded", harness.ContextWindowExceededCode},
		{"other status explicit context", 422, "context_length_exceeded", harness.ContextWindowExceededCode},
		{"413 generic size", 413, "request entity too large", "INVALID_REQUEST"},
		{"400 generic invalid", 400, "invalid model", "INVALID_REQUEST"},
		{"auth takes precedence", 401, "context_length_exceeded", "AUTH"},
		{"rate limit takes precedence", 429, "context_length_exceeded", "RATE_LIMIT"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a, _ := fixture(t, func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tc.status)
				_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"message": tc.detail}})
			})
			_, err := a.Generate(context.Background(), request(), nil)
			if got := harness.ProviderFailureFromError(err).Code; got != tc.want {
				t.Fatalf("failure code=%q, want %q (%v)", got, tc.want, err)
			}
		})
	}
}

func TestUsageBoundary(t *testing.T) {
	for _, tc := range []struct {
		name, usage                  string
		invalid                      bool
		input, output, total, cached int
	}{
		{"negative prompt", `{"prompt_tokens":-3,"completion_tokens":1,"total_tokens":-2}`, true, 0, 0, 0, 0},
		{"negative output", `{"prompt_tokens":3,"completion_tokens":-1}`, true, 0, 0, 0, 0},
		{"negative total", `{"prompt_tokens":3,"completion_tokens":1,"total_tokens":-1}`, true, 0, 0, 0, 0},
		{"negative cache", `{"prompt_tokens":3,"prompt_tokens_details":{"cached_tokens":-1}}`, true, 0, 0, 0, 0},
		{"cache larger than prompt", `{"prompt_tokens":2,"completion_tokens":1,"prompt_tokens_details":{"cached_tokens":5}}`, true, 0, 0, 0, 0},
		{"negative fallback cache", `{"prompt_tokens":3,"prompt_cache_hit_tokens":-1}`, true, 0, 0, 0, 0},
		{"negative cache write", `{"prompt_tokens":3,"prompt_tokens_details":{"cache_write_tokens":-1}}`, true, 0, 0, 0, 0},
		{"negative reasoning", `{"completion_tokens":3,"completion_tokens_details":{"reasoning_tokens":-1}}`, true, 0, 0, 0, 0},
		{"fractional counter", `{"prompt_tokens":1.5}`, true, 0, 0, 0, 0},
		{"wrong counter type", `{"prompt_tokens":"3"}`, true, 0, 0, 0, 0},
		{"huge positive", `{"prompt_tokens":1e100}`, true, 0, 0, 0, 0},
		{"huge negative", `{"prompt_tokens":-1e100}`, true, 0, 0, 0, 0},
		{"int64 overflow", `{"prompt_tokens":9223372036854775808}`, true, 0, 0, 0, 0},
		{"unsafe integer", `{"prompt_tokens":9007199254740992}`, true, 0, 0, 0, 0},
		{"overflowing sum", `{"prompt_tokens":9223372036854775807,"completion_tokens":1}`, true, 0, 0, 0, 0},
		{"integral numeric notation", `{"prompt_tokens":3.0,"completion_tokens":1e0}`, false, 3, 1, 4, 0},
		{"no optional fields", `{"prompt_tokens":3,"completion_tokens":1}`, false, 3, 1, 4, 0},
		{"fallback cache", `{"prompt_tokens":3,"completion_tokens":1,"prompt_cache_hit_tokens":2}`, false, 1, 1, 4, 2},
		{"explicit cache wins", `{"prompt_tokens":3,"completion_tokens":1,"prompt_tokens_details":{"cached_tokens":1},"prompt_cache_hit_tokens":2}`, false, 2, 1, 4, 1},
		{"mismatched total remains unknown", `{"prompt_tokens":3,"completion_tokens":1,"total_tokens":9}`, false, 3, 1, 0, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a, _ := fixture(t, func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				event(w, `{"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}],"usage":`+tc.usage+`}`)
				event(w, "[DONE]")
			})
			completion, err := a.Generate(context.Background(), request(), nil)
			if tc.invalid {
				if harness.ProviderFailureFromError(err).Code != harness.MalformedResponseCode {
					t.Fatalf("invalid usage accepted or misclassified: usage=%+v error=%v", completion.Usage, err)
				}
				return
			}
			u := completion.Usage
			if err != nil || u == nil || u.InputTokens != tc.input || u.OutputTokens != tc.output || u.TotalTokens != tc.total || u.CacheReadTokens != tc.cached {
				t.Fatalf("usage=%+v error=%v", u, err)
			}
		})
	}
}
