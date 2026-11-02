package workflow

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

const taskStarted = "workflow-task/started"
const taskEnded = "workflow-task/ended"

type taskIntent struct {
	Version int                `json:"version"`
	ID      string             `json:"task_id"`
	Owner   harness.SessionID  `json:"owner"`
	CallID  harness.ToolCallID `json:"call_id"`
	Turn    int                `json:"turn,omitempty"`
	Call    Call               `json:"call"`
}
type taskTerminal struct {
	Version    int               `json:"version"`
	ID         string            `json:"task_id"`
	Owner      harness.SessionID `json:"owner"`
	Status     string            `json:"status"`
	Result     *Result           `json:"result,omitempty"`
	Diagnostic string            `json:"diagnostic,omitempty"`
}
type backgroundTask struct {
	parent            *harness.Agent
	intent            taskIntent
	cancel            context.CancelFunc
	done              chan struct{}
	mu                sync.Mutex
	terminal          *taskTerminal
	suppressNotice    atomic.Bool
	noticeError       string
	terminalPersisted bool
}

func (task *backgroundTask) snapshot(retrieval harness.TaskRetrieval) harness.ToolResult {
	task.mu.Lock()
	defer task.mu.Unlock()
	status := "running"
	if task.terminal != nil {
		status = task.terminal.Status
		retrieval = harness.TaskRetrieved
	}
	raw, _ := json.Marshal(struct {
		ID          string                `json:"task_id"`
		Kind        harness.TaskKind      `json:"kind"`
		Status      string                `json:"status"`
		Retrieval   harness.TaskRetrieval `json:"retrieval_status"`
		Terminal    *taskTerminal         `json:"terminal,omitempty"`
		NoticeError string                `json:"notification_error,omitempty"`
	}{task.intent.ID, harness.TaskKindWorkflow, status, retrieval, task.terminal, task.noticeError})
	return harness.ToolResult{IsError: status == "failed" || status == "interrupted", Content: []harness.ContentBlock{{Type: harness.BlockText, Text: string(raw)}}}
}
func (task *backgroundTask) handle() harness.TaskHandle {
	return harness.TaskHandle{ID: task.intent.ID, Kind: harness.TaskKindWorkflow, Done: task.done, Snapshot: task.snapshot, Stop: func(ctx context.Context) (harness.ToolResult, error) {
		if task.cancel != nil {
			task.cancel()
		}
		select {
		case <-task.done:
			return task.snapshot(harness.TaskRetrieved), nil
		case <-ctx.Done():
			return harness.ToolResult{}, ctx.Err()
		}
	}}
}

