package harness

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

type TaskKind string

const (
	TaskKindAgent    TaskKind = "agent"
	TaskKindShell    TaskKind = "shell"
	TaskKindWorkflow TaskKind = "workflow"
)

type TaskRetrieval string

const (
	TaskRetrieved TaskRetrieval = "success"
	TaskNotReady  TaskRetrieval = "not_ready"
	TaskTimedOut  TaskRetrieval = "timeout"
)

// TaskHandle is a borrowed view of a provider-owned task. Its provider retains
// all execution, parent identity, cancellation and durable recovery authority.
// Snapshot must be safe during execution; Stop cancels and joins that same task.
type TaskHandle struct {
	ID       string
	Kind     TaskKind
	Done     <-chan struct{}
	Snapshot func(TaskRetrieval) ToolResult
	Stop     func(context.Context) (ToolResult, error)
}

type TaskLookup func(context.Context, *Agent, string) (TaskHandle, bool, error)

func lookupTaskHandle(ctx context.Context, request ToolRequest, id string, lookup TaskLookup) (TaskHandle, error) {
	if request.Agent == nil || lookup == nil {
		return TaskHandle{}, errors.New("tasks: an owning agent and task provider are required")
	}
	task, found, err := lookup(ctx, request.Agent, id)
	if err != nil {
		return TaskHandle{}, err
	}
	if !found {
		return TaskHandle{}, errors.New("tasks: task is unavailable to this exact parent")
	}
	if task.ID != id || task.Done == nil || task.Snapshot == nil || task.Stop == nil || task.Kind != TaskKindAgent && task.Kind != TaskKindShell && task.Kind != TaskKindWorkflow {
		return TaskHandle{}, errors.New("tasks: provider returned an invalid task handle")
	}
	return task, nil
}

// TaskOutputTool shares dispatch across task providers without owning their
// lifecycle. A read timeout never cancels a background task.
func TaskOutputTool(lookup TaskLookup) Tool {
	return Tool{Schema: ToolSchema{Name: "TaskOutput", Description: "Read a running or completed agent, shell or workflow task owned by this exact parent. block defaults to true; timeout is milliseconds, default 30000, maximum 600000. A read timeout leaves the task running.", InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{"task_id":{"type":"string","minLength":1},"block":{"type":"boolean"},"timeout":{"type":"integer","minimum":0,"maximum":600000}},"required":["task_id"]}`)}, Timeout: 605 * time.Second, IsConcurrencySafe: func(context.Context, ToolRequest) bool { return true }, ExecuteRequest: func(ctx context.Context, request ToolRequest) (ToolResult, error) {
		var input struct {
			ID      string `json:"task_id"`
			Block   *bool  `json:"block"`
			Timeout *int   `json:"timeout"`
		}
		if err := json.Unmarshal(request.Arguments, &input); err != nil {
			return ToolResult{}, err
		}
		task, err := lookupTaskHandle(ctx, request, input.ID, lookup)
		if err != nil {
			return ToolResult{}, err
		}
		select {
		case <-task.Done:
			return task.Snapshot(TaskRetrieved), nil
		default:
		}
		if input.Block != nil && !*input.Block {
			return task.Snapshot(TaskNotReady), nil
		}
		timeout := 30000
		if input.Timeout != nil {
			timeout = *input.Timeout
		}
		timer := time.NewTimer(time.Duration(timeout) * time.Millisecond)
		defer timer.Stop()
		select {
		case <-task.Done:
			return task.Snapshot(TaskRetrieved), nil
		case <-timer.C:
			return task.Snapshot(TaskTimedOut), nil
		case <-ctx.Done():
			return ToolResult{}, ctx.Err()
		}
	}}
}

func TaskStopTool(lookup TaskLookup) Tool {
	return Tool{Schema: ToolSchema{Name: "TaskStop", Description: "Cancel an agent, shell or workflow task owned by this exact parent and join its cleanup. Completed tasks retain their terminal result.", InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{"task_id":{"type":"string","minLength":1}},"required":["task_id"]}`)}, IsConcurrencySafe: func(context.Context, ToolRequest) bool { return true }, ExecuteRequest: func(ctx context.Context, request ToolRequest) (ToolResult, error) {
		var input struct {
			ID string `json:"task_id"`
		}
		if err := json.Unmarshal(request.Arguments, &input); err != nil {
			return ToolResult{}, err
		}
		task, err := lookupTaskHandle(ctx, request, input.ID, lookup)
		if err != nil {
			return ToolResult{}, err
		}
		return task.Stop(ctx)
	}}
}
