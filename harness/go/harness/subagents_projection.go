package harness

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"math"
)

const subagentProjectionMaxInteger = 1<<53 - 1

// SubagentIdentityProjection is display data, never continuation authority.
// Seq addresses the native, one-based log. The Host bridge independently folds
// projected events and exposes their zero-based sequence numbers.
type SubagentIdentityProjection struct {
	Mode  SubagentDescriptorMode `json:"mode"`
	Label *string                `json:"label,omitempty"`
	Seq   uint64                 `json:"seq"`
}

type subagentIdentityState struct {
	Identity *SubagentIdentityProjection `json:"identity,omitempty"`
}

// SubagentTimingInterval bounds an open turn at the latest folded event time.
type SubagentTimingInterval struct {
	Since   int64 `json:"since"`
	Through int64 `json:"through"`
}

// SubagentTimingProjection excludes pre-descriptor turns and elapsed wall time.
type SubagentTimingProjection struct {
	SettledMs         int64                   `json:"settledMs"`
	Active            *SubagentTimingInterval `json:"active,omitempty"`
	LastTurnCompleted *bool                   `json:"lastTurnCompleted,omitempty"`
}

type subagentTimingState struct {
	SettledMs         int64                   `json:"settledMs"`
	Active            *SubagentTimingInterval `json:"active,omitempty"`
	PendingTurnStart  *int64                  `json:"pendingTurnStart,omitempty"`
	DescriptorSeen    bool                    `json:"descriptorSeen"`
	LastTurnCompleted *bool                   `json:"lastTurnCompleted,omitempty"`
}

func cloneSubagentProjectionPointer[T any](value *T) *T {
	if value == nil {
		return nil
	}
	copy := *value
	return &copy
}

func validateSubagentIdentity(value *SubagentIdentityProjection) error {
	if value == nil {
		return nil
	}
	if value.Seq > subagentProjectionMaxInteger || (value.Mode != SubagentDescriptorOneShot && value.Mode != SubagentDescriptorContinuable) || (value.Mode == SubagentDescriptorContinuable && value.Label == nil) {
		return errors.New("subagent identity: invalid value")
	}
	return nil
}

// subagentProjectionFields enforces strict object schemas, including required
// fields and explicit nulls, which encoding/json otherwise accepts as zeroes.
func subagentProjectionFields(raw json.RawMessage, required []string, optional ...string) (map[string]json.RawMessage, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil || fields == nil {
		return nil, errors.New("subagent projection: expected an object")
	}
	allowed := make(map[string]bool, len(required)+len(optional))
	for _, key := range required {
		allowed[key] = true
		if _, ok := fields[key]; !ok {
			return nil, fmt.Errorf("subagent projection: missing %s", key)
		}
	}
	for _, key := range optional {
		allowed[key] = true
	}
	for key, value := range fields {
		if !allowed[key] || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return nil, fmt.Errorf("subagent projection: invalid field %s", key)
		}
	}
	return fields, nil
}

func subagentProjectionInteger(raw json.RawMessage) (int64, error) {
	var value float64
	if json.Unmarshal(raw, &value) != nil || value < 0 || value > subagentProjectionMaxInteger || math.Trunc(value) != value {
		return 0, errors.New("subagent projection: expected a nonnegative safe integer")
	}
	return int64(value), nil
}

func decodeSubagentIdentity(raw json.RawMessage) (*SubagentIdentityProjection, error) {
	fields, err := subagentProjectionFields(raw, []string{"mode", "seq"}, "label")
	if err != nil {
		return nil, err
	}
	value := &SubagentIdentityProjection{}
	if err := json.Unmarshal(fields["mode"], &value.Mode); err != nil {
		return nil, err
	}
	seq, err := subagentProjectionInteger(fields["seq"])
	if err != nil {
		return nil, err
	}
	value.Seq = uint64(seq)
	if raw, exists := fields["label"]; exists {
		if err := json.Unmarshal(raw, &value.Label); err != nil {
			return nil, err
		}
	}
	if err := validateSubagentIdentity(value); err != nil {
		return nil, err
	}
	return value, nil
}

