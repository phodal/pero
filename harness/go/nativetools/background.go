package nativetools

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
	"github.com/phodal/pero/harness/go/shell"
)

const (
	backgroundShellDefault  = 30 * time.Minute
	backgroundShellMaximum  = 2 * time.Hour
	maximumBackgroundShells = 16
	shellTaskStarted        = "shell-task/started"
	shellTaskEnded          = "shell-task/ended"
)

var errShellTaskStopped = errors.New("shell task stopped by TaskStop")

type shellTaskStatus string

const (
	shellTaskRunning     shellTaskStatus = "running"
	shellTaskCompleted   shellTaskStatus = "completed"
	shellTaskFailed      shellTaskStatus = "failed"
	shellTaskStopped     shellTaskStatus = "stopped"
	shellTaskInterrupted shellTaskStatus = "interrupted"
)

type shellTaskIntent struct {
	Version     int                `json:"version"`
	ID          string             `json:"task_id"`
	Owner       harness.SessionID  `json:"owner"`
	CallID      harness.ToolCallID `json:"call_id"`
	Turn        int                `json:"turn,omitempty"`
	Command     string             `json:"command"`
	Workdir     string             `json:"workdir"`
	Description string             `json:"description,omitempty"`
	TimeoutMS   int64              `json:"timeout_ms"`
	Background  bool               `json:"background"`
	OutputFile  string             `json:"output_file,omitempty"`
}

type shellTaskTerminal struct {
	Version           int               `json:"version"`
	ID                string            `json:"task_id"`
	Owner             harness.SessionID `json:"owner"`
	Status            shellTaskStatus   `json:"status"`
	Result            *shell.RunResult  `json:"result,omitempty"`
	Diagnostic        string            `json:"diagnostic,omitempty"`
	OutputFile        string            `json:"output_file,omitempty"`
	OutputFilePartial bool              `json:"output_file_partial,omitempty"`
}

type shellTask struct {
	parent    *harness.Agent
	intent    shellTaskIntent
	cancel    context.CancelCauseFunc
	done      chan struct{}
	mu        sync.Mutex
	terminal  *shellTaskTerminal
	output    []byte
	lossy     bool
	capture   *shell.FileCapture
	fileReady bool
}

