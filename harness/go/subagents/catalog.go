package subagents

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"unicode/utf8"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/model"
)

type agentCatalogItem struct {
	Name                 string `json:"name"`
	Description          string `json:"description"`
	Model                string `json:"model,omitempty"`
	Background           bool   `json:"background,omitempty"`
	DescriptionTruncated bool   `json:"description_truncated,omitempty"`
}

func (s *claudeDelegation) catalogNames() []string {
	names := make([]string, 0, len(s.definitions))
	for name := range s.definitions {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func (s *claudeDelegation) agentListTool() harness.Tool {
	return harness.Tool{
		Schema: harness.ToolSchema{
			Name:        "AgentList",
			Description: "List selected subagent definitions in name order with offset/limit (up to 128 rows) and next_offset. This operation only reads metadata. If description_truncated is true, call with the exact name and follow the UTF-8 byte offset/limit (up to 8192 bytes) and next_offset to recover its complete description. No agent is started and no tools or permissions are granted.",
			InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{"name":{"type":"string","minLength":1},"offset":{"type":"integer","minimum":0},"limit":{"type":"integer","minimum":1,"maximum":8192}}}`),
		},
		IsConcurrencySafe: func(context.Context, harness.ToolRequest) bool { return true },
		ExecuteRequest: func(_ context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
			var input struct {
				Name   string `json:"name"`
				Offset int    `json:"offset"`
				Limit  int    `json:"limit"`
			}
			if err := json.Unmarshal(request.Arguments, &input); err != nil {
				return harness.ToolResult{}, err
			}
			var value any
			if input.Name != "" {
				definition, ok := s.definitions[input.Name]
				if !ok {
					return harness.ToolResult{}, fmt.Errorf("subagents: unknown definition %q; call AgentList without name to list selected definitions", input.Name)
				}
				page, err := model.PaginateCatalogText(definition.Description, input.Offset, input.Limit)
				if err != nil {
					return harness.ToolResult{}, err
				}
				value = struct {
					Name string `json:"name"`
					model.CatalogTextRange
				}{input.Name, page}
			} else {
				rows := make([]agentCatalogItem, 0, len(s.definitions))
				for _, name := range s.catalogNames() {
					definition := s.definitions[name]
					description := definition.Description
					if len(description) > 1024 {
						description = description[:1024]
						for !utf8.ValidString(description) {
							description = description[:len(description)-1]
						}
					}
					rows = append(rows, agentCatalogItem{Name: name, Description: description, Model: definition.Model, Background: definition.Background, DescriptionTruncated: description != definition.Description})
				}
				page, err := model.PaginateCatalog(rows, input.Offset, input.Limit)
				if err != nil {
					return harness.ToolResult{}, err
				}
				value = page
			}
			data, err := json.Marshal(value)
			return harness.ToolResult{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: string(data)}}}, err
		},
	}
}
