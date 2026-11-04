package openai

import (
	"context"

	openaisdk "github.com/openai/openai-go/v3"
	"github.com/phodal/pero/harness/go/harness"
)

// Complete responses enter the existing assembler once. This keeps argument,
// finish-reason, truncation and usage validation owned by that assembler.
func completionChunk(response *openaisdk.ChatCompletion) (openaisdk.ChatCompletionChunk, error) {
	chunk := openaisdk.ChatCompletionChunk{}
	if response == nil || len(response.Choices) != 1 {
		return chunk, harness.NewProviderError("expected one completion choice", harness.MalformedResponseCode, nil)
	}
	choice := response.Choices[0]
	delta := openaisdk.ChatCompletionChunkChoiceDelta{Content: choice.Message.Content}
	delta.JSON.ExtraFields = choice.Message.JSON.ExtraFields
	for index, call := range choice.Message.ToolCalls {
		if call.Type != "function" {
			return chunk, harness.NewProviderError("unsupported completion tool type", harness.MalformedResponseCode, nil)
		}
		delta.ToolCalls = append(delta.ToolCalls, openaisdk.ChatCompletionChunkChoiceDeltaToolCall{
			Index: int64(index), ID: call.ID, Type: call.Type,
			Function: openaisdk.ChatCompletionChunkChoiceDeltaToolCallFunction{
				Name: call.Function.Name, Arguments: call.Function.Arguments,
			},
		})
	}
	chunk.Choices = []openaisdk.ChatCompletionChunkChoice{{Index: choice.Index, Delta: delta, FinishReason: choice.FinishReason}}
	chunk.Usage, chunk.JSON.Usage = response.Usage, response.JSON.Usage
	return chunk, nil
}

func (a *Adapter) pumpCompletion(ctx context.Context, params openaisdk.ChatCompletionNewParams, events chan<- openAIStreamEvent) {
	defer close(events)
	response, err := a.client.New(ctx, params)
	event := openAIStreamEvent{err: err}
	if err == nil {
		event.chunk, event.err = completionChunk(response)
		event.decoded = true
	}
	select {
	case events <- event:
	case <-ctx.Done():
	}
}
