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
	description := "Find caller-authorized tools. For known names use select:Name1,Name2 (comma-separated exact names, case-insensitive; returns up to 20 by default). Otherwise search literal name/description substrings: all whitespace-separated words must match one tool. Use one capability per query; a full tool name ranks first. Keyword searches return up to 5 by default. Returns current schemas, hashes and bounded pagination."
	if deferLoading {
		description += " Complete returned schemas activate their exact versions for the next model request. Omitted schemas are not activated; narrow the query or continue pagination."
	} else {
		description += " This only indexes available tools and does not change activation."
	}
	description += " Discovery never grants permissions. Availability may change: call only tools declared in the current request."
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
				if len(selected) > 0 {
					result.Notice = "Complete returned schemas are activated for this agent and will be declared in the next model request. Omitted schemas are not activated. Call only current declared tools. Authorization, withdrawal and exact schema versions are rechecked at use."
				} else if result.Total > 0 {
					result.Notice = "No complete schemas were returned; no tools were activated by this search. Narrow the query or continue pagination. Call only current declared tools. Discovery never grants permissions."
				}
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
	query = strings.TrimSpace(query)
	words := strings.Fields(strings.ToLower(query))
	selection, exactSelection := strings.CutPrefix(query, "select:")
	if limit == 0 {
		limit = 5
		if exactSelection {
			limit = 20
		}
	}
	var names []string
	if exactSelection {
		for _, name := range strings.Split(selection, ",") {
			if name = strings.TrimSpace(name); name != "" {
				names = append(names, name)
			}
		}
	}
	matches := make([]harness.ToolSchema, 0)
	for _, schema := range schemas {
		if schema.Name == self || len(words) == 0 {
			continue
		}
		haystack := strings.ToLower(schema.Name + " " + schema.Description)
		matched := false
		if exactSelection {
			for _, name := range names {
				matched = matched || strings.EqualFold(schema.Name, name)
			}
		} else {
			matched = true
			for _, word := range words {
				matched = matched && strings.Contains(haystack, word)
			}
		}
		if matched {
			matches = append(matches, schema)
		}
	}
	sort.Slice(matches, func(i, j int) bool {
		leftExact, rightExact := strings.EqualFold(matches[i].Name, query), strings.EqualFold(matches[j].Name, query)
		if leftExact != rightExact {
			return leftExact
		}
		return matches[i].Name < matches[j].Name
	})
	result := toolSearchResult{Tools: []discoveredTool{}, Total: len(matches), Notice: "Current caller-visible tools only; no activation or authorization change. Recheck the current request declarations before calling. schema_sha256 hashes the current complete tool declaration."}
	if len(matches) == 0 {
		result.Notice = "No tools matched; no tools were activated by this search. Use fewer literal keywords (all words must match one tool), or select:Name1,Name2 for exact names. Discovery never grants permissions."
	}
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
