package nativetools

import (
	"context"
	"fmt"
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
	history := shellTaskHistory{intent: task.intent, terminal: task.terminal, promotion: task.promotion}
	task.mu.Unlock()
	if err := task.activity.Deliver(ctx, bashNotice(history)); err != nil {
		durabilityErr = fmt.Errorf("Bash completion notice was not confirmed; do not replay the command: %w", err)
	}
}
