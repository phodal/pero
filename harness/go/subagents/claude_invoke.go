package subagents

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/phodal/pero/harness/go/harness"
	harnessmodel "github.com/phodal/pero/harness/go/model"
	point "github.com/phodal/pero/harness/go/runtime"
)

// ClaudeInvocation is trusted native composition, not a model tool input.
// Origin selects the invoking workflow's namespace. ConfigureChild can mount
// scoped workflow policy before the child's first turn; it cannot replace the
// provider's workspace, route, budget, depth or inherited approval checks.
type ClaudeInvocation struct {
	Definition, Prompt, Description, Model, Origin string
	ConfigureChild                                 func(context.Context, *point.Run, *harness.Agent) error
}

type claudeChildConfigurationKey struct{}

// Invoke synchronously runs the same selected agent and activation lifecycle
// used by Agent. It does not manufacture a model tool call or dispatch twice.
// Child status is returned verbatim; errors report admission, cancellation or
// cleanup failures. On cancellation Invoke disposes and joins the exact child.
func (c *ClaudeContribution) Invoke(ctx context.Context, parent *harness.Agent, input ClaudeInvocation) (harness.SubagentResult, error) {
	if c == nil || c.service == nil {
		return harness.SubagentResult{}, errors.New("subagents: Claude delegation is not mounted")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	task, err := c.service.start(ctx, parent, input)
	if err != nil {
		return harness.SubagentResult{}, err
	}
	select {
	case <-task.done:
		err = task.err
	case <-ctx.Done():
		_ = task.activation.RequestDispose()
		<-task.done
		err = errors.Join(ctx.Err(), task.err)
	}
	result := task.result
	result.Output = harnessmodel.CloneContentBlocks(result.Output)
	return result, err
}

func (s *claudeDelegation) start(ctx context.Context, parent *harness.Agent, input ClaudeInvocation) (*claudeTask, error) {
	if parent == nil || strings.TrimSpace(input.Prompt) == "" {
		return nil, errors.New("subagents: Agent requires a parent and prompt")
	}
	if s.run == nil || !s.run.Active() {
		return nil, errors.New("subagents: Claude delegation is not active")
	}
	if input.Definition == "" {
		input.Definition = "general-purpose"
	}
	origin := input.Origin
	if origin == "" {
		var err error
		origin, err = s.invocationPlugin(parent)
		if err != nil {
			return nil, err
		}
	}
	definition, err := resolveClaudeDefinition(s.definitions, input.Definition, origin)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(input.Description) == "" {
		input.Description = definition.Description
	}
	child := harness.SubagentRequest{Parent: parent, Prompt: input.Prompt, Label: input.Description, Persona: definition.Instructions, MaxDepth: s.maxDepth}
	if definition.Tools != nil {
		child.ToolFilter = &harness.ToolRestriction{Allow: append([]string{}, definition.Tools...)}
	}
	if s.readOnlyBuiltins[definition.Name] {
		tools, err := s.readOnlyTools(ctx, parent)
		if err != nil {
			return nil, err
		}
		child.ToolFilter = &harness.ToolRestriction{Allow: tools}
	}
	model := definition.Model
	if input.Model != "" {
		model = input.Model
	}
	if model != "" && model != "inherit" {
		route, exists := s.routes[model]
		if !exists {
			return nil, fmt.Errorf("subagents: model alias %q is unavailable; configure an explicit model route", model)
		}
		child.Provider, child.Model = route.Provider, route.Model
	}
	if plugin, _, qualified := strings.Cut(definition.Name, ":"); qualified {
		origin = plugin
	}
	ctx = context.WithValue(ctx, claudeDefinitionContextKey{}, claudeDefinitionIdentity{Version: 1, Name: definition.Name, Origin: origin})
	if input.ConfigureChild != nil {
		ctx = context.WithValue(ctx, claudeChildConfigurationKey{}, input.ConfigureChild)
	}
	activation, err := s.facade.StartActivation(ctx, "claude", child, "caller")
	if err != nil {
		return nil, err
	}
	task := &claudeTask{parent: parent, activation: activation, done: make(chan struct{})}
	s.mu.Lock()
	s.tasks[activation.ChildID] = task
	s.mu.Unlock()
	if err := s.run.Go("claude-task/"+string(activation.ChildID), func(ctx context.Context) error { s.observeTask(ctx, task); return nil }); err != nil {
		_ = activation.RequestDispose()
		cleanupErr := activation.Wait(context.Background())
		s.mu.Lock()
		delete(s.tasks, activation.ChildID)
		s.mu.Unlock()
		return nil, errors.Join(err, cleanupErr)
	}
	return task, nil
}
