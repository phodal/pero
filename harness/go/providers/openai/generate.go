package openai

import (
	"context"
	"encoding/json"
	"fmt"
	openaisdk "github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/packages/param"
	"github.com/phodal/pero/harness/go/harness"
	"slices"
	"time"
)

type wireRequest struct {
	Thinking        *wireThinking           `json:"thinking,omitempty"`
	Model           string                  `json:"model"`
	ReasoningEffort harness.ReasoningEffort `json:"reasoning_effort,omitempty"`
	Temperature     *float64                `json:"temperature,omitempty"`
	Messages        []wireMessage           `json:"messages"`
	Tools           []wireTool              `json:"tools,omitempty"`
	MaxTokens       int                     `json:"max_tokens,omitempty"`
	Stop            []string                `json:"stop,omitempty"`
	Stream          bool                    `json:"stream,omitempty"`
	StreamOptions   wireStreamOptions       `json:"stream_options"`
}

type wireThinking struct {
	Type string `json:"type"`
}

type wireStreamOptions struct {
	IncludeUsage bool `json:"include_usage"`
}

type wireMessage struct {
	Role             string         `json:"role"`
	Content          any            `json:"content,omitempty"`
	ReasoningContent string         `json:"reasoning_content,omitempty"`
	ToolCallID       string         `json:"tool_call_id,omitempty"`
	ToolCalls        []wireToolCall `json:"tool_calls,omitempty"`
}

type wireContentPart struct {
	Type     string        `json:"type"`
	Text     string        `json:"text,omitempty"`
	ImageURL *wireImageURL `json:"image_url,omitempty"`
	FileID   string        `json:"file_id,omitempty"`
}

type wireImageURL struct {
	URL string `json:"url"`
}

type wireTool struct {
	Type     string       `json:"type"`
	Function wireFunction `json:"function"`
}

type wireFunction struct {
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	Parameters  json.RawMessage `json:"parameters,omitempty"`
	Arguments   string          `json:"arguments,omitempty"`
}

type wireToolCall struct {
	ID       string       `json:"id"`
	Type     string       `json:"type"`
	Function wireFunction `json:"function"`
}

func (a *Adapter) Generate(ctx context.Context, request harness.GenerateRequest, emit func(harness.StreamChunk) error) (harness.Completion, error) {
	if _, err := a.ResolveModelInfo(ctx, request.Provider, request.Model); err != nil {
		return harness.Completion{}, err
	}
	if request.ReasoningEffort == "" {
		if reasoning := a.models[request.Model].Reasoning; reasoning != nil {
			request.ReasoningEffort = reasoning.DefaultEffort
		}
	}
	if request.ReasoningEffort != "" {
		supported := false
		if reasoning := a.models[request.Model].Reasoning; reasoning != nil {
			for _, effort := range reasoning.Efforts {
				if effort.ID == request.ReasoningEffort {
					supported = true
				}
			}
		}
		if !supported {
			return harness.Completion{}, harness.NewProviderError("unsupported reasoning effort", "UNSUPPORTED", nil)
		}
	}
	if request.PrepareExtensions != nil {
		return harness.Completion{}, harness.NewProviderError("request extensions are not enabled", "UNSUPPORTED", nil)
	}
	if a.maxOutputTokens > 0 && (request.MaxTokens == 0 || request.MaxTokens > a.maxOutputTokens) {
		request.MaxTokens = a.maxOutputTokens
	}
	wire, err := encodeRequest(request, slices.Contains(a.models[request.Model].InputModalities, "image"))
	if err != nil {
		return harness.Completion{}, err
	}
	if a.disableThinking {
		wire.Thinking = &wireThinking{Type: "disabled"}
	}
	payload, err := json.Marshal(wire)
	if err != nil {
		return harness.Completion{}, err
	}
	params := param.Override[openaisdk.ChatCompletionNewParams](json.RawMessage(payload))
	streamCtx, cancelStream := context.WithCancel(ctx)
	defer cancelStream()
	activity := make(chan struct{}, 1)
	streamCtx = context.WithValue(streamCtx, streamActivityContextKey{}, activity)
	events := make(chan openAIStreamEvent, 1)
	// Consume budget immediately before any HTTP generation; failed requests count.
	// The SDK has retries disabled, and exhaustion is not a retryable error.
	if a.maxRequests > 0 && a.requests.Add(1) > a.maxRequests {
		return harness.Completion{}, harness.NewProviderError("provider request budget exhausted", "BUDGET_EXHAUSTED", nil)
	}
	go a.pumpStream(streamCtx, params, events)
	timer := time.NewTimer(a.streamIdleTimeout)
	defer timer.Stop()
	assembly := newStreamAssembly()
	for {
		select {
		case event, open := <-events:
			if !open {
				if ctx.Err() != nil {
					return harness.Completion{}, ctx.Err()
				}
				return assembly.completion()
			}
			if event.err != nil {
				return harness.Completion{}, normalizeStreamError(ctx, event.err)
			}
			resetTimer(timer, a.streamIdleTimeout)
			chunk, consumeErr := assembly.consume(event.chunk)
			if consumeErr != nil {
				return harness.Completion{}, consumeErr
			}
			if emit != nil && (len(chunk.Content) > 0 || chunk.Usage != nil) {
				if emitErr := emit(chunk); emitErr != nil {
					return harness.Completion{}, emitErr
				}
			}
		case <-timer.C:
			select {
			case <-activity:
				timer.Reset(a.streamIdleTimeout)
				continue
			default:
			}
			if err := ctx.Err(); err != nil {
				return harness.Completion{}, err
			}
			cancelStream()
			return harness.Completion{}, harness.NewProviderError(
				fmt.Sprintf("openai adapter: provider stream idle timeout after %dms", a.streamIdleTimeout.Milliseconds()),
				"TIMEOUT", context.DeadlineExceeded,
			)
		case <-ctx.Done():
			return harness.Completion{}, ctx.Err()
		case <-activity:
			resetTimer(timer, a.streamIdleTimeout)
		}
	}
}

type openAIStreamEvent struct {
	chunk openaisdk.ChatCompletionChunk
	err   error
}
