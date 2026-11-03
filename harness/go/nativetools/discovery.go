package nativetools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

type discoveredTool struct {
	Name          string          `json:"name"`
	Description   string          `json:"description"`
	InputSchema   json.RawMessage `json:"input_schema,omitempty"`
	Digest        string          `json:"schema_sha256"`
	SchemaOmitted bool            `json:"schema_omitted,omitempty"`
	Activated     bool            `json:"activated,omitempty"`
}

type toolSearchResult struct {
	Tools      []discoveredTool `json:"tools"`
	Total      int              `json:"total"`
	NextOffset *int             `json:"next_offset,omitempty"`
	Notice     string           `json:"notice"`
}

func mountToolSearch(ctx context.Context, h *harness.Harness, claude, deferLoading bool) error {
	name := "tool_search"
	if claude {
		name = "ToolSearch"
	}
	description := "Search the caller's currently available tools by case-insensitive words in name/description (all words must match). Returns current input schemas, hashes and bounded pagination. This indexes already available tools; it does not activate hidden tools or grant permissions."
	if deferLoading {
		description = "Discover caller-authorized tools by case-insensitive words in name/description (all words must match). Search for the capability needed, such as files, terminal, skills, agents or MCP. Returned complete schemas activate the exact versions for this agent and are declared in the next model request. Discovery never grants permissions. Omitted schemas are not activated; narrow the query or continue pagination."
	}
	description += " Availability may change: call only tools declared in the current request."
	var deferred *harness.DeferredTools
	tool := harness.Tool{
		Schema:        harness.ToolSchema{Name: name, Description: description, InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false,"required":["query"],"properties":{"query":{"type":"string","minLength":1,"maxLength":512},"offset":{"type":"integer","minimum":0},"limit":{"type":"integer","minimum":1,"maximum":20}}}`)},
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
			var schemas []harness.ToolSchema
			var err error
			if deferred != nil {
				schemas, err = deferred.Candidates(ctx, request.Agent)
			} else {
				schemas, err = h.Tools().SchemasForAgent(ctx, request.Agent)
			}
			if err != nil {
				return harness.ToolResult{}, err
			}
			result := searchToolSchemas(schemas, name, input.Query, input.Offset, input.Limit)
			if deferred != nil {
				var selected []harness.ToolSchema
				for index, item := range result.Tools {
					if item.SchemaOmitted {
						continue
					}
					for _, schema := range schemas {
						if schema.Name == item.Name {
							selected = append(selected, schema)
							result.Tools[index].Activated = true
						}
					}
				}
				if err := deferred.Activate(ctx, request.Agent, selected); err != nil {
					return harness.ToolResult{}, err
				}
				result.Notice = "Complete returned schemas are activated for this agent and will be declared in the next model request. Omitted schemas are not activated. Call only current declared tools. Authorization, withdrawal and exact schema versions are rechecked at use."
			}
			return renderResult(result, nil)
		},
	}
	if !deferLoading {
		_, err := h.RegisterTool(ctx, "native/tool-search", tool)
		return err
	}
	definition := point.Define(point.Descriptor{ID: "native/deferred-tools"}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
		if _, err := h.Tools().Register(run, tool); err != nil {
			return nil, err
		}
		var err error
		deferred, _, err = h.Tools().RegisterDeferredTools(run, "native/deferred-tools", name)
		return nil, err
	})
	instance, err := h.Runtime().Mount(nil, "native/tool-search", definition, nil)
	if err != nil {
		return err
	}
	if err := instance.WaitStable(ctx); err != nil {
		_ = instance.Dispose(context.Background())
		return err
	}
	if snapshot := instance.Snapshot(); snapshot.State == point.Failed {
		_ = instance.Dispose(context.Background())
		return fmt.Errorf("native deferred tools: %s", snapshot.LastError)
	}
	return nil
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
		item := discoveredTool{Name: schema.Name, Description: boundedText(schema.Description, 1024), InputSchema: schema.InputSchema, Digest: harness.ToolSchemaDigest(schema)}
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
