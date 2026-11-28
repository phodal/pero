package campaignruntime

import (
	"time"

	"github.com/phodal/pero/server/internal/campaign"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

const (
	WorkflowName   = "pero.research-campaign.v1"
	ProgressQuery  = "progress"
	CancelSignal   = "cancel-campaign"
	trialActivity  = "campaign-trial-v1"
	finishActivity = "campaign-finish-v1"
)

type WorkflowInput struct {
	State        campaign.Progress
	PollInterval time.Duration
}

func Workflow(ctx workflow.Context, input WorkflowInput) (campaign.Progress, error) {
	state := input.State
	if err := workflow.SetQueryHandler(ctx, ProgressQuery, func() (campaign.Progress, error) {
		return state, nil
	}); err != nil {
		return state, err
	}
	cancel := workflow.GetSignalChannel(ctx, CancelSignal)
	name := WorkflowName
	var ready workflow.Channel
	if state.Plan.Mode == campaign.ReviewedPyBaMM {
		name = ReviewWorkflowName
		ready = workflow.NewBufferedChannel(ctx, 1)
		if err := registerReview(ctx, &state, ready); err != nil {
			return state, err
		}
	}
	activities := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 12 * time.Second, ScheduleToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{MaximumAttempts: 2},
	})
	for state.Phase != campaign.Done {
		if err := ctx.Err(); err != nil {
			return state, err
		}
		for cancel.ReceiveAsync(nil) {
			state.RequestCancel()
		}
		// Only roll history between short Activities, with the exact operation and
		// any original Run carried forward from the previous execution.
		if workflow.GetInfo(ctx).GetContinueAsNewSuggested() && (ready == nil || workflow.AllHandlersFinished(ctx)) {
			input.State = state
			return state, workflow.NewContinueAsNewError(ctx, name, input)
		}
		if state.Phase == campaign.AwaitingReview {
			parkReview(ctx, activities, &state, cancel, ready)
			continue
		}
		if state.Phase == campaign.Verifying {
			if state.CancelRequested {
				state.CancelVerification()
				continue
			}
			var evidence campaign.ReviewedEvidence
			err := workflow.ExecuteActivity(activities, verifyActivity, state.Command()).Get(ctx, &evidence)
			for cancel.ReceiveAsync(nil) {
				state.RequestCancel()
			}
			if err == nil {
				state.RecordVerification(evidence)
			} else {
				wait(ctx, input.PollInterval, cancel, &state)
			}
			continue
		}
		var observation campaign.Observation
		cmd := state.Command()
		err := workflow.ExecuteActivity(activities, trialActivity, cmd).Get(ctx, &observation)
		for cancel.ReceiveAsync(nil) {
			state.RequestCancel()
		}
		if err == nil {
			if observation.CancelRequested {
				state.RequestCancel()
			}
			state.Record(observation.Trial)
			if state.Phase == campaign.Dispatching || state.Phase == campaign.Done || state.Phase == campaign.Verifying || (state.CancelRequested && cmd.Action != campaign.Cancel) {
				continue
			}
		} else if state.CancelRequested && cmd.Action != campaign.Cancel {
			continue
		}
		delay := input.PollInterval
		if state.Phase == campaign.PendingReconciliation {
			delay *= 4
		}
		wait(ctx, delay, cancel, &state)
	}
	// The stable project record survives removal of closed Temporal history.
	for {
		if err := workflow.ExecuteActivity(activities, finishActivity, state).Get(ctx, nil); err == nil {
			return state, nil
		}
		if workflow.GetInfo(ctx).GetContinueAsNewSuggested() {
			input.State = state
			return state, workflow.NewContinueAsNewError(ctx, name, input)
		}
		if err := workflow.Sleep(ctx, input.PollInterval); err != nil {
			return state, err
		}
	}
}

func wait(ctx workflow.Context, delay time.Duration, cancel workflow.ReceiveChannel, state *campaign.Progress) {
	timerCtx, stop := workflow.WithCancel(ctx)
	defer stop()
	timer := workflow.NewTimer(timerCtx, delay)
	selector := workflow.NewSelector(ctx)
	selector.AddFuture(timer, func(workflow.Future) {})
	selector.AddReceive(cancel, func(ch workflow.ReceiveChannel, _ bool) {
		ch.Receive(ctx, nil)
		state.RequestCancel()
	})
	selector.Select(ctx)
}
