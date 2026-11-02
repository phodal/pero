package nativetools

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/shell"
)

// A foreground wait borrows the same owned execution; cancellation joins its
// process and file settlement rather than starting a second command.
func (s *shellTasks) waitForeground(ctx context.Context, parent *harness.Agent, id string, handle harness.TaskHandle) (harness.ToolResult, error) {
	s.mu.Lock()
	task := s.tasks[id]
	s.mu.Unlock()
	if task == nil || task.parent != parent {
		return harness.ToolResult{}, errors.New("foreground shell owner is unavailable")
	}
	select {
	case <-handle.Done:
		return renderForegroundTask(task)
	default:
	}
	task.mu.Lock()
	alreadyPromoted := task.promotion != nil
	task.mu.Unlock()
	if alreadyPromoted {
		return task.snapshot(harness.TaskNotReady), nil
	}
	stop := context.AfterFunc(ctx, func() {
		if task.cancel != nil {
			task.cancel(ctx.Err())
		}
	})
	defer stop()
	timer := time.NewTimer(task.timing.wait)
	defer timer.Stop()
	select {
	case <-handle.Done:
	case <-ctx.Done():
		if task.cancel != nil {
			task.cancel(ctx.Err())
		}
		<-handle.Done
	case <-timer.C:
		canPromote := task.timing.promote
		select {
		case <-task.started:
		default:
			canPromote = false
		}
		if canPromote {
			promoted, err := s.promote(ctx, task)
			if err != nil {
				task.cancel(err)
				<-handle.Done
				return harness.ToolResult{}, err
			}
			if promoted {
				return task.snapshot(harness.TaskNotReady), nil
			}
		} else {
			task.cancel(shell.ErrTimeout)
		}
		<-handle.Done
	}
	return renderForegroundTask(task)
}

func renderForegroundTask(task *shellTask) (harness.ToolResult, error) {
	task.mu.Lock()
	terminal := *task.terminal
	task.mu.Unlock()
	result := shell.RunResult{OutputFile: terminal.OutputFile, OutputFilePartial: terminal.OutputFilePartial}
	if terminal.Result != nil {
		result = *terminal.Result
	}
	var err error
	if terminal.Diagnostic != "" {
		err = errors.New(terminal.Diagnostic)
	} else if terminal.Status != shellTaskCompleted {
		err = fmt.Errorf("shell task ended with status %s", terminal.Status)
	}
	return renderBashResult(result, terminal.Presentation, err)
}
