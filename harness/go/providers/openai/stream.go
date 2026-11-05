package openai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"mime"
	"net/http"
	"time"

	openaisdk "github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/packages/respjson"
	"github.com/phodal/pero/harness/go/harness"
)

func (a *Adapter) pumpStream(ctx context.Context, params openaisdk.ChatCompletionNewParams, events chan<- openAIStreamEvent) {
	defer close(events)
	stream := a.client.NewStreaming(ctx, params)
	defer stream.Close()
	for stream.Next() {
		select {
		case events <- openAIStreamEvent{chunk: stream.Current()}:
		case <-ctx.Done():
			return
		}
	}
	if err := stream.Err(); err != nil {
		select {
		case events <- openAIStreamEvent{err: err}:
		case <-ctx.Done():
		}
	}
}

func resetTimer(timer *time.Timer, timeout time.Duration) {
	if !timer.Stop() {
		select {
		case <-timer.C:
		default:
		}
	}
	timer.Reset(timeout)
}

type assembledBlock struct {
	block     harness.ContentBlock
	arguments string
}

type streamAssembly struct {
	blocks         []assembledBlock
	reasoningIndex int
	textIndex      int
	toolIndexes    map[int64]int
	finish         string
	usage          *harness.TokenUsage
}

func newStreamAssembly() *streamAssembly {
	return &streamAssembly{reasoningIndex: -1, textIndex: -1, toolIndexes: make(map[int64]int)}
}

func (a *streamAssembly) consume(chunk openaisdk.ChatCompletionChunk) (harness.StreamChunk, error) {
	emitted := harness.StreamChunk{}
	for _, choice := range chunk.Choices {
		if choice.Index != 0 {
			return harness.StreamChunk{}, harness.NewProviderError("multiple response choices are unsupported", harness.MalformedResponseCode, nil)
		}
		reasoning, err := extraString(choice.Delta.JSON.ExtraFields, "reasoning_content")
		if err != nil {
			return harness.StreamChunk{}, harness.NewProviderError("openai adapter: malformed reasoning delta", harness.MalformedResponseCode, err)
		}
		if reasoning != "" {
			if a.reasoningIndex < 0 {
				a.reasoningIndex = len(a.blocks)
				a.blocks = append(a.blocks, assembledBlock{block: harness.ContentBlock{Type: harness.BlockReasoning}})
			}
			a.blocks[a.reasoningIndex].block.Text += reasoning
			emitted.Content = append(emitted.Content, harness.ContentBlock{Type: harness.BlockReasoning, Text: reasoning})
		}
		if choice.Delta.Content != "" {
			if a.textIndex < 0 {
				a.textIndex = len(a.blocks)
				a.blocks = append(a.blocks, assembledBlock{block: harness.ContentBlock{Type: harness.BlockText}})
			}
			a.blocks[a.textIndex].block.Text += choice.Delta.Content
			emitted.Content = append(emitted.Content, harness.ContentBlock{Type: harness.BlockText, Text: choice.Delta.Content})
		}
		for _, call := range choice.Delta.ToolCalls {
			blockIndex, exists := a.toolIndexes[call.Index]
			if !exists {
				blockIndex = len(a.blocks)
				a.toolIndexes[call.Index] = blockIndex
				a.blocks = append(a.blocks, assembledBlock{block: harness.ContentBlock{Type: harness.BlockToolCall}})
			}
			block := &a.blocks[blockIndex]
			if call.ID != "" {
				block.block.ToolCallID = harness.ToolCallID(call.ID)
			}
			if call.Function.Name != "" {
				block.block.Name = call.Function.Name
			}
			block.arguments += call.Function.Arguments
			emitted.Content = append(emitted.Content, harness.ContentBlock{
				Type: harness.BlockToolCall, ToolCallID: block.block.ToolCallID,
				Name: block.block.Name, ArgumentsDelta: call.Function.Arguments,
			})
		}
		if choice.FinishReason != "" {
			a.finish = choice.FinishReason
		}
	}
	if chunk.JSON.Usage.Valid() {
		usage, err := mapUsage(chunk.Usage)
		if err != nil {
			return harness.StreamChunk{}, harness.NewProviderError("openai adapter: malformed usage", harness.MalformedResponseCode, err)
		}
		a.usage = usage
		emitted.Usage = a.usage
	}
	return emitted, nil
}

