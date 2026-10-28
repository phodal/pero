package mcp

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
)

// MutationMode says what the operator allows for tools classified as mutating.
type MutationMode string

const (
	// MutationsDeny hides mutating tools from the model. It is the zero value.
	MutationsDeny MutationMode = "deny"
	// MutationsApprove exposes mutating tools but asks the approval channel for
	// every call; without an answerer the call fails closed.
	MutationsApprove MutationMode = "approve"
)

// ToolRule is the operator's entire description of one remote tool. Whether a
// tool mutates is declared here; server annotations such as readOnlyHint are
// never consulted because the server is not the authority over its own access.
type ToolRule struct {
	Name    string `json:"name"`
	Mutates bool   `json:"mutates,omitempty"`
	// Pin fixes an argument to one JSON value: absent or null is filled in and
	// any other value is rejected. It never relies on model instructions.
	Pin map[string]json.RawMessage `json:"pin,omitempty"`
	// Forbid names arguments that must be absent, null or false.
	Forbid []string `json:"forbid,omitempty"`
}

// ToolPolicy is trusted operator configuration for one MCP server. A server
// without a policy keeps the legacy behavior of exposing every model-visible
// tool; a server with one exposes only the listed tools.
type ToolPolicy struct {
	Mutations MutationMode `json:"mutations,omitempty"`
	Tools     []ToolRule   `json:"tools"`
}

// Validate rejects a policy that could not enforce what it states.
func (p *ToolPolicy) Validate() error {
	switch p.Mutations {
	case "", MutationsDeny, MutationsApprove:
	default:
		return fmt.Errorf("unknown mutation mode %q", p.Mutations)
	}
	if len(p.Tools) == 0 {
		return errors.New("tool policy lists no tools")
	}
	seen := make(map[string]struct{}, len(p.Tools))
	for _, rule := range p.Tools {
		if strings.TrimSpace(rule.Name) == "" {
			return errors.New("tool policy has an unnamed rule")
		}
		if _, dup := seen[rule.Name]; dup {
			return fmt.Errorf("tool policy lists %q twice", rule.Name)
		}
		seen[rule.Name] = struct{}{}
		forbidden := make(map[string]struct{}, len(rule.Forbid))
		for _, name := range rule.Forbid {
			forbidden[name] = struct{}{}
		}
		for name, value := range rule.Pin {
			if _, clash := forbidden[name]; clash {
				return fmt.Errorf("tool %q both pins and forbids %q", rule.Name, name)
			}
			var decoded any
			if err := json.Unmarshal(value, &decoded); err != nil || decoded == nil {
				return fmt.Errorf("tool %q pins %q to an invalid value", rule.Name, name)
			}
		}
	}
	return nil
}

// Rule returns the operator rule for a remote tool name.
func (p *ToolPolicy) Rule(name string) (ToolRule, bool) {
	for _, rule := range p.Tools {
		if rule.Name == name {
			return rule, true
		}
	}
	return ToolRule{}, false
}

// Exposes reports whether a remote tool may reach the model at all.
func (p *ToolPolicy) Exposes(name string) bool {
	rule, ok := p.Rule(name)
	return ok && (!rule.Mutates || p.Mutations == MutationsApprove)
}

// RequiresApproval reports whether every call to the tool must be approved.
func (r ToolRule) RequiresApproval() bool { return r.Mutates }

// Admit checks one call's arguments against the rule and returns the arguments
// to send, with pinned values filled in. A rejection never reaches the server.
func (r ToolRule) Admit(raw json.RawMessage) (json.RawMessage, error) {
	arguments := map[string]json.RawMessage{}
	if trimmed := bytes.TrimSpace(raw); len(trimmed) > 0 && !bytes.Equal(trimmed, []byte("null")) {
		if err := json.Unmarshal(trimmed, &arguments); err != nil {
			return nil, fmt.Errorf("invalid MCP arguments: %w", err)
		}
	}
	for _, name := range r.Forbid {
		if value, present := arguments[name]; present && !isNullOrFalse(value) {
			return nil, fmt.Errorf("argument %q is not permitted for %s", name, r.Name)
		}
		delete(arguments, name)
	}
	for name, pinned := range r.Pin {
		if value, present := arguments[name]; present && !isNull(value) && !sameJSON(value, pinned) {
			return nil, fmt.Errorf("argument %q must be %s for %s", name, pinned, r.Name)
		}
		arguments[name] = pinned
	}
	return json.Marshal(arguments)
}

func isNull(value json.RawMessage) bool { return bytes.Equal(bytes.TrimSpace(value), []byte("null")) }

func isNullOrFalse(value json.RawMessage) bool {
	trimmed := bytes.TrimSpace(value)
	return bytes.Equal(trimmed, []byte("null")) || bytes.Equal(trimmed, []byte("false"))
}

func sameJSON(a, b json.RawMessage) bool {
	var left, right any
	return json.Unmarshal(a, &left) == nil && json.Unmarshal(b, &right) == nil && reflect.DeepEqual(left, right)
}
