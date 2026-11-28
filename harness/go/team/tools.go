package team

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

type taskToolInput struct {
	Subject     *string            `json:"subject"`
	Details     *string            `json:"description"`
	BlockedBy   *[]TaskID          `json:"blocked_by"`
	WriteScopes *[]string          `json:"write_scopes"`
	TaskID      string             `json:"task_id"`
	Revision    uint64             `json:"expected_revision"`
	Action      Update             `json:"action"`
	Owner       *harness.SessionID `json:"owner"`
	Cursor      uint64             `json:"cursor"`
	Limit       *int               `json:"limit"`
	Status      Status             `json:"status"`
	Unowned     *bool              `json:"unowned"`
	Ready       *bool              `json:"ready"`
}

const teamPolicy = `Agent Teams is available in this session.

The root and its owned children share a task board, not a grant of workspace access. Split write work into disjoint scopes. Record expected workspace-relative write scopes and dependencies on tasks. An overlap warning is advisory, not a lock.

List or read a task, claim a ready revision, do the work, then complete the current revision. Only the Lead can reassign to itself (lead) or an eligible continuable child by exact session ID. Changing a task never wakes its owner or sends a message. Wait for required delegated work using the available subagent controls before reporting a final result.`

// Mount contributes opt-in Team tools and a trusted host command. Mode is
// stored per root; mounting does not enable any new or restored session.
func Mount(ctx context.Context, h *harness.Harness) error {
	if h == nil || h.Subagents() == nil {
		return errors.New("team: a subagent-enabled harness is required")
	}
	board := Board{Registry: h.Subagents()}
	tools := board.tools()
	def := point.Define(point.Descriptor{
		ID: "harness/contribution/pero-team", Requires: []point.Requirement{point.Require(harness.ToolRegistryKey), point.Require(harness.PromptRegistryKey)},
	}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
		if _, err := h.Tools().RegisterCatalogProvider(run, "pero-team", harness.ToolCatalogProvider{
			Schemas: func(_ context.Context, candidate *harness.Agent) ([]harness.ToolSchema, error) {
				if _, err := board.read(candidate); err != nil {
					return nil, nil
				}
				schemas := make([]harness.ToolSchema, 0, len(tools))
				for _, tool := range tools {
					schemas = append(schemas, tool.Schema)
				}
				return schemas, nil
			},
			Resolve: func(_ context.Context, candidate *harness.Agent, name string) (harness.Tool, bool, error) {
				t, ok := tools[name]
				if ok {
					_, err := board.read(candidate)
					ok = err == nil
				}
				return t, ok, nil
			},
		}); err != nil {
			return nil, err
		}
		_, err := h.Prompts().Register(run, harness.PromptSection{
			ID: "team:policy", Order: 660,
			Guidance: func(_ context.Context, _ *harness.Agent, capabilities harness.PromptCapabilities) (string, error) {
				for name := range tools {
					if !capabilities.HasTool(name) {
						return "", nil
					}
				}
				return teamPolicy, nil
			},
		})
		return nil, err
	})
	instance, err := h.Runtime().Mount(nil, "pero/team/tools", def, nil)
	if err != nil {
		return err
	}
	if err = instance.WaitStable(ctx); err == nil && instance.Snapshot().State == point.Failed {
		err = fmt.Errorf("team: mount failed: %s", instance.Snapshot().LastError)
	}
	if err != nil {
		_ = instance.Dispose(context.Background())
		return err
	}
	_, err = h.RegisterCommand(ctx, "pero/team/command", harness.CommandDefinition{
		Name: "team", Description: "Enable, disable, or inspect the current session's shared Team board.",
		Input: &harness.CommandInputDescriptor{Hint: "on | off | status"},
		Handler: func(ctx context.Context, invocation harness.CommandInvocation) (harness.CommandResult, error) {
			input := strings.TrimSpace(invocation.RawInput)
			switch input {
			case "on", "off":
				if err := board.SetEnabled(ctx, invocation.Agent, input == "on"); err != nil {
					return harness.CommandResult{}, err
				}
			case "status":
			default:
				return harness.CommandResult{Kind: harness.CommandError, Text: "Usage: /team on | off | status"}, nil
			}
			items, err := board.List(invocation.Agent)
			if errors.Is(err, ErrDisabled) {
				return harness.CommandResult{Kind: harness.CommandSuccess, Text: "Team is off."}, nil
			}
			if err != nil {
				return harness.CommandResult{}, err
			}
			return harness.CommandResult{Kind: harness.CommandSuccess, Text: fmt.Sprintf("Team is on. Shared tasks: %d.", len(items))}, nil
		},
	})
	if err != nil {
		_ = instance.Dispose(context.Background())
	}
	return err
}

