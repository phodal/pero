package pluginruntime

import (
	"context"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/skills"
)

// GuardSlash runs UserPromptExpansion before a typed slash command becomes a
// prompt. A block stops that expansion. Model Skill tool calls do not come here.
func (app *HookApp) GuardSlash(ctx context.Context, agent *harness.Agent, name, arguments, prompt string) (string, error) {
	if app == nil || agent == nil {
		return "", nil
	}
	decision, err := app.event(ctx, agent, claudehooks.Input{
		Event: "UserPromptExpansion", ExpansionType: "slash_command",
		CommandName: name, CommandArgs: arguments, CommandSource: "plugin", Prompt: prompt,
	})
	if err != nil {
		return "", err
	}
	if decision.Block {
		reason := decision.Reason
		if reason == "" {
			reason = "Claude command hook blocked this slash command."
		}
		return "", &skills.SlashBlockedError{Reason: reason}
	}
	return decision.AdditionalContext, nil
}
