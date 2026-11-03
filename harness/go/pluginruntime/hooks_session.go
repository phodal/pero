package pluginruntime

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

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

func (app *HookApp) Startup(ctx context.Context, agent *harness.Agent) (string, error) {
	var initial string
	err := app.withAgent(ctx, agent, func(ctx context.Context, state *hookAgentState) error {
		decision, err := app.startSession(ctx, agent, state)
		if err != nil {
			return err
		}
		initial = decision.InitialUserMessage
		app.rememberSessionContext(agent, decision.AdditionalContext)
		return nil
	})
	return initial, err
}

func (app *HookApp) startSession(ctx context.Context, agent *harness.Agent, state *hookAgentState) (claudehooks.Decision, error) {
	if state.started {
		return claudehooks.Decision{}, nil
	}
	app.ensureFileWatch(agent)
	source := "startup"
	if !agent.FreshSession() {
		source = "resume"
	}
	decision, err := app.event(ctx, agent, claudehooks.Input{Event: "SessionStart", Source: source, SessionTitle: customSessionTitle(agent), Model: sessionHookModel(agent, claudehooks.Input{Event: "SessionStart"})})
	if err != nil {
		return claudehooks.Decision{}, err
	}
	if decision.Stop {
		return claudehooks.Decision{}, fmt.Errorf("%w: %s", ErrHookStopped, decision.Reason)
	}
	if err := app.finishSessionStart(ctx, agent, source, decision); err != nil {
		return claudehooks.Decision{}, err
	}
	state.started = true
	return decision, nil
}

func (app *HookApp) rememberSessionContext(agent *harness.Agent, text string) {
	if app == nil || agent == nil || text == "" {
		return
	}
	app.mu.Lock()
	defer app.mu.Unlock()
	if app.pendingContext == nil {
		app.pendingContext = map[*harness.Agent][]string{}
	}
	app.pendingContext[agent] = append(app.pendingContext[agent], text)
}

func (app *HookApp) takeSessionContext(agent *harness.Agent) string {
	if app == nil || agent == nil {
		return ""
	}
	app.mu.Lock()
	defer app.mu.Unlock()
	parts := app.pendingContext[agent]
	delete(app.pendingContext, agent)
	return strings.Join(parts, "\n")
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
