package subagents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

// AgentDefinition is trusted composition compiled from a selected plugin.
// Tools is an exact allowlist intersected with the parent's existing tools.
type AgentDefinition struct {
	Name, Description, Instructions, Model string
	Tools                                  []string
}

type ClaudeOptions struct {
	ModelRoutes         []ModelRoute
	MaxDepth, MaxActive int
	Persistence         harness.SessionPersistence
	Compaction          *harness.BasicCompactionConfig
	// InvocationOrigin supplies the current workflow's plugin namespace. It is
	// trusted composition; model arguments cannot choose a resolution namespace.
	InvocationOrigin func(*harness.Agent) string
}

type ClaudeContribution struct {
	instance, provider *point.Instance
	service            *claudeDelegation
}

func (c *ClaudeContribution) Dispose(ctx context.Context) error {
	if c == nil {
		return nil
	}
	var err error
	if c.instance != nil {
		err = c.instance.Dispose(ctx)
	}
	if c.provider != nil {
		err = errors.Join(err, c.provider.Dispose(ctx))
	}
	return err
}

type claudeTask struct {
	parent     *harness.Agent
	activation harness.SubagentActivation
	done       chan struct{}
	result     harness.SubagentResult
	err        error
}

type claudeDelegation struct {
	h                *harness.Harness
	run              *point.Run
	facade           *harness.SubagentFacade
	definitions      map[string]AgentDefinition
	readOnlyBuiltins map[string]bool
	routes           map[string]ModelRoute
	maxDepth         int
	invocationOrigin func(*harness.Agent) string
	mu               sync.Mutex
	tasks            map[harness.SessionID]*claudeTask
}

// MountClaude mounts real Agent/TaskOutput/TaskStop calls over the existing
// registry. Its task cache retains handles/results only; the registry owns all
// child execution, scope, concurrency and teardown.
func MountClaude(ctx context.Context, h *harness.Harness, definitions []AgentDefinition, options ClaudeOptions) (*ClaudeContribution, error) {
	if h == nil || h.Subagents() == nil {
		return nil, errors.New("subagents: Claude delegation requires enabled subagents")
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
	service := &claudeDelegation{h: h, maxDepth: options.MaxDepth, invocationOrigin: options.InvocationOrigin, definitions: make(map[string]AgentDefinition), readOnlyBuiltins: make(map[string]bool), routes: make(map[string]ModelRoute), tasks: make(map[harness.SessionID]*claudeTask)}
	for _, definition := range definitions {
		if strings.TrimSpace(definition.Name) == "" || strings.TrimSpace(definition.Description) == "" || strings.TrimSpace(definition.Instructions) == "" {
			return nil, errors.New("subagents: Claude agent requires name, description and instructions")
		}
		if _, exists := service.definitions[definition.Name]; exists {
			return nil, fmt.Errorf("subagents: duplicate Claude agent %q", definition.Name)
		}
		if definition.Tools != nil {
			definition.Tools = append([]string{}, definition.Tools...)
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
	provider, err := MountInProcess(ctx, h, InProcessOptions{EntryID: "subagents/claude/provider", Name: "claude", Persistence: options.Persistence, Compaction: options.Compaction, InheritApproval: true, ModelRoutes: options.ModelRoutes})
	if err != nil {
		return nil, err
	}
	facade, err := h.Subagents().NewFacade(config)
	if err != nil {
		_ = provider.Dispose(context.Background())
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
			if status.Status == harness.AgentIdle && claudeParentInterrupted(status.Agent) {
				service.stopParent(status.Agent, false)
			}
			return nil
		}); err != nil {
			return nil, err
		}
		for _, tool := range []harness.Tool{service.agentTool(), service.outputTool(), service.stopTool()} {
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
		return nil, err
	}
	return &ClaudeContribution{instance: instance, provider: provider, service: service}, nil
}

func (s *claudeDelegation) agentTool() harness.Tool {
	names := make([]string, 0, len(s.definitions))
	for name := range s.definitions {
		names = append(names, name)
	}
	sort.Strings(names)
	var available strings.Builder
	for _, name := range names {
		description := []rune(s.definitions[name].Description)
		if len(description) > 256 {
			description = description[:256]
		}
		fmt.Fprintf(&available, "\n- %s: %s", name, string(description))
	}
	return harness.Tool{Schema: harness.ToolSchema{Name: "Agent", Description: "Run an independent agent with selected instructions, tools and an explicitly mapped model. subagent_type defaults to general-purpose. Bare names resolve within the current plugin first, then by a unique scoped suffix; use the full name if ambiguous. Exact names, including builtins, take precedence. Explore/Plan use only mounted read-only file/search/web/LSP tools; this profile does not give them Bash, Skill or arbitrary MCP tools. Background runs return a real task_id for TaskOutput/TaskStop. Resuming an old task is unavailable. Available subagent_type values:" + available.String(), InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{"subagent_type":{"type":"string","minLength":1},"description":{"type":"string","minLength":1},"prompt":{"type":"string","minLength":1},"model":{"type":"string"},"run_in_background":{"type":"boolean"},"resume":{"type":"string"}},"required":["description","prompt"]}`)}, IsConcurrencySafe: func(context.Context, harness.ToolRequest) bool { return true }, ExecuteRequest: func(ctx context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
		var input struct {
			Type        string `json:"subagent_type"`
			Description string `json:"description"`
			Prompt      string `json:"prompt"`
			Model       string `json:"model"`
			Background  bool   `json:"run_in_background"`
			Resume      string `json:"resume"`
		}
		if err := json.Unmarshal(request.Arguments, &input); err != nil {
			return harness.ToolResult{}, err
		}
		if input.Resume != "" {
			return harness.ToolResult{}, errors.New("subagents: Claude task resume is unsupported; start a new Agent with the previous result")
		}
		task, err := s.start(ctx, request.Agent, ClaudeInvocation{Definition: input.Type, Prompt: input.Prompt, Description: input.Description, Model: input.Model})
		if err != nil {
			return harness.ToolResult{}, err
		}
		if input.Background {
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
	var result harness.SubagentResult
	var ok bool
	select {
	case result, ok = <-task.activation.Result:
	case <-ctx.Done():
		_ = task.activation.RequestDispose()
		result, ok = <-task.activation.Result
	}
	if !ok {
		result = harness.SubagentResult{ChildID: task.activation.ChildID, Status: harness.SubagentFailed, Reason: harness.FinishError, Diagnostic: "subagent closed without a terminal result"}
	}
	task.result, task.err = result, task.activation.Wait(context.Background())
	close(task.done)
}

func (s *claudeDelegation) findTask(parent *harness.Agent, id string) (*claudeTask, error) {
	s.mu.Lock()
	task := s.tasks[harness.SessionID(id)]
	s.mu.Unlock()
	if parent == nil || task == nil || task.parent != parent {
		return nil, errors.New("subagents: task is unavailable to this parent; completed tasks cannot be resumed after process restart")
	}
	return task, nil
}

func (s *claudeDelegation) outputTool() harness.Tool {
	return harness.Tool{Schema: harness.ToolSchema{Name: "TaskOutput", Description: "Read a child task's real output. block defaults to true; timeout is milliseconds, default 30000. A timeout leaves the child running. Only tasks owned by this exact parent can be read.", InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{"task_id":{"type":"string","minLength":1},"block":{"type":"boolean"},"timeout":{"type":"integer","minimum":0,"maximum":600000}},"required":["task_id"]}`)}, IsConcurrencySafe: func(context.Context, harness.ToolRequest) bool { return true }, ExecuteRequest: func(ctx context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
		var input struct {
			ID      string `json:"task_id"`
			Block   *bool  `json:"block"`
			Timeout *int   `json:"timeout"`
		}
		if err := json.Unmarshal(request.Arguments, &input); err != nil {
			return harness.ToolResult{}, err
		}
		task, err := s.findTask(request.Agent, input.ID)
		if err != nil {
			return harness.ToolResult{}, err
		}
		select {
		case <-task.done:
			return claudeTaskResult(task, "success"), nil
		default:
		}
		if input.Block != nil && !*input.Block {
			return claudeTaskResult(task, "not_ready"), nil
		}
		timeout := 30000
		if input.Timeout != nil {
			timeout = *input.Timeout
		}
		timer := time.NewTimer(time.Duration(timeout) * time.Millisecond)
		defer timer.Stop()
		select {
		case <-task.done:
			return claudeTaskResult(task, "success"), nil
		case <-timer.C:
			return claudeTaskResult(task, "timeout"), nil
		case <-ctx.Done():
			return harness.ToolResult{}, ctx.Err()
		}
	}}
}

