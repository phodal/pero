package campaignruntime

import (
	"time"

	"github.com/phodal/pero/server/internal/campaign"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

const (
	ReviewWorkflowName = "pero.research-campaign.v2"
	verifyActivity     = "campaign-verify-pybamm-v1"
	decisionActivity   = "campaign-record-decision-v1"
	decisionUpdate     = "decide-campaign-review"
)

func registerReview(ctx workflow.Context, state *campaign.Progress, ready workflow.Channel) error {
	busy := false
	return workflow.SetUpdateHandler(ctx, decisionUpdate, func(ctx workflow.Context, request campaign.Decision) (campaign.Decision, error) {
		if prior := state.Decision; prior != nil && request.RequestID == prior.RequestID && request.DecisionInput == prior.DecisionInput {
			return *prior, nil
		}
		if busy {
			return request, rejectReview("a decision is already being recorded")
		}
		now := workflow.Now(ctx)
		if err := state.CheckDecision(request.DecisionInput, now); err != nil {
			return request, rejectReview(err.Error())
		}
		busy = true
		defer func() { busy = false; ready.SendAsync(nil) }()
		request.DecidedAt = now.UTC()
		persist := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{StartToCloseTimeout: 12 * time.Second,
			RetryPolicy: &temporal.RetryPolicy{MaximumInterval: time.Minute}})
		if err := workflow.ExecuteActivity(persist, decisionActivity, state.Plan.ID, request).Get(ctx, nil); err != nil {
			return request, err
		}
		state.Decision = &request
		return request, nil
	})
}

func parkReview(ctx, activities workflow.Context, state *campaign.Progress, cancel workflow.ReceiveChannel, ready workflow.Channel) {
	now := workflow.Now(ctx)
	left := state.Gate.ExpiresAt.Sub(now)
	if state.CancelRequested || state.Decision != nil || left <= 0 {
		_ = workflow.Await(ctx, func() bool { return workflow.AllHandlersFinished(ctx) })
		state.CloseReview(workflow.Now(ctx))
		return
	}
	timerCtx, stop := workflow.WithCancel(ctx)
	defer stop()
	timer := workflow.NewTimer(timerCtx, min(left, time.Minute))
	tick := false
	selector := workflow.NewSelector(ctx)
	selector.AddFuture(timer, func(workflow.Future) { tick = true })
	selector.AddReceive(ready, func(ch workflow.ReceiveChannel, _ bool) { ch.Receive(ctx, nil) })
	selector.AddReceive(cancel, func(ch workflow.ReceiveChannel, _ bool) {
		ch.Receive(ctx, nil)
		state.RequestCancel()
	})
	selector.Select(ctx)
	if tick && workflow.Now(ctx).Before(state.Gate.ExpiresAt) {
		// Recover a committed cancellation even if the wakeup Signal was lost.
		var current campaign.Observation
		cmd := campaign.TrialCommand{CampaignID: state.Plan.ID, Index: 0, Action: campaign.Observe}
		if err := workflow.ExecuteActivity(activities, trialActivity, cmd).Get(ctx, &current); err == nil && current.CancelRequested {
			state.RequestCancel()
		}
	}
}
