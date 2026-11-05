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

func (app *HookApp) runAgentHook(ctx context.Context, agent *harness.Agent, hook claudehooks.Hook, input claudehooks.Input) (claudehooks.Decision, error) {
	if app.options.RunAgent == nil {
		return claudehooks.Decision{}, fmt.Errorf("%w for %s: agent hook runner is not mounted", claudehooks.ErrNonBlocking, hook.Event)
	}
	payload, err := json.Marshal(input)
	if err != nil {
		return claudehooks.Decision{}, err
	}
	timeout := hook.Timeout
	if timeout == 0 {
		timeout = 60 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	text, err := app.options.RunAgent(ctx, agent, claudehooks.RenderPrompt(hook.Prompt, string(payload)), hook.Model)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return claudehooks.Decision{}, context.DeadlineExceeded
		}
		return claudehooks.Decision{}, fmt.Errorf("%w for %s: %s", claudehooks.ErrNonBlocking, hook.Event, err.Error())
	}
	decision, err := claudehooks.AgentDecision(hook.Event, text)
	if err != nil {
		return claudehooks.Decision{}, fmt.Errorf("%w for %s: %s", claudehooks.ErrNonBlocking, hook.Event, err.Error())
	}
	return decision, nil
}