func (app *App) registerBackground(run *point.Run) error {
	app.background = make(map[string]*backgroundTask)
	app.fenced = make(map[*harness.Agent]bool)
	if _, err := app.h.Hooks().Retiring.On(run, func(ctx context.Context, parent *harness.Agent) error {
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer cancel()
		return app.stopBackground(cleanup, parent, true)
	}); err != nil {
		return err
	}
	_, err := app.h.Hooks().Status.On(run, func(ctx context.Context, input harness.AgentStatusInput) error {
		if input.Status == harness.AgentIdle && input.Agent.CurrentTurnInterrupted() {
			cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
			defer cancel()
			return app.stopBackground(cleanup, input.Agent, false)
		}
		return nil
	})
	return err
}
func (app *App) stopBackground(ctx context.Context, parent *harness.Agent, fence bool) error {
	app.mu.Lock()
	if fence && parent != nil {
		app.fenced[parent] = true
	}
	tasks := []*backgroundTask{}
	for _, task := range app.background {
		if parent == nil || task.parent == parent {
			task.suppressNotice.Store(true)
			tasks = append(tasks, task)
			if task.cancel != nil {
				task.cancel()
			}
		}
	}
	app.mu.Unlock()
	// Retirement withdraws the entire child tree before its hooks complete.
	// Child receipts also await parent retirement: do not join here. The
	// owning contribution drain joins bookkeeping after retirement completes.
	if fence {
		return nil
	}
	for _, task := range tasks {
		select {
		case <-task.done:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return nil
}

// StartBackground commits intent before admitting any Node/agent effect. Its
// context owns admission only; the run and exact live parent own accepted work.
func (app *App) StartBackground(ctx context.Context, request harness.ToolRequest, call Call) (harness.ToolResult, error) {
	if request.Agent == nil || request.CallID == "" {
		return harness.ToolResult{}, errors.New("workflow: background execution requires an owning agent and call identity")
	}
	call.RunInBackground = false
	if err := app.validate(ctx, call); err != nil {
		return harness.ToolResult{}, err
	}
	app.mu.Lock()
	defer app.mu.Unlock()
	if app.closed || app.fenced[request.Agent] || ctx.Err() != nil {
		return harness.ToolResult{}, point.ErrInactiveRun
	}
	// Repeated dispatch cannot start another copy of a partially committed effect.
	history, err := foldBackground(request.Agent.Session().Events(), request.Agent.ID())
	if err != nil {
		return harness.ToolResult{}, err
	}
	for id, entry := range history {
		if entry.intent.CallID == request.CallID && entry.intent.Turn == request.Agent.CurrentTurn() {
			task, err := app.restoreLocked(ctx, request.Agent, id, entry)
			if err != nil {
				return harness.ToolResult{}, err
			}
			return task.snapshot(harness.TaskNotReady), nil
		}
	}
	active := 0
	for _, task := range app.background {
		select {
		case <-task.done:
		default:
			active++
		}
	}
	if active >= 16 {
		return harness.ToolResult{}, errors.New("workflow: at most 16 background workflows may run concurrently")
	}
	intent := taskIntent{Version: 1, ID: "workflow-" + rand.Text(), Owner: request.Agent.ID(), CallID: request.CallID, Turn: request.Agent.CurrentTurn(), Call: call}
	if _, err := app.h.Agents().AppendAgentLogExactAndFlush(ctx, request.Agent, taskStarted, intent); err != nil {
		return harness.ToolResult{}, err
	}
	operation, cancel := context.WithCancel(app.owner)
	task := &backgroundTask{parent: request.Agent, intent: intent, cancel: cancel, done: make(chan struct{})}
	app.background[intent.ID] = task
	app.calls.Add(1)
	go func() {
		defer app.calls.Done()
		defer cancel()
		result, err := app.execute(operation, task.parent, call, intent.ID)
		terminal := taskTerminal{Version: 1, ID: intent.ID, Owner: intent.Owner, Status: "completed", Result: &result}
		if err != nil || result.StopReason != "completed" {
			terminal.Status = "failed"
			if err != nil {
				terminal.Diagnostic = err.Error()
			}
		}
		if operation.Err() != nil {
			terminal.Status = "stopped"
			terminal.Diagnostic = "Workflow cancelled; inspect actual child receipts before retrying."
		}
		_, persistErr := task.parent.Session().Append(taskEnded, terminal)
		if persistErr == nil {
			persistErr = task.parent.Session().Flush(context.WithoutCancel(operation))
		}
		if persistErr != nil {
			terminal.Status = "failed"
			terminal.Diagnostic = "Workflow settled but terminal persistence failed; reconcile session effects before retrying."
		}
		task.mu.Lock()
		task.terminal = &terminal
		task.terminalPersisted = persistErr == nil
		task.mu.Unlock()
		if persistErr == nil {
			app.notifyBackground(operation, task, terminal)
		}
		close(task.done)
	}()
	return task.snapshot(harness.TaskNotReady), nil
}

type backgroundHistory struct {
	startedSeq, settledSeq uint64
	intent                 taskIntent
	terminal               *taskTerminal
}

func foldBackground(events []harness.Event, owner harness.SessionID) (map[string]backgroundHistory, error) {
	result := map[string]backgroundHistory{}
	for _, event := range events {
		switch event.Type {
		case taskStarted:
			var intent taskIntent
			if decodeWire(event.Data, &intent) != nil || intent.Version != 1 || !strings.HasPrefix(intent.ID, "workflow-") || intent.Owner == "" || intent.CallID == "" || intent.Call.ScriptPath == "" {
				return nil, errors.New("workflow: invalid durable background intent")
			}
			if intent.Owner != owner {
				continue
			}
			if _, exists := result[intent.ID]; exists {
				return nil, errors.New("workflow: duplicate durable task identity")
			}
			result[intent.ID] = backgroundHistory{intent: intent, startedSeq: event.Seq}
		case taskEnded:
			var terminal taskTerminal
			if decodeWire(event.Data, &terminal) != nil || terminal.Version != 1 || terminal.Owner == "" {
				return nil, errors.New("workflow: invalid durable terminal")
			}
			if terminal.Owner != owner {
				continue
			}
			entry, exists := result[terminal.ID]
			if !exists || entry.terminal != nil {
				return nil, errors.New("workflow: terminal lacks one unfinished task")
			}
			switch terminal.Status {
			case "completed", "failed", "stopped", "interrupted":
			default:
				return nil, errors.New("workflow: unknown durable task state")
			}
			if terminal.Status == "completed" && (terminal.Result == nil || terminal.Result.StopReason != "completed") {
				return nil, errors.New("workflow: completed task lacks execution result")
			}
			entry.terminal = &terminal
			entry.settledSeq = event.Seq
			result[terminal.ID] = entry
		}
	}
	return result, nil
}
func (app *App) restoreLocked(ctx context.Context, parent *harness.Agent, id string, history backgroundHistory) (*backgroundTask, error) {
	if existing := app.background[id]; existing != nil && existing.parent == parent {
		return existing, nil
	}
	terminal := history.terminal
	if terminal == nil {
		terminal = &taskTerminal{Version: 1, ID: id, Owner: parent.ID(), Status: "interrupted", Diagnostic: "Process ownership was lost; workflow and child effects were not replayed. Inspect durable effects before retrying."}
		if _, err := app.h.Agents().AppendAgentLogExactAndFlush(ctx, parent, taskEnded, *terminal); err != nil {
			return nil, err
		}
	}
	task := &backgroundTask{parent: parent, intent: history.intent, terminal: terminal, terminalPersisted: true, done: make(chan struct{})}
	close(task.done)
	app.background[id] = task
	return task, nil
}
func (app *App) LookupTask(ctx context.Context, parent *harness.Agent, id string) (harness.TaskHandle, bool, error) {
	if app == nil || parent == nil || !strings.HasPrefix(id, "workflow-") {
		return harness.TaskHandle{}, false, nil
	}
	app.mu.Lock()
	defer app.mu.Unlock()
	if task := app.background[id]; task != nil && task.parent == parent {
		return task.handle(), true, nil
	}
	history, err := foldBackground(parent.Session().Events(), parent.ID())
	if err != nil {
		return harness.TaskHandle{}, false, err
	}
	entry, exists := history[id]
	if !exists {
		return harness.TaskHandle{}, false, nil
	}
	task, err := app.restoreLocked(ctx, parent, id, entry)
	if err != nil {
		return harness.TaskHandle{}, false, err
	}
	return task.handle(), true, nil
}
