package workflow

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/phodal/pero/harness/go/harness"
)

// The workflow task is not a child session. Give its notice an independent
// source kind and deterministic identity; the existing inbox deduplicates it.
func workflowNotice(terminal taskTerminal) harness.Message {
	summary := fmt.Sprintf("Background workflow %s finished with status %s.", terminal.ID, terminal.Status)
	raw, _ := json.Marshal(terminal)
	source, _ := json.Marshal(struct {
		Kind    string `json:"kind"`
		TaskID  string `json:"taskId"`
		Summary string `json:"summary"`
	}{"workflow-settled", terminal.ID, summary})
	return harness.Message{ID: "workflow-notice-" + terminal.ID, Role: harness.RoleUser, Source: source, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: summary}, {Type: harness.BlockText, Text: string(raw)}}}
}

func (app *App) notifyBackground(ctx context.Context, task *backgroundTask, terminal taskTerminal) {
	if terminal.Status != "completed" && terminal.Status != "failed" {
		return
	}
	if task.suppressNotice.Load() || ctx.Err() != nil || task.parent.CurrentTurnInterrupted() {
		return
	}
	app.mu.Lock()
	disabled := app.closed || app.fenced[task.parent]
	app.mu.Unlock()
	if disabled {
		return
	}
	parent, live := app.h.Agents().Get(task.parent.ID())
	if !live || parent != task.parent {
		return
	}
	delivery, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	err := parent.DeliverBackgroundNotice(delivery, workflowNotice(terminal))
	if err != nil {
		task.mu.Lock()
		task.noticeError = "Workflow settled, but completion notice delivery was not confirmed. Retrieve the actual result with TaskOutput."
		task.mu.Unlock()
	}
}
