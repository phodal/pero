package openai

import (
	"encoding/json"
	"fmt"
	"github.com/phodal/pero/harness/go/harness"
	"math"
	"strings"
)

// Deliberately reject unsupported content instead of silently dropping attachments.
func encodeRequest(r harness.GenerateRequest, imagesAllowed bool) (wireRequest, error) {
	if r.MaxTokens < 0 || (r.Temperature != nil && (math.IsNaN(*r.Temperature) || math.IsInf(*r.Temperature, 0) || *r.Temperature < 0 || *r.Temperature > 2)) {
		return wireRequest{}, fmt.Errorf("invalid generation controls")
	}
	w := wireRequest{Model: r.Model, ReasoningEffort: r.ReasoningEffort, Temperature: r.Temperature, MaxTokens: r.MaxTokens, Stop: r.Stop, Stream: true, StreamOptions: wireStreamOptions{IncludeUsage: true}}
	imageBytes := 0
	if r.System != "" {
		w.Messages = append(w.Messages, wireMessage{Role: "system", Content: r.System})
	}
	for _, m := range r.Messages {
		out := wireMessage{Role: string(m.Role)}
		var reason strings.Builder
		var content []harness.ContentBlock
		switch m.Role {
		case harness.RoleSystem, harness.RoleDeveloper, harness.RoleUser, harness.RoleAssistant, harness.RoleTool:
		default:
			return w, fmt.Errorf("unsupported message role %q", m.Role)
		}
		for _, b := range m.Content {
			if len(b.Extensions) > 0 {
				return w, fmt.Errorf("unsupported content extensions")
			}
			switch b.Type {
			case harness.BlockText:
				if m.Role == harness.RoleTool {
					return w, fmt.Errorf("tool messages require tool results")
				}
				content = append(content, b)
			case harness.BlockImage:
				if m.Role != harness.RoleUser {
					return w, fmt.Errorf("image input requires user or tool-result content")
				}
				content = append(content, b)
			case harness.BlockReasoning:
				if m.Role != harness.RoleAssistant {
					return w, fmt.Errorf("reasoning requires assistant role")
				}
				reason.WriteString(b.Text)
			case harness.BlockToolCall:
				if m.Role != harness.RoleAssistant || b.ToolCallID == "" || b.Name == "" || !json.Valid(b.Arguments) {
					return w, fmt.Errorf("invalid tool call")
				}
				out.ToolCalls = append(out.ToolCalls, wireToolCall{ID: string(b.ToolCallID), Type: "function", Function: wireFunction{Name: b.Name, Arguments: string(b.Arguments)}})
			case harness.BlockToolResult:
				if m.Role != harness.RoleTool || b.ToolCallID == "" {
					return w, fmt.Errorf("invalid tool result")
				}
				// Tool images remain in the journal/ACP transcript for display.
				// Text-only providers receive an explicit visual-read limitation;
				// user image attachments still require declared image capability.
				toolContent := projectToolImages(b.Content, imagesAllowed, imageBytes)
				result, err := encodeContent(toolContent, imagesAllowed, &imageBytes)
				if err != nil {
					return w, err
				}
				w.Messages = append(w.Messages, wireMessage{Role: "tool", ToolCallID: string(b.ToolCallID), Content: result})
			default:
				return w, fmt.Errorf("unsupported content kind %q", b.Type)
			}
		}
		if m.Role != harness.RoleTool {
			var err error
			out.Content, err = encodeContent(content, imagesAllowed, &imageBytes)
			if err != nil {
				return w, err
			}
			out.ReasoningContent = reason.String()
			w.Messages = append(w.Messages, out)
		}
	}
	for _, t := range r.Tools {
		if t.Name == "" || !json.Valid(t.InputSchema) {
			return w, fmt.Errorf("invalid tool schema")
		}
		w.Tools = append(w.Tools, wireTool{Type: "function", Function: wireFunction{Name: t.Name, Description: t.Description, Parameters: t.InputSchema}})
	}
	return w, nil
}
