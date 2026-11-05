package nativetools

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
	"github.com/phodal/pero/harness/go/shell"
)

type terminalInput struct {
	ID        string `json:"terminal_id"`
	Command   string `json:"command"`
	TimeoutMS int    `json:"timeout_ms"`
	Rows      int    `json:"rows"`
	Columns   int    `json:"columns"`
	Data      string `json:"data"`
	EOF       bool   `json:"eof"`
	Offset    int64  `json:"offset"`
	Limit     int    `json:"limit"`
	WaitMS    int    `json:"wait_ms"`
}

type ownedTerminal struct {
	parent   *harness.Agent
	terminal *shell.Terminal
	settled  chan struct{}
}

type terminalOwner struct {
	mu        sync.Mutex
	app       *App
	h         *harness.Harness
	run       *point.Run
	closed    bool
	fenced    map[*harness.Agent]bool
	terminals map[string]*ownedTerminal
}

type terminalReceipt struct {
	ID           string             `json:"terminal_id"`
	State        shell.TerminalRead `json:"state"`
	WrittenBytes *int               `json:"written_bytes,omitempty"`
	Status       string             `json:"status,omitempty"`
}

type terminalIntent struct {
	ID        string             `json:"terminal_id"`
	CallID    harness.ToolCallID `json:"call_id"`
	Turn      int                `json:"turn"`
	Command   string             `json:"command"`
	CWD       string             `json:"cwd"`
	TimeoutMS int64              `json:"timeout_ms"`
	Rows      int                `json:"rows"`
	Columns   int                `json:"columns"`
}

