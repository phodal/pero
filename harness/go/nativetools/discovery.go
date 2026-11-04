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
	Name                string          `json:"name"`
	Description         string          `json:"description"`
	InputSchema         json.RawMessage `json:"input_schema,omitempty"`
	Digest              string          `json:"schema_sha256"`
	SchemaOmitted       bool            `json:"schema_omitted,omitempty"`
	Activated           bool            `json:"activated,omitempty"`
	SchemaInDeclaration bool            `json:"schema_in_declaration,omitempty"`
}

type toolSearchResult struct {
	Tools        []discoveredTool `json:"tools"`
	Total        int              `json:"total"`
	PartialMatch bool             `json:"partial_match,omitempty"`
	NextOffset   *int             `json:"next_offset,omitempty"`
	Notice       string           `json:"notice"`
}

func mountToolSearch(ctx context.Context, h *harness.Harness, claude, deferLoading bool) error {
	name := "tool_search"
	if claude {
		name = "ToolSearch"
	}
	description := "Find caller-authorized tools. A full tool name selects only that tool, case-insensitively. For multiple known names use select:Name1,Name2 (up to 20 by default). Otherwise search literal name/description keywords, preferring tools matching every word. If none do, return explicitly marked partial matches ranked by keyword coverage and name matches. Use one capability per query. Keyword searches return up to 5 by default, with bounded pagination."
	if deferLoading {
		description += " Returns compact activation receipts and hashes; complete schemas are declared in the next model request. Omitted schemas are not activated; narrow the query or continue pagination."
	} else {
		description += " Returns current schemas and hashes. This only indexes available tools and does not change activation."
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
			if result.PartialMatch {
				result.Notice = "No tool matched every keyword; these are partial keyword matches. Check their descriptions before use. " + result.Notice
			}
			if deferred != nil {
				return renderDeferredDiscovery(result)
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

// Keep the complete bounded discovery receipt for inspection, while the next
// request declarations carry the executable schemas to the model only once.
func renderDeferredDiscovery(result toolSearchResult) (harness.ToolResult, error) {
	meta, err := json.Marshal(struct {
		Discovery toolSearchResult `json:"discovery"`
	}{result})
	if err != nil {
		return harness.ToolResult{}, err
	}
	result.Tools = append([]discoveredTool{}, result.Tools...)
	for i := range result.Tools {
		item := &result.Tools[i]
		item.InputSchema = nil
		item.SchemaInDeclaration = item.Activated
		item.Description = boundedText(strings.SplitN(item.Description, "\n", 2)[0], 160)
	}
	activated := false
	for _, item := range result.Tools {
		activated = activated || item.Activated
	}
	if activated {
		result.Notice = "Activated tools are declared next request with full schemas. Omitted tools were not activated; narrow the query or continue pagination. Use only current declarations."
		if result.PartialMatch {
			result.Notice = "Partial keyword matches; check tool purposes. " + result.Notice
		}
	}
	raw, err := json.Marshal(result)
	if err != nil {
		return harness.ToolResult{}, err
	}
	return harness.ToolResult{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: string(raw)}}, Meta: meta}, nil
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
	type keywordMatch struct {
		harness.ToolSchema
		words, nameWords int
	}
	matches := make([]keywordMatch, 0)
	allWords := false
	exactName := ""
	for _, schema := range schemas {
		if schema.Name == self || len(words) == 0 {
			continue
		}
		if !exactSelection && strings.EqualFold(schema.Name, query) {
			exactName = schema.Name
		}
		name := strings.ToLower(schema.Name)
		haystack := name + " " + strings.ToLower(schema.Description)
		match := keywordMatch{ToolSchema: schema}
		if exactSelection {
			for _, selected := range names {
				if strings.EqualFold(schema.Name, selected) {
					match.words = 1
					break
				}
			}
		} else {
			for _, word := range words {
				if strings.Contains(haystack, word) {
					match.words++
				}
				if strings.Contains(name, word) {
					match.nameWords++
				}
			}
			allWords = allWords || match.words == len(words)
		}
		if match.words > 0 {
			matches = append(matches, match)
		}
	}
	if exactName != "" {
		for _, match := range matches {
			if match.Name == exactName {
				matches = []keywordMatch{match}
				break
			}
		}
	}
	partial := !exactSelection && !allWords && len(matches) > 0
	if !exactSelection && allWords {
		complete := matches[:0]
		for _, match := range matches {
			if match.words == len(words) {
				complete = append(complete, match)
			}
		}
		matches = complete
	}
	sort.Slice(matches, func(i, j int) bool {
		leftExact, rightExact := strings.EqualFold(matches[i].Name, query), strings.EqualFold(matches[j].Name, query)
		if leftExact != rightExact {
			return leftExact
		}
		if partial {
			if matches[i].words != matches[j].words {
				return matches[i].words > matches[j].words
			}
			if matches[i].nameWords != matches[j].nameWords {
				return matches[i].nameWords > matches[j].nameWords
			}
		}
		return matches[i].Name < matches[j].Name
	})
	result := toolSearchResult{Tools: []discoveredTool{}, Total: len(matches), PartialMatch: partial, Notice: "Current caller-visible tools only; no activation or authorization change. Recheck the current request declarations before calling. schema_sha256 hashes the current complete tool declaration."}
	if len(matches) == 0 {
		result.Notice = "No tools matched; no tools were activated by this search. Try a different capability keyword, or select:Name1,Name2 for exact names. Discovery never grants permissions."
	}
	used := 0
	for i := offset; i < len(matches); i++ {
		if len(result.Tools) >= limit || used >= 32<<10 {
			result.NextOffset = &i
			break
		}
		schema := matches[i]
		item := discoveredTool{Name: schema.Name, Description: boundedText(schema.Description, 1024), InputSchema: schema.InputSchema, Digest: harness.ToolSchemaDigest(schema.ToolSchema)}
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
