// Package campaign owns the finite progression of a shared research plan.
package campaign

import (
	"strconv"

	"github.com/phodal/pero/server/internal/runref"
)

// The first plan version runs one ordered round with a single trial in flight.
const MaxTrials = 8

type PlanRef struct {
	ID         string `json:"id"`
	Project    string `json:"project_id"`
	Digest     string `json:"plan_digest"`
	TrialCount int    `json:"trial_count"`
	Mode       string `json:"mode,omitempty"`
}

type Action string

const (
	Ensure  Action = "ensure"
	Observe Action = "observe"
	Cancel  Action = "cancel"
)

type TrialCommand struct {
	CampaignID string
	Index      int
	Action     Action
}

func (c TrialCommand) OperationID() string {
	return c.CampaignID + "-trial-" + strconv.Itoa(c.Index+1)
}

type TrialStatus string

const (
	NotStarted TrialStatus = "not_started"
	Queued     TrialStatus = "queued"
	Running    TrialStatus = "running"
	Stopping   TrialStatus = "cancel_requested"
	Reconcile  TrialStatus = "reconcile"
	Succeeded  TrialStatus = "succeeded"
	Failed     TrialStatus = "failed"
	Cancelled  TrialStatus = "cancelled"
	Reconciled TrialStatus = "reconciled"
	Rejected   TrialStatus = "rejected"
	Skipped    TrialStatus = "skipped"
)

type Trial struct {
	OperationID string      `json:"operation_id"`
	Run         *runref.Ref `json:"run,omitempty"`
	Status      TrialStatus `json:"status"`
}

type Observation struct {
	Trial           Trial `json:"trial"`
	CancelRequested bool  `json:"cancel_requested"`
}

type Phase string

const (
	Starting              Phase = "starting"
	Accepted              Phase = "accepted"
	Dispatching           Phase = "dispatching"
	Waiting               Phase = "waiting"
	Cancelling            Phase = "cancelling"
	PendingReconciliation Phase = "pending_reconciliation"
	Unavailable           Phase = "unavailable"
	Done                  Phase = "done"
)

type Outcome string

const (
	ExecutionCompleted Outcome = "execution_completed"
	ExecutionFailed    Outcome = "execution_failed"
	CampaignCancelled  Outcome = "cancelled"
)

type Progress struct {
	Plan            PlanRef     `json:"plan"`
	Phase           Phase       `json:"phase"`
	Outcome         Outcome     `json:"outcome,omitempty"`
	Trials          []Trial     `json:"trials"`
	Current         int         `json:"current"`
	CancelRequested bool        `json:"cancel_requested"`
	Evidence        []Evidence  `json:"evidence,omitempty"`
	Gate            *ReviewGate `json:"review_gate,omitempty"`
	Decision        *Decision   `json:"decision,omitempty"`
}

func Start(plan PlanRef) Progress {
	state := Progress{Plan: plan, Phase: Dispatching, Trials: make([]Trial, plan.TrialCount)}
	for i := range state.Trials {
		state.Trials[i] = Trial{OperationID: (TrialCommand{CampaignID: plan.ID, Index: i}).OperationID(), Status: NotStarted}
	}
	return state
}

func (p Progress) Command() TrialCommand {
	cmd := TrialCommand{CampaignID: p.Plan.ID, Index: p.Current, Action: Ensure}
	switch {
	case p.CancelRequested:
		cmd.Action = Cancel
	case p.Trials[p.Current].Run != nil:
		cmd.Action = Observe
	}
	return cmd
}

func (p *Progress) RequestCancel() {
	if p.Phase != Done {
		p.CancelRequested = true
		if p.Phase != PendingReconciliation && p.Phase != AwaitingReview && p.Phase != Verifying {
			p.Phase = Cancelling
		}
	}
}

// Record consumes the latest observation of the current operation. An unresolved
// original execution holds the round even after cancellation was requested.
func (p *Progress) Record(trial Trial) {
	p.Trials[p.Current] = trial
	switch trial.Status {
	case Reconcile:
		p.Phase = PendingReconciliation
	case Queued, Running, Stopping:
		p.Phase = Waiting
		if p.CancelRequested {
			p.Phase = Cancelling
		}
	case Succeeded, Failed, Cancelled, Reconciled, Rejected:
		if p.Plan.Mode == ReviewedPyBaMM && trial.Status == Succeeded && !p.CancelRequested {
			p.Phase = Verifying
			return
		}
		p.Current++
		switch {
		case p.CancelRequested:
			p.finish(CampaignCancelled)
		case trial.Status != Succeeded:
			p.finish(ExecutionFailed)
		case p.Current == len(p.Trials):
			p.finish(ExecutionCompleted)
		default:
			p.Phase = Dispatching
		}
	}
}

func (p *Progress) finish(outcome Outcome) {
	p.Phase, p.Outcome = Done, outcome
	for i := p.Current; i < len(p.Trials); i++ {
		p.Trials[i].Status = Skipped
	}
}
