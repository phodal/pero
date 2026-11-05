package main

import (
	"context"
	"errors"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

type launchReceipt struct {
	Model                 string                         `json:"model"`
	ContextWindow         int                            `json:"context_window"`
	MaxOutputTokens       int                            `json:"max_output_tokens"`
	ThinkingDisabled      bool                           `json:"thinking_disabled"`
	ImageInput            bool                           `json:"image_input"`
	MaxTurnSteps          int                            `json:"max_turn_steps"`
	OutputLimitRecoveries int                            `json:"output_limit_recoveries"`
	RequestTimeoutMS      int64                          `json:"request_timeout_ms"`
	Compaction            *harness.BasicCompactionConfig `json:"compaction,omitempty"`
	EnvironmentServices   bool                           `json:"environment_services"`
}

// A launch receipt is frozen host configuration, not current routing authority.
// Credentials, endpoints and environment values are never serialized here.
func mountLaunchReceipt(ctx context.Context, h *harness.Harness, receipt launchReceipt) error {
	definition := point.Define(point.Descriptor{ID: "cli/launch-receipt"}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
		_, err := h.Hooks().Published.On(run, func(_ context.Context, agent *harness.Agent) error {
			_, err := agent.Session().Append("agent/launch-config", receipt)
			return err
		})
		return nil, err
	})
	instance, err := h.Runtime().Mount(nil, "cli-launch-receipt", definition, nil)
	if err != nil {
		return err
	}
	if err = instance.WaitStable(ctx); err != nil {
		return err
	}
	if instance.Snapshot().State == point.Failed {
		return errors.New("launch receipt activation failed")
	}
	return nil
}
