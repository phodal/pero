package scienceenv

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"time"

	"github.com/phodal/pero/harness/go/harness"
)

type Action string

const (
	ActionStart     Action = "start"
	ActionStatus    Action = "status"
	ActionExecute   Action = "execute"
	ActionInterrupt Action = "interrupt"
	ActionRestart   Action = "restart"
	ActionClose     Action = "close"
)

// Command is the Notebook's bounded input. ACP binds the actual Agent separately;
// no caller-supplied session name can select a different interpreter here.
type Command struct {
	Action   Action   `json:"action"`
	Language Language `json:"language"`
	Code     string   `json:"code,omitempty"`
}

// Snapshot observes the same computation that the python/r/repl tools mutate.
type Snapshot struct {
	Session        string           `json:"session"`
	Language       Language         `json:"language"`
	Status         KernelStatus     `json:"status"`
	Generation     int              `json:"generation"`
	History        []Cell           `json:"history"`
	Outputs        []NotebookOutput `json:"outputs"`
	ExecutionCount *int             `json:"execution_count"`
	Error          string           `json:"error"`
}

// computation is the imperative shell around Journal and the existing Kernel.
// Its lock protects observations; it is never held while executing user code.
type computation struct {
	mu          sync.Mutex
	env         *Env
	agent       *harness.Agent
	language    Language
	journal     Journal
	kernel      *Kernel
	cancel      context.CancelFunc
	done        chan struct{}
	interrupted bool
	retired     bool
	closing     bool
}

// DispatchJSON validates external input once, then calls the typed owner.
func (e *Env) DispatchJSON(ctx context.Context, agent *harness.Agent, raw json.RawMessage) (any, error) {
	var command Command
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&command); err != nil {
		return nil, err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return nil, errors.New("Expected one science command")
	}
	if command.Language != Python && command.Language != R && command.Language != Repl {
		return nil, errors.New("Choose python, r, or repl")
	}
	switch command.Action {
	case "start", "status", "execute", "interrupt", "restart", "close":
	default:
		return nil, errors.New("Unknown science session action")
	}
	if command.Action == "execute" && (strings.TrimSpace(command.Code) == "" || len(command.Code) > maxCodeBytes) {
		return nil, errors.New("A code cell must be between 1 byte and 1 MiB")
	}
	return e.dispatch(ctx, agent, command)
}

func (e *Env) dispatch(ctx context.Context, agent *harness.Agent, command Command) (Snapshot, error) {
	current, err := e.computation(agent, command.Language)
	if err != nil {
		return Snapshot{}, err
	}
	switch command.Action {
	case "start", "restart":
		err = current.start(command.Action == "restart")
	case "execute":
		err = current.submit(command.Code)
	case "interrupt":
		current.stopRunning(true)
	case "close":
		err = current.closeKernel()
	}
	return current.snapshot(), err
}

func (e *Env) computation(agent *harness.Agent, language Language) (*computation, error) {
	if _, err := e.session(harness.ToolRequest{Agent: agent}); err != nil {
		return nil, err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.closed {
		return nil, errors.New("Science environment is closed")
	}
	if e.sessions == nil {
		e.sessions = map[*harness.Agent]map[Language]*computation{}
	}
	languages := e.sessions[agent]
	if languages == nil {
		prepared, err := e.harness.Agents().RegisterCleanup(agent, func(context.Context) error {
			e.mu.Lock()
			owned := e.sessions[agent]
			delete(e.sessions, agent)
			delete(e.artifacts, string(agent.ID()))
			e.mu.Unlock()
			var result error
			for _, current := range owned {
				result = errors.Join(result, current.close())
			}
			return result
		})
		if err != nil {
			return nil, err
		}
		languages = map[Language]*computation{}
		e.sessions[agent] = languages
		defer prepared()
	}
	current := languages[language]
	if current == nil {
		current = &computation{env: e, agent: agent, language: language, journal: Journal{Status: "closed", History: []Cell{}}}
		for _, event := range agent.Session().Events() {
			if event.Type != "science/cell" {
				continue
			}
			var receipt CellReceipt
			if json.Unmarshal(event.Data, &receipt) == nil && receipt.Language == language {
				current.journal = current.journal.restore(receipt.Cell)
			}
		}
		languages[language] = current
	}
	return current, nil
}

func (c *computation) snapshot() Snapshot {
	c.mu.Lock()
	defer c.mu.Unlock()
	history := append([]Cell{}, c.journal.History...)
	value := Snapshot{Session: string(c.agent.ID()), Language: c.language, Status: c.journal.Status,
		Generation: c.journal.Generation, History: history, Error: c.journal.Error, Outputs: []NotebookOutput{}}
	if len(history) > 0 && history[len(history)-1].Generation == c.journal.Generation {
		latest := history[len(history)-1]
		value.Outputs, value.ExecutionCount = latest.Outputs, &latest.ExecutionCount
	}
	return value
}

func (c *computation) start(restart bool) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.retired || c.closing {
		return errors.New("Agent session is closed")
	}
	if c.journal.Status == "running" {
		return errors.New("Interrupt the running cell before restarting")
	}
	if !restart && c.journal.Status == "idle" {
		return nil
	}
	if c.kernel != nil {
		_ = c.kernel.Close()
		c.kernel = nil
	}
	interpreter := c.env.pythonBin
	if c.language == R {
		var err error
		interpreter, err = resolveInterpreter(c.env.rscript)
		if err != nil {
			c.journal.Status = "unavailable"
			c.journal.Error = "Rscript is unavailable. Install R or configure --science-rscript, then retry Start: " + err.Error()
			return nil
		}
	}
	kernel, err := Start(Config{Language: c.language, Interpreter: interpreter, Workspace: c.env.workspace})
	if err != nil {
		option := "--science-python"
		if c.language == R {
			option = "--science-rscript"
		}
		c.journal.Status, c.journal.Error = "unavailable", fmt.Sprintf("%s could not start; check %s and retry Start: %v", c.language, option, err)
		return nil
	}
	c.kernel = kernel
	c.journal.Status, c.journal.Error = "idle", ""
	c.journal.Generation++
	return nil
}

