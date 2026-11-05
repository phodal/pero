package pluginruntime

import (
	"context"
	"encoding/json"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
)

// afterToolBatch runs once after every tool call in an assistant batch. It can
// add one context note or stop the loop before the next model call.
func (app *HookApp) afterToolBatch(ctx context.Context, input *harness.ToolBatchInput) error {
	raw, err := json.Marshal(input.Calls)
	if err != nil {
		return err
	}
	decision, err := app.event(ctx, input.Agent, claudehooks.Input{Event: "PostToolBatch", ToolCalls: raw})
	if err != nil {
		return err
	}
	if decision.Stop || decision.Block {
		input.Stop = true
		input.Reason = decision.Reason
	}
	input.Context = decision.AdditionalContext
	return nil
}
