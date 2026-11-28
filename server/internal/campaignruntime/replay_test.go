package campaignruntime

import (
	_ "embed"
	"testing"

	historypb "go.temporal.io/api/history/v1"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
	"google.golang.org/protobuf/encoding/protojson"
)

//go:embed testdata/cancel-in-flight-v1.json
var cancelInFlightHistory []byte

func TestReplayCampaignV1(t *testing.T) {
	history := &historypb.History{}
	if err := protojson.Unmarshal(cancelInFlightHistory, history); err != nil {
		t.Fatal(err)
	}
	replayer := worker.NewWorkflowReplayer()
	replayer.RegisterWorkflowWithOptions(Workflow, workflow.RegisterOptions{Name: WorkflowName})
	if err := replayer.ReplayWorkflowHistory(nil, history); err != nil {
		t.Fatal(err)
	}
}
