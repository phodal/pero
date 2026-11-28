package campaignruntime

import (
	_ "embed"
	"os"
	"testing"

	historypb "go.temporal.io/api/history/v1"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
	"google.golang.org/protobuf/encoding/protojson"
)

//go:embed testdata/cancel-in-flight-v1.json
var cancelInFlightHistory []byte

//go:embed testdata/reviewed-pybamm-v2.json
var reviewedPyBaMMHistory []byte

func TestReplayCampaignV1(t *testing.T) {
	replay(t, WorkflowName, cancelInFlightHistory)
}

func TestReplayCampaignV2(t *testing.T) {
	data := reviewedPyBaMMHistory
	if path := os.Getenv("PERO_TEST_REVIEW_HISTORY"); path != "" {
		var err error
		data, err = os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
	}
	replay(t, ReviewWorkflowName, data)
}

func replay(t *testing.T, name string, data []byte) {
	t.Helper()
	history := &historypb.History{}
	if err := protojson.Unmarshal(data, history); err != nil {
		t.Fatal(err)
	}
	replayer := worker.NewWorkflowReplayer()
	replayer.RegisterWorkflowWithOptions(Workflow, workflow.RegisterOptions{Name: name})
	if err := replayer.ReplayWorkflowHistory(nil, history); err != nil {
		t.Fatal(err)
	}
}