func (t *shellTask) Write(data []byte) (int, error) {
	if t.capture != nil {
		if n, err := t.capture.Write(data); err != nil {
			return n, err
		}
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	const limit = 8192
	if len(data) >= limit {
		t.lossy = t.lossy || len(data) > limit || len(t.output) > 0
		t.output = append(t.output[:0], data[len(data)-limit:]...)
	} else {
		if overflow := len(t.output) + len(data) - limit; overflow > 0 {
			t.output = t.output[overflow:]
			t.lossy = true
		}
		t.output = append(t.output, data...)
	}
	return len(data), nil
}

func (t *shellTask) snapshot(retrieval harness.TaskRetrieval) harness.ToolResult {
	t.mu.Lock()
	status, diagnostic := shellTaskRunning, ""
	outputFile, partial := "", false
	var result *shell.RunResult
	var output *shell.CollectedOutput
	if t.terminal != nil {
		status, diagnostic, result = t.terminal.Status, t.terminal.Diagnostic, t.terminal.Result
		outputFile, partial = t.terminal.OutputFile, t.terminal.OutputFilePartial
		retrieval = harness.TaskRetrieved
	} else {
		output = &shell.CollectedOutput{Text: strings.ToValidUTF8(string(t.output), "�"), Truncated: t.lossy}
		if t.fileReady {
			outputFile = t.intent.OutputFile
			partial = true
		}
	}
	if result != nil {
		copy := *result
		copy.Stdout.Text, copy.Stderr.Text = boundedTail(copy.Stdout.Text, 4096), boundedTail(copy.Stderr.Text, 4096)
		copy.Stdout.Truncated = copy.Stdout.Truncated || len(copy.Stdout.Text) != len(result.Stdout.Text)
		copy.Stderr.Truncated = copy.Stderr.Truncated || len(copy.Stderr.Text) != len(result.Stderr.Text)
		result = &copy
	}
	t.mu.Unlock()
	raw, _ := json.Marshal(struct {
		ID                string                 `json:"task_id"`
		Kind              harness.TaskKind       `json:"kind"`
		Status            shellTaskStatus        `json:"status"`
		Retrieval         harness.TaskRetrieval  `json:"retrieval_status"`
		Diagnostic        string                 `json:"diagnostic,omitempty"`
		Output            *shell.CollectedOutput `json:"output,omitempty"`
		Result            *shell.RunResult       `json:"result,omitempty"`
		OutputFile        string                 `json:"output_file,omitempty"`
		OutputFilePartial bool                   `json:"output_file_partial,omitempty"`
	}{t.intent.ID, harness.TaskKindShell, status, retrieval, boundedText(diagnostic, 1024), output, result, outputFile, partial})
	return harness.ToolResult{IsError: status == shellTaskFailed || status == shellTaskInterrupted || diagnostic != "", Content: []harness.ContentBlock{{Type: harness.BlockText, Text: string(raw)}}}
}

func (t *shellTask) handle() harness.TaskHandle {
	return harness.TaskHandle{ID: t.intent.ID, Kind: harness.TaskKindShell, Done: t.done, Snapshot: t.snapshot, Stop: func(ctx context.Context) (harness.ToolResult, error) {
		if t.cancel != nil {
			t.cancel(errShellTaskStopped)
		}
		select {
		case <-t.done:
			return t.snapshot(harness.TaskRetrieved), nil
		case <-ctx.Done():
			return harness.ToolResult{}, ctx.Err()
		}
	}}
}

// shellTasks owns only native shell execution. Agent activation ownership stays
// in SubagentRegistry; TaskHandle shares their read/stop dispatch surface.
type shellTasks struct {
	instance   *point.Instance
	run        *point.Run
	options    shell.LocalOptions
	foreground shell.LocalOptions
	mu         sync.Mutex
	closed     bool
	fenced     map[*harness.Agent]bool
	tasks      map[string]*shellTask
	recovery   sync.Mutex
	admission  sync.Mutex
}

func mountShellTasks(ctx context.Context, h *harness.Harness, options shell.LocalOptions) (*shellTasks, error) {
	foreground := options
	options.Timeout, options.MaxTimeout = backgroundShellDefault, backgroundShellMaximum
	owner := &shellTasks{options: options, foreground: foreground, tasks: make(map[string]*shellTask), fenced: make(map[*harness.Agent]bool)}
	definition := point.Define(point.Descriptor{ID: "harness/contribution/background-shell", Requires: []point.Requirement{point.Require(harness.AgentHooksKey)}}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
		owner.run = run
		if _, err := h.Hooks().Activated.On(run, func(ctx context.Context, agent *harness.Agent) error {
			history, err := foldShellTasks(agent.Session().Events(), agent.ID())
			if err != nil {
				return err
			}
			for id := range history {
				if _, _, err := owner.lookup(ctx, agent, id); err != nil {
					return err
				}
			}
			return nil
		}); err != nil {
			return nil, err
		}
		if err := run.BeforeCleanup("background-shell", func(ctx context.Context) error { return owner.stop(ctx, nil, true, true) }); err != nil {
			return nil, err
		}
		if _, err := h.Hooks().Retiring.On(run, func(ctx context.Context, agent *harness.Agent) error {
			cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
			defer cancel()
			return owner.stop(cleanup, agent, false, true)
		}); err != nil {
			return nil, err
		}
		if _, err := h.Hooks().Deactivated.On(run, func(_ context.Context, agent *harness.Agent) error {
			owner.mu.Lock()
			defer owner.mu.Unlock()
			delete(owner.fenced, agent)
			for id, task := range owner.tasks {
				if task.parent == agent {
					delete(owner.tasks, id)
				}
			}
			return nil
		}); err != nil {
			return nil, err
		}
		if _, err := h.Hooks().Status.On(run, func(ctx context.Context, input harness.AgentStatusInput) error {
			if input.Status == harness.AgentIdle && shellParentInterrupted(input.Agent) {
				cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
				defer cancel()
				return owner.stop(cleanup, input.Agent, false, false)
			}
			return nil
		}); err != nil {
			return nil, err
		}
		return nil, nil
	})
	instance, err := h.Runtime().Mount(nil, "native/background-shell", definition, nil)
	if err == nil {
		err = instance.WaitStable(ctx)
	}
	if err == nil && instance.Snapshot().State == point.Failed {
		err = errors.New(instance.Snapshot().LastError)
	}
	if err != nil {
		if instance != nil {
			_ = instance.Dispose(context.Background())
		}
		return nil, err
	}
	owner.instance = instance
	return owner, nil
}

