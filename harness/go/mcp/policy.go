package mcp

import (
	"errors"
	"strings"
	"unicode"
)

// ToolDecision is trusted operator policy, never an MCP server annotation.
type ToolDecision string

const (
	// ToolAllow adds no MCP-specific gate; existing session approval requirements remain.
	ToolAllow ToolDecision = "allow"
	ToolAsk   ToolDecision = "ask"
	ToolDeny  ToolDecision = "deny"
)

// ToolPolicy uses exact remote tool names, before public-name normalization.
// A policy must explicitly choose a default for newly discovered tools.
type ToolPolicy struct {
	Default ToolDecision            `json:"default"`
	Tools   map[string]ToolDecision `json:"tools,omitempty"`
}

// Freeze validates at configuration admission and detaches mutable input.
// Nil preserves the existing server-wide grant and annotation behavior.
func (p *ToolPolicy) Freeze() (*ToolPolicy, error) {
	if p == nil {
		return nil, nil
	}
	valid := func(value ToolDecision) bool {
		return value == ToolAllow || value == ToolAsk || value == ToolDeny
	}
	if !valid(p.Default) {
		return nil, errors.New("MCP tool policy requires an allow, ask or deny default")
	}
	if len(p.Tools) > 256 {
		return nil, errors.New("MCP tool policy exceeds 256 rules")
	}
	frozen := &ToolPolicy{Default: p.Default, Tools: make(map[string]ToolDecision, len(p.Tools))}
	for name, decision := range p.Tools {
		if strings.TrimSpace(name) == "" || len(name) > 128 || strings.IndexFunc(name, unicode.IsControl) >= 0 || !valid(decision) {
			return nil, errors.New("MCP tool policy contains an invalid tool rule")
		}
		frozen.Tools[name] = decision
	}
	return frozen, nil
}

func (p *ToolPolicy) Decision(name string) ToolDecision {
	if decision, present := p.Tools[name]; present {
		return decision
	}
	return p.Default
}
