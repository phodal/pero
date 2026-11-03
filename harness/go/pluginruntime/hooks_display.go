package pluginruntime

import (
	"context"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
)

// HoldsAssistantText reports whether a finished assistant message should wait
// for MessageDisplay before the client sees it.
func (app *HookApp) HoldsAssistantText() bool {
	return app.hasHookEvent("MessageDisplay")
}

// RenderAssistantText runs MessageDisplay once for the completed message.
// A hook failure or omitted displayContent keeps the original text. The
// stored transcript is not changed here.
func (app *HookApp) RenderAssistantText(ctx context.Context, agent *harness.Agent, text string) string {
	if app == nil || agent == nil || text == "" || !app.HoldsAssistantText() {
		return text
	}
	decision, err := app.event(ctx, agent, claudehooks.Input{
		Event: "MessageDisplay", Delta: text, Final: true,
		TurnID: string(agent.ID()), MessageID: string(agent.ID()) + ":assistant",
	})
	if err != nil || decision.DisplayContent == nil {
		return text
	}
	return *decision.DisplayContent
}
