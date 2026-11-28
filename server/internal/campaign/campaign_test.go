package campaign

import (
	"testing"
	"time"

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

func TestReviewedCampaignGate(t *testing.T) {
	now := time.Date(2026, 11, 28, 0, 0, 0, 0, time.UTC)
	ref := runref.Ref{TaskID: "task", RunID: "run", Generation: 1}
	for _, scenario := range []struct {
		name, verdict, choice string
		at                    time.Time
		stale                 bool
		want                  Phase
		outcome               Outcome
	}{
		{"verify and approve", "consistent", "approve", now, false, Dispatching, ""},
		{"verify and reject", "consistent", "reject", now, false, Done, ReviewRejected},
		{"ignore stale evidence", "consistent", "approve", now, true, AwaitingReview, ""},
		{"expire on the deadline", "consistent", "approve", now.Add(ReviewWindow), false, Done, ReviewExpired},
		{"missing output blocks review", "missing", "approve", now, false, Done, VerificationFailed},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			state := Start(PlanRef{ID: "campaign", Digest: "plan", TrialCount: 2, Mode: ReviewedPyBaMM})
			state.Record(Trial{OperationID: "first", Run: &ref, Status: Succeeded})
			if state.Phase != Verifying {
				t.Fatalf("execution bypassed verification: %+v", state)
			}
			gate := ReviewGate{ID: "gate", PlanDigest: "plan", EvidenceDigest: "observed", ExpiresAt: now.Add(ReviewWindow)}
			state.RecordVerification(ReviewedEvidence{Gate: &gate, Evidence: Evidence{Verification: Verification{Status: scenario.verdict}, Run: ref}})
			if state.Phase == AwaitingReview {
				req := DecisionInput{GateID: gate.ID, PlanDigest: gate.PlanDigest, EvidenceDigest: gate.EvidenceDigest, Choice: scenario.choice}
				if scenario.stale {
					req.EvidenceDigest = "older"
				}
				if err := state.CheckDecision(req, scenario.at); err == nil {
					state.Decision = &Decision{DecisionInput: req}
				}
				state.CloseReview(scenario.at)
			}
			if state.Phase != scenario.want || state.Outcome != scenario.outcome || state.Trials[0].Status != Succeeded ||
				(state.Phase == Done && state.Trials[1].Status != Skipped) {
				t.Fatalf("unexpected reviewed outcome: %+v", state)
			}
		})
	}
}
