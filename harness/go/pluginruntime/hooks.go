package pluginruntime

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/plugins"
	point "github.com/phodal/pero/harness/go/runtime"
	"github.com/phodal/pero/harness/go/subagents"
)

var (
	ErrHookStopped = errors.New("plugin-runtime: hook stopped processing")
)

type HookOptions struct {
	Shell          string
	Environment    []string
	StateDirectory string
	MaxStopBlocks  int
	// Retain keeps the hook runtime when a package has no settings hooks, so
	// skill and agent frontmatter hooks can register later.
	Retain bool
}

type HookApp struct {
	h                   *harness.Harness
	packages            []plugins.Package
	options             HookOptions
	transcriptDirectory string
	instance            *point.Instance
	owner               context.Context
	mu                  sync.Mutex
	closed              bool
	states              map[*harness.Agent]*hookAgentState
	calls               sync.WaitGroup
	skillHooks          map[*harness.Agent][]sessionHook
	retired             map[string]bool
	asyncNotes          map[*harness.Agent][]string
	asyncCancels        []context.CancelFunc
	fileWatchCancels    map[*harness.Agent]context.CancelFunc
	dynamicWatches      map[*harness.Agent][]string
	idleCancels         map[*harness.Agent]context.CancelFunc
	modelNotes          map[*harness.Agent]modelNote
}

type sessionHook struct {
	id, root, plugin string
	hook             claudehooks.Hook
}

type hookAgentState struct {
	mu           sync.Mutex
	started      bool
	turn         int
	stopBlocks   int
	userMessages map[string]bool
}

// MountHooks is an explicit execution grant supplied by the composition root.
// It registers only events whose effects are connected to the real Harness.
func MountHooks(ctx context.Context, h *harness.Harness, packages []plugins.Package, options HookOptions) (*HookApp, error) {
	if h == nil {
		return nil, errors.New("plugin-runtime: harness is required")
	}
	count := 0
	for _, pkg := range packages {
		for _, component := range pkg.Definition.Components {
			count += len(component.Hooks)
		}
		for _, hook := range pkg.Hooks {
			count++
			switch hook.Event {
			case "SessionStart", "UserPromptSubmit", "UserPromptExpansion", "PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest", "PostToolBatch", "PreCompact", "PostCompact", "Stop", "StopFailure", "SessionEnd", "SubagentStart", "SubagentStop", "TaskCreated", "TaskCompleted", "WorktreeCreate", "WorktreeRemove", "FileChanged", "Notification", "Setup", "PreModelSwitch", "PostModelSwitch":
			default:
				return nil, fmt.Errorf("plugin-runtime: hook event %q is not implemented", hook.Event)
			}
			if _, err := claudehooks.Match(hook.Matcher, ""); err != nil {
				return nil, err
			}
			if hook.URL == "" && !hook.ExecForm && !filepath.IsAbs(options.Shell) {
				return nil, errors.New("plugin-runtime: command hooks require an explicit absolute shell")
			}
		}
	}
	if count == 0 && !options.Retain {
		return nil, nil
	}
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		return nil, errors.New("plugin-runtime: command hook process ownership is not implemented on this platform")
	}
	if !filepath.IsAbs(options.StateDirectory) {
		return nil, errors.New("plugin-runtime: hooks require an explicit absolute state directory")
	}
	if options.MaxStopBlocks == 0 {
		options.MaxStopBlocks = 8
	}
	if options.MaxStopBlocks < 1 {
		return nil, errors.New("plugin-runtime: Stop hook continuation budget must be positive")
	}
	directory := filepath.Join(options.StateDirectory, "claude-transcripts")
	if err := os.MkdirAll(directory, 0700); err != nil {
		return nil, fmt.Errorf("plugin-runtime: create transcript directory: %w", err)
	}
	info, err := os.Lstat(directory)
	if err != nil || !info.IsDir() {
		return nil, errors.New("plugin-runtime: transcript directory must be a real directory")
	}
	app := &HookApp{h: h, packages: append([]plugins.Package(nil), packages...), options: options, transcriptDirectory: directory, states: make(map[*harness.Agent]*hookAgentState)}
	app.options.Environment = append([]string(nil), options.Environment...)
	requires := []point.Requirement{point.Require(harness.AgentHooksKey), point.Require(harness.ToolRegistryKey)}
	if h.Subagents() != nil {
		requires = append(requires, point.Require(harness.SubagentRegistryKey))
	}
	definition := point.Define(point.Descriptor{ID: "harness/claude-command-hooks", Requires: requires}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
		app.owner = run.Context
		if err := run.BeforeCleanup("claude-hooks/drain", app.drain); err != nil {
			return nil, err
		}
		return nil, app.register(run)
	})
	app.instance, err = h.Runtime().Mount(nil, "claude-command-hooks", definition, nil)
	if err == nil {
		err = app.instance.WaitStable(ctx)
	}
	if err != nil {
		_ = app.Close()
		return nil, err
	}
	return app, nil
}

