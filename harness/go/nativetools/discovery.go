package nativetools

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"strings"

	"github.com/phodal/pero/harness/go/harness"
)

type discoveredTool struct {
	Name          string          `json:"name"`
	Description   string          `json:"description"`
	InputSchema   json.RawMessage `json:"input_schema,omitempty"`
	Digest        string          `json:"schema_sha256"`
	SchemaOmitted bool            `json:"schema_omitted,omitempty"`
}

type toolSearchResult struct {
	Tools      []discoveredTool `json:"tools"`
	Total      int              `json:"total"`
	NextOffset *int             `json:"next_offset,omitempty"`
	Notice     string           `json:"notice"`
}

func mountToolSearch(ctx context.Context, h *harness.Harness, claude bool) error {
	name := "tool_search"
	if claude {
		name = "ToolSearch"
	}
	_, err := h.RegisterTool(ctx, "native/tool-search", harness.Tool{
		Schema:        harness.ToolSchema{Name: name, Description: "Search the caller's currently available tools by case-insensitive words in name/description (all words must match). Returns current input schemas, hashes and bounded pagination. This indexes already available tools; it does not activate hidden tools or grant permissions. Availability may change: use only tools declared in the current request. Oversize schemas are explicitly omitted; narrow queries or consult the current declaration.", InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false,"required":["query"],"properties":{"query":{"type":"string","minLength":1,"maxLength":512},"offset":{"type":"integer","minimum":0},"limit":{"type":"integer","minimum":1,"maximum":20}}}`)},
		ExecutionMode: harness.ExecutionSerial,
		ExecuteRequest: func(ctx context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
			if request.Agent == nil {
				return harness.ToolResult{}, errors.New("tool search requires an agent")
			}
			var input struct {
				Query  string `json:"query"`
				Offset int    `json:"offset"`
				Limit  int    `json:"limit"`
			}
			if err := json.Unmarshal(request.Arguments, &input); err != nil {
				return harness.ToolResult{}, err
			}
			schemas, err := h.Tools().SchemasForAgent(ctx, request.Agent)
			if err != nil {
				return harness.ToolResult{}, err
			}
			return renderResult(searchToolSchemas(schemas, name, input.Query, input.Offset, input.Limit), nil)
		},
	})
	return err
}

func searchToolSchemas(schemas []harness.ToolSchema, self, query string, offset, limit int) toolSearchResult {
	if limit == 0 {
		limit = 5
	}
	words := strings.Fields(strings.ToLower(query))
	matches := make([]harness.ToolSchema, 0)
	for _, schema := range schemas {
		if schema.Name == self || len(words) == 0 {
			continue
		}
		haystack := strings.ToLower(schema.Name + " " + schema.Description)
		matched := true
		for _, word := range words {
			matched = matched && strings.Contains(haystack, word)
		}
		if matched {
			matches = append(matches, schema)
		}
	}
	sort.Slice(matches, func(i, j int) bool { return matches[i].Name < matches[j].Name })
	result := toolSearchResult{Tools: []discoveredTool{}, Total: len(matches), Notice: "Current caller-visible tools only; no activation or authorization change. Recheck the current request declarations before calling. schema_sha256 hashes the current complete tool declaration."}
	used := 0
	for i := offset; i < len(matches); i++ {
		if len(result.Tools) >= limit || used >= 32<<10 {
			result.NextOffset = &i
			break
		}
		schema := matches[i]
		raw, _ := json.Marshal(schema)
		digest := sha256.Sum256(raw)
		item := discoveredTool{Name: schema.Name, Description: boundedText(schema.Description, 1024), InputSchema: schema.InputSchema, Digest: hex.EncodeToString(digest[:])}
		encoded, _ := json.Marshal(item)
		if used+len(encoded) > 32<<10 {
			if len(result.Tools) > 0 {
				result.NextOffset = &i
				break
			}
			item.InputSchema, item.SchemaOmitted = nil, true
			encoded, _ = json.Marshal(item)
		}
		used += len(encoded)
		result.Tools = append(result.Tools, item)
	}
	return result
}
