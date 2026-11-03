package pluginruntime

import (
	"context"
	"encoding/json"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
)

func sessionHookModel(agent *harness.Agent, input claudehooks.Input) string {
	if input.Event != "SessionStart" || input.Model != "" || agent == nil {
		return input.Model
	}
	return agent.Model()
}

func customSessionTitle(agent *harness.Agent) string {
	if agent == nil || agent.Session() == nil {
		return ""
	}
	events := agent.Session().Events()
	for index := len(events) - 1; index >= 0; index-- {
		if events[index].Type != "session/title" {
			continue
		}
		var body struct {
			Title string `json:"title"`
		}
		if json.Unmarshal(events[index].Data, &body) == nil {
			return body.Title
		}
	}
	return ""
}

func (app *HookApp) finishSessionStart(ctx context.Context, agent *harness.Agent, source string, decision claudehooks.Decision) error {
	if decision.WatchPaths != nil {
		app.setDynamicWatches(agent, decision.WatchPaths)
	}
	if (source == "startup" || source == "resume") && decision.SessionTitle != "" {
		if err := app.storeSessionTitle(agent, decision.SessionTitle); err != nil {
			return err
		}
	}
	if decision.ReloadSkills && app.options.ReloadSkills != nil {
		return app.options.ReloadSkills(ctx)
	}
	return nil
}

func (app *HookApp) storeSessionTitle(agent *harness.Agent, title string) error {
	if app == nil || agent == nil || agent.Session() == nil || title == "" {
		return nil
	}
	_, err := agent.Session().Append("session/title", map[string]string{"title": title})
	return err
}

func blockedPromptReason(decision claudehooks.Decision, prompt string) string {
	if !decision.Stop && !decision.Block {
		return ""
	}
	reason := decision.Reason
	if reason == "" {
		reason = "Claude command hook rejected this user prompt."
	}
	if !decision.SuppressOriginalPrompt && prompt != "" {
		reason += "\nOriginal prompt: " + prompt
	}
	return reason
}
