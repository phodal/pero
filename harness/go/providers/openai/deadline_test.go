package openai

import (
	"context"
	"net/http"
	"slices"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/llm"
)

func TestTotalDeadlineBoundsContinuousStream(t *testing.T) {
	a, _ := fixture(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		ticker := time.NewTicker(10 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-r.Context().Done():
				return
			case <-ticker.C:
				event(w, `{"choices":[{"index":0,"delta":{"content":"x"}}]}`)
			}
		}
	})
	a.requestTimeout = 150 * time.Millisecond
	chunks := 0
	completion, err := a.Generate(t.Context(), request(), func(harness.StreamChunk) error { chunks++; return nil })
	failure := harness.ProviderFailureFromError(err)
	if failure.Code != harness.RequestDeadlineExceededCode || chunks < 2 || completion.Usage != nil {
		t.Fatalf("failure=%+v chunks=%d usage=%+v", failure, chunks, completion.Usage)
	}
	policy, err := llm.ResolveRetryPolicy(nil)
	if err != nil || slices.Contains(policy.RetryableCodes, failure.Code) {
		t.Fatal("deadline is automatically retryable")
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := a.Generate(ctx, request(), nil); err != context.Canceled {
		t.Fatalf("parent cancellation=%v", err)
	}
}
