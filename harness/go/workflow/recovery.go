package workflow

import (
	"context"
	"sort"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

type recoveryPhase int

const (
	stageRecovery recoveryPhase = iota
	liveRecovery
)

func (app *App) registerNoticeRecovery(run *point.Run) error {
	if _, err := app.h.Hooks().BeforeInboxResume.On(run, func(ctx context.Context, parent *harness.Agent) error {
		return app.reconcileNotices(ctx, parent, stageRecovery)
	}); err != nil {
		return err
	}
	_, err := app.h.Hooks().PreStep.Use(run, func(ctx context.Context, input harness.StepInput, next point.Next[harness.StepInput]) (harness.StepInput, error) {
		if err := app.reconcileNotices(ctx, input.Agent, liveRecovery); err != nil {
			return input, err
		}
		return next(input)
	})
	return err
}

// A source terminal plus the stable inbox identity is the outbox. A separate
// acknowledgement database would introduce another crash window. The durable
// inbox deduplicates both pending and already consumed identities.
func (app *App) reconcileNotices(ctx context.Context, parent *harness.Agent, phase recoveryPhase) error {
	if parent == nil || !parent.Session().DurabilityAttached() {
		return nil
	}
	if live, ok := app.h.Agents().Get(parent.ID()); !ok || live != parent {
		return harness.ErrAgentRetired
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	events := parent.Session().Events()
	// Resume restores the last durable turn number; a new admitted turn
	// advances it before PreStep. Reuse the common interruption correlation.
	if parent.CurrentTurnInterrupted() {
		return nil
	}
	history, err := foldBackground(events, parent.ID())
	if err != nil {
		return err
	}
	ids := make([]string, 0, len(history))
	for id := range history {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return history[ids[i]].startedSeq < history[ids[j]].startedSeq })
	for _, id := range ids {
		app.mu.Lock()
		if app.closed || app.fenced[parent] {
			app.mu.Unlock()
			return point.ErrInactiveRun
		}
		_, err := app.restoreLocked(ctx, parent, id, history[id])
		app.mu.Unlock()
		if err != nil {
			return err
		}
	}
	history, err = foldBackground(parent.Session().Events(), parent.ID())
	if err != nil {
		return err
	}
	sort.Slice(ids, func(i, j int) bool { return history[ids[i]].settledSeq < history[ids[j]].settledSeq })
	for _, id := range ids {
		app.mu.Lock()
		task := app.background[id]
		app.mu.Unlock()
		task.mu.Lock()
		terminal := task.terminal
		persisted := task.terminalPersisted
		task.mu.Unlock()
		if !persisted || terminal == nil || task.suppressNotice.Load() || terminal.Status == "stopped" {
			continue
		}
		notice := workflowNotice(*terminal)
		if phase == stageRecovery {
			err = parent.StageBackgroundNotice(ctx, notice)
		} else {
			err = parent.DeliverBackgroundNotice(ctx, notice)
		}
		if err != nil {
			return err
		}
	}
	return nil
}