func (app *HookApp) register(run *point.Run) error {
	hooks, tools := app.h.Hooks(), app.h.Tools()
	if registry := app.h.Subagents(); registry != nil {
		if _, err := registry.Started.On(run, func(ctx context.Context, info harness.SubagentLifecycle) error {
			if info.Child == nil {
				return nil
			}
			// Start is informational: even an exit-2 hook cannot deny spawning.
			if err := app.withAgent(ctx, info.Child, func(ctx context.Context, _ *hookAgentState) error { return app.startingChild(ctx, info.Child) }); err != nil {
				app.h.Runtime().Logger().Warn("Claude SubagentStart hook failed without blocking creation", "error", err)
			}
			return nil
		}); err != nil {
			return err
		}
	}
	if _, err := hooks.PreStep.Use(run, func(ctx context.Context, input harness.StepInput, next point.Next[harness.StepInput]) (harness.StepInput, error) {
		app.deliverAsyncNotes(&input)
		err := app.withAgent(ctx, input.Agent, func(ctx context.Context, state *hookAgentState) error { return app.prepare(ctx, &input, state) })
		if err != nil {
			return input, err
		}
		return next(input)
	}, point.ListenerOptions{Prepend: true}); err != nil {
		return err
	}
	if app.h.Approvals() != nil {
		if _, err := app.h.Approvals().RegisterBeforePrompt(run, app.permissionRequest); err != nil {
			return err
		}
	}
	if _, err := tools.Before.Use(run, func(ctx context.Context, request harness.ToolRequest, next point.Next[harness.ToolRequest]) (harness.ToolRequest, error) {
		err := app.withAgent(ctx, request.Agent, func(ctx context.Context, state *hookAgentState) error {
			return app.beforeTool(ctx, &request)
		})
		if err != nil {
			return request, err
		}
		return next(request)
	}); err != nil {
		return err
	}
	if _, err := hooks.PostToolBatch.Use(run, func(ctx context.Context, input harness.ToolBatchInput, next point.Next[harness.ToolBatchInput]) (harness.ToolBatchInput, error) {
		err := app.withAgent(ctx, input.Agent, func(ctx context.Context, _ *hookAgentState) error {
			return app.afterToolBatch(ctx, &input)
		})
		if err != nil {
			return input, err
		}
		return next(input)
	}); err != nil {
		return err
	}
	if _, err := tools.After.Use(run, func(ctx context.Context, outcome harness.ToolOutcome, next point.Next[harness.ToolOutcome]) (harness.ToolOutcome, error) {
		err := app.withAgent(ctx, outcome.Request.Agent, func(ctx context.Context, state *hookAgentState) error {
			if !outcome.Result.ConcludesTurn {
				state.stopBlocks = 0
			}
			return app.afterTool(ctx, &outcome)
		})
		if err != nil {
			return outcome, err
		}
		return next(outcome)
	}); err != nil {
		return err
	}
	if _, err := hooks.TurnStopping.On(run, func(ctx context.Context, input harness.TurnStoppingInput) error {
		return app.withAgent(ctx, input.Agent, func(ctx context.Context, state *hookAgentState) error { return app.stopping(ctx, input.Agent, state) })
	}); err != nil {
		return err
	}
	if _, err := hooks.PreModelSwitch.Use(run, func(ctx context.Context, input harness.ModelSwitchInput, next point.Next[harness.ModelSwitchInput]) (harness.ModelSwitchInput, error) {
		err := app.withAgent(ctx, input.Agent, func(ctx context.Context, _ *hookAgentState) error {
			return app.beforeModelSwitch(ctx, &input)
		})
		if err != nil {
			return input, err
		}
		return next(input)
	}); err != nil {
		return err
	}
	if _, err := hooks.PostModelSwitch.Use(run, func(ctx context.Context, input harness.ModelSwitchInput, next point.Next[harness.ModelSwitchInput]) (harness.ModelSwitchInput, error) {
		err := app.withAgent(ctx, input.Agent, func(ctx context.Context, _ *hookAgentState) error {
			return app.afterModelSwitch(ctx, input)
		})
		if err != nil {
			return input, err
		}
		return next(input)
	}); err != nil {
		return err
	}
	if _, err := hooks.Request.Use(run, func(ctx context.Context, request harness.GenerateRequest, next point.Next[harness.GenerateRequest]) (harness.GenerateRequest, error) {
		request, err := next(request)
		if err != nil || request.Agent == nil || request.Purpose != "" {
			return request, err
		}
		if note := app.modelNoteForRequest(request.Agent, request.Turn); note != "" {
			request.Messages = append(request.Messages, hookMessage("PostModelSwitch", note))
		}
		return request, nil
	}, point.ListenerOptions{Prepend: true}); err != nil {
		return err
	}
	if _, err := hooks.Error.On(run, func(ctx context.Context, input harness.AgentErrorInput) error {
		return app.withAgent(ctx, input.Agent, func(ctx context.Context, _ *hookAgentState) error {
			return app.stopFailure(ctx, input.Agent, input.Error)
		})
	}); err != nil {
		return err
	}
	if _, err := hooks.PreCompact.Use(run, func(ctx context.Context, input harness.CompactionHookInput, next point.Next[harness.CompactionHookInput]) (harness.CompactionHookInput, error) {
		err := app.withAgent(ctx, input.Agent, func(ctx context.Context, state *hookAgentState) error {
			hookInput := claudehooks.Input{Event: "PreCompact", Trigger: input.Trigger, CustomInstructions: []byte("null")}
			if input.CustomInstructions != "" {
				encoded, err := json.Marshal(input.CustomInstructions)
				if err != nil {
					return err
				}
				hookInput.CustomInstructions = encoded
			}
			decision, err := app.event(ctx, input.Agent, hookInput)
			if err != nil {
				return err
			}
			if decision.Block {
				input.Reject, input.Reason = true, decision.Reason
			} else if decision.AdditionalContext != "" {
				input.Messages = append(input.Messages, hookMessage("PreCompact", decision.AdditionalContext))
			}
			return nil
		})
		if err != nil {
			return input, err
		}
		return next(input)
	}); err != nil {
		return err
	}
	if _, err := hooks.PostCompact.Use(run, func(ctx context.Context, input harness.CompactionHookInput, next point.Next[harness.CompactionHookInput]) (harness.CompactionHookInput, error) {
		err := app.withAgent(ctx, input.Agent, func(ctx context.Context, state *hookAgentState) error {
			events := []claudehooks.Input{{Event: "PostCompact", Trigger: input.Trigger, CompactSummary: input.CompactSummary}}
			if input.Agent.Parent() == nil {
				events = append(events, claudehooks.Input{Event: "SessionStart", Source: "compact"})
			}
			for _, event := range events {
				decision, err := app.event(ctx, input.Agent, event)
				if err != nil {
					return err
				}
				if decision.Stop {
					return fmt.Errorf("%w: %s", ErrHookStopped, decision.Reason)
				}
				if decision.AdditionalContext != "" {
					input.Messages = append(input.Messages, hookMessage(event.Event, decision.AdditionalContext))
				}
			}
			return nil
		})
		if err != nil {
			return input, err
		}
		return next(input)
	}); err != nil {
		return err
	}
	if _, err := hooks.Status.On(run, func(_ context.Context, input harness.AgentStatusInput) error {
		app.noteIdle(input.Agent, input.Status)
		return nil
	}); err != nil {
		return err
	}
	_, err := hooks.Deactivated.On(run, func(ctx context.Context, agent *harness.Agent) error {
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		var err error
		if agent.Parent() == nil {
			err = app.withAgent(cleanup, agent, func(ctx context.Context, state *hookAgentState) error {
				_, err := app.event(ctx, agent, claudehooks.Input{Event: "SessionEnd", Reason: "other"})
				return err
			})
		}
		app.mu.Lock()
		delete(app.states, agent)
		if cancelWatch := app.fileWatchCancels[agent]; cancelWatch != nil {
			delete(app.fileWatchCancels, agent)
			cancelWatch()
		}
		if cancelIdle := app.idleCancels[agent]; cancelIdle != nil {
			delete(app.idleCancels, agent)
			cancelIdle()
		}
		delete(app.modelNotes, agent)
		delete(app.dynamicWatches, agent)
		app.mu.Unlock()
		return err
	})
	return err
}

