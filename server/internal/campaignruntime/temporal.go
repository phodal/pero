package campaignruntime

import (
	"context"
	"errors"
	"time"

	"github.com/phodal/pero/server/internal/campaign"
	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/api/serviceerror"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/temporal"
)

const TaskQueue = "pero-research-campaigns-v1"
const ReviewTaskQueue = "pero-research-campaigns-v2"

type Temporal struct {
	Client       client.Client
	PollInterval time.Duration
}

func (t Temporal) Start(ctx context.Context, plan campaign.PlanRef) (string, error) {
	interval := t.PollInterval
	if interval <= 0 {
		interval = 15 * time.Second
	}
	name, queue := WorkflowName, TaskQueue
	if plan.Mode == campaign.ReviewedPyBaMM {
		name, queue = ReviewWorkflowName, ReviewTaskQueue
	}
	run, err := t.Client.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		ID: plan.ID, TaskQueue: queue,
		WorkflowIDConflictPolicy:                 enumspb.WORKFLOW_ID_CONFLICT_POLICY_FAIL,
		WorkflowIDReusePolicy:                    enumspb.WORKFLOW_ID_REUSE_POLICY_REJECT_DUPLICATE,
		WorkflowExecutionErrorWhenAlreadyStarted: true,
	}, name, WorkflowInput{State: campaign.Start(plan), PollInterval: interval})
	var started *serviceerror.WorkflowExecutionAlreadyStarted
	switch {
	case errors.As(err, &started):
		info, err := t.Client.DescribeWorkflowExecution(ctx, plan.ID, started.RunId)
		if err != nil {
			return "", err
		}
		id := info.GetWorkflowExecutionInfo().GetFirstRunId()
		if id == "" {
			id = started.RunId
		}
		return id, nil
	case err != nil:
		return "", err
	default:
		return run.GetFirstExecutionRunID(), nil
	}
}

func (t Temporal) Progress(ctx context.Context, id string) (campaign.Progress, error) {
	var state campaign.Progress
	value, err := t.Client.QueryWorkflow(ctx, id, "", ProgressQuery)
	if err != nil {
		return state, err
	}
	err = value.Get(&state)
	return state, err
}

func (t Temporal) Cancel(ctx context.Context, id string) error {
	return t.Client.SignalWorkflow(ctx, id, "", CancelSignal, nil)
}

type ReviewRejection struct{ reason string }

func (r *ReviewRejection) Error() string { return r.reason }

func (t Temporal) Review(ctx context.Context, id string, request campaign.Decision) (campaign.Decision, error) {
	var reply campaign.Decision
	handle, err := t.Client.UpdateWorkflow(ctx, client.UpdateWorkflowOptions{WorkflowID: id, UpdateID: request.RequestID,
		UpdateName: decisionUpdate, Args: []interface{}{request}, WaitForStage: client.WorkflowUpdateStageCompleted})
	if err == nil {
		err = handle.Get(ctx, &reply)
	}
	var rejected *temporal.ApplicationError
	if errors.As(err, &rejected) && rejected.Type() == "ReviewRejected" {
		return reply, &ReviewRejection{reason: rejected.Message()}
	}
	return reply, err
}
