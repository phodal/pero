package pluginruntime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/tasks"
)

// applyTaskHooks runs TaskCreated and TaskCompleted after the task tool has
// committed. A blocking hook undoes that commit and returns the reason as the
// tool error. TaskUpdate ignores continue:false; exit 2 still prevents completion.
func (app *HookApp) applyTaskHooks(ctx context.Context, outcome *harness.ToolOutcome) error {
	if outcome.Result.IsError || outcome.Request.Agent == nil {
		return nil
	}
	switch outcome.Request.Name {
	case "TaskCreate":
		task, ok := taskFromToolResult(outcome.Result)
		if !ok {
			return nil
		}
		return app.blockTask(ctx, outcome, "TaskCreated", task, tasks.Deleted)
	case "TaskUpdate":
		var input struct {
			TaskID string `json:"taskId"`
			Status string `json:"status"`
		}
		if json.Unmarshal(outcome.Request.Arguments, &input) != nil || input.Status != string(tasks.Completed) {
			return nil
		}
		task, ok := taskFromToolResult(outcome.Result)
		if !ok || string(task.ID) != input.TaskID {
			return nil
		}
		previous, err := taskStatusBeforeLastChange(outcome.Request.Agent.Session(), task.ID)
		if err != nil || previous == "" || previous == tasks.Completed {
			return err
		}
		return app.blockTask(ctx, outcome, "TaskCompleted", task, previous)
	default:
		return nil
	}
}

func (app *HookApp) blockTask(ctx context.Context, outcome *harness.ToolOutcome, event string, task tasks.TaskView, rollback tasks.TaskStatus) error {
	decision, err := app.event(ctx, outcome.Request.Agent, claudehooks.Input{
		Event: event, TaskID: string(task.ID), TaskSubject: task.Subject, TaskDescription: task.Description,
	})
	if err != nil {
		return err
	}
	if event == "TaskCompleted" {
		decision.Stop = false
	}
	if decision.Stop {
		return fmt.Errorf("%w: %s", ErrHookStopped, decision.Reason)
	}
	if !decision.Block {
		return nil
	}
	status := rollback
	if _, err := tasks.Commit(ctx, outcome.Request.Agent.Session(), tasks.Command{Update: &tasks.Update{TaskID: task.ID, Status: &status}}); err != nil {
		return err
	}
	reason := decision.Reason
	if reason == "" {
		reason = "Claude command hook denied this task change."
	}
	outcome.Result = harness.ToolResult{IsError: true, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: reason}}}
	return nil
}

func taskFromToolResult(result harness.ToolResult) (tasks.TaskView, bool) {
	var text string
	for _, block := range result.Content {
		if block.Type == harness.BlockText {
			text += block.Text
		}
	}
	var body struct {
		Task tasks.TaskView `json:"task"`
	}
	if json.Unmarshal([]byte(text), &body) != nil || body.Task.ID == "" {
		return tasks.TaskView{}, false
	}
	return body.Task, true
}

func taskStatusBeforeLastChange(session *harness.Session, id tasks.TaskID) (tasks.TaskStatus, error) {
	if session == nil {
		return "", errors.New("plugin-runtime: task hook requires a session")
	}
	var changes []tasks.Change
	for _, event := range session.Events() {
		if event.Type != tasks.EventType {
			continue
		}
		var change tasks.Change
		if err := json.Unmarshal(event.Data, &change); err != nil {
			return "", err
		}
		changes = append(changes, change)
	}
	if len(changes) == 0 {
		return "", errors.New("plugin-runtime: task completion has no journal record")
	}
	state, err := tasks.Fold(changes[:len(changes)-1])
	if err != nil {
		return "", err
	}
	task, err := state.Get(id)
	if err != nil {
		return "", err
	}
	return task.Status, nil
}
