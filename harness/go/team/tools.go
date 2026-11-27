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
	Subject   string   `json:"subject"`
	Details   string   `json:"description"`
	BlockedBy []string `json:"blocked_by"`
	TaskID    string   `json:"task_id"`
	Revision  uint64   `json:"expected_revision"`
	Action    Update   `json:"action"`
	Cursor    int      `json:"cursor"`
}

// Mount contributes opt-in Team tools and a trusted host command. Mode is
// stored per root; mounting does not enable any new or restored session.
func Mount(ctx context.Context, h *harness.Harness) error {
	if h == nil || h.Subagents() == nil {
		return errors.New("team: a subagent-enabled harness is required")
	}
	board := Board{Registry: h.Subagents()}
	tools := board.tools()
	def := point.Define(point.Descriptor{
		ID: "harness/contribution/pero-team", Requires: []point.Requirement{point.Require(harness.ToolRegistryKey)},
	}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
		return h.Tools().RegisterCatalogProvider(run, "pero-team", harness.ToolCatalogProvider{
			Schemas: func(_ context.Context, candidate *harness.Agent) ([]harness.ToolSchema, error) {
				if _, err := board.List(candidate); err != nil {
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
					_, err := board.List(candidate)
					ok = err == nil
				}
				return t, ok, nil
			},
		})
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
	add("create", "Create one unowned task. Add only existing prerequisite IDs.",
		`"subject":{"type":"string","minLength":1,"maxLength":200},"description":{"type":"string","minLength":1,"maxLength":16384},"blocked_by":{"type":"array","maxItems":256,"items":{"type":"string","pattern":"^[1-9][0-9]{0,8}$"}}`,
		`"subject","description"`, func(ctx context.Context, caller *harness.Agent, in taskToolInput) (any, error) {
			ids := make([]TaskID, 0, len(in.BlockedBy))
			for _, raw := range in.BlockedBy {
				id, err := parseTaskID(raw)
				if err != nil {
					return nil, err
				}
				ids = append(ids, id)
			}
			return b.Create(ctx, caller, NewTask{Title: in.Subject, Details: in.Details, Dependencies: ids})
		})
	add("list", "List up to 20 shared task summaries from the optional zero-based cursor. Read full details using team_task_get.",
		`"cursor":{"type":"integer","minimum":0,"maximum":256}`, "", func(_ context.Context, caller *harness.Agent, in taskToolInput) (any, error) {
			tasks, err := b.List(caller)
			if err != nil {
				return nil, err
			}
			start := min(in.Cursor, len(tasks))
			end := min(start+20, len(tasks))
			page := tasks[start:end]
			for i := range page {
				page[i].Details = ""
			}
			next := 0
			if end < len(tasks) {
				next = end
			}
			return struct {
				Tasks      []Task `json:"tasks"`
				NextCursor int    `json:"nextCursor,omitempty"`
			}{page, next}, nil
		})
	add("get", "Read one shared task with its current revision.", taskID, `"task_id"`, func(_ context.Context, caller *harness.Agent, in taskToolInput) (any, error) {
		id, err := parseTaskID(in.TaskID)
		if err != nil {
			return nil, err
		}
		tasks, err := b.List(caller)
		if err != nil {
			return nil, err
		}
		return (state{tasks: tasks}).get(id)
	})
	add("update", "Claim a ready task for yourself, or release or complete an in-progress task. Pass the latest revision. Claiming a task does not start an agent.",
		taskID+`,"expected_revision":{"type":"integer","minimum":1},"action":{"enum":["claim","release","complete"]}`, `"task_id","expected_revision","action"`, func(ctx context.Context, caller *harness.Agent, in taskToolInput) (any, error) {
			id, err := parseTaskID(in.TaskID)
			if err != nil {
				return nil, err
			}
			return b.Update(ctx, caller, TaskRef{ID: id, Revision: in.Revision}, in.Action)
		})
	return tools
}
