package pluginruntime

import (
	"context"
	"encoding/json"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
)

// Starting a run can inject child context before Begin. The same retained
// context is not injected on resume; compaction can remove it for a later run.

func (app *HookApp) startingChild(ctx context.Context, child *harness.Agent) error {
	decision, err := app.event(ctx, child, claudehooks.Input{Event: "SubagentStart"})
	if err != nil || decision.AdditionalContext == "" {
		return err
	}
	messages, err := child.Session().DeriveMessages()
	if err != nil {
		return err
	}
	for _, message := range messages {
		var source struct {
			Kind  string `json:"kind"`
			Event string `json:"event"`
		}
		if json.Unmarshal(message.Source, &source) == nil && source.Kind == "claude-hook" && source.Event == "SubagentStart" && messageText(message) == decision.AdditionalContext {
			return nil
		}
	}
	return child.Inject(hookMessage("SubagentStart", decision.AdditionalContext))
}
