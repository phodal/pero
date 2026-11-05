// Contract algorithms ported from DeepSeek DSH (MIT); see
// DEEPSEEK_FILES_LICENSE.txt for the retained notice.
package model

import "fmt"

// ToolHistory is capability-independent durable declaration history. Current
// request tools remain a separate value: removal does not erase old schemas.
type ToolHistory struct {
	Tools   []ToolSchema        `json:"tools"`
	Updates []ToolHistoryUpdate `json:"updates"`
}
type ToolHistoryUpdate struct {
	MessageID string       `json:"messageId"`
	Additions []ToolSchema `json:"additions"`
}
type ProjectedToolUpdates struct {
	Messages []Message    `json:"messages"`
	Tools    []ToolSchema `json:"tools,omitempty"`
}

func CloneToolSchemas(tools []ToolSchema) []ToolSchema {
	if tools == nil {
		return nil
	}
	result := make([]ToolSchema, len(tools))
	copy(result, tools)
	for i := range result {
		result[i].Catalog = CloneCatalogText(tools[i].Catalog)
		result[i].InputSchema = append(result[i].InputSchema[:0:0], tools[i].InputSchema...)
		result[i].OutputSchema = append(result[i].OutputSchema[:0:0], tools[i].OutputSchema...)
		result[i].OutputProjectionConfig = append(result[i].OutputProjectionConfig[:0:0], tools[i].OutputProjectionConfig...)
	}
	return result
}
func CloneToolHistory(history *ToolHistory) *ToolHistory {
	if history == nil {
		return nil
	}
	out := &ToolHistory{Tools: CloneToolSchemas(history.Tools), Updates: make([]ToolHistoryUpdate, len(history.Updates))}
	for i, update := range history.Updates {
		out.Updates[i] = ToolHistoryUpdate{MessageID: update.MessageID, Additions: CloneToolSchemas(update.Additions)}
	}
	return out
}

// ProjectToolUpdates implements the fixed source llm/content.ts projection.
// It never mutates durable messages, schemas or the caller's history snapshot.
func ProjectToolUpdates(messages []Message, tools []ToolSchema, mode string, history *ToolHistory) (ProjectedToolUpdates, error) {
	if mode != "" && mode != "in-history" && mode != "addition-only" {
		return ProjectedToolUpdates{}, fmt.Errorf("unsupported tool update mode %q", mode)
	}
	fallback := func(immediate bool) ProjectedToolUpdates {
		out := ProjectedToolUpdates{Messages: make([]Message, 0, len(messages)), Tools: CloneToolSchemas(tools)}
		for _, message := range messages {
			if message.Role != RoleDeveloper {
				out.Messages = append(out.Messages, CloneMessage(message))
			}
		}
		if immediate {
			for i := range out.Tools {
				out.Tools[i].DeferLoading = false
			}
		}
		return out
	}
	if mode == "" {
		return fallback(true), nil
	}
	if history == nil {
		return fallback(false), nil
	}
	ids := map[string]bool{}
	for _, message := range messages {
		if message.Role == RoleDeveloper {
			ids[message.ID] = true
		}
	}
	for _, update := range history.Updates {
		if !ids[update.MessageID] {
			return fallback(false), nil
		}
	}
	declarations := map[string]ToolSchema{}
	order := []string{}
	for _, tool := range history.Tools {
		if _, exists := declarations[tool.Name]; !exists {
			order = append(order, tool.Name)
		}
		declarations[tool.Name] = tool
	}
	for _, update := range history.Updates {
		for _, tool := range update.Additions {
			if _, exists := declarations[tool.Name]; !exists {
				tool.DeferLoading = true
				declarations[tool.Name] = tool
				order = append(order, tool.Name)
			}
		}
	}
	if mode == "addition-only" {
		active := map[string]bool{}
		for _, tool := range tools {
			active[tool.Name] = true
		}
		for name := range declarations {
			if !active[name] {
				delete(declarations, name)
			}
		}
	}
	updates := map[string]bool{}
	for _, update := range history.Updates {
		updates[update.MessageID] = true
	}
	offered := map[string]bool{}
	for _, tool := range history.Tools {
		if !tool.DeferLoading {
			offered[tool.Name] = true
		}
	}
	out := ProjectedToolUpdates{Messages: make([]Message, 0, len(messages)), Tools: []ToolSchema{}}
	for _, message := range messages {
		if message.Role != RoleDeveloper {
			out.Messages = append(out.Messages, CloneMessage(message))
			continue
		}
		if !updates[message.ID] {
			continue
		}
		copy := CloneMessage(message)
		copy.Content = copy.Content[:0]
		for _, block := range message.Content {
			switch block.Type {
			case BlockToolAddition:
				if _, declared := declarations[block.ToolName]; !declared || offered[block.ToolName] {
					continue
				}
				offered[block.ToolName] = true
			case BlockToolRemoval:
				if mode != "in-history" || !offered[block.ToolName] {
					continue
				}
				delete(offered, block.ToolName)
			}
			copy.Content = append(copy.Content, CloneContentBlock(block))
		}
		if len(copy.Content) > 0 {
			out.Messages = append(out.Messages, copy)
		}
	}
	for _, name := range order {
		if tool, exists := declarations[name]; exists {
			out.Tools = append(out.Tools, tool)
		}
	}
	out.Tools = CloneToolSchemas(out.Tools)
	return out, nil
}
