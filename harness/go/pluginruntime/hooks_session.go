package pluginruntime

import (
	"context"
	"encoding/json"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
)

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
	if err := app.storeSessionTitle(agent, source, decision.SessionTitle); err != nil {
		return err
	}
	if decision.ReloadSkills && app.options.ReloadSkills != nil {
		return app.options.ReloadSkills(ctx)
	}
	return nil
}

func (app *HookApp) storeSessionTitle(agent *harness.Agent, source, title string) error {
	if app == nil || agent == nil || agent.Session() == nil || title == "" {
		return nil
	}
	if source != "startup" && source != "resume" {
		return nil
	}
	_, err := agent.Session().Append("session/title", map[string]string{"title": title})
	return err
}
