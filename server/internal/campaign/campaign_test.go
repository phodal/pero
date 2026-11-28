package campaign

import (
	"testing"

	"github.com/phodal/pero/server/internal/runref"
)

func TestCampaignProgress(t *testing.T) {
	original := runref.Ref{TaskID: "task", RunID: "first", Generation: 1}
	later := runref.Ref{TaskID: "another-task", RunID: "second", Generation: 1}
	type step struct {
		action Action
		index  int
		status TrialStatus
		run    *runref.Ref
		stop   bool
		phase  Phase
	}
	for _, scenario := range []struct {
		name    string
		steps   []step
		outcome Outcome
		last    TrialStatus
	}{
		{"all trials complete in plan order", []step{
			{Ensure, 0, Queued, &original, false, Waiting},
			{Observe, 0, Succeeded, &original, false, Dispatching},
			{Ensure, 1, Running, &later, false, Waiting},
			{Observe, 1, Succeeded, &later, false, Done},
		}, ExecutionCompleted, Succeeded},
		{"cancellation stays pending until the owner resolves uncertainty", []step{
			{Ensure, 0, Reconcile, &original, false, PendingReconciliation},
			{Cancel, 0, Reconcile, &original, true, PendingReconciliation},
			{Cancel, 0, Reconciled, &original, false, Done},
		}, CampaignCancelled, Skipped},
		{"settled lost execution still fails the round", []step{
			{Ensure, 0, Reconcile, &original, false, PendingReconciliation},
			{Observe, 0, Reconciled, &original, false, Done},
		}, ExecutionFailed, Skipped},
		{"failed trial stops the round", []step{
			{Ensure, 0, Failed, &original, false, Done},
		}, ExecutionFailed, Skipped},
		{"cancel before dispatch", []step{
			{Cancel, 0, Cancelled, nil, true, Done},
		}, CampaignCancelled, Skipped},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			state := Start(PlanRef{ID: "campaign", Project: "lab", TrialCount: 2})
			for _, next := range scenario.steps {
				if next.stop {
					state.RequestCancel()
				}
				cmd := state.Command()
				if cmd.Action != next.action || cmd.Index != next.index {
					t.Fatalf("expected %s at position %d, got %+v", next.action, next.index, cmd)
				}
				state.Record(Trial{OperationID: cmd.OperationID(), Run: next.run, Status: next.status})
				if state.Phase != next.phase {
					t.Fatalf("expected phase %s, got %+v", next.phase, state)
				}
			}
			if state.Outcome != scenario.outcome || state.Trials[1].Status != scenario.last {
				t.Fatalf("unexpected outcome or trial denominator: %+v", state)
			}
		})
	}
}
