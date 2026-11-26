package openai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	openaisdk "github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/packages/param"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/providers/messages"
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
	Stream          bool                    `json:"stream"`
	StreamOptions   *wireStreamOptions      `json:"stream_options,omitempty"`
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

func (a *Adapter) generate(ctx context.Context, request harness.GenerateRequest, emit func(harness.StreamChunk) error) (harness.Completion, error) {
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
	var body any
	var toolsPayload []byte
	toolResultBytes, toolResults := 0, 0
	imagesAllowed := slices.Contains(a.models[request.Model].InputModalities, "image")
	var messagesRoute messages.ReplayRoute
	if a.apiFormat == DeepSeekMessages {
		if request.MaxTokens == 0 {
			request.MaxTokens = a.models[request.Model].MaxTokens
		}
		var wire messages.Request
		var err error
		if a.messagesReplayScope != "" {
			messagesRoute = messages.ReplayRoute{Scope: a.messagesReplayScope, Model: request.Model}
			wire, err = messages.EncodeSigned(messagesRoute, request.System, request.MaxTokens, request.Temperature, request.Stop, request.Messages, request.Tools)
		} else {
			wire, err = messages.Encode(request.Model, request.System, request.MaxTokens, request.Temperature, request.Stop, request.Messages, request.Tools)
		}
		if err != nil {
			return harness.Completion{}, harness.NewProviderError(err.Error(), "INVALID_REQUEST", nil)
		}
		body = wire
		toolsPayload, toolResultBytes, toolResults = wire.WireAccounting()
	} else if a.apiFormat == Responses {
		wire, err := encodeResponses(request, imagesAllowed)
		if err != nil {
			return harness.Completion{}, err
		}
		body = wire
		if len(wire.Tools) > 0 {
			toolsPayload, _ = json.Marshal(wire.Tools)
		}
		for _, item := range wire.Input {
			if item.Type == "function_call_output" {
				encoded, _ := json.Marshal(item)
				toolResultBytes += len(encoded)
				toolResults++
			}
		}
	} else {
		wire, err := encodeRequest(request, imagesAllowed)
		if err != nil {
			return harness.Completion{}, err
		}
		if a.disableThinking {
			wire.Thinking = &wireThinking{Type: "disabled"}
		}
		if a.disableStreaming {
			wire.Stream, wire.StreamOptions = false, nil
		}
		body = wire
		if len(wire.Tools) > 0 {
			toolsPayload, _ = json.Marshal(wire.Tools)
		}
		for _, message := range wire.Messages {
			if message.Role == "tool" {
				encoded, _ := json.Marshal(message)
				toolResultBytes += len(encoded)
				toolResults++
			}
		}
	}
	payload, err := json.Marshal(body)
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
		return harness.Completion{}, harness.NewProviderError("provider request budget exhausted", harness.RequestBudgetExhaustedCode, nil)
	}
	if request.Agent != nil {
		hash := sha256.Sum256(payload)
		promptID, promptReceiptSeq := harness.PromptReceiptLink(ctx)
		_, err := request.Agent.Session().Append("request/wire-size", struct {
			Stage                  string `json:"stage"`
			Purpose                string `json:"purpose,omitempty"`
			Turn                   int    `json:"turn,omitempty"`
			Step                   int    `json:"step,omitempty"`
			PromptID               string `json:"promptId,omitempty"`
			PromptReceiptSeq       uint64 `json:"promptReceiptSeq,omitempty"`
			PayloadBytes           int    `json:"payload_bytes"`
			ToolsBytes             int    `json:"tools_bytes"`
			ToolResultMessageBytes int    `json:"tool_result_message_bytes"`
			ToolResults            int    `json:"tool_results"`
			SHA256                 string `json:"payload_sha256"`
		}{"prepared_for_http", request.Purpose, request.Turn, request.Step, promptID, promptReceiptSeq, len(payload), len(toolsPayload), toolResultBytes, toolResults, hex.EncodeToString(hash[:])})
		if err != nil {
			return harness.Completion{}, err
		}
		if err := request.Agent.Session().Flush(ctx); err != nil {
			return harness.Completion{}, err
		}
	}
	if a.apiFormat == DeepSeekMessages {
		go a.pumpMessages(streamCtx, payload, messagesRoute, events)
	} else if a.apiFormat == Responses {
		go a.pumpResponses(streamCtx, payload, events)
	} else if a.disableStreaming {
		go a.pumpCompletion(streamCtx, params, events)
	} else {
		go a.pumpStream(streamCtx, params, events)
	}
	timer := time.NewTimer(a.streamIdleTimeout)
	defer timer.Stop()
	assembly := newStreamAssembly()
	observedStream := false
	for {
		select {
		case event, open := <-events:
			if !open {
				if ctx.Err() != nil {
					return harness.Completion{}, ctx.Err()
				}
				if a.apiFormat == DeepSeekMessages {
					return harness.Completion{}, harness.NewProviderError("messages adapter: missing terminal completion", harness.StreamClosedCode, nil)
				}
				return assembly.completion()
			}
			if event.err != nil {
				if event.decoded {
					return harness.Completion{}, event.err
				}
				return harness.Completion{}, normalizeStreamError(ctx, event.err)
			}
			if event.completion != nil {
				if emit != nil && a.apiFormat != DeepSeekMessages {
					chunk := harness.StreamChunk{Usage: event.completion.Usage}
					for _, block := range event.completion.Message.Content {
						block.Extensions = nil
						if block.Type == harness.BlockToolCall {
							block.ArgumentsDelta = string(block.Arguments)
							block.Arguments = nil
						}
						chunk.Content = append(chunk.Content, block)
					}
					if err := emit(chunk); err != nil {
						return harness.Completion{}, err
					}
				}
				if err := ctx.Err(); err != nil {
					return harness.Completion{}, err
				}
				return *event.completion, nil
			}
			resetTimer(timer, a.streamIdleTimeout)
			if event.delta != nil {
				observedStream = true
				if emit != nil {
					if err := emit(*event.delta); err != nil {
						return harness.Completion{}, err
					}
				}
				continue
			}
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
				observedStream = true
				timer.Reset(a.streamIdleTimeout)
				continue
			default:
			}
			if err := ctx.Err(); err != nil {
				return harness.Completion{}, err
			}
			cancelStream()
			if observedStream && a.apiFormat == DeepSeekMessages {
				return harness.Completion{}, harness.NewProviderError("messages adapter: idle timeout after response data", harness.StreamClosedCode, nil)
			}
			return harness.Completion{}, harness.NewProviderError(
				fmt.Sprintf("openai adapter: provider stream idle timeout after %dms", a.streamIdleTimeout.Milliseconds()),
				"TIMEOUT", context.DeadlineExceeded,
			)
		case <-ctx.Done():
			return harness.Completion{}, ctx.Err()
		case <-activity:
			observedStream = true
			resetTimer(timer, a.streamIdleTimeout)
		}
	}
}

type openAIStreamEvent struct {
	delta      *harness.StreamChunk
	decoded    bool
	completion *harness.Completion
	chunk      openaisdk.ChatCompletionChunk
	err        error
}
