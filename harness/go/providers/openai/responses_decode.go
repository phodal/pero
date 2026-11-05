package openai

import (
	"context"
	"encoding/json"
	"fmt"

	openaisdk "github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/packages/param"
	"github.com/openai/openai-go/v3/responses"
	"github.com/phodal/pero/harness/go/harness"
)

func decodeResponses(response *responses.Response) (harness.Completion, error) {
	assembly := newStreamAssembly()
	if response == nil {
		return harness.Completion{}, fmt.Errorf("missing Responses result")
	}
	if response.Status == "incomplete" && response.IncompleteDetails.Reason == "max_output_tokens" {
		assembly.finish = "length"
	} else if response.Status == "completed" && response.Error.Code == "" {
		assembly.finish = "stop"
	} else {
		return harness.Completion{}, harness.NewProviderError("Responses did not complete", harness.MalformedResponseCode, nil)
	}
	for _, output := range response.Output {
		var item responseItem
		if err := json.Unmarshal([]byte(output.RawJSON()), &item); err != nil {
			return harness.Completion{}, err
		}
		block := harness.ContentBlock{}
		switch item.Type {
		case "message":
			if item.Role != "assistant" {
				return harness.Completion{}, fmt.Errorf("unexpected Responses output role")
			}
			for _, part := range item.Content {
				if part.Type != "output_text" {
					return harness.Completion{}, harness.NewProviderError("unsupported Responses output content", harness.MalformedResponseCode, nil)
				}
			}
			block.Type, block.Text = harness.BlockText, responseText(item.Content)
		case "reasoning":
			if item.Summary == nil || item.EncryptedContent == "" {
				return harness.Completion{}, harness.NewProviderError("Responses omitted stateless reasoning replay data", harness.MalformedResponseCode, nil)
			}
			block.Type, block.Text = harness.BlockReasoning, responseSummary(item)
		case "function_call":
			block.Type, block.ToolCallID, block.Name = harness.BlockToolCall, harness.ToolCallID(item.CallID), item.Name
			if assembly.finish != "length" {
				assembly.finish = "tool_calls"
			}
		default:
			return harness.Completion{}, harness.NewProviderError("unsupported Responses output item", harness.MalformedResponseCode, nil)
		}
		raw, err := json.Marshal(item)
		if err != nil {
			return harness.Completion{}, err
		}
		block.Extensions = map[string]json.RawMessage{responseItemExtension: raw}
		assembly.blocks = append(assembly.blocks, assembledBlock{block: block, arguments: item.Arguments})
	}
	if response.JSON.Usage.Valid() {
		usage := openaisdk.CompletionUsage{PromptTokens: response.Usage.InputTokens, CompletionTokens: response.Usage.OutputTokens, TotalTokens: response.Usage.TotalTokens}
		usage.JSON.PromptTokens = response.Usage.JSON.InputTokens
		usage.JSON.CompletionTokens = response.Usage.JSON.OutputTokens
		usage.JSON.TotalTokens = response.Usage.JSON.TotalTokens
		usage.PromptTokensDetails.CachedTokens = response.Usage.InputTokensDetails.CachedTokens
		usage.PromptTokensDetails.JSON.CachedTokens = response.Usage.InputTokensDetails.JSON.CachedTokens
		usage.CompletionTokensDetails.ReasoningTokens = response.Usage.OutputTokensDetails.ReasoningTokens
		usage.CompletionTokensDetails.JSON.ReasoningTokens = response.Usage.OutputTokensDetails.JSON.ReasoningTokens
		var err error
		assembly.usage, err = mapUsage(usage)
		if err != nil {
			return harness.Completion{}, harness.NewProviderError("malformed Responses usage", harness.MalformedResponseCode, err)
		}
	}
	return assembly.completion()
}

func (a *Adapter) pumpResponses(ctx context.Context, payload []byte, events chan<- openAIStreamEvent) {
	defer close(events)
	response, err := a.responses.New(ctx, param.Override[responses.ResponseNewParams](json.RawMessage(payload)))
	event := openAIStreamEvent{err: err}
	if err == nil {
		result, decodeErr := decodeResponses(response)
		event.decoded = true
		event.err = decodeErr
		if decodeErr == nil {
			event.completion = &result
		}
	}
	select {
	case events <- event:
	case <-ctx.Done():
	}
}