func (a *streamAssembly) completion() (harness.Completion, error) {
	if len(a.blocks) == 0 && a.finish != "length" {
		return harness.Completion{}, harness.NewProviderError(
			"openai adapter: model returned a completed response with no content",
			harness.EmptyResponseCode,
			nil,
		)
	}
	blocks := make([]harness.ContentBlock, 0, len(a.blocks))
	for _, assembled := range a.blocks {
		block := assembled.block
		if block.Type == harness.BlockToolCall {
			// Match the upstream assembler: output truncation never dispatches
			// tool calls, even when an earlier call happened to finish its JSON.
			if a.finish == "length" {
				continue
			}
			if block.ToolCallID == "" || block.Name == "" || a.finish != "tool_calls" {
				return harness.Completion{}, harness.NewProviderError("incomplete tool call", harness.MalformedResponseCode, nil)
			}
			var object map[string]json.RawMessage
			if json.Unmarshal([]byte(assembled.arguments), &object) != nil || object == nil {
				return harness.Completion{}, harness.NewProviderError("tool arguments must be a JSON object", harness.MalformedResponseCode, nil)
			}
			arguments := json.RawMessage(assembled.arguments)
			if !json.Valid(arguments) {
				return harness.Completion{}, harness.NewProviderError(
					"openai adapter: tool returned malformed arguments",
					harness.MalformedResponseCode,
					nil,
				)
			}
			block.Arguments = arguments
		}
		blocks = append(blocks, block)
	}
	finish, err := finishKind(a.finish)
	if err != nil {
		return harness.Completion{}, err
	}
	return harness.Completion{
		Message: harness.Message{Role: harness.RoleAssistant, Content: blocks},
		Finish:  finish, Usage: a.usage,
	}, nil
}

func mapUsage(usage openaisdk.CompletionUsage) (*harness.TokenUsage, error) {
	cacheRead := usage.PromptTokensDetails.CachedTokens
	if !usage.PromptTokensDetails.JSON.CachedTokens.Valid() {
		hit, err := extraInt64(usage.JSON.ExtraFields, "prompt_cache_hit_tokens")
		if err != nil {
			return nil, err
		}
		if hit != nil {
			cacheRead = *hit
		}
	}
	cacheWrite := usage.PromptTokensDetails.CacheWriteTokens
	reasoning := usage.CompletionTokensDetails.ReasoningTokens
	// Validate wire counters once before subtraction, addition, or int conversion.
	// Upstream accepts only nonnegative safe integers; the Go model must also fit
	// the native int width on every supported target.
	limit := min(int64(^uint(0)>>1), int64(1<<53-1))
	for _, counter := range []struct {
		value int64
		field respjson.Field
	}{
		{usage.PromptTokens, usage.JSON.PromptTokens},
		{usage.CompletionTokens, usage.JSON.CompletionTokens},
		{usage.TotalTokens, usage.JSON.TotalTokens},
		{cacheRead, usage.PromptTokensDetails.JSON.CachedTokens},
		{cacheWrite, usage.PromptTokensDetails.JSON.CacheWriteTokens},
		{reasoning, usage.CompletionTokensDetails.JSON.ReasoningTokens},
	} {
		// The SDK coerces numeric strings and fractional numbers into int64.
		// Inspect supplied wire values rather than accepting that coercion.
		if raw := counter.field.Raw(); raw != "" && raw != respjson.Null {
			var number float64
			if err := json.Unmarshal([]byte(raw), &number); err != nil || math.Trunc(number) != number {
				return nil, errors.New("usage counters must be integers")
			}
		}
		if counter.value < 0 || counter.value > limit {
			return nil, errors.New("usage counters must be nonnegative safe integers")
		}
	}
	if cacheRead > usage.PromptTokens || usage.PromptTokens > limit-usage.CompletionTokens {
		return nil, errors.New("usage counters exceed their prompt or total bound")
	}
	total := 0
	combined := usage.PromptTokens + usage.CompletionTokens
	if !usage.JSON.TotalTokens.Valid() || usage.TotalTokens == combined {
		total = int(combined)
	}
	return &harness.TokenUsage{
		InputTokens: int(usage.PromptTokens - cacheRead), OutputTokens: int(usage.CompletionTokens),
		TotalTokens: total, CacheReadTokens: int(cacheRead), CacheWriteTokens: int(cacheWrite),
		ReasoningTokens: int(reasoning),
	}, nil
}

func extraString(fields map[string]respjson.Field, name string) (string, error) {
	field, exists := fields[name]
	if !exists || field.Raw() == "" || field.Raw() == respjson.Null {
		return "", nil
	}
	var value string
	if err := json.Unmarshal([]byte(field.Raw()), &value); err != nil {
		return "", err
	}
	return value, nil
}