func (b Board) tools() map[string]harness.Tool {
	const names = "team_task_"
	const taskID = `"task_id":{"type":"string","pattern":"^[1-9][0-9]{0,8}$"}`
	const taskText = `"subject":{"type":"string","minLength":1,"maxLength":200},"description":{"type":"string","minLength":1,"maxLength":16384}`
	const dependencies = `"blocked_by":{"type":"array","maxItems":256,"items":{"type":"string","pattern":"^[1-9][0-9]{0,8}$"}}`
	const writeScopes = `"write_scopes":{"type":"array","maxItems":32,"items":{"type":"string","minLength":1,"maxLength":256}}`
	type action func(context.Context, *harness.Agent, taskToolInput) (any, error)
	tools := make(map[string]harness.Tool, 4)
	add := func(name, title, args, required string, run action) {
		name = names + name
		tools[name] = harness.Tool{
			Schema: harness.ToolSchema{Name: name, Description: title,
				InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{` + args + `},"required":[` + required + `]}`)},
			ExecuteRequest: func(ctx context.Context, req harness.ToolRequest) (harness.ToolResult, error) {
				var input taskToolInput
				if err := json.Unmarshal(req.Arguments, &input); err != nil {
					return harness.ToolResult{}, err
				}
				value, err := run(ctx, req.Agent, input)
				if err != nil {
					return harness.ToolResult{}, err
				}
				data, err := json.Marshal(value)
				if err != nil {
					return harness.ToolResult{}, err
				}
				return harness.ToolResult{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: string(data)}}}, nil
			},
		}
	}
	add("create", "Create one unowned task. Use existing prerequisite IDs and optional advisory workspace-relative write_scopes.",
		taskText+","+dependencies+","+writeScopes,
		`"subject","description"`, func(ctx context.Context, caller *harness.Agent, in taskToolInput) (any, error) {
			if in.Subject == nil || in.Details == nil {
				return nil, ErrArgument
			}
			input := NewTask{Title: *in.Subject, Details: *in.Details}
			if in.BlockedBy != nil {
				input.Dependencies = *in.BlockedBy
			}
			if in.WriteScopes != nil {
				input.WriteScopes = *in.WriteScopes
			}
			return b.Create(ctx, caller, input)
		})
	add("list", "Filter shared task summaries by status, owner (lead or exact session ID), unowned, or readiness, then page through the results. Read full details using team_task_get.",
		`"status":{"enum":["pending","in_progress","completed"]},"owner":{"type":"string","minLength":1,"maxLength":256},"unowned":{"type":"boolean"},"ready":{"type":"boolean"},"cursor":{"type":"integer","minimum":0,"maximum":9007199254740991},"limit":{"type":"integer","minimum":1,"maximum":100}`,
		"", func(_ context.Context, caller *harness.Agent, in taskToolInput) (any, error) {
			if in.Owner != nil && in.Unowned != nil {
				return nil, fmt.Errorf("%w: owner and unowned cannot be combined", ErrArgument)
			}
			root, s, err := b.readRoot(caller)
			if err != nil {
				return nil, err
			}
			q := taskQuery{status: in.Status, unowned: in.Unowned, ready: in.Ready, cursor: in.Cursor, limit: 50}
			if in.Limit != nil {
				q.limit = *in.Limit
			}
			if in.Owner != nil {
				q.owner = *in.Owner
				if q.owner == "lead" {
					q.owner = root.ID()
				}
			}
			return s.page(q), nil
		})
	add("get", "Read one shared task (including a deleted record) with its revision, readiness and advisory write-scope warnings.", taskID, `"task_id"`, func(_ context.Context, caller *harness.Agent, in taskToolInput) (any, error) {
		id, err := parseTaskID(in.TaskID)
		if err != nil {
			return nil, err
		}
		s, err := b.read(caller)
		if err != nil {
			return nil, err
		}
		task, err := s.get(id)
		if err != nil {
			return nil, err
		}
		return s.view(task), nil
	})
	add("update", "Change a shared task using its latest revision. Edit subject, description and/or write_scopes (use [] to clear scopes); set_dependencies replaces blocked_by (use [] to clear). The owner or Lead can edit, rewire, reopen completed tasks, or delete tasks without dependents. Only the Lead can reassign to lead or a continuable child session ID; omit owner to unassign. Never starts an agent.",
		taskID+`,"expected_revision":{"type":"integer","minimum":1},"action":{"enum":["claim","release","complete","reassign","edit","set_dependencies","reopen","delete"]},"owner":{"type":"string","minLength":1,"maxLength":256}`+","+taskText+","+dependencies+","+writeScopes, `"task_id","expected_revision","action"`, func(ctx context.Context, caller *harness.Agent, in taskToolInput) (any, error) {
			id, err := parseTaskID(in.TaskID)
			if err != nil {
				return nil, err
			}
			ref := TaskRef{ID: id, Revision: in.Revision}
			if (in.Subject != nil || in.Details != nil || in.WriteScopes != nil) && in.Action != Edit {
				return nil, fmt.Errorf("%w: subject, description and write_scopes are only valid for edit", ErrArgument)
			}
			if in.BlockedBy != nil && in.Action != SetDependencies {
				return nil, fmt.Errorf("%w: blocked_by is only valid for set_dependencies", ErrArgument)
			}
			if in.Action == Reassign {
				var target harness.SessionID
				if in.Owner != nil {
					target = *in.Owner
				}
				return b.Reassign(ctx, caller, ref, target)
			}
			if in.Owner != nil {
				return nil, fmt.Errorf("%w: owner is only valid for reassignment", ErrArgument)
			}
			return b.update(ctx, caller, ref, mutation{operation: in.Action, title: in.Subject, details: in.Details, dependencies: in.BlockedBy, writeScopes: in.WriteScopes})
		})
	return tools
}
