package messages

import (
	"encoding/json"
	"errors"
	"math"
	"strings"

	"github.com/phodal/pero/harness/go/model"
)

// Request is a provider wire value.
type Request struct {
	Model       string   `json:"model"`
	System      string   `json:"system,omitempty"`
	MaxTokens   int      `json:"max_tokens"`
	Temperature *float64 `json:"temperature,omitempty"`
	Stop        []string `json:"stop_sequences,omitempty"`
	Stream      bool     `json:"stream"`
	Thinking    struct {
		Type string `json:"type"`
	} `json:"thinking"`
	Messages []requestMessage `json:"messages"`
	Tools    []requestTool    `json:"tools,omitempty"`
}

type requestMessage struct {
	Role    model.Role     `json:"role"`
	Content []requestBlock `json:"content"`
}

type requestBlock struct {
	Type      string           `json:"type"`
	Text      string           `json:"text,omitempty"`
	Thinking  *string          `json:"thinking,omitempty"`
	Signature string           `json:"signature,omitempty"`
	ID        model.ToolCallID `json:"id,omitempty"`
	Name      string           `json:"name,omitempty"`
	Input     json.RawMessage  `json:"input,omitempty"`
	ToolUseID model.ToolCallID `json:"tool_use_id,omitempty"`
	Content   []requestBlock   `json:"content,omitempty"`
	Source    *ImageSource     `json:"source,omitempty"`
	IsError   bool             `json:"is_error,omitempty"`
}

// ImageSource is the Messages representation of an already admitted raster.
type ImageSource struct {
	Type      string `json:"type"`
	MediaType string `json:"media_type"`
	Data      []byte `json:"data"`
}

// ImageEncoder owns image admission and per-request budgets outside the codec.
type ImageEncoder func(model.ContentBlock) (ImageSource, error)

type requestTool struct {
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	Schema      json.RawMessage `json:"input_schema"`
}

func Encode(modelID, system string, maxTokens int, temperature *float64, stop []string, history []model.Message, tools []model.ToolSchema) (Request, error) {
	return encode(modelID, system, maxTokens, temperature, stop, history, tools, ReplayRoute{}, nil)
}

// EncodeSigned explicitly selects thinking mode and permits replay only on
// the same locally admitted route. A different route receives neither the
// signed block nor the reasoning text; normal text/tools are preserved.
func EncodeSigned(route ReplayRoute, system string, maxTokens int, temperature *float64, stop []string, history []model.Message, tools []model.ToolSchema) (Request, error) {
	if !route.valid() {
		return Request{}, errors.New("messages: signed thinking requires an explicit route")
	}
	return encode(route.Model, system, maxTokens, temperature, stop, history, tools, route, nil)
}

// EncodeVision adds image representation to the same signed or plain history
// codec. The adapter resolves only inert, bounded raster bytes.
func EncodeVision(modelID, system string, maxTokens int, temperature *float64, stop []string, history []model.Message, tools []model.ToolSchema, route ReplayRoute, images ImageEncoder) (Request, error) {
	if images == nil || (route != (ReplayRoute{}) && (!route.valid() || route.Model != modelID)) {
		return Request{}, errors.New("messages: invalid vision request configuration")
	}
	return encode(modelID, system, maxTokens, temperature, stop, history, tools, route, images)
}

