package nativetools

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/phodal/pero/harness/go/harness"
)

// The durable result is the notification source. Recovered task lookup may
// report missing files, but it cannot change a previously accepted message's
// content. Render a receipt from the original facts, without live delivery errors.
func bashNotice(history shellTaskHistory) harness.Message {
	receipt := shellTask{intent: history.intent, terminal: history.terminal, promotion: history.promotion}
	summary := fmt.Sprintf("Background Bash %s finished with status %s.", history.intent.ID, history.terminal.Status)
	source, _ := json.Marshal(struct {
		Kind   string `json:"kind"`
		TaskID string `json:"taskId"`
	}{"bash-settled", history.intent.ID})
	content := []harness.ContentBlock{{Type: harness.BlockText, Text: summary}}
	content = append(content, receipt.snapshot(harness.TaskRetrieved).Content...)
	return harness.Message{ID: "bash-notice-" + history.intent.ID, Role: harness.RoleUser, Source: source, Content: content}
}

func (s *shellTasks) notifyRoot(ctx context.Context, task *shellTask, attempted bool, durabilityErr error) {
	if !s.notifications || task.parent.Delegated() || !attempted || durabilityErr != nil || task.parent.CurrentTurnInterrupted() {
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
	if !history.intent.Background && history.promotion == nil {
		return
	}
	err := task.parent.DeliverBackgroundNotice(ctx, bashNotice(history))
	task.mu.Lock()
	if err != nil {
		task.noticeError = "Bash settled, but completion notice delivery was not confirmed. Retrieve the actual result with TaskOutput."
	} else {
		task.noticeError = ""
	}
	task.mu.Unlock()
}
