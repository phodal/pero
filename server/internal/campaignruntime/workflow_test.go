package campaignruntime

import (
	"testing"
	"time"

	"github.com/phodal/pero/server/internal/campaign"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/testsuite"
)

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
