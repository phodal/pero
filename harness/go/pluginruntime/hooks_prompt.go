package pluginruntime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
)

func (app *HookApp) runPromptHook(ctx context.Context, agent *harness.Agent, hook claudehooks.Hook, input claudehooks.Input) (claudehooks.Decision, error) {
	payload, err := json.Marshal(input)
	if err != nil {
		return claudehooks.Decision{}, err
	}
	timeout := hook.Timeout
	if timeout == 0 {
		timeout = 30 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	selection := agent.ModelSelection()
	if hook.Model != "" {
		if app.options.ResolveModel == nil {
			return claudehooks.Decision{}, errors.New("plugin-runtime: hook model requires an explicit plugin model mapping")
		}
		provider, model, err := app.options.ResolveModel(hook.Model)
		if err != nil {
			return claudehooks.Decision{}, err
		}
		selection.Provider, selection.Model, selection.ReasoningEffort = provider, model, ""
	}
	text, err := agent.CompleteOnceWithSelection(ctx, selection, claudehooks.RenderPrompt(hook.Prompt, string(payload)))
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return claudehooks.Decision{}, context.DeadlineExceeded
		}
		return claudehooks.Decision{}, fmt.Errorf("%w for %s: %s", claudehooks.ErrNonBlocking, hook.Event, err.Error())
	}
	decision, err := claudehooks.PromptDecision(hook.Event, hook.ContinueOnBlock, text)
	if err != nil {
		return claudehooks.Decision{}, fmt.Errorf("%w for %s: %s", claudehooks.ErrNonBlocking, hook.Event, err.Error())
	}
	return decision, nil
}
