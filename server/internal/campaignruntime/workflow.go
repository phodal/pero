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
		if workflow.GetInfo(ctx).GetContinueAsNewSuggested() {
			input.State = state
			return state, workflow.NewContinueAsNewError(ctx, WorkflowName, input)
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
			if state.Phase == campaign.Dispatching || state.Phase == campaign.Done || (state.CancelRequested && cmd.Action != campaign.Cancel) {
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
			return state, workflow.NewContinueAsNewError(ctx, WorkflowName, input)
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
