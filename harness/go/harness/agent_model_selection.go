package harness

import (
	"context"
	"encoding/json"
)

// ModelSwitchInput is one requested session model change. Reject cancels it
// before the choice is recorded. Context is guidance for the next request.
type ModelSwitchInput struct {
	Agent          *Agent
	FromModel      string
	To             AgentModelSelection
	RequestedModel string
	Source         string
	Reject         bool
	Reason         string
	Context        string
}

// ModelSwitchRejectedError means a hook refused the switch. The session model
// is unchanged and the caller must not treat the session as corrupt.
type ModelSwitchRejectedError struct{ Reason string }

func (e *ModelSwitchRejectedError) Error() string {
	if e == nil || e.Reason == "" {
		return "model switch was blocked"
	}
	return e.Reason
}

// ModelSelection is the durable route for the next request. Reading the log
// keeps resume and fork behavior identical to live model switching.
func (a *Agent) ModelSelection() AgentModelSelection {
	if a.modelSelection != nil {
		return a.modelSelection(a.session)
	}
	if _, selected := a.session.LatestEvent("session/model-selected"); selected {
		if next, found, err := RecordedModelSelection(a.session); err == nil && found {
			return next
		}
	}
	return AgentModelSelection{Provider: a.provider, Model: a.model, ReasoningEffort: a.reasoningEffort}
}
func (a *Agent) SelectModel(ctx context.Context, next AgentModelSelection) error {
	if err := a.mutationAdmissionError(); err != nil {
		return err
	}
	if err := validateAgentModelSelection(next); err != nil {
		return err
	}
	prepared, _, _, _, err := prepareGenerateCall(ctx, a.adapter, a.modelInfo, GenerateRequest{Provider: next.Provider, Model: next.Model, ReasoningEffort: next.ReasoningEffort, Agent: a})
	if err != nil {
		return err
	}
	if err = ValidateReasoningEffort(prepared.ModelInfo, next.ReasoningEffort); err != nil {
		return err
	}
	if err := a.mutationAdmissionError(); err != nil {
		return err
	}
	current := a.ModelSelection()
	if current.Provider != next.Provider || current.Model != next.Model {
		switchInput := ModelSwitchInput{Agent: a, FromModel: current.Model, To: next, RequestedModel: next.Model, Source: "sdk"}
		if a.hooks != nil && a.hooks.PreModelSwitch != nil {
			switchInput, err = a.hooks.PreModelSwitch.Run(ctx, switchInput, func(_ context.Context, value ModelSwitchInput) (ModelSwitchInput, error) {
				return value, nil
			})
			if err != nil {
				return err
			}
			if switchInput.Reject {
				reason := switchInput.Reason
				if reason == "" {
					reason = "model switch was blocked"
				}
				return &ModelSwitchRejectedError{Reason: reason}
			}
		}
	}
	if _, err = a.session.Append("session/model-selected", next); err != nil {
		return err
	}
	if current.Provider != next.Provider || current.Model != next.Model {
		if a.hooks != nil && a.hooks.PostModelSwitch != nil {
			if _, err = a.hooks.PostModelSwitch.Run(ctx, ModelSwitchInput{Agent: a, FromModel: current.Model, To: next, RequestedModel: next.Model, Source: "sdk"}, func(_ context.Context, value ModelSwitchInput) (ModelSwitchInput, error) {
				return value, nil
			}); err != nil {
				return err
			}
		}
	}
	if a.session.DurabilityAttached() {
		return a.session.Flush(ctx)
	}
	return nil
}

// RecordedModelSelection folds durable conversation choice like the public DSH
// model-selection projection: a matching request header consumes a pending
// selection; later headers then become current until another explicit choice.
// No log is rewritten and an unmatched request cannot consume pending intent.
// ModelSelectionHistory is the serializable read-side fold shared by full
// Session reconstruction and incremental history caches.
type ModelSelectionHistory struct {
	Pending *AgentModelSelection `json:"pending,omitempty"`
	Last    *AgentModelSelection `json:"last,omitempty"`
}

func (state *ModelSelectionHistory) Apply(event Event) error {
	switch event.Type {
	case "session/model-selected":
		var value AgentModelSelection
		if err := json.Unmarshal(event.Data, &value); err != nil {
			return err
		}
		if err := validateAgentModelSelection(value); err != nil {
			return err
		}
		state.Pending = &value
	case "request/header":
		var header RequestHeaderEvent
		if err := json.Unmarshal(event.Data, &header); err != nil {
			return err
		}
		if header.TransientModel {
			return nil
		}
		if header.Provider == "" || header.Model == "" {
			return nil
		}
		value := AgentModelSelection{Provider: header.Provider, Model: header.Model, ReasoningEffort: header.ReasoningEffort}
		if state.Pending != nil && *state.Pending == value {
			state.Pending = nil
		}
		if header.AdapterDefaults != nil && header.AdapterDefaults.ReasoningEffort {
			value.ReasoningEffort = ""
		}
		state.Last = &value
	}
	return nil
}
func (state ModelSelectionHistory) Selection() (AgentModelSelection, bool) {
	if state.Pending != nil {
		return *state.Pending, true
	}
	if state.Last != nil {
		return *state.Last, true
	}
	return AgentModelSelection{}, false
}
func RecordedModelSelection(session *Session) (AgentModelSelection, bool, error) {
	var state ModelSelectionHistory
	for _, event := range session.Events() {
		if err := state.Apply(event); err != nil {
			return AgentModelSelection{}, false, err
		}
	}
	value, found := state.Selection()
	return value, found, nil
}
