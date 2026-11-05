package pluginruntime

import (
	"context"
	"errors"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
)

// RunSetup executes Setup for an explicit init or maintenance launch.
// init also runs SessionStart startup. Hook failures do not stop the launch.
func (app *HookApp) RunSetup(ctx context.Context, agent *harness.Agent, trigger string) error {
	if app == nil || agent == nil {
		return nil
	}
	if trigger != "init" && trigger != "maintenance" {
		return errors.New("plugin-runtime: setup trigger must be init or maintenance")
	}
	if _, err := app.event(ctx, agent, claudehooks.Input{Event: "Setup", Trigger: trigger}); err != nil && errors.Is(err, context.Canceled) {
		return err
	}
	if trigger != "init" {
		return nil
	}
	if _, err := app.event(ctx, agent, claudehooks.Input{Event: "SessionStart", Source: "startup"}); err != nil && errors.Is(err, context.Canceled) {
		return err
	}
	return nil
}
