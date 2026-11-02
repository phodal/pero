package nativetools

import (
	"context"
	"errors"
	"fmt"

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
	stop := context.AfterFunc(ctx, func() {
		if task.cancel != nil {
			task.cancel(ctx.Err())
		}
	})
	defer stop()
	select {
	case <-handle.Done:
	case <-ctx.Done():
		if task.cancel != nil {
			task.cancel(ctx.Err())
		}
		<-handle.Done
	}
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
	return renderResult(result, err)
}