func encode(modelID, system string, maxTokens int, temperature *float64, stop []string, history []model.Message, tools []model.ToolSchema, route ReplayRoute, images ImageEncoder) (Request, error) {
	var zero Request
	if modelID == "" || maxTokens < 1 || (temperature != nil && (math.IsNaN(*temperature) || *temperature < 0 || *temperature > 2)) {
		return zero, errors.New("messages: invalid generation controls")
	}
	r := Request{Model: modelID, MaxTokens: maxTokens, Temperature: temperature, Stop: stop, Stream: true}
	r.Thinking.Type = "disabled"
	if route.valid() {
		r.Thinking.Type = "enabled"
	}
	imageBlock := func(b model.ContentBlock) (requestBlock, error) {
		if images == nil {
			return requestBlock{}, errors.New("messages: image input is not enabled for this model")
		}
		source, err := images(b)
		return requestBlock{Type: "image", Source: &source}, err
	}
	var instructions []string
	if system != "" {
		instructions = append(instructions, system)
	}
	pending := map[model.ToolCallID]bool{}
	for _, m := range history {
		if len(pending) != 0 && m.Role != model.RoleTool {
			return zero, errors.New("messages: missing adjacent tool results")
		}
		role := m.Role
		if role == model.RoleTool {
			role = model.RoleUser
		}
		var content []requestBlock
		for _, b := range m.Content {
			if b.Type == model.BlockReasoning && m.Role == model.RoleAssistant && route.valid() {
				replay, keep, err := replayThinking(b, route)
				if err != nil {
					return zero, err
				}
				if keep {
					content = append(content, replay)
				}
				continue
			}
			if len(b.Extensions) != 0 {
				return zero, errors.New("messages: unsupported content extensions")
			}
			switch b.Type {
			case model.BlockText:
				switch m.Role {
				case model.RoleSystem, model.RoleDeveloper:
					if len(r.Messages) != 0 {
						return zero, errors.New("messages: in-conversation instructions are not supported")
					}
					instructions = append(instructions, b.Text)
				case model.RoleUser, model.RoleAssistant:
					if b.Text != "" {
						content = append(content, requestBlock{Type: "text", Text: b.Text})
					}
				default:
					return zero, errors.New("messages: unsupported text role")
				}
			case model.BlockImage:
				if m.Role != model.RoleUser {
					return zero, errors.New("messages: image input requires user or tool-result content")
				}
				encoded, err := imageBlock(b)
				if err != nil {
					return zero, err
				}
				content = append(content, encoded)
			case model.BlockToolCall:
				if m.Role != model.RoleAssistant || b.ToolCallID == "" || pending[b.ToolCallID] || b.Name == "" || !jsonObject(b.Arguments) {
					return zero, errors.New("messages: invalid tool use")
				}
				pending[b.ToolCallID] = true
				content = append(content, requestBlock{Type: "tool_use", ID: b.ToolCallID, Name: b.Name, Input: b.Arguments})
			case model.BlockToolResult:
				if m.Role != model.RoleTool || !pending[b.ToolCallID] {
					return zero, errors.New("messages: unmatched tool result")
				}
				result := requestBlock{Type: "tool_result", ToolUseID: b.ToolCallID, IsError: b.IsError}
				for _, part := range b.Content {
					if len(part.Extensions) != 0 {
						return zero, errors.New("messages: unsupported tool result content")
					}
					switch part.Type {
					case model.BlockText:
						if part.Text != "" {
							result.Content = append(result.Content, requestBlock{Type: "text", Text: part.Text})
						}
					case model.BlockImage:
						encoded, err := imageBlock(part)
						if err != nil {
							return zero, err
						}
						result.Content = append(result.Content, encoded)
					default:
						return zero, errors.New("messages: unsupported tool result content")
					}
				}
				delete(pending, b.ToolCallID)
				content = append(content, result)
			default:
				return zero, errors.New("messages: unsupported content kind")
			}
		}
		if len(content) == 0 {
			continue
		}
		if n := len(r.Messages); n != 0 && r.Messages[n-1].Role == role {
			r.Messages[n-1].Content = append(r.Messages[n-1].Content, content...)
		} else {
			if role == model.RoleAssistant && len(r.Messages) == 0 {
				return zero, errors.New("messages: history must begin with user content")
			}
			r.Messages = append(r.Messages, requestMessage{Role: role, Content: content})
		}
	}
	if len(pending) != 0 || len(r.Messages) == 0 || r.Messages[len(r.Messages)-1].Role != model.RoleUser {
		return zero, errors.New("messages: incomplete request history")
	}
	r.System = strings.Join(instructions, "\n\n")
	for _, tool := range tools {
		if tool.Name == "" || tool.DeferLoading || !jsonObject(tool.InputSchema) {
			return zero, errors.New("messages: unsupported tool declaration")
		}
		r.Tools = append(r.Tools, requestTool{Name: tool.Name, Description: tool.Description, Schema: tool.InputSchema})
	}
	return r, nil
}

// WireAccounting reports encoded tools and tool result blocks for the shared
// request receipt without exposing any content in that receipt.
func (r Request) WireAccounting() (tools []byte, resultBytes, results int) {
	if len(r.Tools) > 0 {
		tools, _ = json.Marshal(r.Tools)
	}
	for _, m := range r.Messages {
		for _, block := range m.Content {
			if block.Type == "tool_result" {
				b, _ := json.Marshal(block)
				resultBytes += len(b)
				results++
			}
		}
	}
	return
}
