package nativetools

import (
	"context"
	"fmt"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/shell"
)

type shellTaskPromotion struct {
	Version    int               `json:"version"`
	ID         string            `json:"task_id"`
	Owner      harness.SessionID `json:"owner"`
	TimeoutMS  int64             `json:"timeout_ms"`
	NoDeadline bool              `json:"no_deadline,omitempty"`
}

// promote changes only how the caller waits for the already-started process.
// The lifecycle lock orders its durable transition before the terminal fact.
func (s *shellTasks) promote(ctx context.Context, task *shellTask) (bool, error) {
	task.lifecycle.Lock()
	defer task.lifecycle.Unlock()
	select {
	case <-task.processDone:
		return false, nil
	default:
	}
	if err := ctx.Err(); err != nil {
		return false, err
	}
	select {
	case <-task.started:
	default:
		return false, nil
	}
	task.mu.Lock()
	settled, already := task.terminal != nil, task.promotion != nil
	task.mu.Unlock()
	if settled || already {
		return already, nil
	}
	activity, err := s.subagents.RetainBackgroundActivity(task.parent)
	if err != nil {
		return false, err
	}
	retained := false
	defer func() {
		if !retained {
			activity.Release(nil)
		}
	}()
	promotion := shellTaskPromotion{Version: 1, ID: task.intent.ID, Owner: task.intent.Owner}
	if s.timingPolicy.mode == BashInteractive {
		promotion.NoDeadline = true
	} else {
		promotion.TimeoutMS = s.timingPolicy.backgroundDefault.Milliseconds()
	}
	if _, err := task.parent.Session().Append(shellTaskPromoted, promotion); err != nil {
		return false, fmt.Errorf("record Bash promotion: %w", err)
	}
	if err := task.parent.Session().Flush(ctx); err != nil {
		return false, fmt.Errorf("persist Bash promotion: %w", err)
	}
	task.mu.Lock()
	task.promotion = &promotion
	task.mu.Unlock()
	task.activity = activity
	retained = true
	if !promotion.NoDeadline {
		task.deadline = time.AfterFunc(time.Duration(promotion.TimeoutMS)*time.Millisecond, func() { task.cancel(shell.ErrTimeout) })
	}
	return true, nil
}