// subagentDescriptorDisplayIdentity matches official descriptor v3 for display.
// Point's v4/v5 extension also remains displayable, after its native parser has
// accepted the record. Neither this last-wins fold nor its weaker official-v3
// validation replaces FoldSubagentDescriptor's first-own-descriptor authority.
func subagentDescriptorDisplayIdentity(event Event) *SubagentIdentityProjection {
	var fields map[string]json.RawMessage
	if json.Unmarshal(event.Data, &fields) != nil || fields == nil {
		return nil
	}
	var version float64
	if raw, ok := fields["version"]; !ok || json.Unmarshal(raw, &version) != nil {
		return nil
	}
	if version == 4 || version == 5 || version == subagentExplicitLabelDescriptorVersion {
		if _, supported, err := parseSubagentDescriptor(event.Data); err != nil || !supported {
			return nil
		}
	} else if version != 3 {
		return nil
	}
	var mode SubagentDescriptorMode
	if json.Unmarshal(fields["mode"], &mode) != nil || (mode != SubagentDescriptorOneShot && mode != SubagentDescriptorContinuable) {
		return nil
	}
	optional := []string{"label"}
	required := []string{"version", "mode", "provider"}
	if mode == SubagentDescriptorContinuable {
		required = append(required, "label")
		optional = []string{"agentProvider", "agentModel", "agentReasoningEffort", "persona", "toolFilter"}
		if version == 5 || version == subagentExplicitLabelDescriptorVersion {
			optional = append(optional, "suppressParentSettlement")
		}
	}
	if _, err := subagentProjectionFields(event.Data, required, optional...); err != nil {
		return nil
	}
	for _, key := range []string{"provider", "label", "agentProvider", "agentModel", "agentReasoningEffort", "persona"} {
		if raw, exists := fields[key]; exists {
			var value string
			if json.Unmarshal(raw, &value) != nil {
				return nil
			}
		}
	}
	if raw, exists := fields["toolFilter"]; exists {
		filter, err := subagentProjectionFields(raw, nil, "allow", "deny")
		if err != nil || len(filter) == 0 {
			return nil
		}
		for _, raw := range filter {
			var items []json.RawMessage
			if json.Unmarshal(raw, &items) != nil || items == nil {
				return nil
			}
			for _, item := range items {
				var text string
				if bytes.Equal(bytes.TrimSpace(item), []byte("null")) || json.Unmarshal(item, &text) != nil {
					return nil
				}
			}
		}
	}
	if raw, exists := fields["suppressParentSettlement"]; exists {
		var value bool
		if json.Unmarshal(raw, &value) != nil {
			return nil
		}
	}
	identity := &SubagentIdentityProjection{Mode: mode, Seq: event.Seq}
	if raw, exists := fields["label"]; exists {
		var label string
		_ = json.Unmarshal(raw, &label)
		identity.Label = &label
	}
	if validateSubagentIdentity(identity) != nil {
		return nil
	}
	return identity
}

// SubagentIdentityProjectionDefinition exposes the official v2 state and null
// wire sentinel. Every descriptor resets identity, including invalid payloads.
func SubagentIdentityProjectionDefinition() ProjectionDefinition {
	d := DefineProjection(ProjectionSpec[*subagentIdentityState, *SubagentIdentityProjection]{
		Key: "subagent", StateVersion: 2,
		Init: func(SessionHeader) *subagentIdentityState { return &subagentIdentityState{} },
		Apply: func(state *subagentIdentityState, event Event) *subagentIdentityState {
			if event.Type != "subagent/descriptor" {
				return state
			}
			return &subagentIdentityState{Identity: subagentDescriptorDisplayIdentity(event)}
		},
		ValidateState: func(state *subagentIdentityState) error {
			if state == nil {
				return errors.New("subagent identity: missing state")
			}
			return validateSubagentIdentity(state.Identity)
		},
		View: func(state *subagentIdentityState) *SubagentIdentityProjection {
			copy := cloneSubagentProjectionPointer(state.Identity)
			if copy != nil {
				copy.Label = cloneSubagentProjectionPointer(copy.Label)
			}
			return copy
		},
		ValidateView: validateSubagentIdentity,
	})
	d.DecodeState = func(raw json.RawMessage) (any, error) {
		fields, err := subagentProjectionFields(raw, nil, "identity")
		if err != nil {
			return nil, err
		}
		state := &subagentIdentityState{}
		if identity, exists := fields["identity"]; exists {
			state.Identity, err = decodeSubagentIdentity(identity)
		}
		return state, err
	}
	return d
}

func validateSubagentTiming(value SubagentTimingProjection) error {
	if value.SettledMs < 0 || value.SettledMs > subagentProjectionMaxInteger {
		return errors.New("subagent timing: invalid settledMs")
	}
	if value.Active != nil && (value.Active.Since < 0 || value.Active.Through < 0 || value.Active.Since > subagentProjectionMaxInteger || value.Active.Through > subagentProjectionMaxInteger) {
		return errors.New("subagent timing: invalid interval")
	}
	return nil
}

func (state *subagentTimingState) view() SubagentTimingProjection {
	return SubagentTimingProjection{SettledMs: state.SettledMs, Active: cloneSubagentProjectionPointer(state.Active), LastTurnCompleted: cloneSubagentProjectionPointer(state.LastTurnCompleted)}
}

