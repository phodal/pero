package nativetools

import (
	"context"
	"sort"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

func (s *shellTasks) registerNoticeRecovery(h *harness.Harness, run *point.Run) error {
	if _, err := h.Hooks().BeforeInboxResume.On(run, func(ctx context.Context, parent *harness.Agent) error {
		return s.reconcileNotices(ctx, parent, true)
	}); err != nil {
		return err
	}
	_, err := h.Hooks().PreStep.Use(run, func(ctx context.Context, input harness.StepInput, next point.Next[harness.StepInput]) (harness.StepInput, error) {
		if err := s.reconcileNotices(ctx, input.Agent, false); err != nil {
			return input, err
		}
		return next(input)
	})
	return err
}

// Source terminal facts plus the stable inbox IDs form the outbox. Stage all
// recovered notices before the controller resumes the existing inbox driver.
// Lost process owners are folded as interrupted, never executed again.
func (s *shellTasks) reconcileNotices(ctx context.Context, parent *harness.Agent, staging bool) error {
	if parent == nil || parent.Delegated() || !parent.Session().DurabilityAttached() || parent.CurrentTurnInterrupted() {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	s.mu.Lock()
	disabled := s.closed || s.fenced[parent] || !s.run.Active()
	s.mu.Unlock()
	if disabled {
		return point.ErrInactiveRun
	}
	history, err := foldShellTasks(parent.Session().Events(), parent.ID())
	if err != nil {
		return err
	}
	ids := make([]string, 0, len(history))
	for id, stored := range history {
		if stored.intent.Background || stored.promotion != nil {
			ids = append(ids, id)
		}
	}
	sort.Slice(ids, func(i, j int) bool { return history[ids[i]].startedSeq < history[ids[j]].startedSeq })
	for _, id := range ids {
		if _, _, err := s.lookup(ctx, parent, id); err != nil {
			return err
		}
	}
	history, err = foldShellTasks(parent.Session().Events(), parent.ID())
	if err != nil {
		return err
	}
	sort.Slice(ids, func(i, j int) bool { return history[ids[i]].settledSeq < history[ids[j]].settledSeq })
	for _, id := range ids {
		s.mu.Lock()
		task := s.tasks[id]
		s.mu.Unlock()
		if task == nil || task.parent != parent {
			return harness.ErrAgentRetired
		}
		task.mu.Lock()
		persisted := task.terminal != nil && task.terminalPersisted
		task.mu.Unlock()
		stored := history[id]
		if !persisted || stored.terminal == nil {
			continue
		}
		if staging {
			err = parent.StageBackgroundNotice(ctx, bashNotice(stored))
		} else {
			err = parent.DeliverBackgroundNotice(ctx, bashNotice(stored))
		}
		if err != nil {
			return err
		}
		task.mu.Lock()
		task.noticeError = ""
		task.mu.Unlock()
	}
	return nil
}