func extraInt64(fields map[string]respjson.Field, name string) (*int64, error) {
	field, exists := fields[name]
	if !exists || field.Raw() == "" || field.Raw() == respjson.Null {
		return nil, nil
	}
	var value int64
	if err := json.Unmarshal([]byte(field.Raw()), &value); err != nil {
		return nil, err
	}
	return &value, nil
}

func finishKind(reason string) (harness.FinishKind, error) {
	switch reason {
	case "":
		return "", harness.NewProviderError("provider omitted finish reason", harness.MalformedResponseCode, nil)
	case "stop":
		return harness.FinishStop, nil
	case "tool_calls":
		return harness.FinishToolCalls, nil
	case "length":
		return harness.FinishMaxTokens, nil
	default:
		return "", harness.NewProviderError("provider returned an unsupported finish reason", harness.MalformedResponseCode, nil)
	}
}

type terminalCheckingTransport struct {
	next         http.RoundTripper
	nonStreaming bool
}

type streamActivityContextKey struct{}

func (t terminalCheckingTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	response, err := t.next.RoundTrip(request)
	if err != nil {
		return nil, err
	}
	mediaType, _, _ := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if response.Body != nil {
		response.Body = &boundedResponseBody{ReadCloser: response.Body}
	}
	expectedType := "text/event-stream"
	if t.nonStreaming {
		expectedType = "application/json"
	}
	if response.StatusCode >= 200 && response.StatusCode < 300 && mediaType != expectedType {
		if response.Body != nil {
			_ = response.Body.Close()
		}
		return nil, errors.New("provider returned an unexpected success response content type")
	}
	if response.StatusCode >= 200 && response.StatusCode < 300 && response.Body != nil {
		body := response.Body
		if activity, ok := request.Context().Value(streamActivityContextKey{}).(chan struct{}); ok {
			body = &activityReadCloser{ReadCloser: body, activity: activity}
		}
		if !t.nonStreaming {
			body = &doneCheckingBody{ReadCloser: body}
		}
		response.Body = body
	}
	return response, nil
}

type boundedResponseBody struct {
	io.ReadCloser
	total int
}

func (b *boundedResponseBody) Read(p []byte) (int, error) {
	if b.total > 16*1024*1024 {
		return 0, errors.New("provider response exceeded bounded output")
	}
	if len(p) > 16*1024*1024-b.total+1 {
		p = p[:16*1024*1024-b.total+1]
	}
	n, err := b.ReadCloser.Read(p)
	b.total += n
	if b.total > 16*1024*1024 {
		return 0, errors.New("provider response exceeded bounded output")
	}
	return n, err
}

type activityReadCloser struct {
	io.ReadCloser
	activity chan<- struct{}
}

func (b *activityReadCloser) Read(target []byte) (int, error) {
	n, err := b.ReadCloser.Read(target)
	if n > 0 {
		select {
		case b.activity <- struct{}{}:
		default:
		}
	}
	return n, err
}

type doneCheckingBody struct {
	io.ReadCloser
	buffer      []byte
	pendingDone bool
	done        bool
	pendingErr  error
	total       int
}

func (b *doneCheckingBody) Read(target []byte) (int, error) {
	if b.pendingErr != nil {
		err := b.pendingErr
		b.pendingErr = nil
		return 0, err
	}
	n, err := b.ReadCloser.Read(target)
	if n > 0 {
		b.total += n
		if b.total > 16*1024*1024 || len(b.buffer)+n > 1024*1024 {
			return 0, errors.New("provider stream exceeded bounded output")
		}
		b.observe(target[:n])
	}
	if errors.Is(err, io.EOF) && !b.done {
		err = errStreamClosed
	}
	if n > 0 && err != nil {
		b.pendingErr = err
		return n, nil
	}
	return n, err
}

func (b *doneCheckingBody) observe(data []byte) {
	b.buffer = append(b.buffer, data...)
	for {
		newline := bytes.IndexByte(b.buffer, '\n')
		if newline < 0 {
			return
		}
		line := bytes.TrimSuffix(b.buffer[:newline], []byte{'\r'})
		b.buffer = b.buffer[newline+1:]
		if len(line) == 0 {
			if b.pendingDone {
				b.done = true
			}
			b.pendingDone = false
			continue
		}
		name, value, found := bytes.Cut(line, []byte{':'})
		if !found || !bytes.Equal(name, []byte("data")) {
			continue
		}
		value = bytes.TrimPrefix(value, []byte{' '})
		if bytes.Equal(value, []byte("[DONE]")) {
			b.pendingDone = true
		}
	}
}