func (state *subagentTimingState) validate() error {
	if state == nil {
		return errors.New("subagent timing: missing state")
	}
	if state.PendingTurnStart != nil && (*state.PendingTurnStart < 0 || *state.PendingTurnStart > subagentProjectionMaxInteger) {
		return errors.New("subagent timing: invalid pendingTurnStart")
	}
	return validateSubagentTiming(state.view())
}

// Native legacy turn-end strings use the same mapping as the Host's
// normalizePointTurnEnd; structured current reasons preserve their kind.
func subagentTurnCompleted(raw json.RawMessage) bool {
	var data struct {
		Reason json.RawMessage `json:"reason"`
	}
	if json.Unmarshal(raw, &data) != nil {
		return false
	}
	var reason struct {
		Kind string `json:"kind"`
	}
	trimmed := bytes.TrimSpace(data.Reason)
	if len(trimmed) > 0 && trimmed[0] == '{' {
		return json.Unmarshal(trimmed, &reason) == nil && reason.Kind == "completed"
	}
	var legacy string
	_ = json.Unmarshal(data.Reason, &legacy)
	switch legacy {
	case "max-tokens", "aborted", "error", "blocked":
		return false
	default:
		return true
	}
}

// SubagentTimingProjectionDefinition folds the official v3 timing state. All
// descriptors reset the origin, including inherited and malformed descriptors.
func SubagentTimingProjectionDefinition() ProjectionDefinition {
	d := DefineProjection(ProjectionSpec[*subagentTimingState, SubagentTimingProjection]{
		Key: "subagentTiming", StateVersion: 3,
		Init: func(SessionHeader) *subagentTimingState { return &subagentTimingState{} },
		Apply: func(state *subagentTimingState, event Event) *subagentTimingState {
			at := event.Time.UnixMilli()
			next := *state
			switch event.Type {
			case "turn/start":
				next.LastTurnCompleted = nil
				if state.DescriptorSeen {
					next.Active = &SubagentTimingInterval{Since: at, Through: at}
				} else {
					next.PendingTurnStart = &at
				}
			case "subagent/descriptor":
				next = subagentTimingState{DescriptorSeen: true}
				if state.Active != nil {
					next.Active = &SubagentTimingInterval{Since: state.Active.Since, Through: at}
				} else if state.PendingTurnStart != nil {
					next.Active = &SubagentTimingInterval{Since: *state.PendingTurnStart, Through: at}
				}
			case "turn/end":
				if !state.DescriptorSeen {
					if state.PendingTurnStart == nil {
						return state
					}
					next.PendingTurnStart = nil
				} else {
					if state.Active == nil {
						return state
					}
					elapsed := at - state.Active.Since
					if elapsed > 0 {
						next.SettledMs += elapsed
					}
					next.Active = nil
					completed := subagentTurnCompleted(event.Data)
					next.LastTurnCompleted = &completed
				}
			default:
				if state.Active == nil {
					return state
				}
				next.Active = &SubagentTimingInterval{Since: state.Active.Since, Through: at}
			}
			return &next
		},
		ValidateState: (*subagentTimingState).validate,
		View:          (*subagentTimingState).view,
		ValidateView:  validateSubagentTiming,
	})
	d.DecodeState = func(raw json.RawMessage) (any, error) {
		fields, err := subagentProjectionFields(raw, []string{"settledMs", "descriptorSeen"}, "active", "pendingTurnStart", "lastTurnCompleted")
		if err != nil {
			return nil, err
		}
		var state subagentTimingState
		state.SettledMs, err = subagentProjectionInteger(fields["settledMs"])
		if err != nil {
			return nil, err
		}
		if err := json.Unmarshal(fields["descriptorSeen"], &state.DescriptorSeen); err != nil {
			return nil, err
		}
		if raw, exists := fields["pendingTurnStart"]; exists {
			value, err := subagentProjectionInteger(raw)
			if err != nil {
				return nil, err
			}
			state.PendingTurnStart = &value
		}
		if raw, exists := fields["lastTurnCompleted"]; exists {
			if err := json.Unmarshal(raw, &state.LastTurnCompleted); err != nil {
				return nil, err
			}
		}
		if raw, exists := fields["active"]; exists {
			active, err := subagentProjectionFields(raw, []string{"since", "through"})
			if err != nil {
				return nil, err
			}
			since, err := subagentProjectionInteger(active["since"])
			if err != nil {
				return nil, err
			}
			through, err := subagentProjectionInteger(active["through"])
			if err != nil {
				return nil, err
			}
			state.Active = &SubagentTimingInterval{Since: since, Through: through}
		}
		if err := state.validate(); err != nil {
			return nil, err
		}
		return &state, nil
	}
	return d
}