func (s *claudeDelegation) stopTool() harness.Tool {
	return harness.Tool{Schema: harness.ToolSchema{Name: "TaskStop", Description: "Cancel a child task owned by this exact parent and join its cleanup. Completed tasks keep their original terminal result.", InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{"task_id":{"type":"string","minLength":1}},"required":["task_id"]}`)}, IsConcurrencySafe: func(context.Context, harness.ToolRequest) bool { return true }, ExecuteRequest: func(ctx context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
		var input struct {
			ID string `json:"task_id"`
		}
		if err := json.Unmarshal(request.Arguments, &input); err != nil {
			return harness.ToolResult{}, err
		}
		task, err := s.findTask(request.Agent, input.ID)
		if err != nil {
			return harness.ToolResult{}, err
		}
		if err := task.activation.RequestDispose(); err != nil && !errors.Is(err, harness.ErrSubagentActivationDisposalPending) {
			return harness.ToolResult{}, err
		}
		select {
		case <-task.done:
			result := claudeTaskResult(task, "success")
			// Aborted is the intended outcome of a successful stop request.
			if task.result.Status == harness.SubagentAborted && task.err == nil {
				result.IsError = false
			}
			return result, nil
		case <-ctx.Done():
			return harness.ToolResult{}, ctx.Err()
		}
	}}
}

func claudeTaskResult(task *claudeTask, retrieval string) harness.ToolResult {
	status := harness.SubagentRunning
	var content []harness.ContentBlock
	diagnostic := ""
	failed := false
	select {
	case <-task.done:
		status = task.result.Status
		content = task.result.Output
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

func claudeParentInterrupted(parent *harness.Agent) bool {
	if parent == nil {
		return false
	}
	events := parent.Session().Events()
	for i := len(events) - 1; i >= 0; i-- {
		if events[i].Type != "turn/end" {
			continue
		}
		var end struct {
			Reason harness.FinishKind `json:"reason"`
		}
		return json.Unmarshal(events[i].Data, &end) == nil && (end.Reason == harness.FinishAborted || end.Reason == harness.FinishError)
	}
	return false
}
