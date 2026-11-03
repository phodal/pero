package subagents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

// AgentDefinition is trusted composition compiled from a selected plugin.
// Tools is an exact allowlist intersected with the parent's existing tools.
type AgentDefinition struct {
	Name, Description, Instructions, Model, Effort, Isolation string
	MaxTurns                                                  int
	Background                                                bool
	Tools                                                     []string
	DisallowedTools                                           []string
	Skills                                                    []string
	Memory                                                    string
	AutoCompactWindow                                         int
}

func requestedBackground(value *bool) bool {
	return value != nil && *value
}

func (s *claudeDelegation) agentDefaultsToBackground(parent *harness.Agent, name string) bool {
	if name == "" {
		name = "general-purpose"
	}
	origin := ""
	if parent != nil && s.invocationOrigin != nil {
		origin = s.invocationOrigin(parent)
	}
	definition, err := resolveClaudeDefinition(s.definitions, name, origin)
	if err != nil {
		return false
	}
	return definition.Background
}

func validAgentEffort(effort string) bool {
	switch effort {
	case "low", "medium", "high", "xhigh", "max":
		return true
	default:
		return false
	}
}

type ClaudeOptions struct {
	ModelRoutes         []ModelRoute
	MaxDepth, MaxActive int
	Persistence         harness.SessionPersistence
	Compaction          *harness.BasicCompactionConfig
	// MemoryPresentation selects how newly created agent memory enters context.
	// Zero preserves legacy persona rendering; MemoryAsContext is retained on resume.
	MemoryPresentation MemoryPresentation
	// InvocationOrigin supplies the current workflow's plugin namespace. It is
	// trusted composition; model arguments cannot choose a resolution namespace.
	InvocationOrigin func(*harness.Agent) string
	// TaskLookup supplies other task kinds without transferring their ownership.
	TaskLookup harness.TaskLookup
	// LegacyTaskAlias exposes the former Task spelling for explicitly selected
	// packages that still use it. It shares Agent's execution and authority.
	LegacyTaskAlias bool
	// BackgroundNotifications delivers actual terminal notices after child
	// cleanup. It does not make a one-shot child resident.
	BackgroundNotifications bool
	// IsolatedWorktree creates the directory for isolation=worktree. Returning
	// ErrDefaultWorktree keeps the Git worktree. A nil cleanup leaves a
	// hook-created directory in place when the child finishes.
	IsolatedWorktree func(context.Context, *harness.Agent) (string, func(), error)
	// SkillText supplies the body of a skill named by an agent. The text is
	// context only and does not grant tools.
	SkillText func(context.Context, string) (string, error)
}

// ErrDefaultWorktree asks the caller to create the Git worktree itself.
var ErrDefaultWorktree = errors.New("subagents: no WorktreeCreate hook is configured")

type ClaudeContribution struct {
	instance  *point.Instance
	providers []*point.Instance
	service   *claudeDelegation
}

func (c *ClaudeContribution) Dispose(ctx context.Context) error {
	if c == nil {
		return nil
	}
	var err error
	if c.instance != nil {
		err = c.instance.Dispose(ctx)
	}
	for _, provider := range c.providers {
		err = errors.Join(err, provider.Dispose(ctx))
	}
	return err
}

type claudeTask struct {
	parent         *harness.Agent
	activation     harness.SubagentActivation
	notifyParent   atomic.Bool
	suppressNotice atomic.Bool
	done           chan struct{}
	result         harness.SubagentResult
	err            error
	cleanup        func()
}

type claudeDelegation struct {
	h                  *harness.Harness
	run                *point.Run
	facade             *harness.SubagentFacade
	definitions        map[string]AgentDefinition
	readOnlyBuiltins   map[string]bool
	routes             map[string]ModelRoute
	maxDepth           int
	invocationOrigin   func(*harness.Agent) string
	taskLookup         harness.TaskLookup
	backgroundNotices  bool
	isolatedWorktree   func(context.Context, *harness.Agent) (string, func(), error)
	skillText          func(context.Context, string) (string, error)
	memoryPresentation MemoryPresentation
	mu                 sync.Mutex
	tasks              map[harness.SessionID]*claudeTask
}