func (app *HookApp) withAgent(ctx context.Context, agent *harness.Agent, effect func(context.Context, *hookAgentState) error) error {
	if agent == nil {
		return errors.New("plugin-runtime: hook event requires an agent")
	}
	app.mu.Lock()
	if app.closed {
		app.mu.Unlock()
		return point.ErrInactiveRun
	}
	state := app.states[agent]
	if state == nil {
		state = &hookAgentState{userMessages: make(map[string]bool)}
		app.states[agent] = state
	}
	app.calls.Add(1)
	app.mu.Unlock()
	defer app.calls.Done()
	operation, cancel := context.WithCancel(ctx)
	stop := context.AfterFunc(app.owner, cancel)
	defer func() { stop(); cancel() }()
	state.mu.Lock()
	defer state.mu.Unlock()
	if err := operation.Err(); err != nil {
		return err
	}
	return effect(operation, state)
}

func (app *HookApp) prepare(ctx context.Context, input *harness.StepInput, state *hookAgentState) error {
	if state.turn != input.Turn {
		state.turn, state.stopBlocks = input.Turn, 0
		app.retireUsedModelNote(input.Agent, input.Turn)
	}
	if input.Agent.Parent() != nil {
		return nil
	}
	if !state.started {
		app.ensureFileWatch(input.Agent)
		source := "startup"
		if !input.Agent.FreshSession() {
			source = "resume"
		}
		decision, err := app.event(ctx, input.Agent, claudehooks.Input{Event: "SessionStart", Source: source})
		if err != nil {
			return err
		}
		if decision.Stop {
			return fmt.Errorf("%w: %s", ErrHookStopped, decision.Reason)
		}
		if decision.AdditionalContext != "" {
			input.Messages = append(input.Messages, hookMessage("SessionStart", decision.AdditionalContext))
		}
		state.started = true
	}
	var userIDs, prompts []string
	for _, message := range input.Messages {
		if !directUserMessage(message) || state.userMessages[message.ID] {
			continue
		}
		userIDs = append(userIDs, message.ID)
		prompts = append(prompts, messageText(message))
	}
	if len(userIDs) == 0 {
		return nil
	}
	decision, err := app.event(ctx, input.Agent, claudehooks.Input{Event: "UserPromptSubmit", Prompt: strings.Join(prompts, "\n")})
	if err != nil {
		return err
	}
	for _, id := range userIDs {
		state.userMessages[id] = true
	}
	if decision.Stop || decision.Block {
		input.Reject = true
		input.RejectReason = decision.Reason
		if input.RejectReason == "" {
			input.RejectReason = "Claude command hook rejected this user prompt."
		}
	}
	if decision.AdditionalContext != "" {
		input.Messages = append(input.Messages, hookMessage("UserPromptSubmit", decision.AdditionalContext))
	}
	return nil
}

