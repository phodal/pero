package skills

import (
	"context"
	"encoding/json"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

func DisallowsTool(rules []string, name string) bool {
	for _, rule := range rules {
		if wildcard(rule, name) {
			return true
		}
	}
	return false
}

// Fold durable invocation metadata plus the current uncommitted slash expansion.
// Reattached instructions cannot reactivate an expired restriction.
func activeSkillInvocations(events []harness.Event, pending []harness.Message, turn int) ([]skillInvocation, error) {
	var invoked []skillInvocation
	recorded := map[string]bool{}
	key := func(message harness.Message) string { return message.ID + "\x00" + string(message.Source) }
	apply := func(message harness.Message) {
		var source skillInvocation
		if json.Unmarshal(message.Source, &source) != nil {
			return
		}
		if source.Kind == "user" {
			invoked = nil
		} else if source.Kind == "skill-invocation" && source.Form != "reattached" {
			invoked = append(invoked, source)
		}
	}
	for _, event := range events {
		if event.Type == "turn/start" {
			invoked = nil
		}
		if event.Type != "user/message" {
			continue
		}
		var message harness.Message
		if err := json.Unmarshal(event.Data, &message); err != nil {
			return nil, err
		}
		recorded[key(message)] = true
		apply(message)
	}
	for _, message := range pending {
		if recorded[key(message)] {
			continue
		}
		var source skillInvocation
		if json.Unmarshal(message.Source, &source) == nil && (source.Turn == turn || source.Kind == "user") {
			apply(message)
		}
	}
	return invoked, nil
}

func turnDenials(ctx context.Context, catalog *Catalog, events []harness.Event, pending []harness.Message, turn int) ([]string, error) {
	invoked, err := activeSkillInvocations(events, pending, turn)
	if err != nil {
		return nil, err
	}
	var rules []string
	catalog.mu.Lock()
	defer catalog.mu.Unlock()
	for _, source := range invoked {
		entry, err := catalog.lookup(ctx, source.Name, source.Digest)
		if err != nil {
			return nil, err
		}
		if entry.definition.Context != "fork" || source.Form == "fork-grant" {
			rules = append(rules, entry.definition.DisallowedTools...)
		}
	}
	return rules, nil
}

func mountSkillRestrictions(run *point.Run, h *harness.Harness, hooks *harness.AgentHooks, catalog *Catalog) error {
	catalog.mu.Lock()
	enabled := false
	for _, entry := range catalog.entries {
		enabled = enabled || len(entry.definition.DisallowedTools) > 0
	}
	catalog.mu.Unlock()
	if !enabled {
		return nil
	}
	if _, err := h.Tools().RestrictWhen(run, func(agent *harness.Agent, name string) bool {
		rules, err := turnDenials(run.Context, catalog, agent.Session().Events(), nil, agent.CurrentTurn())
		return err == nil && !DisallowsTool(rules, name)
	}); err != nil {
		return err
	}
	_, err := hooks.Request.Use(run, func(ctx context.Context, request harness.GenerateRequest, next point.Next[harness.GenerateRequest]) (harness.GenerateRequest, error) {
		request, err := next(request)
		if err != nil || request.Agent == nil || request.Purpose != "" {
			return request, err
		}
		rules, err := turnDenials(ctx, catalog, request.Agent.Session().Events(), request.Messages, request.Turn)
		if err != nil {
			return request, err
		}
		tools := make([]harness.ToolSchema, 0, len(request.Tools))
		for _, tool := range request.Tools {
			if !DisallowsTool(rules, tool.Name) {
				tools = append(tools, tool)
			}
		}
		request.Tools = tools
		return request, nil
	})
	return err
}
