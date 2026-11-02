package skills

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

type skillModel struct{ provider, model string }
type skillModelKey struct{ name, digest string }

// Model aliases are resolved once from trusted launch configuration. Invocation
// receipts determine the turn-local override; no second session state is kept.
func mountSkillModels(run *point.Run, hooks *harness.AgentHooks, catalog *Catalog, options MountOptions) error {
	models := make(map[skillModelKey]skillModel)
	catalog.mu.Lock()
	var definitions []Definition
	for _, entry := range catalog.entries {
		if entry.definition.Claude && entry.definition.Context != "fork" && entry.definition.Model != "" && entry.definition.Model != "inherit" {
			definitions = append(definitions, entry.definition)
		}
	}
	catalog.mu.Unlock()
	for _, definition := range definitions {
		if options.ResolveModel == nil {
			return errors.New("skills: model overrides require explicitly configured model aliases")
		}
		provider, model, err := options.ResolveModel(definition.Model)
		if err != nil {
			return err
		}
		if strings.TrimSpace(provider) == "" || strings.TrimSpace(model) == "" {
			return errors.New("skills: model alias resolved to an empty route")
		}
		models[skillModelKey{definition.Name, definition.Digest}] = skillModel{provider, model}
	}
	if len(models) == 0 {
		return nil
	}
	_, err := hooks.Request.Use(run, func(ctx context.Context, request harness.GenerateRequest, next point.Next[harness.GenerateRequest]) (harness.GenerateRequest, error) {
		request, err := next(request)
		if err != nil || request.Agent == nil || request.Purpose != "" || request.Turn < 1 {
			return request, err
		}
		if model, found, err := currentSkillModel(request.Agent.Session().Events(), request.Messages, request.Turn, models); err != nil {
			return request, err
		} else if found {
			request.Provider, request.Model, request.TransientModel = model.provider, model.model, true
		}
		return request, nil
	})
	return err
}

func currentSkillModel(events []harness.Event, messages []harness.Message, turn int, models map[skillModelKey]skillModel) (skillModel, bool, error) {
	var selected skillModel
	found, active := false, false
	recorded := make(map[string]bool)
	messageKey := func(message harness.Message) string { return message.ID + "\x00" + string(message.Source) }
	apply := func(message harness.Message) {
		var source skillInvocation
		if json.Unmarshal(message.Source, &source) != nil {
			return
		}
		if source.Kind == "user" {
			selected, found = skillModel{}, false
			return
		}
		if source.Kind != "skill-invocation" || source.Form != "instructions" && source.Form != "activation" {
			return
		}
		if model, ok := models[skillModelKey{source.Name, source.Digest}]; ok {
			selected, found = model, true
		}
	}
	for _, event := range events {
		if event.Type == "turn/start" {
			var start struct{ Turn int }
			if err := json.Unmarshal(event.Data, &start); err != nil {
				return skillModel{}, false, err
			}
			active = start.Turn == turn
		}
		if event.Type != "user/message" {
			continue
		}
		var message harness.Message
		if err := json.Unmarshal(event.Data, &message); err != nil {
			return skillModel{}, false, err
		}
		recorded[messageKey(message)] = true
		if active {
			apply(message)
		}
	}
	// The Request hook runs before canonical admission. Include newly expanded
	// slash instructions, but never reinterpret a previous turn's history.
	for _, message := range messages {
		if recorded[messageKey(message)] {
			continue
		}
		var source skillInvocation
		if json.Unmarshal(message.Source, &source) == nil && (source.Turn == turn || source.Kind == "user") {
			apply(message)
		}
	}
	return selected, found, nil
}