func legacyHookPaths(raw json.RawMessage) (filePath, notebookPath string) {
	var fields struct {
		FilePath     string `json:"file_path"`
		NotebookPath string `json:"notebook_path"`
	}
	_ = json.Unmarshal(raw, &fields)
	return fields.FilePath, fields.NotebookPath
}

func (app *HookApp) beforeTool(ctx context.Context, request *harness.ToolRequest) error {
	filePath, notebookPath := legacyHookPaths(request.Arguments)
	decision, err := app.event(ctx, request.Agent, claudehooks.Input{Event: "PreToolUse", ToolName: request.Name, ToolUseID: string(request.CallID), ToolInput: request.Arguments, FilePath: filePath, NotebookPath: notebookPath})
	if err != nil {
		return err
	}
	if decision.Stop {
		return fmt.Errorf("%w: %s", ErrHookStopped, decision.Reason)
	}
	if len(decision.UpdatedInput) > 0 {
		request.Arguments = decision.UpdatedInput
	}
	if decision.Block || decision.Permission == "deny" {
		if request.DenyReason == "" {
			request.DenyReason = decision.Reason
			if request.DenyReason == "" {
				request.DenyReason = "Claude command hook denied this tool call."
			}
		}
	} else if decision.Permission == "ask" {
		request.RequestApproval, request.Preapproved = true, false
		request.ApprovalReason = decision.Reason
	} else if decision.Permission == "allow" && !request.RequestApproval {
		request.Preapproved = true
	}
	if decision.AdditionalContext != "" {
		return request.Agent.Inject(hookMessage("PreToolUse", decision.AdditionalContext))
	}
	return nil
}