func (s *shellTasks) start(ctx context.Context, request harness.ToolRequest, input arguments) (harness.ToolResult, error) {
	s.admission.Lock()
	releaseAdmission := sync.OnceFunc(s.admission.Unlock)
	defer releaseAdmission()
	if err := ctx.Err(); err != nil {
		return harness.ToolResult{}, err
	}
	task := &shellTask{parent: request.Agent, done: make(chan struct{}), capture: &shell.FileCapture{}}
	options := s.options
	if !input.RunInBackground {
		options = s.foreground
	}
	options.OutputSink = task
	executor, err := shell.NewLocalExecutor(options)
	if err != nil {
		return harness.ToolResult{}, err
	}
	timeout := time.Duration(min(input.TimeoutMS, int(options.MaxTimeout.Milliseconds()))) * time.Millisecond
	spec, err := executor.Resolve(shell.ExecRequest{Command: input.Command, Workdir: request.Agent.Session().WorkingDirectory(), Timeout: timeout})
	if err != nil {
		return harness.ToolResult{}, err
	}
	turn, err := request.Agent.Session().LastTurn()
	if err != nil {
		return harness.ToolResult{}, err
	}
	history, err := foldShellTasks(request.Agent.Session().Events(), request.Agent.ID())
	if err != nil {
		return harness.ToolResult{}, err
	}
	for id, previous := range history {
		if request.CallID == "" || previous.intent.CallID != request.CallID || previous.intent.Turn != turn {
			continue
		}
		if previous.intent.Command != spec.Command || previous.intent.Workdir != spec.Workdir || previous.intent.TimeoutMS != spec.Timeout.Milliseconds() || previous.intent.Background != input.RunInBackground {
			return harness.ToolResult{}, errors.New("background shell call identity already has a different durable intent; do not replay it")
		}
		handle, _, err := s.lookup(ctx, request.Agent, id)
		if err != nil {
			return harness.ToolResult{}, err
		}
		if !input.RunInBackground {
			releaseAdmission()
			return s.waitForeground(ctx, request.Agent, id, handle)
		}
		return handle.Snapshot(harness.TaskNotReady), nil
	}
	task.intent = shellTaskIntent{Version: 1, ID: "bash-" + rand.Text(), Owner: request.Agent.ID(), CallID: request.CallID, Turn: turn, Command: spec.Command, Workdir: spec.Workdir, Description: input.Description, TimeoutMS: spec.Timeout.Milliseconds(), Background: input.RunInBackground}
	plan, err := shell.PlanOutputFile(options.CWD, ".pero/bash-output", task.intent.ID+".log", 0)
	if err != nil {
		return harness.ToolResult{}, err
	}
	task.intent.OutputFile = plan.Path()
	taskCtx, cancel := context.WithCancelCause(s.run.Context)
	task.cancel = cancel
	s.mu.Lock()
	active := 0
	for _, existing := range s.tasks {
		select {
		case <-existing.done:
		default:
			active++
		}
	}
	if s.closed || s.fenced[request.Agent] || !s.run.Active() || active >= maximumBackgroundShells {
		s.mu.Unlock()
		cancel(context.Canceled)
		return harness.ToolResult{}, errors.New("background shell admission unavailable: owner retired or 16-task capacity reached")
	}
	s.tasks[task.intent.ID] = task
	s.mu.Unlock()
	startCtx, stopStart := context.WithCancel(ctx)
	stopTask := context.AfterFunc(taskCtx, stopStart)
	defer func() { stopTask(); stopStart() }()
	if _, err = request.Agent.Session().Append(shellTaskStarted, task.intent); err == nil {
		err = request.Agent.Session().Flush(startCtx)
	}
	if err == nil {
		err = startCtx.Err()
	}
	if err != nil {
		cancel(err)
		s.finish(task, nil, fmt.Errorf("background shell did not launch: %w", err), "failed")
		return harness.ToolResult{}, err
	}
	if err := executor.CheckCWD(request.Agent.Session().WorkingDirectory()); err != nil {
		cancel(err)
		s.finish(task, nil, err, shellTaskFailed)
		return harness.ToolResult{}, err
	}
	if err := task.capture.Open(plan); err != nil {
		cancel(err)
		s.finish(task, nil, err, shellTaskFailed)
		return harness.ToolResult{}, err
	}
	task.mu.Lock()
	task.fileReady = true
	task.mu.Unlock()
	if err := s.run.Go("background-shell/"+task.intent.ID, func(runCtx context.Context) error {
		defer cancel(nil)
		stop := context.AfterFunc(runCtx, func() { cancel(context.Canceled) })
		defer stop()
		result, runErr := executor.Run(taskCtx, spec)
		status := shellTaskCompleted
		if errors.Is(context.Cause(taskCtx), errShellTaskStopped) {
			status, runErr = shellTaskStopped, nil
		} else if runErr != nil {
			status = shellTaskFailed
		} else if !shell.ClaudeCommandSucceeded(spec.Command, result.ExitCode) {
			status = shellTaskFailed
			if result.ExitCode == nil {
				runErr = errors.New("shell completed without an exit code")
			} else {
				runErr = fmt.Errorf("shell exited with code %d", *result.ExitCode)
			}
		}
		s.finish(task, &result, runErr, status)
		return nil
	}); err != nil {
		cancel(err)
		s.finish(task, nil, err, "failed")
		return harness.ToolResult{}, err
	}
	if !input.RunInBackground {
		releaseAdmission()
		return s.waitForeground(ctx, request.Agent, task.intent.ID, task.handle())
	}
	return task.snapshot(harness.TaskNotReady), nil
}