// MountClaude mounts real Agent/TaskOutput/TaskStop calls over the existing
// registry. Its task cache retains handles/results only; the registry owns all
// child execution, scope, concurrency and teardown.
func MountClaude(ctx context.Context, h *harness.Harness, definitions []AgentDefinition, options ClaudeOptions) (*ClaudeContribution, error) {
	if h == nil || h.Subagents() == nil {
		return nil, errors.New("subagents: Claude delegation requires enabled subagents")
	}
	if options.MemoryPresentation != "" && options.MemoryPresentation != MemoryAsContext {
		return nil, errors.New("subagents: unsupported memory presentation")
	}
	if options.MaxDepth == 0 {
		options.MaxDepth = 1
	}
	if options.MaxActive == 0 {
		options.MaxActive = 4
	}
	config := harness.SubagentRuntimeConfig{MaxDepth: options.MaxDepth, MaxActiveSubagents: options.MaxActive}
	if err := config.Validate(); err != nil {
		return nil, err
	}
	service := &claudeDelegation{h: h, maxDepth: options.MaxDepth, invocationOrigin: options.InvocationOrigin, taskLookup: options.TaskLookup, backgroundNotices: options.BackgroundNotifications, isolatedWorktree: options.IsolatedWorktree, skillText: options.SkillText, memoryPresentation: options.MemoryPresentation, definitions: make(map[string]AgentDefinition), readOnlyBuiltins: make(map[string]bool), routes: make(map[string]ModelRoute), tasks: make(map[harness.SessionID]*claudeTask)}
	for _, definition := range definitions {
		if strings.TrimSpace(definition.Name) == "" || strings.TrimSpace(definition.Description) == "" || strings.TrimSpace(definition.Instructions) == "" {
			return nil, errors.New("subagents: Claude agent requires name, description and instructions")
		}
		if definition.Effort != "" && !validAgentEffort(definition.Effort) {
			return nil, fmt.Errorf("subagents: agent %q effort must be low, medium, high, xhigh, or max", definition.Name)
		}
		if definition.Isolation != "" && definition.Isolation != "worktree" {
			return nil, fmt.Errorf("subagents: agent %q isolation must be worktree", definition.Name)
		}
		if definition.MaxTurns < 0 {
			return nil, fmt.Errorf("subagents: agent %q maxTurns must be positive", definition.Name)
		}
		if _, exists := service.definitions[definition.Name]; exists {
			return nil, fmt.Errorf("subagents: duplicate Claude agent %q", definition.Name)
		}
		if definition.Tools != nil {
			definition.Tools = append([]string{}, definition.Tools...)
		}
		if definition.DisallowedTools != nil {
			definition.DisallowedTools = append([]string{}, definition.DisallowedTools...)
		}
		if definition.Skills != nil {
			definition.Skills = append([]string{}, definition.Skills...)
		}
		if definition.Memory != "" && definition.Memory != "user" && definition.Memory != "project" && definition.Memory != "local" {
			return nil, fmt.Errorf("subagents: agent %q memory must be user, project, or local", definition.Name)
		}
		if definition.AutoCompactWindow < 0 {
			return nil, fmt.Errorf("subagents: agent %q auto compact window must be positive", definition.Name)
		}
		service.definitions[definition.Name] = definition
	}
	for _, builtin := range builtinClaudeAgents() {
		if _, exists := service.definitions[builtin.Name]; exists {
			continue
		}
		service.definitions[builtin.Name] = builtin
		service.readOnlyBuiltins[builtin.Name] = builtin.Name == "Explore" || builtin.Name == "Plan"
	}
	for _, route := range options.ModelRoutes {
		if strings.TrimSpace(route.Alias) == "" || route.Alias == "inherit" || strings.TrimSpace(route.Provider) == "" || strings.TrimSpace(route.Model) == "" {
			return nil, errors.New("subagents: model routes require an alias, provider and model; inherit is reserved")
		}
		if _, exists := service.routes[route.Alias]; exists {
			return nil, fmt.Errorf("subagents: duplicate model alias %q", route.Alias)
		}
		service.routes[route.Alias] = route
	}
	provider, err := mountInProcess(ctx, h, InProcessOptions{EntryID: "subagents/claude/provider", Name: "claude", Persistence: options.Persistence, Compaction: options.Compaction, InheritApproval: true, ModelRoutes: options.ModelRoutes}, false, service.definitions)
	if err != nil {
		return nil, err
	}
	oneShot, err := MountInProcess(ctx, h, InProcessOptions{EntryID: "subagents/claude/oneshot", Name: "claude-oneshot", Persistence: options.Persistence, Compaction: options.Compaction, InheritApproval: true, ModelRoutes: options.ModelRoutes})
	if err != nil {
		_ = provider.Dispose(context.Background())
		return nil, err
	}
	facade, err := h.Subagents().NewFacade(config)
	if err != nil {
		_ = provider.Dispose(context.Background())
		_ = oneShot.Dispose(context.Background())
		return nil, err
	}
	service.facade = facade
	definition := point.Define(point.Descriptor{ID: "harness/contribution/claude-delegation", Requires: []point.Requirement{point.Require(harness.SubagentRegistryKey), point.Require(harness.ToolRegistryKey), point.Require(harness.AgentHooksKey)}}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
		service.run = run
		if err := run.BeforeCleanup("claude-subagents", func(ctx context.Context) error {
			err := facade.RequestDispose()
			if err != nil && !errors.Is(err, harness.ErrSubagentFacadeDisposalPending) {
				return err
			}
			return facade.Wait(ctx)
		}); err != nil {
			return nil, err
		}
		if _, err := h.Hooks().Retiring.On(run, func(_ context.Context, parent *harness.Agent) error { service.stopParent(parent, true); return nil }); err != nil {
			return nil, err
		}
		if _, err := h.Hooks().Status.On(run, func(_ context.Context, status harness.AgentStatusInput) error {
			if status.Status == harness.AgentIdle && status.Agent.CurrentTurnInterrupted() {
				service.stopParent(status.Agent, false)
			}
			return nil
		}); err != nil {
			return nil, err
		}
		tools := []harness.Tool{service.agentTool(), service.agentListTool(), service.sendMessageTool(), service.outputTool(), service.stopTool()}
		if options.LegacyTaskAlias {
			alias := service.agentTool()
			alias.Schema.Name = "Task"
			alias.Schema.Description = "Legacy spelling of Agent for the selected compatibility profile. " + alias.Schema.Description
			alias.Schema.Catalog.Header = "Legacy spelling of Agent for the selected compatibility profile. " + alias.Schema.Catalog.Header
			tools = append(tools, alias)
		}
		for _, tool := range tools {
			if _, err := h.Tools().Register(run, tool); err != nil {
				return nil, err
			}
		}
		return nil, nil
	})
	instance, err := h.Runtime().Mount(nil, "subagents/claude/tools", definition, nil)
	if err == nil {
		err = instance.WaitStable(ctx)
	}
	if err == nil && instance.Snapshot().State == point.Failed {
		err = fmt.Errorf("subagents: Claude delegation activation failed: %s", instance.Snapshot().LastError)
	}
	if err != nil {
		if instance != nil {
			_ = instance.Dispose(context.Background())
		}
		_ = facade.RequestDispose()
		_ = facade.Wait(context.Background())
		_ = provider.Dispose(context.Background())
		_ = oneShot.Dispose(context.Background())
		return nil, err
	}
	return &ClaudeContribution{instance: instance, providers: []*point.Instance{provider, oneShot}, service: service}, nil
}

