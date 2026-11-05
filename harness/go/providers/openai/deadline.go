package openai

import (
	"context"
	"errors"
	"time"

	"github.com/phodal/pero/harness/go/harness"
)

func (a *Adapter) Generate(ctx context.Context, request harness.GenerateRequest, emit func(harness.StreamChunk) error) (harness.Completion, error) {
	if a.requestTimeout == 0 {
		return a.generate(ctx, request, emit)
	}
	bounded, cancel := context.WithTimeout(ctx, a.requestTimeout)
	defer cancel()
	started := time.Now()
	chunks, bytes := 0, 0
	var observedUsage *harness.TokenUsage
	completion, err := a.generate(bounded, request, func(chunk harness.StreamChunk) error {
		chunks++
		for _, block := range chunk.Content {
			bytes += len(block.Text) + len(block.ArgumentsDelta)
		}
		if chunk.Usage != nil {
			copy := *chunk.Usage
			observedUsage = &copy
		}
		if emit != nil {
			return emit(chunk)
		}
		return nil
	})
	if ctx.Err() != nil {
		return harness.Completion{}, ctx.Err()
	}
	if err != nil && errors.Is(bounded.Err(), context.DeadlineExceeded) {
		if request.Agent != nil {
			_, _ = request.Agent.Session().Append("provider/request-timeout", struct {
				TimeoutMS     int64               `json:"timeout_ms"`
				ElapsedMS     int64               `json:"elapsed_ms"`
				Chunks        int                 `json:"chunks"`
				ContentBytes  int                 `json:"content_bytes"`
				UsageComplete bool                `json:"usage_complete"`
				ObservedUsage *harness.TokenUsage `json:"observed_usage,omitempty"`
			}{a.requestTimeout.Milliseconds(), time.Since(started).Milliseconds(), chunks, bytes, false, observedUsage})
		}
		// This code is absent from the default retry set: a slow paid response
		// must not be silently reissued. Parent cancellation stays authoritative.
		return harness.Completion{}, harness.NewProviderError("openai adapter: configured total request deadline exceeded; response usage may be unknown", harness.RequestDeadlineExceededCode, nil)
	}
	return completion, err
}