func (app *HookApp) afterTool(ctx context.Context, outcome *harness.ToolOutcome) error {
	if err := app.applyTaskHooks(ctx, outcome); err != nil {
		return err
	}
	event := "PostToolUse"
	if outcome.Result.IsError {
		event = "PostToolUseFailure"
	}
	response := outcome.Result.Value
	if len(response) == 0 {
		var err error
		response, err = json.Marshal(outcome.Result)
		if err != nil {
			return err
		}
	}
	decision, err := app.event(ctx, outcome.Request.Agent, claudehooks.Input{Event: event, ToolName: outcome.Request.Name, ToolUseID: string(outcome.Request.CallID), ToolInput: outcome.Request.Arguments, ToolResponse: response})
	if err != nil {
		return err
	}
	if decision.Stop {
		return fmt.Errorf("%w: %s", ErrHookStopped, decision.Reason)
	}
	if event == "PostToolUse" && len(decision.UpdatedToolOutput) > 0 {
		if err := replaceToolOutput(&outcome.Result, decision.UpdatedToolOutput); err != nil {
			return err
		}
	}
	text := decision.AdditionalContext
	if decision.Block && decision.Reason != "" {
		text = strings.TrimSpace(text + "\n" + decision.Reason)
	}
	if text != "" {
		message := hookMessage(event, text)
		outcome.Result.AdditionalContexts = append(outcome.Result.AdditionalContexts, harness.DeferredContext{Role: message.Role, Content: message.Content, Source: message.Source})
	}
	return nil
}

func replaceToolOutput(result *harness.ToolResult, raw json.RawMessage) error {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || !json.Valid(raw) {
		return errors.New("plugin-runtime: updatedToolOutput must be JSON")
	}
	if raw[0] == '"' {
		var text string
		if err := json.Unmarshal(raw, &text); err != nil {
			return err
		}
		result.Content = []harness.ContentBlock{{Type: harness.BlockText, Text: text}}
		result.Value = append(json.RawMessage(nil), raw...)
		return nil
	}
	result.Content = []harness.ContentBlock{{Type: harness.BlockText, Text: string(raw)}}
	result.Value = append(json.RawMessage(nil), raw...)
	return nil
}