func (s *shellTasks) finish(task *shellTask, result *shell.RunResult, operationErr error, status shellTaskStatus) {
	terminal := shellTaskTerminal{Version: 1, ID: task.intent.ID, Owner: task.intent.Owner, Status: status, Result: result}
	if task.capture != nil && task.capture.Path() != "" {
		terminal.OutputFile = task.intent.OutputFile
		terminal.OutputFilePartial = result == nil || result.Aborted || result.TimedOut || result.CleanupUncertain || result.ExitCode == nil || errors.Is(operationErr, shell.ErrOutputFileLimit) || errors.Is(operationErr, exec.ErrWaitDelay)
		if result != nil {
			result.OutputFile = terminal.OutputFile
			result.OutputBytes = task.capture.Bytes()
			result.OutputFilePartial = terminal.OutputFilePartial
		}
		if err := task.capture.Close(true); err != nil {
			operationErr = errors.Join(operationErr, fmt.Errorf("preserve shell output file: %w", err))
			terminal.Status, terminal.OutputFilePartial = shellTaskFailed, true
			if result != nil {
				result.OutputFilePartial = true
			}
		}
	}
	if operationErr != nil {
		terminal.Diagnostic = operationErr.Error()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err := task.parent.Session().Append(shellTaskEnded, terminal)
	if err == nil {
		err = task.parent.Session().Flush(ctx)
	}
	if err != nil {
		terminal.Diagnostic += "; terminal durability failed; do not replay the command: " + err.Error()
	}
	task.mu.Lock()
	task.terminal = &terminal
	task.mu.Unlock()
	close(task.done)
}

func (s *shellTasks) stop(ctx context.Context, parent *harness.Agent, all, fence bool) error {
	s.mu.Lock()
	if all {
		s.closed = true
	} else if fence {
		s.fenced[parent] = true
	}
	var selected []*shellTask
	for _, task := range s.tasks {
		if all || task.parent == parent {
			selected = append(selected, task)
		}
	}
	s.mu.Unlock()
	for _, task := range selected {
		if task.cancel != nil {
			task.cancel(context.Canceled)
		}
	}
	for _, task := range selected {
		select {
		case <-task.done:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return nil
}

func shellParentInterrupted(agent *harness.Agent) bool {
	if agent == nil {
		return false
	}
	events := agent.Session().Events()
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
