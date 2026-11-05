package subagents

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/phodal/pero/harness/go/harness"
)

func (s *claudeDelegation) resume(ctx context.Context, parent *harness.Agent, id harness.SessionID, prompt string, background bool) (*claudeTask, error) {
	if parent == nil || id == "" || strings.TrimSpace(prompt) == "" {
		return nil, errors.New("subagents: resume requires an exact parent, child ID and prompt")
	}
	s.mu.Lock()
	previous := s.tasks[id]
	s.mu.Unlock()
	if previous != nil && previous.parent != parent {
		return nil, errors.New("subagents: resumed task belongs to another parent")
	}
	if previous != nil {
		select {
		case <-previous.done:
		default:
			if background {
				previous.notifyParent.Store(true)
			}
			if _, err := s.facade.SendMessage(ctx, parent, id, []harness.ContentBlock{{Type: harness.BlockText, Text: prompt}}); err != nil {
				return nil, err
			}
			return previous, nil
		}
	}
	ctx = context.WithValue(ctx, claudeBackgroundActivationKey{}, background)
	activation, err := s.facade.ResumeActivation(ctx, parent, id, harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: prompt}}})
	if err != nil {
		return nil, err
	}
	task := &claudeTask{parent: parent, activation: activation, done: make(chan struct{})}
	task.notifyParent.Store(background)
	s.mu.Lock()
	if current := s.tasks[id]; current != nil && current.activation.Done == activation.Done {
		if background {
			current.notifyParent.Store(true)
		}
		s.mu.Unlock()
		return current, nil
	}
	s.tasks[id] = task
	s.mu.Unlock()
	if err := s.run.Go("claude-resume/"+string(id), func(ctx context.Context) error { s.observeTask(ctx, task); return nil }); err != nil {
		_ = activation.RequestDispose()
		cleanupErr := activation.Wait(context.Background())
		task.result = harness.SubagentResult{ChildID: id, Status: harness.SubagentFailed, Reason: harness.FinishError, Diagnostic: "resume observer could not be started"}
		task.err = errors.Join(err, cleanupErr)
		close(task.done)
		return nil, task.err
	}
	return task, nil
}

func (s *claudeDelegation) sendMessageTool() harness.Tool {
	return harness.Tool{Schema: harness.ToolSchema{Name: "SendMessage", Description: "Continue or message a custom/general-purpose subagent by its exact agent ID in to. The original child history, definition and scoped tools are retained; current parent policy still applies. Explore/Plan are one-shot. Returns a real task_id; the settled result is delivered to the parent. Team and cross-session messaging are not implemented.", InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{"to":{"type":"string","minLength":1},"message":{"type":"string","minLength":1},"summary":{"type":"string"}},"required":["to","message"]}`)}, ExecuteRequest: func(ctx context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
		var input struct {
			To      string `json:"to"`
			Message string `json:"message"`
		}
		if err := json.Unmarshal(request.Arguments, &input); err != nil {
			return harness.ToolResult{}, err
		}
		task, err := s.resume(ctx, request.Agent, harness.SessionID(input.To), input.Message, true)
		if err != nil {
			return harness.ToolResult{}, err
		}
		return claudeTaskResult(task, "not_ready"), nil
	}}
}