func (app *HookApp) stopping(ctx context.Context, agent *harness.Agent, state *hookAgentState) error {
	event := "Stop"
	if agent.Parent() != nil {
		event = "SubagentStop"
	}
	messages, err := agent.Session().DeriveMessages()
	if err != nil {
		return err
	}
	lastAssistant := ""
	for index := len(messages) - 1; index >= 0; index-- {
		if messages[index].Role == harness.RoleAssistant {
			lastAssistant = messageText(messages[index])
			break
		}
	}
	decision, err := app.event(ctx, agent, claudehooks.Input{Event: event, StopHookActive: state.stopBlocks > 0, LastAssistantMessage: lastAssistant})
	if err != nil {
		return err
	}
	if decision.Stop {
		return fmt.Errorf("%w: %s", ErrHookStopped, decision.Reason)
	}
	if !decision.Block && decision.AdditionalContext == "" {
		return nil
	}
	if state.stopBlocks >= app.options.MaxStopBlocks {
		return nil
	}
	state.stopBlocks++
	text := strings.TrimSpace(decision.Reason + "\n" + decision.AdditionalContext)
	if text == "" {
		text = "Claude command hook requires the workflow to continue."
	}
	return agent.Inject(hookMessage(event, text))
}

type runnableHook struct {
	hook   claudehooks.Hook
	root   string
	plugin string
	onceID string
}

