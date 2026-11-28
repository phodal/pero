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
	"github.com/phodal/pero/harness/go/media"
	"github.com/phodal/pero/harness/go/providers/messages"
)

// pumpMessages uses the same HTTP transport, auditing and cancellation
// context as the other explicit provider protocols. The Messages decoder,
// rather than the Chat [DONE] wrapper, owns terminal validation.
func (a *Adapter) pumpMessages(ctx context.Context, payload []byte, route messages.ReplayRoute, fallback *messagesInlineRetry, out chan<- openAIStreamEvent) {
	defer close(out)
	send := func(event openAIStreamEvent) error {
		select {
		case out <- event:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	var response *http.Response
	var err error
	for {
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
		if fallback != nil {
			post.Header.Set("Anthropic-Beta", messagesFilesBeta)
		}
		response, err = a.messagesClient.Do(post)
		if err != nil {
			_ = send(openAIStreamEvent{err: err})
			return
		}

		if response.StatusCode < 200 || response.StatusCode >= 300 {
			var info struct {
				Error struct{ Type, Code, Message string }
			}
			decodeErr := json.NewDecoder(io.LimitReader(response.Body, 8192)).Decode(&info)
			_ = response.Body.Close()
			if fallback != nil && decodeErr == nil {
				stale := confirmedStaleMessagesID(response.StatusCode, info.Error.Type, info.Error.Code, info.Error.Message, fallback.ids)
				if stale != "" {
					a.messagesFiles.markStale(stale)
					payload, err = fallback.prepare(ctx)
					if err != nil {
						_ = send(openAIStreamEvent{decoded: true, err: err})
						return
					}
					fallback = nil
					continue
				}
			}
			status := response.StatusCode
			_ = send(openAIStreamEvent{decoded: true, err: harness.NewProviderErrorWithFailure(harness.ProviderFailure{
				Message: fmt.Sprintf("messages adapter: HTTP %d: %s", status, http.StatusText(status)),
				Code:    httpErrorCode(status, info.Error.Type+" "+info.Error.Message), Status: status,
				ProviderRetryAfterMS: retryAfterMilliseconds(response.Header, time.Now()),
			}, nil)})
			return
		}
		break
	}
	defer response.Body.Close()
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

// Resolve immutable local references or already held tool bytes, never paths
// or URLs. Budgets cover every image occurrence in the HTTP request.
func messagesImageEncoder(ctx context.Context, store harness.AttachmentStore) messages.ImageEncoder {
	remaining, count := MaxRequestImageBytes, 0
	return func(block harness.ContentBlock) (messages.ImageSource, error) {
		var zero messages.ImageSource
		if err := ctx.Err(); err != nil {
			return zero, err
		}
		if count >= harness.DefaultMaxImagesPerMessage {
			return zero, fmt.Errorf("messages: too many images in request")
		}
		raw, mime := block.Data, block.MIMEType
		if block.Attachment != nil {
			if store == nil || len(raw) != 0 {
				return zero, fmt.Errorf("messages: invalid image attachment source")
			}
			stored, err := store.ReadImage(ctx, *block.Attachment)
			if err != nil {
				return zero, fmt.Errorf("messages: could not resolve the saved image")
			}
			raw, mime = stored.Data, stored.Ref.MediaType
		}
		data, normalized, err := media.NormalizeToolImage(raw, mime)
		if err != nil || len(data) > remaining {
			return zero, fmt.Errorf("messages: invalid raster or request image budget exceeded")
		}
		remaining -= len(data)
		count++
		return messages.ImageSource{Type: "base64", MediaType: normalized, Data: data}, nil
	}
}
