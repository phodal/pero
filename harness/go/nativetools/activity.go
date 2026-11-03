package nativetools

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/phodal/pero/harness/go/harness"
)

// Only a managed background child opts into this activity. Roots and
// foreground children keep their existing command ownership and exit policy.
func (s *shellTasks) completeActivity(ctx context.Context, task *shellTask, launched bool, durabilityErr error) {
	if task.activity == nil {
		return
	}
	defer func() { task.activity.Release(durabilityErr) }()
	if durabilityErr != nil || !launched || task.parent.CurrentTurnInterrupted() {
		return
	}
	s.mu.Lock()
	disabled := s.closed || s.fenced[task.parent] || !s.run.Active()
	s.mu.Unlock()
	if disabled {
		return
	}
	task.mu.Lock()
	status := task.terminal.Status
	task.mu.Unlock()
	summary := fmt.Sprintf("Background Bash %s finished with status %s.", task.intent.ID, status)
	source, _ := json.Marshal(struct {
		Kind   string `json:"kind"`
		TaskID string `json:"taskId"`
	}{"bash-settled", task.intent.ID})
	content := []harness.ContentBlock{{Type: harness.BlockText, Text: summary}}
	content = append(content, task.snapshot(harness.TaskRetrieved).Content...)
	message := harness.Message{ID: "bash-notice-" + task.intent.ID, Role: harness.RoleUser, Source: source, Content: content}
	if err := task.activity.Deliver(ctx, message); err != nil {
		durabilityErr = fmt.Errorf("Bash completion notice was not confirmed; do not replay the command: %w", err)
	}
}