func (app *HookApp) event(ctx context.Context, agent *harness.Agent, input claudehooks.Input) (claudehooks.Decision, error) {
	var decisions []claudehooks.Decision
	identity, err := subagents.HookAttribution(agent)
	if err != nil {
		return claudehooks.Decision{}, err
	}
	input.SessionID, input.CWD = string(identity.Session.ID()), agent.Session().WorkingDirectory()
	input.AgentID, input.AgentType = string(identity.AgentID), identity.AgentType
	for _, selected := range app.hooksFor(agent, input) {
		hook := selected.hook
		if hook.Event != input.Event {
			continue
		}
		matcherValue, filter, matches := "", false, true
		switch input.Event {
		case "SessionStart":
			matcherValue, filter = input.Source, true
		case "PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest":
			matcherValue, filter = input.ToolName, true
		case "FileChanged":
			matcherValue, filter = filepath.Base(input.FilePath), true
		case "Notification":
			matcherValue, filter = input.NotificationType, true
		case "UserPromptExpansion":
			matcherValue, filter = input.CommandName, true
		case "StopFailure":
			matcherValue, filter = input.ErrorKind, true
		case "PreModelSwitch", "PostModelSwitch":
			matcherValue, filter = input.ToModel, true
		case "SubagentStart", "SubagentStop":
			matcherValue, filter = input.AgentType, true
		case "PreCompact", "PostCompact", "Setup":
			matcherValue, filter = input.Trigger, true
		}
		if filter {
			var err error
			matches, err = claudehooks.Match(hook.Matcher, matcherValue)
			if err != nil {
				return claudehooks.Decision{}, err
			}
		}
		if !matches || !claudehooks.IfMatches(hook.If, input) {
			continue
		}
		if input.TranscriptPath == "" {
			var err error
			input.TranscriptPath, err = app.writeTranscript(identity.Session)
			if err != nil {
				return claudehooks.Decision{}, err
			}
		}
		if input.Event == "SubagentStop" && input.AgentTranscriptPath == "" {
			input.AgentTranscriptPath, err = app.writeTranscript(agent)
			if err != nil {
				return claudehooks.Decision{}, err
			}
		}
		project := identity.Session.Session().Header().CWD
		if project == "" {
			project = input.CWD
		}
		dataDirectory, err := plugins.EnsurePluginDataDirectory(selected.plugin)
		if err != nil {
			return claudehooks.Decision{}, err
		}
		environment := append([]string{}, app.options.Environment...)
		environment = append(environment, "CLAUDE_PLUGIN_ROOT="+selected.root, "CLAUDE_PLUGIN_DATA="+dataDirectory, "CLAUDE_PROJECT_DIR="+project, "CLAUDE_SESSION_ID="+input.SessionID)
		if hook.ExecForm {
			expand := strings.NewReplacer("${CLAUDE_PLUGIN_ROOT}", selected.root, "${CLAUDE_PLUGIN_DATA}", dataDirectory, "${CLAUDE_PROJECT_DIR}", project, "${CLAUDE_SESSION_ID}", input.SessionID)
			hook.Command = expand.Replace(hook.Command)
			hook.Args = append([]string(nil), hook.Args...)
			for index := range hook.Args {
				hook.Args[index] = expand.Replace(hook.Args[index])
			}
		}
		if hook.Async {
			if err := app.startAsyncHook(agent, selected, hook, input, environment); err != nil {
				app.h.Runtime().Logger().Warn("Claude async hook failed to start", "plugin", selected.plugin, "event", input.Event, "error", err)
			}
			continue
		}
		runner := claudehooks.Runner{Shell: app.options.Shell, Environment: environment}
		var decision claudehooks.Decision
		if hook.URL != "" {
			decision, err = runner.Post(ctx, hook, input)
		} else {
			decision, err = runner.Run(ctx, hook, input)
		}
		if selected.onceID != "" && hook.Once && err == nil && !decision.Block {
			app.retireSkillHook(selected.onceID)
		}
		if err != nil {
			if errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
				return claudehooks.Decision{}, err
			}
			if input.Event == "PreModelSwitch" && errors.Is(err, context.DeadlineExceeded) {
				decisions = append(decisions, claudehooks.Decision{Block: true, Reason: "PreModelSwitch hook timed out."})
				continue
			}
			if failureBlocks(hook, input.Event) {
				decisions = append(decisions, blockedHookFailure(hook, input, err))
				continue
			}
			app.h.Runtime().Logger().Warn("Claude command hook failed without blocking", "plugin", selected.plugin, "event", input.Event, "error", err)
			continue
		}
		if decision.SystemMessage != "" {
			app.h.Runtime().Logger().Warn("Claude command hook message", "plugin", selected.plugin, "event", input.Event, "message", decision.SystemMessage)
		}
		decisions = append(decisions, decision)
	}
	return claudehooks.Merge(decisions)
}

func (app *HookApp) hooksFor(agent *harness.Agent, input claudehooks.Input) []runnableHook {
	var hooks []runnableHook
	for _, pkg := range app.packages {
		for _, hook := range pkg.Hooks {
			hooks = append(hooks, runnableHook{hook: hook, root: pkg.Root, plugin: pkg.Definition.Name})
		}
		if input.AgentType == "" {
			continue
		}
		for _, component := range pkg.Definition.Components {
			if component.Kind != plugins.ComponentAgent || component.QualifiedName != input.AgentType {
				continue
			}
			for _, hook := range component.Hooks {
				copied := hook
				copied.Once = false
				if copied.Event == "Stop" {
					copied.Event = "SubagentStop"
				}
				hooks = append(hooks, runnableHook{hook: copied, root: pkg.Root, plugin: pkg.Definition.Name})
			}
		}
	}
	app.mu.Lock()
	defer app.mu.Unlock()
	for _, hook := range app.skillHooks[agent] {
		if app.retired[hook.id] {
			continue
		}
		hooks = append(hooks, runnableHook{hook: hook.hook, root: hook.root, plugin: hook.plugin, onceID: hook.id})
	}
	return hooks
}

