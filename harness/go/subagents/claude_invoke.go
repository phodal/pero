package subagents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/phodal/pero/harness/go/harness"
	harnessmodel "github.com/phodal/pero/harness/go/model"
	point "github.com/phodal/pero/harness/go/runtime"
	"github.com/phodal/pero/harness/go/shell"
)

// ClaudeInvocation is trusted native composition, not a model tool input.
// Origin selects the invoking workflow's namespace. ConfigureChild can mount
// scoped workflow policy before the child's first turn; it cannot replace the
// provider's workspace, route, budget, depth or inherited approval checks.
type ClaudeInvocation struct {
	Definition, Prompt, Description, Model, Effort, Origin, Isolation string
	OutputSchema                                                      json.RawMessage
	Background                                                        bool
	// ReportCompletion posts the terminal result to the parent after a
	// background run. The caller does not wait for that result.
	ReportCompletion bool
	// MaxSteps caps the child. Zero inherits the parent budget. A positive
	// value cannot exceed the parent budget.
	MaxSteps       int
	ConfigureChild func(context.Context, *point.Run, *harness.Agent) error
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
		task.suppressNotice.Store(true)
		_ = task.activation.RequestDispose()
		<-task.done
		err = errors.Join(ctx.Err(), task.err)
	}
	result := task.result
	result.Output = harnessmodel.CloneContentBlocks(result.Output)
	return result, err
}

// Start admits a background child and returns while it is still running.
func (c *ClaudeContribution) Start(ctx context.Context, parent *harness.Agent, input ClaudeInvocation) (harness.SubagentResult, error) {
	if c == nil || c.service == nil {
		return harness.SubagentResult{}, errors.New("subagents: Claude delegation is not mounted")
	}
	if !input.Background {
		return harness.SubagentResult{}, errors.New("subagents: background start requires background execution")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	task, err := c.service.start(ctx, parent, input)
	if err != nil {
		return harness.SubagentResult{}, err
	}
	return harness.SubagentResult{ChildID: task.activation.ChildID, Status: harness.SubagentRunning}, nil
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
	child := harness.SubagentRequest{Parent: parent, Prompt: input.Prompt, Label: input.Description, Persona: definition.Instructions, MaxDepth: s.maxDepth, MaxSteps: input.MaxSteps, OutputSchema: input.OutputSchema, ReasoningEffort: harness.ReasoningEffort(input.Effort)}
	var cleanup func()
	if input.Isolation != "" {
		if input.Isolation != "worktree" {
			return nil, errors.New("subagents: isolation must be worktree")
		}
		var dir string
		var release func()
		var err error
		if s.isolatedWorktree != nil {
			dir, release, err = s.isolatedWorktree(ctx, parent)
		}
		if s.isolatedWorktree == nil || errors.Is(err, ErrDefaultWorktree) {
			dir, release, err = isolateGitWorktree(parent.Session().WorkingDirectory())
		}
		if err != nil {
			return nil, err
		}
		child.CWD, child.IsolatedWorktree, cleanup = dir, true, release
	}
	releaseWorktree := cleanup != nil
	if cleanup != nil {
		defer func() {
			if releaseWorktree {
				cleanup()
			}
		}()
	}
	if definition.Tools != nil {
		child.ToolFilter = &harness.ToolRestriction{Allow: append([]string{}, definition.Tools...)}
	}
	if s.readOnlyBuiltins[definition.Name] {
		tools, err := s.readOnlyTools(ctx, parent)
		if err != nil {
			return nil, err
		}
		child.ToolFilter = &harness.ToolRestriction{Allow: tools}
		input.ConfigureChild = composeChildConfiguration(input.ConfigureChild, func(setup context.Context, run *point.Run, agent *harness.Agent) error {
			return mountReadOnlyBashGate(s.h, run, agent)
		})
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
	ctx = context.WithValue(ctx, claudeBackgroundActivationKey{}, input.Background)
	if input.ConfigureChild != nil {
		ctx = context.WithValue(ctx, claudeChildConfigurationKey{}, input.ConfigureChild)
	}
	provider := "claude"
	if s.readOnlyBuiltins[definition.Name] || input.ConfigureChild != nil {
		provider = "claude-oneshot"
	}
	activation, err := s.facade.StartActivation(ctx, provider, child, "caller")
	if err != nil {
		return nil, err
	}
	task := &claudeTask{parent: parent, activation: activation, done: make(chan struct{}), cleanup: cleanup}
	task.notifyParent.Store(input.Background && (s.backgroundNotices || input.ReportCompletion))
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
	releaseWorktree = false
	return task, nil
}

func availableToolAllow(ctx context.Context, h *harness.Harness, agent *harness.Agent, allow []string) ([]string, error) {
	schemas, err := h.Tools().SchemasForAgent(ctx, agent)
	if err != nil {
		return nil, err
	}
	known := make(map[string]bool, len(schemas))
	for _, schema := range schemas {
		known[schema.Name] = true
	}
	kept := make([]string, 0, len(allow))
	for _, name := range allow {
		if known[name] {
			kept = append(kept, name)
		}
	}
	if len(allow) > 0 && len(kept) == 0 {
		return nil, fmt.Errorf("subagents: none of the declared tools are available")
	}
	return kept, nil
}

func composeChildConfiguration(base, next func(context.Context, *point.Run, *harness.Agent) error) func(context.Context, *point.Run, *harness.Agent) error {
	switch {
	case base == nil:
		return next
	case next == nil:
		return base
	default:
		return func(ctx context.Context, run *point.Run, child *harness.Agent) error {
			if err := base(ctx, run, child); err != nil {
				return err
			}
			return next(ctx, run, child)
		}
	}
}

// mountReadOnlyBashGate keeps Explore/Plan aligned with Claude's read-only tool
// pool: Bash may be visible, but only documented read-only commands run.
func mountReadOnlyBashGate(h *harness.Harness, run *point.Run, child *harness.Agent) error {
	_, err := h.Tools().Before.Use(run, func(_ context.Context, request harness.ToolRequest, next point.Next[harness.ToolRequest]) (harness.ToolRequest, error) {
		request, err := next(request)
		if err != nil || request.Agent != child || (request.Name != "Bash" && request.Name != "shell") {
			return request, err
		}
		var input struct {
			Command string `json:"command"`
		}
		if json.Unmarshal(request.Arguments, &input) != nil || strings.TrimSpace(input.Command) == "" {
			request.DenyReason = "Explore/Plan may only run read-only shell commands"
			return request, nil
		}
		commands, ok := shell.ClaudeAllowCommands(input.Command)
		if !ok {
			request.DenyReason = "Explore/Plan may only run read-only shell commands"
			return request, nil
		}
		for _, command := range commands {
			if !shell.ClaudeReadOnlyAllowCommand(command) {
				request.DenyReason = "Explore/Plan may only run read-only shell commands"
				return request, nil
			}
		}
		return request, nil
	})
	return err
}
