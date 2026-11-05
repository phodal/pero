package pluginruntime

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
)

// modelNote is PostModelSwitch guidance for the next model request. A later
// switch replaces it, and it stays through retries of the turn that first used it.
type modelNote struct {
	text     string
	usedTurn int
}

func (app *HookApp) beforeModelSwitch(ctx context.Context, input *harness.ModelSwitchInput) error {
	tokens := lastContextTokens(input.Agent)
	decision, err := app.event(ctx, input.Agent, modelSwitchInput("PreModelSwitch", input, tokens))
	if err != nil {
		return err
	}
	if decision.Block || decision.Permission == "deny" || decision.Permission == "ask" {
		input.Reject = true
		input.Reason = decision.Reason
		if input.Reason == "" {
			input.Reason = "PreModelSwitch hook blocked the model switch."
		}
	}
	return nil
}

func (app *HookApp) afterModelSwitch(ctx context.Context, input harness.ModelSwitchInput) error {
	tokens := lastContextTokens(input.Agent)
	decision, err := app.event(ctx, input.Agent, modelSwitchInput("PostModelSwitch", &input, tokens))
	if err != nil {
		if errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
			return err
		}
		return nil
	}
	app.rememberModelNote(input.Agent, decision.AdditionalContext)
	return nil
}

func modelSwitchInput(event string, input *harness.ModelSwitchInput, tokens int) claudehooks.Input {
	return claudehooks.Input{
		Event: event, FromModel: input.FromModel, ToModel: input.To.Model,
		RequestedModel: input.RequestedModel, Source: input.Source, ContextTokens: &tokens,
	}
}

func (app *HookApp) rememberModelNote(agent *harness.Agent, text string) {
	app.mu.Lock()
	defer app.mu.Unlock()
	if app.modelNotes == nil {
		app.modelNotes = map[*harness.Agent]modelNote{}
	}
	if text == "" {
		delete(app.modelNotes, agent)
		return
	}
	app.modelNotes[agent] = modelNote{text: text}
}

func (app *HookApp) modelNoteForRequest(agent *harness.Agent, turn int) string {
	app.mu.Lock()
	defer app.mu.Unlock()
	note, ok := app.modelNotes[agent]
	if !ok || note.text == "" {
		return ""
	}
	if note.usedTurn == 0 {
		note.usedTurn = turn
		app.modelNotes[agent] = note
	}
	return note.text
}

func (app *HookApp) retireUsedModelNote(agent *harness.Agent, turn int) {
	app.mu.Lock()
	defer app.mu.Unlock()
	note, ok := app.modelNotes[agent]
	if ok && note.usedTurn != 0 && turn > note.usedTurn {
		delete(app.modelNotes, agent)
	}
}

func lastContextTokens(agent *harness.Agent) int {
	if agent == nil || agent.Session() == nil {
		return 0
	}
	events := agent.Session().Events()
	for index := len(events) - 1; index >= 0; index-- {
		if events[index].Type != "assistant/message" {
			continue
		}
		var payload struct {
			Usage *harness.TokenUsage `json:"usage"`
		}
		if json.Unmarshal(events[index].Data, &payload) != nil || payload.Usage == nil {
			return 0
		}
		return payload.Usage.InputTokens + payload.Usage.OutputTokens + payload.Usage.CacheReadTokens + payload.Usage.CacheWriteTokens
	}
	return 0
}
