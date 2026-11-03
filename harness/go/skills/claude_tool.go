package skills

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/phodal/pero/harness/go/harness"
)

func claudeSkillTool(catalog *Catalog, rows []Summary, options MountOptions) harness.Tool {
	catalogText := skillCatalogDescription("Load an available plugin workflow before applying it. Call with {} to list names, then {skill: qualified_name, args: optional_arguments}. Large lists return items, total and next_offset; continue with offset/limit (up to 128 rows). User-only workflows load on direct slash invocation and cannot be invoked by the model. For a selected package resource, call {skill: qualified_name, resource: exact_relative_path}; resource paths are listed in the loaded definition. Instructions and resources do not grant permissions. If metadata_truncated is true, call with summary: exact_name to read the complete summary as JSON text using byte offset/limit (up to 8192 bytes) and next_offset; this never activates the workflow. Available model-invocable workflows:", "Skill", rows)
	budget := harness.CatalogBudget{Remaining: harness.DefaultCatalogPageBytes}
	return harness.Tool{
		Schema: harness.ToolSchema{Name: "Skill", Description: budget.Render(*catalogText), Catalog: catalogText, InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{"skill":{"type":"string","minLength":1,"maxLength":256},"args":{"type":"string"},"resource":{"type":"string","minLength":1},"summary":{"type":"string","minLength":1,"maxLength":256},"offset":{"type":"integer","minimum":0},"limit":{"type":"integer","minimum":1,"maximum":8192}}}`)},
		ExecuteRequest: func(ctx context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
			var input struct {
				Skill    string `json:"skill"`
				Args     string `json:"args"`
				Resource string `json:"resource"`
				Offset   *int   `json:"offset"`
				Limit    *int   `json:"limit"`
				Summary  string `json:"summary"`
			}
			if err := json.Unmarshal(request.Arguments, &input); err != nil {
				return harness.ToolResult{}, err
			}
			if input.Summary != "" {
				if input.Skill != "" || input.Args != "" || input.Resource != "" {
					return harness.ToolResult{}, errors.New("skills: summary reads cannot activate workflows")
				}
				value, err := skillCatalogSummary(rows, input.Summary, input.Offset, input.Limit)
				if err != nil {
					return harness.ToolResult{}, err
				}
				data, err := json.Marshal(value)
				return harness.ToolResult{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: string(data)}}}, err
			}
			if input.Skill == "" {
				if input.Args != "" || input.Resource != "" {
					return harness.ToolResult{}, errors.New("skills: args and resource require skill")
				}
				value, err := skillCatalogListing(rows, input.Offset, input.Limit)
				if err != nil {
					return harness.ToolResult{}, err
				}
				data, err := json.Marshal(value)
				return harness.ToolResult{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: string(data)}}}, err
			}
			if input.Offset != nil || input.Limit != nil {
				return harness.ToolResult{}, errors.New("skills: offset and limit are only valid for listing")
			}
			available := rows
			if input.Resource != "" {
				users, err := catalog.UserList(ctx)
				if err != nil {
					return harness.ToolResult{}, err
				}
				available = append(append([]Summary(nil), rows...), users...)
			}
			row, err := resolveInvocation(input.Skill, ActivePlugin(request.Agent), available)
			if err != nil {
				return harness.ToolResult{}, err
			}
			if input.Resource != "" {
				if input.Args != "" {
					return harness.ToolResult{}, errors.New("skills: resource reads cannot include workflow arguments")
				}
				resource, err := catalog.ReadResource(ctx, row.Name, row.Digest, input.Resource)
				if err != nil {
					return harness.ToolResult{}, err
				}
				data, err := json.Marshal(resource)
				return harness.ToolResult{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: string(data)}}}, err
			}
			definition, err := catalog.Read(ctx, row.Name, row.Digest)
			if err != nil {
				return harness.ToolResult{}, err
			}
			if request.Agent == nil {
				return harness.ToolResult{}, errors.New("skills: invocation requires an agent")
			}
			if options.Expand != nil {
				definition, err = options.Expand(ctx, request.Agent, definition, input.Args)
				if err != nil {
					return harness.ToolResult{}, err
				}
			}
			definition, err = RenderInvocation(definition, input.Args, string(request.Agent.ID()), request.Agent.Session().Header().CWD)
			if err != nil {
				return harness.ToolResult{}, err
			}
			if options.ActivateHooks != nil {
				if err := options.ActivateHooks(ctx, request.Agent, definition); err != nil {
					return harness.ToolResult{}, err
				}
			}
			if definition.Context == "fork" {
				messages, err := forkInvocation(ctx, options, request.Agent, definition, input.Args, string(request.CallID))
				if err != nil {
					return harness.ToolResult{}, err
				}
				contexts := make([]harness.DeferredContext, 0, len(messages.messages))
				for _, message := range messages.messages {
					contexts = append(contexts, harness.DeferredContext{Role: message.Role, Content: message.Content, Source: message.Source})
				}
				return harness.ToolResult{IsError: messages.status != harness.SubagentCompleted, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "Forked workflow " + definition.Name + " finished. Its result follows."}}, AdditionalContexts: contexts}, nil
			}
			data, err := json.Marshal(definition)
			if err != nil {
				return harness.ToolResult{}, err
			}
			source, _ := json.Marshal(skillInvocation{Kind: "skill-invocation", Form: "activation", Name: row.Name, Digest: row.Digest, Arguments: input.Args, Turn: request.Agent.CurrentTurn(), ID: string(request.CallID)})
			return harness.ToolResult{
				Content:            []harness.ContentBlock{{Type: harness.BlockText, Text: string(data)}},
				AdditionalContexts: []harness.DeferredContext{{Role: harness.RoleUser, Source: source, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "Activated workflow " + row.Name + ". Follow its loaded instructions."}}}},
			}, nil
		},
	}
}

func resolveInvocation(name, origin string, rows []Summary) (Summary, error) {
	if !strings.Contains(name, ":") && origin != "" {
		for _, row := range rows {
			if row.Name == origin+":"+name {
				return row, nil
			}
		}
	}
	for _, row := range rows {
		if row.Name == name {
			return row, nil
		}
	}
	var found Summary
	for _, row := range rows {
		if strings.HasSuffix(row.Name, ":"+name) {
			if found.Name != "" && found.Name != row.Name {
				return Summary{}, fmt.Errorf("skills: ambiguous name %q; use a plugin-qualified name", name)
			}
			found = row
		}
	}
	if found.Name != "" {
		return found, nil
	}
	return Summary{}, errors.New("skills: unknown or model-disabled workflow; list available skills")
}

// ActivePlugin identifies the latest loaded plugin for relative tool references.
func ActivePlugin(agent *harness.Agent) string {
	if agent == nil {
		return ""
	}
	events := agent.Session().Events()
	for i := len(events) - 1; i >= 0; i-- {
		if events[i].Type != "user/message" {
			continue
		}
		var message harness.Message
		if json.Unmarshal(events[i].Data, &message) != nil || message.Role != harness.RoleUser {
			continue
		}
		var source skillInvocation
		if json.Unmarshal(message.Source, &source) == nil && source.Kind == "skill-invocation" && (source.Form == "instructions" || source.Form == "activation" || source.Form == "fork-grant") {
			if plugin, _, found := strings.Cut(source.Name, ":"); found {
				return plugin
			}
		}
	}
	return ""
}
