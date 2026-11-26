package openai

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/providers/messages"
)

// pumpMessages uses the same HTTP transport, auditing and cancellation
// context as the other explicit provider protocols. The Messages decoder,
// rather than the Chat [DONE] wrapper, owns terminal validation.
func (a *Adapter) pumpMessages(ctx context.Context, payload []byte, route messages.ReplayRoute, out chan<- openAIStreamEvent) {
	defer close(out)
	send := func(event openAIStreamEvent) error {
		select {
		case out <- event:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	post, err := http.NewRequestWithContext(ctx, http.MethodPost, a.messagesURL, bytes.NewReader(payload))
	if err != nil {
		_ = send(openAIStreamEvent{err: harness.NewProviderError("messages adapter: cannot prepare HTTP request", "INVALID_REQUEST", nil), decoded: true})
		return
	}
	post.Header.Set("Content-Type", "application/json")
	post.Header.Set("Accept", "text/event-stream")
	post.Header.Set("User-Agent", "pero-agent/0.1")
	post.Header.Set("X-API-Key", a.messagesKey)
	post.Header.Set("Anthropic-Version", "2023-06-01")
	response, err := a.messagesClient.Do(post)
	if err != nil {
		_ = send(openAIStreamEvent{err: err})
		return
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var info struct {
			Error struct{ Type, Message string }
		}
		_ = json.NewDecoder(io.LimitReader(response.Body, 8192)).Decode(&info)
		status := response.StatusCode
		_ = send(openAIStreamEvent{decoded: true, err: harness.NewProviderErrorWithFailure(harness.ProviderFailure{
			Message: fmt.Sprintf("messages adapter: HTTP %d: %s", status, http.StatusText(status)),
			Code:    httpErrorCode(status, info.Error.Type+" "+info.Error.Message), Status: status,
			ProviderRetryAfterMS: retryAfterMilliseconds(response.Header, time.Now()),
		}, nil)})
		return
	}
	emit := func(chunk harness.StreamChunk) error {
		return send(openAIStreamEvent{delta: &chunk})
	}
	var result harness.Completion
	if route.Scope == "" {
		result, err = messages.ReadStream(response.Body, emit)
	} else {
		result, err = messages.ReadSignedStream(response.Body, route, emit)
	}
	if err != nil {
		// Once a successful HTTP response starts, replay is not safe: it may
		// have consumed budget and emitted deltas. Never return a partial call.
		_ = send(openAIStreamEvent{decoded: true, err: harness.NewProviderError("messages adapter: incomplete or unsupported provider stream", harness.StreamClosedCode, nil)})
		return
	}
	_ = send(openAIStreamEvent{completion: &result})
}

// This durable identifier changes when the credential or exact endpoint
// changes, without exposing an unkeyed fingerprint of the API credential.
func messagesReplayScope(key []byte, endpoint, provider, credential string) string {
	mac := hmac.New(sha256.New, key)
	fmt.Fprintf(mac, "pero/deepseek-messages-replay/v1 %q %q %q", endpoint, provider, credential)
	return hex.EncodeToString(mac.Sum(nil))
}
