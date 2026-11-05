package tasks

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

type taskSummary struct {
	ID        TaskID     `json:"id"`
	Subject   string     `json:"subject"`
	Status    TaskStatus `json:"status"`
	Owner     string     `json:"owner,omitempty"`
	BlockedBy []TaskID   `json:"blockedBy"`
	Blocks    []TaskID   `json:"blocks"`
}

// Mount grants task metadata for the current session only. It does not grant
// file, shell, background execution or another session's task authority.
func Mount(ctx context.Context, h *harness.Harness) (*point.Instance, error) {
	if h == nil || h.Runtime() == nil || h.Tools() == nil {
		return nil, errors.New("tasks: a running harness is required")
	}
	definition := point.Define(point.Descriptor{ID: "harness/contribution/claude-tasks", Requires: []point.Requirement{point.Require(harness.ToolRegistryKey)}}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
		for _, tool := range taskTools() {
			if _, err := h.Tools().Register(run, tool); err != nil {
				return nil, err
			}
		}
		return nil, nil
	})
	instance, err := h.Runtime().Mount(nil, "tasks/claude-tools", definition, nil)
	if err != nil {
		return nil, err
	}
	if err = instance.WaitStable(ctx); err == nil && instance.Snapshot().State == point.Failed {
		err = fmt.Errorf("tasks: activation failed: %s", instance.Snapshot().LastError)
	}
	if err != nil {
		_ = instance.Dispose(context.Background())
		return nil, err
	}
	return instance, nil
}

func taskTools() []harness.Tool {
	const metadata = `"metadata":{"type":"object"}`
	const textFields = `"subject":{"type":"string","minLength":1,"maxLength":512},"description":{"type":"string","maxLength":16384},"activeForm":{"type":"string","maxLength":512}`
	const taskID = `"taskId":{"type":"string","minLength":1}`
	return []harness.Tool{
		{Schema: harness.ToolSchema{Name: "TaskCreate", Description: "Create a durable task in the current session with a stable id. Tasks survive turns and session reload. subject and description describe work; activeForm is a short progress label. This does not start an Agent or execute work.", InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{` + textFields + `,` + metadata + `},"required":["subject","description"]}`)}, IsConcurrencySafe: taskConcurrency, ExecuteRequest: func(ctx context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
			var input NewTask
			if err := json.Unmarshal(request.Arguments, &input); err != nil {
				return harness.ToolResult{}, err
			}
			transition, err := commitRequest(ctx, request, Command{Create: &input})
			if err != nil {
				return harness.ToolResult{}, err
			}
			return taskJSON(struct {
				Task TaskView `json:"task"`
			}{transition.Task})
		}},
		{Schema: harness.ToolSchema{Name: "TaskUpdate", Description: "Update a current-session task's text, status, owner, metadata or dependencies. addBlockedBy adds prerequisite task IDs; addBlocks adds tasks that depend on this task. Dependencies must exist and must not form cycles. Metadata merges by key; null removes a key. deleted removes a task from normal views and unblocks its dependents.", InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{` + taskID + `,` + textFields + `,` + metadata + `,"status":{"type":"string","enum":["pending","in_progress","completed","deleted"]},"owner":{"type":"string","maxLength":512},"addBlockedBy":{"type":"array","items":{"type":"string","minLength":1}},"addBlocks":{"type":"array","items":{"type":"string","minLength":1}}},"required":["taskId"]}`)}, IsConcurrencySafe: taskConcurrency, ExecuteRequest: func(ctx context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
			var input Update
			if err := json.Unmarshal(request.Arguments, &input); err != nil {
				return harness.ToolResult{}, err
			}
			transition, err := commitRequest(ctx, request, Command{Update: &input})
			if err != nil {
				return harness.ToolResult{}, err
			}
			return taskJSON(struct {
				Success bool     `json:"success"`
				Task    TaskView `json:"task"`
			}{true, transition.Task})
		}},
		{Schema: harness.ToolSchema{Name: "TaskList", Description: "List current-session tasks with IDs, subjects, status, owner and dependency edges. Deleted tasks are excluded. Use TaskGet for full descriptions and metadata; this is not the background Agent task list.", InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{}}`)}, IsConcurrencySafe: taskConcurrency, ExecuteRequest: func(_ context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
			if request.Agent == nil {
				return harness.ToolResult{}, errors.New("tasks: tool requires an owning agent")
			}
			state, err := Current(request.Agent.Session())
			if err != nil {
				return harness.ToolResult{}, err
			}
			items := []taskSummary{}
			for _, task := range state.List() {
				items = append(items, taskSummary{ID: task.ID, Subject: task.Subject, Status: task.Status, Owner: task.Owner, BlockedBy: task.BlockedBy, Blocks: task.Blocks})
			}
			return taskJSON(struct {
				Tasks []taskSummary `json:"tasks"`
			}{items})
		}},
		{Schema: harness.ToolSchema{Name: "TaskGet", Description: "Get the complete current-session task for taskId, including description, activeForm, metadata and dependency edges.", InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{` + taskID + `},"required":["taskId"]}`)}, IsConcurrencySafe: taskConcurrency, ExecuteRequest: func(_ context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
			if request.Agent == nil {
				return harness.ToolResult{}, errors.New("tasks: tool requires an owning agent")
			}
			var input struct {
				TaskID TaskID `json:"taskId"`
			}
			if err := json.Unmarshal(request.Arguments, &input); err != nil {
				return harness.ToolResult{}, err
			}
			state, err := Current(request.Agent.Session())
			if err != nil {
				return harness.ToolResult{}, err
			}
			task, err := state.Get(input.TaskID)
			if err != nil {
				return harness.ToolResult{}, err
			}
			return taskJSON(struct {
				Task TaskView `json:"task"`
			}{task})
		}},
	}
}

func taskConcurrency(context.Context, harness.ToolRequest) bool { return true }
func commitRequest(ctx context.Context, request harness.ToolRequest, command Command) (Transition, error) {
	if request.Agent == nil {
		return Transition{}, errors.New("tasks: tool requires an owning agent")
	}
	return Commit(ctx, request.Agent.Session(), command)
}
func taskJSON(value any) (harness.ToolResult, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return harness.ToolResult{}, err
	}
	return harness.ToolResult{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: string(raw)}}}, nil
}
