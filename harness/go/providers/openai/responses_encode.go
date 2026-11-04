package openai

import (
	"bytes"
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"github.com/phodal/pero/harness/go/harness"
)

const responseItemExtension = "openai.responses.item"

type responseContent struct {
	Type        string             `json:"type"`
	Text        string             `json:"text,omitempty"`
	ImageURL    string             `json:"image_url,omitempty"`
	Detail      string             `json:"detail,omitempty"`
	Annotations *[]json.RawMessage `json:"annotations,omitempty"`
}

type responseItem struct {
	Type             string             `json:"type"`
	ID               string             `json:"id,omitempty"`
	Role             string             `json:"role,omitempty"`
	Status           string             `json:"status,omitempty"`
	Phase            string             `json:"phase,omitempty"`
	Content          []responseContent  `json:"content,omitempty"`
	Summary          *[]responseContent `json:"summary,omitempty"`
	EncryptedContent string             `json:"encrypted_content,omitempty"`
	CallID           string             `json:"call_id,omitempty"`
	Name             string             `json:"name,omitempty"`
	Arguments        string             `json:"arguments,omitempty"`
	Output           any                `json:"output,omitempty"`
}

type responseTool struct {
	Type        string          `json:"type"`
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	Parameters  json.RawMessage `json:"parameters"`
	Strict      bool            `json:"strict"`
}

type responsesReasoning struct {
	Effort harness.ReasoningEffort `json:"effort"`
}

type responseRequest struct {
	Model           string              `json:"model"`
	Input           []responseItem      `json:"input"`
	Tools           []responseTool      `json:"tools,omitempty"`
	MaxOutputTokens int                 `json:"max_output_tokens,omitempty"`
	Temperature     *float64            `json:"temperature,omitempty"`
	Reasoning       *responsesReasoning `json:"reasoning,omitempty"`
	Store           bool                `json:"store"`
	Stream          bool                `json:"stream"`
	Include         []string            `json:"include"`
}

func responseText(parts []responseContent) string {
	var text strings.Builder
	for _, part := range parts {
		text.WriteString(part.Text)
	}
	return text.String()
}

func responseSummary(item responseItem) string {
	if item.Summary == nil {
		return ""
	}
	return responseText(*item.Summary)
}

func encodeResponses(request harness.GenerateRequest, imagesAllowed bool) (responseRequest, error) {
	result := responseRequest{Model: request.Model, MaxOutputTokens: request.MaxTokens, Temperature: request.Temperature, Include: []string{"reasoning.encrypted_content"}}
	if len(request.Stop) > 0 {
		return result, fmt.Errorf("Responses does not support Chat stop sequences")
	}
	if request.ReasoningEffort != "" {
		result.Reasoning = &responsesReasoning{Effort: request.ReasoningEffort}
	}
	// Preserve only this adapter's typed replay metadata. All remaining controls,
	// content and tool/image bounds pass through the existing request validator.
	clean := request
	clean.Messages = slices.Clone(request.Messages)
	var assistantItems [][]responseItem
	for index, message := range request.Messages {
		clean.Messages[index].Content = slices.Clone(message.Content)
		var replay []responseItem
		for j, block := range message.Content {
			item := responseItem{}
			if len(block.Extensions) > 0 {
				raw, ok := block.Extensions[responseItemExtension]
				if message.Role != harness.RoleAssistant || !ok || len(block.Extensions) != 1 || json.Unmarshal(raw, &item) != nil {
					return result, fmt.Errorf("unsupported Responses replay metadata")
				}
				switch block.Type {
				case harness.BlockText:
					if item.Type != "message" || item.Role != "assistant" || responseText(item.Content) != block.Text {
						return result, fmt.Errorf("Responses text replay differs from its committed block")
					}
				case harness.BlockReasoning:
					if item.Type != "reasoning" || responseSummary(item) != block.Text {
						return result, fmt.Errorf("Responses reasoning replay differs from its committed block")
					}
				case harness.BlockToolCall:
					if item.Type != "function_call" || item.CallID != string(block.ToolCallID) || item.Name != block.Name || !sameJSON(item.Arguments, block.Arguments) {
						return result, fmt.Errorf("Responses call replay differs from its committed block")
					}
				default:
					return result, fmt.Errorf("unsupported Responses replay block")
				}
				clean.Messages[index].Content[j].Extensions = nil
			}
			if message.Role == harness.RoleAssistant {
				if item.Type == "" {
					switch block.Type {
					case harness.BlockText:
						item = responseItem{Type: "message", Role: "assistant", Status: "completed", Content: []responseContent{{Type: "output_text", Text: block.Text, Annotations: &[]json.RawMessage{}}}}
					case harness.BlockToolCall:
						item = responseItem{Type: "function_call", CallID: string(block.ToolCallID), Name: block.Name, Arguments: string(block.Arguments)}
					case harness.BlockReasoning:
						return result, fmt.Errorf("Responses reasoning requires durable replay metadata")
					default:
						return result, fmt.Errorf("unsupported Responses assistant content")
					}
				}
				replay = append(replay, item)
			}
		}
		if message.Role == harness.RoleAssistant {
			assistantItems = append(assistantItems, replay)
		}
	}
	wire, err := encodeRequest(clean, imagesAllowed)
	if err != nil {
		return result, err
	}
	assistant := 0
	for _, message := range wire.Messages {
		if message.Role == "assistant" {
			result.Input = append(result.Input, assistantItems[assistant]...)
			assistant++
			continue
		}
		content := []responseContent{}
		switch value := message.Content.(type) {
		case string:
			content = append(content, responseContent{Type: "input_text", Text: value})
		case []wireContentPart:
			for _, part := range value {
				switch part.Type {
				case "text":
					content = append(content, responseContent{Type: "input_text", Text: part.Text})
				case "image_url":
					content = append(content, responseContent{Type: "input_image", ImageURL: part.ImageURL.URL, Detail: "auto"})
				default:
					return result, fmt.Errorf("unsupported Responses input part")
				}
			}
		case nil:
		default:
			return result, fmt.Errorf("unsupported Responses message content")
		}
		if message.Role == "tool" {
			var output any = content
			if len(content) == 1 && content[0].Type == "input_text" {
				output = content[0].Text
			}
			result.Input = append(result.Input, responseItem{Type: "function_call_output", CallID: message.ToolCallID, Output: output})
		} else {
			result.Input = append(result.Input, responseItem{Type: "message", Role: message.Role, Content: content})
		}
	}
	for _, tool := range wire.Tools {
		result.Tools = append(result.Tools, responseTool{Type: "function", Name: tool.Function.Name, Description: tool.Function.Description, Parameters: tool.Function.Parameters})
	}
	return result, nil
}

func sameJSON(text string, raw json.RawMessage) bool {
	var left, right bytes.Buffer
	if json.Compact(&left, []byte(text)) != nil || json.Compact(&right, raw) != nil {
		return false
	}
	return bytes.Equal(left.Bytes(), right.Bytes())
}
