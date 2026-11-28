package campaignruntime

import (
	"errors"
	"testing"
	"time"

	"github.com/phodal/pero/server/internal/campaign"
	"github.com/phodal/pero/server/internal/runref"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/converter"
	"go.temporal.io/sdk/testsuite"
	"go.temporal.io/sdk/workflow"
)

func TestContinueAsNewKeepsOriginalRun(t *testing.T) {
	ref := runref.Ref{TaskID: "task", RunID: "original", Generation: 3}
	state := campaign.Start(campaign.PlanRef{ID: "campaign", TrialCount: 1})
	operation := state.Command().OperationID()
	state.Record(campaign.Trial{OperationID: operation, Run: &ref, Status: campaign.Running})

	var suite testsuite.WorkflowTestSuite
	before := suite.NewTestWorkflowEnvironment()
	before.RegisterWorkflowWithOptions(Workflow, workflow.RegisterOptions{Name: WorkflowName})
	before.SetContinueAsNewSuggested(true)
	before.ExecuteWorkflow(WorkflowName, WorkflowInput{State: state, PollInterval: time.Second})
	var next *workflow.ContinueAsNewError
	if err := before.GetWorkflowError(); !errors.As(err, &next) {
		t.Fatalf("expected Continue-as-New: %v", err)
	}
	var input WorkflowInput
	if err := converter.GetDefaultDataConverter().FromPayloads(next.Input, &input); err != nil {
		t.Fatal(err)
	}
	if trial := input.State.Trials[0]; trial.Run == nil || *trial.Run != ref || trial.OperationID != operation || input.State.Phase != campaign.Waiting {
		t.Fatalf("original execution lost across rollover: %+v", input.State)
	}

	after := suite.NewTestWorkflowEnvironment()
	after.RegisterActivityWithOptions(func(cmd campaign.TrialCommand) (campaign.Observation, error) {
		if cmd.Action != campaign.Observe || cmd.OperationID() != operation {
			return campaign.Observation{}, errors.New("rollover must observe the original execution")
		}
		return campaign.Observation{Trial: campaign.Trial{OperationID: operation, Run: &ref, Status: campaign.Succeeded}}, nil
	}, activity.RegisterOptions{Name: trialActivity})
	after.RegisterActivityWithOptions(func(campaign.Progress) error { return nil }, activity.RegisterOptions{Name: finishActivity})
	after.SetTestTimeout(5 * time.Second)
	after.ExecuteWorkflow(Workflow, input)
	var result campaign.Progress
	if err := after.GetWorkflowResult(&result); err != nil {
		t.Fatal(err)
	}
	if result.Outcome != campaign.ExecutionCompleted || result.Trials[0].Run == nil || *result.Trials[0].Run != ref {
		t.Fatalf("rollover did not finish the original execution: %+v", result)
	}
}

func TestCancelDuringFinalVerification(t *testing.T) {
	state := campaign.Start(campaign.PlanRef{ID: "campaign", TrialCount: 2, Mode: campaign.ReviewedPyBaMM})
	state.Current = 1
	state.Record(campaign.Trial{OperationID: state.Command().OperationID(), Status: campaign.Succeeded})
	evidence := campaign.ReviewedEvidence{Evidence: campaign.Evidence{Verification: campaign.Verification{Status: "consistent"}}}

	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterActivityWithOptions(func(campaign.TrialCommand) (campaign.ReviewedEvidence, error) {
		return evidence, nil
	}, activity.RegisterOptions{Name: verifyActivity})
	env.RegisterActivityWithOptions(func(campaign.Progress) error { return nil }, activity.RegisterOptions{Name: finishActivity})
	env.OnActivity(verifyActivity, state.Command()).After(2*time.Second).Return(evidence, nil)
	env.RegisterDelayedCallback(func() { env.SignalWorkflow(CancelSignal, nil) }, time.Second)
	env.ExecuteWorkflow(Workflow, WorkflowInput{State: state, PollInterval: time.Second})

	var result campaign.Progress
	if err := env.GetWorkflowResult(&result); err != nil {
		t.Fatal(err)
	}
	if result.Outcome != campaign.CampaignCancelled || len(result.Evidence) != 1 || result.Trials[1].Status != campaign.Succeeded {
		t.Fatalf("cancel did not preserve final execution and evidence: %+v", result)
	}
}
