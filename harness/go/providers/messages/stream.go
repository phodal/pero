// Package messages implements the DeepSeek Messages wire contract independently
// of endpoint selection. It does not issue requests or execute tools.
package messages

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"

	"github.com/phodal/pero/harness/go/model"
)

const maxStreamBytes = 16 << 20

var ErrIncomplete = errors.New("messages: stream ended before a complete message")

type wireUsage struct {
	Input      *int `json:"input_tokens"`
	Output     *int `json:"output_tokens"`
	CacheRead  *int `json:"cache_read_input_tokens"`
	CacheWrite *int `json:"cache_creation_input_tokens"`
}

type wireEvent struct {
	Type    string `json:"type"`
	Index   *int   `json:"index"`
	Message *struct {
		Usage wireUsage `json:"usage"`
	} `json:"message"`
	Block *struct {
		Type, ID, Name string
		Text           *string
		Input          json.RawMessage
	} `json:"content_block"`
	Delta *struct {
		Type       string
		Text       *string
		Partial    *string `json:"partial_json"`
		StopReason string  `json:"stop_reason"`
	} `json:"delta"`
	Usage wireUsage `json:"usage"`
}

type streamedBlock struct {
	block   model.ContentBlock
	payload bytes.Buffer
	closed  bool
}

// ReadStream decodes text and tool-use SSE. Deltas are observations only: a
// tool call is eligible for execution only in a successfully decoded terminal
// Completion. Thinking signatures and other content types are not supported
// by this initial codec and are rejected, not lossy-translated.
func ReadStream(src io.Reader, emit func(model.StreamChunk) error) (model.Completion, error) {
	var zero model.Completion
	result := model.Completion{Message: model.Message{Role: model.RoleAssistant}}
	usage := model.TokenUsage{}
	blocks := make(map[int]*streamedBlock)
	var order []int
	var started bool
	toolIDs := make(map[model.ToolCallID]bool)
	var data bytes.Buffer
	var eventName string
	scanner := bufio.NewScanner(io.LimitReader(src, maxStreamBytes+1))
	scanner.Buffer(make([]byte, 4096), 1<<20)
	consumed := 0
	send := func(block model.ContentBlock) error {
		if emit == nil {
			return nil
		}
		return emit(model.StreamChunk{Content: []model.ContentBlock{block}})
	}
	mergeUsage := func(value wireUsage) error {
		for _, pair := range []struct{ from, to *int }{
			{value.Input, &usage.InputTokens}, {value.Output, &usage.OutputTokens},
			{value.CacheRead, &usage.CacheReadTokens}, {value.CacheWrite, &usage.CacheWriteTokens},
		} {
			if pair.from == nil {
				continue
			}
			if *pair.from < 0 || *pair.from > int(^uint(0)>>1)/4 || int64(*pair.from) > (1<<53-1)/4 {
				return errors.New("messages: invalid token usage")
			}
			*pair.to = *pair.from
		}
		return nil
	}
	for scanner.Scan() {
		line := scanner.Bytes()
		consumed += len(line) + 1
		if consumed > maxStreamBytes {
			return zero, errors.New("messages: stream exceeds byte limit")
		}
		if len(line) != 0 {
			field, value, _ := bytes.Cut(line, []byte(":"))
			value = bytes.TrimPrefix(value, []byte(" "))
			switch string(field) {
			case "event":
				eventName = string(value)
			case "data":
				if data.Len() != 0 {
					data.WriteByte('\n')
				}
				data.Write(value)
			}
			continue
		}
		if data.Len() == 0 {
			eventName = ""
			continue
		}
		var event wireEvent
		err := json.Unmarshal(data.Bytes(), &event)
		data.Reset()
		if err != nil || event.Type == "" || (eventName != "" && eventName != event.Type) {
			return zero, errors.New("messages: malformed SSE frame")
		}
		eventName = ""
		switch event.Type {
		case "ping":
			continue
		case "error":
			return zero, errors.New("messages: provider stream reported an error")
		case "message_start":
			if started || event.Message == nil {
				return zero, errors.New("messages: invalid message start")
			}
			if err := mergeUsage(event.Message.Usage); err != nil {
				return zero, err
			}
			started = true
			continue
		case "message_delta", "message_stop", "content_block_start", "content_block_delta", "content_block_stop":
			if !started {
				return zero, errors.New("messages: content precedes message start")
			}
		default:
			continue // Allow additive, non-content-bearing event types.
		}
		switch event.Type {
		case "content_block_start", "content_block_delta", "content_block_stop":
			if event.Index == nil || *event.Index < 0 || result.Finish != "" {
				return zero, errors.New("messages: invalid content block position")
			}
			index := *event.Index
			block := blocks[index]
			switch event.Type {
			case "content_block_start":
				if block != nil || event.Block == nil || len(order) >= 1024 {
					return zero, errors.New("messages: invalid or duplicate block start")
				}
				native := event.Block
				block = new(streamedBlock)
				switch native.Type {
				case "text":
					if native.Text == nil {
						return zero, errors.New("messages: missing initial text")
					}
					block.block = model.ContentBlock{Type: model.BlockText}
					block.payload.WriteString(*native.Text)
				case "tool_use":
					id := model.ToolCallID(native.ID)
					if id == "" || native.Name == "" || toolIDs[id] || !jsonObject(native.Input) {
						return zero, errors.New("messages: invalid tool identity or input")
					}
					toolIDs[id] = true
					block.block = model.ContentBlock{Type: model.BlockToolCall, ToolCallID: id, Name: native.Name, Arguments: native.Input}
				default:
					return zero, errors.New("messages: unsupported response content")
				}
				order = append(order, index)
				blocks[index] = block
				delta := block.block
				delta.Arguments = nil
				if delta.Type == model.BlockText {
					delta.Text = block.payload.String()
				}
				if err := send(delta); err != nil {
					return zero, err
				}
			case "content_block_delta":
				if block == nil || block.closed || event.Delta == nil {
					return zero, errors.New("messages: delta outside an open block")
				}
				delta := event.Delta
				var chunk model.ContentBlock
				switch {
				case block.block.Type == model.BlockText && delta.Type == "text_delta" && delta.Text != nil:
					block.payload.WriteString(*delta.Text)
					chunk = model.ContentBlock{Type: model.BlockText, Text: *delta.Text}
				case block.block.Type == model.BlockToolCall && delta.Type == "input_json_delta" && delta.Partial != nil:
					block.payload.WriteString(*delta.Partial)
					chunk = model.ContentBlock{Type: model.BlockToolCall, ToolCallID: block.block.ToolCallID,
						Name: block.block.Name, ArgumentsDelta: *delta.Partial}
				default:
					return zero, errors.New("messages: delta does not match block type")
				}
				if err := send(chunk); err != nil {
					return zero, err
				}
			case "content_block_stop":
				if block == nil || block.closed {
					return zero, errors.New("messages: stop outside an open block")
				}
				block.closed = true
			}
		case "message_delta":
			if event.Delta == nil {
				return zero, errors.New("messages: missing message delta")
			}
			if stop := event.Delta.StopReason; stop != "" {
				if result.Finish != "" {
					return zero, errors.New("messages: duplicate terminal reason")
				}
				switch stop {
				case "end_turn", "stop_sequence":
					result.Finish = model.FinishStop
				case "tool_use":
					result.Finish = model.FinishToolCalls
				case "max_tokens":
					result.Finish = model.FinishMaxTokens
				case "refusal":
					result.Finish = model.FinishRefusal
				default:
					return zero, errors.New("messages: unsupported stop reason")
				}
			}
			if err := mergeUsage(event.Usage); err != nil {
				return zero, err
			}
		case "message_stop":
			if result.Finish == "" || (result.Finish == model.FinishStop && len(order) == 0) {
				return zero, ErrIncomplete
			}
			for _, index := range order {
				block := blocks[index]
				if !block.closed {
					return zero, ErrIncomplete
				}
				if block.block.Type == model.BlockToolCall {
					if result.Finish == model.FinishMaxTokens || result.Finish == model.FinishRefusal {
						continue // Never publish a call from a truncated or refused response.
					}
					if block.payload.Len() != 0 {
						block.block.Arguments = block.payload.Bytes()
					}
					if !jsonObject(block.block.Arguments) {
						return zero, errors.New("messages: invalid completed tool input")
					}
				}
				if block.block.Type == model.BlockText {
					block.block.Text = block.payload.String()
				}
				if result.Finish != model.FinishRefusal {
					result.Message.Content = append(result.Message.Content, block.block)
				}
			}
			if (result.Finish == model.FinishToolCalls && len(toolIDs) == 0) || (result.Finish == model.FinishStop && len(toolIDs) != 0) {
				return zero, errors.New("messages: tool calls and terminal reason disagree")
			}
			usage.TotalTokens = usage.InputTokens + usage.OutputTokens + usage.CacheReadTokens + usage.CacheWriteTokens
			result.Usage = &usage
			return result, nil
		}
	}
	if err := scanner.Err(); err != nil {
		return zero, fmt.Errorf("messages: read stream: %w", err)
	}
	return zero, ErrIncomplete
}

func jsonObject(raw json.RawMessage) bool {
	raw = bytes.TrimSpace(raw)
	return len(raw) != 0 && raw[0] == '{' && json.Valid(raw)
}