func (c *computation) begin(ctx context.Context, code string, origin CellOrigin) (context.Context, *Kernel, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.retired || c.closing {
		return nil, nil, errors.New("Agent session is closed")
	}
	journal, err := c.journal.begin(code, origin)
	if err != nil {
		if c.journal.Status == "unavailable" {
			return nil, nil, errors.New(c.journal.Error)
		}
		return nil, nil, err
	}
	if _, err := c.agent.Session().Append("science/cell", CellReceipt{c.language, journal.History[len(journal.History)-1]}); err != nil {
		return nil, nil, fmt.Errorf("Cell was not run because its input could not be saved: %w", err)
	}
	c.journal = journal
	c.interrupted = false
	c.done = make(chan struct{})
	cellContext, cancel := context.WithTimeout(ctx, 10*time.Minute)
	c.cancel = cancel
	return cellContext, c.kernel, nil
}

func (c *computation) submit(code string) error {
	ctx, kernel, err := c.begin(context.Background(), code, UserCell)
	if err != nil {
		return err
	}
	go c.run(ctx, kernel, code, false)
	return nil
}

func (c *computation) execute(ctx context.Context, code string, origin CellOrigin, load bool) (Output, error) {
	// Agent tools preserve their existing lazy-start behavior. A stopped
	// computation is explicitly visible as a new generation in the Notebook.
	c.mu.Lock()
	needsStart := c.journal.Status != "idle" && c.journal.Status != "running"
	c.mu.Unlock()
	if needsStart {
		if err := c.start(false); err != nil {
			return Output{}, err
		}
	}
	cellContext, kernel, err := c.begin(ctx, code, origin)
	if err != nil {
		return Output{}, err
	}
	return c.run(cellContext, kernel, code, load)
}

func (c *computation) run(ctx context.Context, kernel *Kernel, code string, load bool) (Output, error) {
	host := c.env.host(string(c.agent.ID()), c.language, c.agent)
	var out Output
	var err error
	if load {
		out, err = kernel.Load(ctx, code, host)
	} else {
		out, err = kernel.Exec(ctx, code, host)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.cancel()
	c.cancel = nil
	c.journal = c.journal.finish(out, err, c.interrupted)
	receipt := CellReceipt{c.language, c.journal.History[len(c.journal.History)-1]}
	_, appendErr := c.agent.Session().Append("science/cell", receipt)
	if appendErr != nil {
		c.journal.Error = "Execution finished, but its receipt could not be saved: " + appendErr.Error()
	}
	close(c.done)
	c.done = nil
	return out, errors.Join(err, appendErr)
}

func (c *computation) stopRunning(interrupted bool) {
	c.mu.Lock()
	done := c.done
	if c.cancel != nil {
		c.interrupted = interrupted
		c.cancel()
	}
	c.mu.Unlock()
	if done != nil {
		<-done
	}
}

func (c *computation) closeKernel() error {
	c.mu.Lock()
	c.closing = true
	done := c.done
	if c.cancel != nil {
		c.interrupted = true
		c.cancel()
	}
	c.mu.Unlock()
	if done != nil {
		<-done
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.closing = false
	c.journal.Status = "closed"
	if c.kernel == nil {
		return nil
	}
	err := c.kernel.Close()
	c.kernel = nil
	return err
}

func (c *computation) close() error {
	c.mu.Lock()
	c.retired = true
	c.mu.Unlock()
	return c.closeKernel()
}
