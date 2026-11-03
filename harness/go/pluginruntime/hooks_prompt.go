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
	text, err := agent.CompleteOnce(ctx, hook.Model, claudehooks.RenderPrompt(hook.Prompt, string(payload)))
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