// MountTerminals exposes actual PTY tools only for a shell executor that can
// admit them. Configured sandbox and unsupported platforms expose no aliases.
// The Harness owns cleanup; App.Close follows its Dispose/Drain as usual.
func MountTerminals(ctx context.Context, h *harness.Harness, app *App, options Options) error {
	if h == nil || app == nil {
		return errors.New("terminal tools require native composition")
	}
	if !options.EnableShell || !app.shell.SupportsTerminal() {
		return nil
	}
	owner := &terminalOwner{app: app, h: h, fenced: map[*harness.Agent]bool{}, terminals: map[string]*ownedTerminal{}}
	definition := point.Define(point.Descriptor{ID: "native/terminals", Requires: []point.Requirement{point.Require(harness.AgentHooksKey)}}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
		owner.run = run
		if err := run.BeforeCleanup("terminal-processes", func(ctx context.Context) error { return owner.stop(ctx, nil, true, true) }); err != nil {
			return nil, err
		}
		if _, err := h.Hooks().Retiring.On(run, func(ctx context.Context, agent *harness.Agent) error {
			cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
			defer cancel()
			return owner.stop(cleanup, agent, false, true)
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
		if _, err := h.Hooks().Deactivated.On(run, func(_ context.Context, agent *harness.Agent) error {
			owner.mu.Lock()
			defer owner.mu.Unlock()
			delete(owner.fenced, agent)
			for id, terminal := range owner.terminals {
				if terminal.parent == agent {
					delete(owner.terminals, id)
				}
			}
			return nil
		}); err != nil {
			return nil, err
		}
		for _, definition := range terminalToolDefinitions(options.ClaudeTools) {
			selected := definition
			schema := json.RawMessage(fmt.Sprintf(`{"type":"object","additionalProperties":false,"properties":{%s},"required":[%s]}`, selected.properties, selected.required))
			if _, err := h.Tools().Register(run, harness.Tool{Schema: harness.ToolSchema{Name: selected.name, Description: selected.description, InputSchema: schema}, RequiresApproval: selected.approval, ExecutionMode: harness.ExecutionSerial, ExecuteRequest: func(ctx context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
				if request.Agent == nil {
					return harness.ToolResult{}, errors.New("terminal tool requires an agent")
				}
				var input terminalInput
				if err := json.Unmarshal(request.Arguments, &input); err != nil {
					return harness.ToolResult{}, err
				}
				if selected.action == "open" {
					return owner.open(ctx, request, input)
				}
				owner.mu.Lock()
				stored := owner.terminals[input.ID]
				owner.mu.Unlock()
				if stored == nil || stored.parent != request.Agent {
					return harness.ToolResult{}, errors.New("terminal is unavailable for this exact agent; historical handles are not restarted")
				}
				var err error
				var written *int
				switch selected.action {
				case "write":
					count, writeErr := stored.terminal.Write(ctx, input.Data, input.EOF)
					written, err = &count, writeErr
				case "resize":
					err = stored.terminal.Resize(input.Rows, input.Columns)
				case "stop":
					err = stored.terminal.Stop(ctx)
				}
				limit := input.Limit
				if limit == 0 {
					limit = 8192
				}
				state, readErr := stored.terminal.Read(ctx, input.Offset, limit, time.Duration(input.WaitMS)*time.Millisecond)
				return renderResult(terminalReceipt{ID: input.ID, State: state, WrittenBytes: written}, errors.Join(err, readErr))
			}}); err != nil {
				return nil, err
			}
		}
		return nil, nil
	})
	instance, err := h.Runtime().Mount(nil, "native/terminals", definition, nil)
	if err == nil {
		err = instance.WaitStable(ctx)
	}
	return err
}

func (o *terminalOwner) open(ctx context.Context, request harness.ToolRequest, input terminalInput) (harness.ToolResult, error) {
	if err := o.app.CheckCWD(request.Agent.Session().WorkingDirectory()); err != nil {
		return harness.ToolResult{}, err
	}
	if input.Rows == 0 {
		input.Rows = 24
	}
	if input.Columns == 0 {
		input.Columns = 80
	}
	spec, err := o.app.shell.Resolve(shell.ExecRequest{Command: input.Command, Workdir: request.Agent.Session().WorkingDirectory(), Timeout: time.Duration(input.TimeoutMS) * time.Millisecond})
	if err != nil {
		return renderResult(nil, err)
	}
	turn, err := request.Agent.Session().LastTurn()
	if err != nil {
		return renderResult(nil, err)
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.closed || o.fenced[request.Agent] || !o.run.Active() {
		return harness.ToolResult{}, errors.New("terminal owner has retired")
	}
	for _, event := range request.Agent.Session().Events() {
		if event.Type != "terminal/intent" {
			continue
		}
		var previous terminalIntent
		if err := json.Unmarshal(event.Data, &previous); err != nil {
			return renderResult(nil, err)
		}
		if request.CallID == "" || previous.CallID != request.CallID || previous.Turn != turn {
			continue
		}
		if previous.Command != spec.Command || previous.CWD != spec.Workdir || previous.TimeoutMS != spec.Timeout.Milliseconds() || previous.Rows != input.Rows || previous.Columns != input.Columns {
			return renderResult(terminalReceipt{ID: previous.ID, Status: "not_restarted"}, errors.New("terminal call identity already has a different recorded intent; do not replay"))
		}
		if stored := o.terminals[previous.ID]; stored != nil && stored.parent == request.Agent {
			state, err := stored.terminal.Read(ctx, 0, 8192, 0)
			return renderResult(terminalReceipt{ID: previous.ID, State: state}, err)
		}
		return renderResult(terminalReceipt{ID: previous.ID, Status: "not_restarted"}, errors.New("recorded terminal has no live owner; inspect the journal, no command was restarted"))
	}
	active := 0
	for _, stored := range o.terminals {
		select {
		case <-stored.terminal.Done():
		default:
			active++
		}
	}
	if active >= 16 || len(o.terminals) >= 128 {
		return harness.ToolResult{}, errors.New("terminal capacity reached (16 live / 128 retained handles)")
	}
	id := "terminal-" + rand.Text()
	intent := terminalIntent{ID: id, CallID: request.CallID, Turn: turn, Command: spec.Command, CWD: spec.Workdir, TimeoutMS: spec.Timeout.Milliseconds(), Rows: input.Rows, Columns: input.Columns}
	if _, err := request.Agent.Session().Append("terminal/intent", intent); err != nil {
		return renderResult(terminalReceipt{ID: id, Status: "not_started"}, err)
	}
	if err := request.Agent.Session().Flush(ctx); err != nil {
		return renderResult(terminalReceipt{ID: id, Status: "not_started"}, err)
	}
	activity, err := o.h.Subagents().RetainBackgroundActivity(request.Agent)
	if err != nil {
		return harness.ToolResult{}, err
	}
	terminal, err := o.app.shell.StartTerminal(o.run.Context, shell.ExecRequest{Command: spec.Command, Workdir: spec.Workdir, Timeout: spec.Timeout}, input.Rows, input.Columns)
	if err != nil {
		activity.Release(nil)
		receipt := terminalReceipt{ID: id, Status: "not_started", State: shell.TerminalRead{Error: err.Error()}}
		_, recordErr := request.Agent.Session().Append("terminal/ended", receipt)
		return renderResult(receipt, errors.Join(err, recordErr))
	}
	stored := &ownedTerminal{parent: request.Agent, terminal: terminal, settled: make(chan struct{})}
	o.terminals[id] = stored
	_, err = request.Agent.Session().Append("terminal/opened", struct {
		ID      string `json:"terminal_id"`
		Command string `json:"command"`
		CWD     string `json:"cwd"`
	}{id, input.Command, request.Agent.Session().WorkingDirectory()})
	if err != nil {
		stopErr := terminal.Stop(context.Background())
		state, readErr := terminal.Read(context.Background(), 0, 8192, 0)
		receipt := terminalReceipt{ID: id, Status: "stopped_after_journal_error_effects_unknown", State: state}
		_, recordErr := request.Agent.Session().Append("terminal/ended", receipt)
		close(stored.settled)
		activity.Release(errors.Join(err, stopErr, readErr, recordErr))
		return renderResult(receipt, errors.Join(err, stopErr, readErr, recordErr))
	}
	go func() {
		<-terminal.Done()
		settleCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		state, readErr := terminal.Read(context.Background(), 0, 8192, 0)
		_, appendErr := request.Agent.Session().Append("terminal/ended", terminalReceipt{ID: id, State: state})
		if appendErr == nil {
			appendErr = request.Agent.Session().Flush(settleCtx)
		}
		close(stored.settled)
		durabilityErr := errors.Join(readErr, appendErr)
		if activity != nil && durabilityErr == nil && !request.Agent.CurrentTurnInterrupted() {
			raw, _ := json.Marshal(terminalReceipt{ID: id, State: state})
			notice := harness.Message{ID: "terminal-notice-" + id, Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "Interactive terminal settled: " + string(raw)}}}
			durabilityErr = activity.Deliver(settleCtx, notice)
		}
		activity.Release(durabilityErr)
	}()
	state, err := terminal.Read(ctx, 0, 8192, 0)
	return renderResult(terminalReceipt{ID: id, State: state}, err)
}

func (o *terminalOwner) stop(ctx context.Context, agent *harness.Agent, all, fence bool) error {
	o.mu.Lock()
	if all {
		o.closed = true
	} else if fence {
		o.fenced[agent] = true
	}
	var selected []*ownedTerminal
	for _, terminal := range o.terminals {
		if all || terminal.parent == agent {
			selected = append(selected, terminal)
		}
	}
	o.mu.Unlock()
	var result error
	for _, stored := range selected {
		result = errors.Join(result, stored.terminal.Stop(ctx))
		select {
		case <-stored.settled:
		case <-ctx.Done():
			return errors.Join(result, ctx.Err())
		}
	}
	return result
}
