package pluginruntime

import (
	"context"
	"strings"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

func (app *HookApp) mountAssistantDisplay(run *point.Run, hooks *harness.AgentHooks) error {
	_, err := hooks.AssistantReady.On(run, func(ctx context.Context, input harness.AssistantReadyInput) error {
		if input.Agent.Parent() != nil || !app.HoldsAssistantText() {
			return nil
		}
		var text strings.Builder
		for _, block := range input.Message.Content {
			if block.Type == harness.BlockText {
				text.WriteString(block.Text)
			}
		}
		original := text.String()
		shown := app.RenderAssistantText(ctx, input.Agent, original)
		// Run effects before acquiring the state lock: a hook may itself invoke
		// tools whose hook callbacks use the same per-agent state.
		_ = app.withAgent(ctx, input.Agent, func(_ context.Context, state *hookAgentState) error {
			state.displayOriginal, state.displayText = original, shown
			return nil
		})
		return nil
	})
	return err
}

// DisplayedAssistantText is safe from a synchronous session subscriber. It
// consumes only prepared presentation and never executes hooks or appends events.
func (app *HookApp) DisplayedAssistantText(_ context.Context, agent *harness.Agent, text string) string {
	app.mu.Lock()
	state := app.states[agent]
	app.mu.Unlock()
	if state == nil {
		return text
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.displayOriginal != text {
		return text
	}
	shown := state.displayText
	state.displayOriginal, state.displayText = "", ""
	return shown
}

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
