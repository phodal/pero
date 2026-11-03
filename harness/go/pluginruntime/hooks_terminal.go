package pluginruntime

import (
	"context"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
)

func (app *HookApp) executeHook(ctx context.Context, agent *harness.Agent, plugin string, hook claudehooks.Hook, input claudehooks.Input, runner claudehooks.Runner) (claudehooks.Decision, error, bool) {
	switch {
	case hook.Agent:
		if !claudehooks.PromptHookAllowed(input.Event) || input.Event == "PermissionRequest" {
			return claudehooks.Decision{}, nil, false
		}
	case hook.MCPTool != "":
		if input.Event == "Setup" || input.Event == "SessionStart" && input.Source != "compact" {
			return claudehooks.Decision{}, nil, false
		}
	case hook.Prompt != "":
		if !claudehooks.PromptHookAllowed(input.Event) {
			return claudehooks.Decision{}, nil, false
		}
	}
	app.reportHookStatus(agent, hook.StatusMessage)
	defer app.reportHookStatus(agent, "")
	var decision claudehooks.Decision
	var err error
	switch {
	case hook.Agent:
		decision, err = app.runAgentHook(ctx, agent, hook, input)
	case hook.MCPTool != "":
		decision, err = app.runMCPHook(ctx, agent, plugin, hook, input)
	case hook.Prompt != "":
		decision, err = app.runPromptHook(ctx, agent, hook, input)
	case hook.URL != "":
		decision, err = runner.Post(ctx, hook, input)
	default:
		decision, err = runner.Run(ctx, hook, input)
	}
	return decision, err, true
}

func (app *HookApp) reportHookStatus(agent *harness.Agent, message string) {
	if app == nil || app.options.ReportStatus == nil {
		return
	}
	app.options.ReportStatus(agent, message)
}

func (app *HookApp) writeTerminal(sequence string) {
	if app == nil || sequence == "" || app.options.EmitTerminal == nil {
		return
	}
	app.options.EmitTerminal(sequence)
}