// ActivateSkillHooks keeps skill frontmatter hooks for the rest of this agent session.
// once hooks leave after their first successful run.
func (app *HookApp) ActivateSkillHooks(agent *harness.Agent, pluginName, root, skill string, hooks []claudehooks.Hook) {
	if app == nil || agent == nil || len(hooks) == 0 {
		return
	}
	app.mu.Lock()
	defer app.mu.Unlock()
	if app.skillHooks == nil {
		app.skillHooks = map[*harness.Agent][]sessionHook{}
	}
	current := app.skillHooks[agent]
	for index, hook := range hooks {
		id := skill + "#" + hook.Event + "#" + strconv.Itoa(index)
		if app.retired[id] {
			continue
		}
		exists := false
		for _, saved := range current {
			if saved.id == id {
				exists = true
				break
			}
		}
		if exists {
			continue
		}
		current = append(current, sessionHook{id: id, root: root, plugin: pluginName, hook: hook})
	}
	app.skillHooks[agent] = current
}

func (app *HookApp) startAsyncHook(agent *harness.Agent, selected runnableHook, hook claudehooks.Hook, input claudehooks.Input, environment []string) error {
	parent := app.owner
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	started, err := (claudehooks.Runner{Shell: app.options.Shell, Environment: environment}).StartDetached(ctx, hook, input)
	if err != nil {
		cancel()
		return err
	}
	app.mu.Lock()
	if app.closed {
		app.mu.Unlock()
		cancel()
		_ = started.Wait()
		return errors.New("plugin-runtime: async hook started after shutdown")
	}
	app.asyncCancels = append(app.asyncCancels, cancel)
	app.calls.Add(1)
	app.mu.Unlock()
	go func() {
		defer app.calls.Done()
		defer cancel()
		err := started.Wait()
		if app.closing() {
			return
		}
		decision, parseErr := claudehooks.ParseDecision(hook.Event, started.Stdout.Bytes(), started.Stderr.Bytes(), started.ExitCode(err))
		if parseErr != nil || decision.AdditionalContext == "" && decision.SystemMessage == "" {
			return
		}
		text := strings.TrimSpace(decision.SystemMessage + "\n" + decision.AdditionalContext)
		app.mu.Lock()
		if app.asyncNotes == nil {
			app.asyncNotes = map[*harness.Agent][]string{}
		}
		app.asyncNotes[agent] = append(app.asyncNotes[agent], text)
		if selected.onceID != "" && hook.Once && err == nil {
			if app.retired == nil {
				app.retired = map[string]bool{}
			}
			app.retired[selected.onceID] = true
		}
		app.mu.Unlock()
	}()
	return nil
}

func (app *HookApp) closing() bool {
	app.mu.Lock()
	defer app.mu.Unlock()
	return app.closed
}

func (app *HookApp) deliverAsyncNotes(input *harness.StepInput) {
	if input.Agent == nil {
		return
	}
	app.mu.Lock()
	notes := app.asyncNotes[input.Agent]
	delete(app.asyncNotes, input.Agent)
	app.mu.Unlock()
	for _, text := range notes {
		input.Messages = append(input.Messages, hookMessage("async-hook", text))
	}
}

func (app *HookApp) retireSkillHook(id string) {
	app.mu.Lock()
	defer app.mu.Unlock()
	if app.retired == nil {
		app.retired = map[string]bool{}
	}
	app.retired[id] = true
}

func hookMessage(event, text string) harness.Message {
	source, _ := json.Marshal(struct {
		Kind  string `json:"kind"`
		Event string `json:"event"`
	}{Kind: "claude-hook", Event: event})
	return harness.Message{Role: harness.RoleUser, Source: source, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: text}}}
}

func (app *HookApp) drain(ctx context.Context) error {
	app.mu.Lock()
	app.closed = true
	cancels := app.asyncCancels
	app.asyncCancels = nil
	app.mu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
	done := make(chan struct{})
	go func() { app.calls.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (app *HookApp) Dispose(ctx context.Context) error {
	if app == nil || app.instance == nil {
		return nil
	}
	return app.instance.Dispose(ctx)
}

func (app *HookApp) Close() error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	return app.Dispose(ctx)
}
