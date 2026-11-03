package claudehooks

import (
	"encoding/json"
	"errors"
)

// elicitationDecision reads an Elicitation or ElicitationResult answer.
// A top-level block declines and overrides action in the same output.
// reason, systemMessage, and continue are discarded.
func (wire output) elicitationDecision(event string) (Decision, error) {
	if wire.Decision != "" && wire.Decision != "block" {
		return Decision{}, errors.New("claudehooks: unsupported top-level hook decision")
	}
	if wire.Decision == "block" {
		return Decision{Action: "decline", Block: true}, nil
	}
	specific := wire.HookSpecificOutput
	if specific == nil || specific.Action == "" {
		if specific != nil && specific.Event != "" && specific.Event != event {
			return Decision{}, errors.New("claudehooks: hook output event does not match its invocation")
		}
		return Decision{}, nil
	}
	if specific.Event != "" && specific.Event != event {
		return Decision{}, errors.New("claudehooks: hook output event does not match its invocation")
	}
	switch specific.Action {
	case "accept", "decline", "cancel":
	default:
		return Decision{}, errors.New("claudehooks: elicitation action must be accept, decline, or cancel")
	}
	decision := Decision{Action: specific.Action}
	if specific.Action == "decline" || len(specific.Content) == 0 || string(specific.Content) == "null" {
		return decision, nil
	}
	if !jsonObject(specific.Content) {
		return Decision{}, errors.New("claudehooks: elicitation content must be a JSON object")
	}
	decision.Content = append(json.RawMessage(nil), specific.Content...)
	return decision, nil
}
