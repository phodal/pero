package subagents

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/phodal/pero/harness/go/harness"
)

func resolveClaudeDefinition(definitions map[string]AgentDefinition, name, origin string) (AgentDefinition, error) {
	if definition, found := definitions[name]; found {
		return definition, nil // Explicit names, including builtins, stay stable.
	}
	if !strings.Contains(name, ":") {
		var local, global []string
		for candidate := range definitions {
			if !strings.HasSuffix(candidate, ":"+name) {
				continue
			}
			global = append(global, candidate)
			if origin != "" && strings.HasPrefix(candidate, origin+":") {
				local = append(local, candidate)
			}
		}
		// Prefer the direct same-plugin name over a nested suffix in that plugin.
		if definition, found := definitions[origin+":"+name]; origin != "" && found {
			return definition, nil
		}
		matches := global
		if len(local) != 0 {
			matches = local
		}
		if len(matches) == 1 {
			return definitions[matches[0]], nil
		}
		if len(matches) > 1 {
			sort.Strings(matches)
			return AgentDefinition{}, fmt.Errorf("subagents: ambiguous subagent_type %q; use a qualified name: %s", name, strings.Join(matches, ", "))
		}
	}
	return AgentDefinition{}, fmt.Errorf("subagents: unknown subagent_type %q", name)
}

// This identity is minted from the selected native definition, never from a
// model-chosen namespace. Recording before Begin makes it available even to a
// child that immediately delegates. It carries no tool or permission grant.
type claudeDefinitionContextKey struct{}
type claudeDefinitionIdentity struct {
	Version int    `json:"version"`
	Name    string `json:"name"`
	Origin  string `json:"origin,omitempty"`
}

const claudeDefinitionEvent = "subagent/claude-definition"

func recordClaudeDefinition(ctx context.Context, child *harness.Agent) error {
	identity, selected := ctx.Value(claudeDefinitionContextKey{}).(claudeDefinitionIdentity)
	if !selected {
		return nil
	}
	_, err := child.Session().Append(claudeDefinitionEvent, identity)
	return err
}

func (s *claudeDelegation) invocationPlugin(agent *harness.Agent) (string, error) {
	if s.invocationOrigin != nil {
		if origin := s.invocationOrigin(agent); origin != "" {
			return origin, nil
		}
	}
	identity, _, err := selectedClaudeDefinition(agent)
	return identity.Origin, err
}

func selectedClaudeDefinition(agent *harness.Agent) (claudeDefinitionIdentity, bool, error) {
	events := agent.Session().Events()
	for index := len(events) - 1; index >= 0; index-- {
		if events[index].Type != claudeDefinitionEvent {
			continue
		}
		var identity claudeDefinitionIdentity
		if err := json.Unmarshal(events[index].Data, &identity); err != nil || identity.Version != 1 || identity.Name == "" {
			return claudeDefinitionIdentity{}, false, fmt.Errorf("subagents: selected Claude definition identity is unreadable or unsupported")
		}
		return identity, true, nil
	}
	return claudeDefinitionIdentity{}, false, nil
}

// ClaudeHookAttribution identifies the root session that owns hook lifecycle
// and the child that owns a particular tool call. It grants no execution rights.
type ClaudeHookAttribution struct {
	Session   *harness.Agent
	AgentID   harness.SessionID
	AgentType string
}

// HookAttribution reads the existing selected-definition fact. Generic child
// agents retain their exact ID without inventing a Claude agent type. Root
// lifecycle calls have neither agent_id nor agent_type.
func HookAttribution(agent *harness.Agent) (ClaudeHookAttribution, error) {
	if agent == nil {
		return ClaudeHookAttribution{}, fmt.Errorf("subagents: hook attribution requires an agent")
	}
	result := ClaudeHookAttribution{Session: agent}
	for result.Session.Parent() != nil {
		result.Session = result.Session.Parent()
	}
	if result.Session == agent {
		return result, nil
	}
	result.AgentID = agent.ID()
	identity, _, err := selectedClaudeDefinition(agent)
	result.AgentType = identity.Name
	return result, err
}
