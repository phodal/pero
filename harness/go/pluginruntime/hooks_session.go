package pluginruntime

import (
	"encoding/json"

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
