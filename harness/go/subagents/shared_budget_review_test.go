package subagents

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	openaiadapter "github.com/phodal/pero/harness/go/providers/openai"
)

// Uses only loopback and a deliberately fake credential. HTTP receipts, not
// adapter counters or direct API calls, prove the budget covers real child turns.
func TestReviewParentChildShareHardHTTPBudget(t *testing.T) {
	for _, cap := range []int{1, 2, 3} {
		t.Run(fmt.Sprint(cap), func(t *testing.T) {
			var mu sync.Mutex
			var bodies []string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body json.RawMessage
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					w.WriteHeader(400)
					return
				}
				mu.Lock()
				bodies = append(bodies, string(body))
				n := len(bodies)
				mu.Unlock()
				w.Header().Set("Content-Type", "text/event-stream")
				payload := `{"choices":[{"index":0,"delta":{"content":"review-child-result"},"finish_reason":"stop"}]}`
				if n == 1 {
					payload = `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"review-delegate-1","type":"function","function":{"name":"subagent","arguments":"{\"description\":\"budget probe\",\"prompt\":\"review-child-task\"}"}}]},"finish_reason":"tool_calls"}]}`
				}
				fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", payload)
			}))
			defer server.Close()
			adapter, err := openaiadapter.New(openaiadapter.Config{Endpoint: server.URL + "/v1", APIKey: "review-fake-not-a-real-key", ProviderName: "review", Models: []openaiadapter.ModelConfig{{ID: "review-model", ContextWindow: 8192}}, MaxRequests: cap, MaxOutputTokens: 32})
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			h, err := harness.Boot(ctx, harness.Options{EnableSubagents: true, Adapter: adapter, AdapterProviders: []string{"review"}, ModelInfo: adapter})
			if err != nil {
				t.Fatal(err)
			}
			defer func() {
				_ = h.Dispose(context.Background())
				if err := h.Drain(ctx); err != nil {
					t.Error(err)
				}
			}()
			if _, err := MountInProcess(ctx, h, InProcessOptions{}); err != nil {
				t.Fatal(err)
			}
			if _, err := MountTool(ctx, h, ToolOptions{Provider: "spawn", MaxDepth: 1}); err != nil {
				t.Fatal(err)
			}
			parent, err := h.Agents().Create(ctx, harness.AgentOptions{ID: "budget-parent", CWD: t.TempDir(), Provider: "review", Model: "review-model", MaxSteps: 5, MaxTokens: 32, DisableCompaction: true})
			if err != nil {
				t.Fatal(err)
			}
			prompt := harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "review-parent-task"}}}
			_, promptErr := parent.Prompt(ctx, prompt)
			if cap < 3 && (promptErr == nil || !strings.Contains(promptErr.Error(), "budget exhausted")) {
				t.Fatalf("expected shared exhaustion, got %v", promptErr)
			}
			if cap == 3 && promptErr != nil {
				t.Fatal(promptErr)
			}
			mu.Lock()
			observed := append([]string(nil), bodies...)
			mu.Unlock()
			if len(observed) != cap {
				t.Fatalf("HTTP count %d, cap %d", len(observed), cap)
			}
			if cap >= 2 && (!strings.Contains(observed[1], "review-child-task") || strings.Contains(observed[1], "review-parent-task")) {
				t.Fatalf("second HTTP request was not independent child: %s", observed[1])
			}
			if cap == 3 && !strings.Contains(observed[2], "review-child-result") {
				t.Fatalf("parent continuation lacks actual child output: %s", observed[2])
			}
			// Same parent retries after exhaustion; neither a turn nor child cleanup
			// may construct a fresh adapter or reset the configured lifetime budget.
			_, retryErr := parent.Prompt(ctx, prompt)
			if retryErr == nil || !strings.Contains(retryErr.Error(), "budget exhausted") {
				t.Fatalf("budget reset on next turn: %v", retryErr)
			}
			mu.Lock()
			finalCount := len(bodies)
			mu.Unlock()
			if finalCount != cap {
				t.Fatalf("post-exhaustion HTTP transmissions %d exceed cap %d", finalCount, cap)
			}
		})
	}
}