func (s *claudeDelegation) agentTool() harness.Tool {
	catalog := &harness.CatalogText{RecoveryTool: "AgentList", Continuation: "Call AgentList with offset/limit to discover all selected subagent types; follow next_offset."}
	for _, name := range s.catalogNames() {
		data, _ := json.Marshal(struct {
			Name        string `json:"name"`
			Description string `json:"description"`
		}{name, s.definitions[name].Description})
		catalog.Rows = append(catalog.Rows, string(data))
	}
	catalog.Header = "Run an independent agent with selected instructions, tools and an explicitly mapped model. subagent_type defaults to general-purpose. Bare names resolve within the current plugin first, then by a unique scoped suffix; use the full name if ambiguous. Exact names, including builtins, take precedence. Explore/Plan use mounted read-only file/search/web/LSP tools and, when the parent mounted shell, read-only Bash only; Write/Edit, Skill and arbitrary MCP stay unavailable. isolation=worktree runs the child in a detached Git worktree that is removed when the child finishes. Background runs return a real task_id for TaskOutput/TaskStop. Resume custom/general-purpose agents with their ID and a new prompt; Explore/Plan remain one-shot. Available subagent_type values:"
	budget := harness.CatalogBudget{Remaining: harness.DefaultCatalogPageBytes}
	return harness.Tool{Schema: harness.ToolSchema{Name: "Agent", Description: budget.Render(*catalog), Catalog: catalog, InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{"subagent_type":{"type":"string","minLength":1},"description":{"type":"string","minLength":1},"prompt":{"type":"string","minLength":1},"model":{"type":"string"},"isolation":{"type":"string","enum":["worktree"]},"run_in_background":{"type":"boolean"},"resume":{"type":"string"}},"required":["description","prompt"]}`)}, IsConcurrencySafe: func(context.Context, harness.ToolRequest) bool { return true }, ExecuteRequest: func(ctx context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
		var input struct {
			Type        string `json:"subagent_type"`
			Description string `json:"description"`
			Prompt      string `json:"prompt"`
			Model       string `json:"model"`
			Isolation   string `json:"isolation"`
			Background  *bool  `json:"run_in_background"`
			Resume      string `json:"resume"`
		}
		if err := json.Unmarshal(request.Arguments, &input); err != nil {
			return harness.ToolResult{}, err
		}
		background := requestedBackground(input.Background)
		if input.Background == nil && input.Resume == "" {
			background = s.agentDefaultsToBackground(request.Agent, input.Type)
		}
		var task *claudeTask
		var err error
		if input.Resume != "" {
			if input.Type != "" || input.Model != "" {
				return harness.ToolResult{}, errors.New("subagents: resume retains its original definition and model route; omit subagent_type/model")
			}
			task, err = s.resume(ctx, request.Agent, harness.SessionID(input.Resume), input.Prompt, background)
		} else {
			task, err = s.start(ctx, request.Agent, ClaudeInvocation{Definition: input.Type, Prompt: input.Prompt, Description: input.Description, Model: input.Model, Isolation: input.Isolation, Background: background})
		}
		if err != nil {
			return harness.ToolResult{}, err
		}
		if background {
			return claudeTaskResult(task, "not_ready"), nil
		}
		select {
		case <-task.done:
			return claudeTaskResult(task, "success"), nil
		case <-ctx.Done():
			_ = task.activation.RequestDispose()
			return harness.ToolResult{}, ctx.Err()
		}
	}}
}

func (s *claudeDelegation) observeTask(ctx context.Context, task *claudeTask) {
	defer func() {
		if task.cleanup != nil {
			task.cleanup()
		}
		close(task.done)
	}()
	var result harness.SubagentResult
	var ok bool
	select {
	case result, ok = <-task.activation.Result:
	case <-ctx.Done():
		task.suppressNotice.Store(true)
		_ = task.activation.RequestDispose()
		result, ok = <-task.activation.Result
	}
	if !ok {
		result = harness.SubagentResult{ChildID: task.activation.ChildID, Status: harness.SubagentFailed, Reason: harness.FinishError, Diagnostic: "subagent closed without a terminal result"}
	}
	task.result, task.err = result, task.activation.Wait(context.Background())
	if task.notifyParent.Load() && !task.suppressNotice.Load() && ctx.Err() == nil && s.run.Active() && !task.parent.CurrentTurnInterrupted() {
		if parent, live := s.h.Agents().Get(task.parent.ID()); live && parent == task.parent {
			diagnostic := result.Diagnostic
			if task.err != nil {
				if diagnostic != "" {
					diagnostic += "\n"
				}
				diagnostic += task.err.Error()
			}
			if err := harness.DeliverParentNotice(parent, result.ChildID, result.Status, result.Output, result.Structured, diagnostic); err != nil {
				task.err = errors.Join(task.err, fmt.Errorf("subagents: parent completion notice failed: %w", err))
			}
		}
	}
}

func (s *claudeDelegation) lookupTask(ctx context.Context, parent *harness.Agent, id string) (harness.TaskHandle, bool, error) {
	s.mu.Lock()
	task := s.tasks[harness.SessionID(id)]
	s.mu.Unlock()
	if task != nil && parent != nil && task.parent == parent {
		return harness.TaskHandle{ID: id, Kind: harness.TaskKindAgent, Done: task.done,
			Snapshot: func(retrieval harness.TaskRetrieval) harness.ToolResult {
				return claudeTaskResult(task, string(retrieval))
			},
			Stop: func(ctx context.Context) (harness.ToolResult, error) {
				if err := task.activation.RequestDispose(); err != nil && !errors.Is(err, harness.ErrSubagentActivationDisposalPending) {
					return harness.ToolResult{}, err
				}
				select {
				case <-task.done:
					result := claudeTaskResult(task, "success")
					if task.result.Status == harness.SubagentAborted && task.err == nil {
						result.IsError = false
					}
					return result, nil
				case <-ctx.Done():
					return harness.ToolResult{}, ctx.Err()
				}
			}}, true, nil
	}
	if s.taskLookup != nil {
		return s.taskLookup(ctx, parent, id)
	}
	return harness.TaskHandle{}, false, nil
}

func (s *claudeDelegation) outputTool() harness.Tool { return harness.TaskOutputTool(s.lookupTask) }
func (s *claudeDelegation) stopTool() harness.Tool   { return harness.TaskStopTool(s.lookupTask) }

func claudeTaskResult(task *claudeTask, retrieval string) harness.ToolResult {
	status := harness.SubagentRunning
	var content []harness.ContentBlock
	diagnostic := ""
	failed := false
	select {
	case <-task.done:
		status = task.result.Status
		content = task.result.ParentContent()
		diagnostic = task.result.Diagnostic
		retrieval = "success"
		if task.err != nil {
			failed = true
			if diagnostic != "" {
				diagnostic += "\n"
			}
			diagnostic += task.err.Error()
		}
	default:
	}
	raw, _ := json.Marshal(struct {
		ID         harness.SessionID      `json:"task_id"`
		Status     harness.SubagentStatus `json:"status"`
		Retrieval  string                 `json:"retrieval_status"`
		Diagnostic string                 `json:"diagnostic,omitempty"`
	}{task.activation.ChildID, status, retrieval, diagnostic})
	blocks := []harness.ContentBlock{{Type: harness.BlockText, Text: string(raw)}}
	blocks = append(blocks, content...)
	return harness.ToolResult{Content: blocks, IsError: status == harness.SubagentFailed || status == harness.SubagentAborted || failed}
}

func (s *claudeDelegation) stopParent(parent *harness.Agent, forget bool) {
	s.mu.Lock()
	var tasks []*claudeTask
	for id, task := range s.tasks {
		if task.parent == parent {
			task.suppressNotice.Store(true)
			tasks = append(tasks, task)
			if forget {
				delete(s.tasks, id)
			}
		}
	}
	s.mu.Unlock()
	for _, task := range tasks {
		_ = task.activation.RequestDispose()
	}
}
