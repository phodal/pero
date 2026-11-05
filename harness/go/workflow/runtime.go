package workflow

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
	"github.com/phodal/pero/harness/go/subagents"
)

//go:embed worker.cjs
var workerSource string

const maxWireBytes = 8 << 20

type wireRequest struct {
	sequence   int
	ID         int             `json:"id,omitempty"`
	Method     string          `json:"method"`
	ScriptPath string          `json:"scriptPath,omitempty"`
	Prompt     string          `json:"prompt,omitempty"`
	Label      string          `json:"label,omitempty"`
	Phase      string          `json:"phase,omitempty"`
	Provider   string          `json:"provider,omitempty"`
	Model      string          `json:"model,omitempty"`
	Schema     json.RawMessage `json:"schema,omitempty"`
	Isolation  string          `json:"isolation,omitempty"`
	AgentType  string          `json:"agentType,omitempty"`
	Effort     string          `json:"effort,omitempty"`
	Meta       *Meta           `json:"meta,omitempty"`
	Message    string          `json:"message,omitempty"`
	Result     *Result         `json:"result,omitempty"`
}

type wireResponse struct {
	ID         int             `json:"id"`
	Source     string          `json:"source,omitempty"`
	Status     string          `json:"status,omitempty"`
	ChildID    string          `json:"childId,omitempty"`
	Text       string          `json:"text,omitempty"`
	Structured json.RawMessage `json:"structured,omitempty"`
	Error      string          `json:"error,omitempty"`
}

type progress struct {
	RunID       string                 `json:"runId"`
	ScriptPath  string                 `json:"scriptPath,omitempty"`
	Meta        *Meta                  `json:"meta,omitempty"`
	Phase       string                 `json:"phase,omitempty"`
	Message     string                 `json:"message,omitempty"`
	Sequence    int                    `json:"sequence,omitempty"`
	Label       string                 `json:"label,omitempty"`
	ChildID     harness.SessionID      `json:"childId,omitempty"`
	Status      harness.SubagentStatus `json:"status,omitempty"`
	Outcome     string                 `json:"outcome,omitempty"`
	StopReason  string                 `json:"stopReason,omitempty"`
	Fingerprint string                 `json:"fingerprint,omitempty"`
	ArgsHash    string                 `json:"argsHash,omitempty"`
	Text        string                 `json:"text,omitempty"`
	Structured  json.RawMessage        `json:"structured,omitempty"`
}

type execution struct {
	app      *App
	parent   *harness.Agent
	ctx      context.Context
	runID    string
	slots    chan struct{}
	mu       sync.Mutex
	started  int
	fatal    error
	logBytes int
	loaded   map[string]selectedScript
	writes   sync.Mutex
	output   *json.Encoder
	children sync.WaitGroup
	ledger   map[int]resumeStep
}

func decodeWire(raw []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return errors.New("workflow: invalid request fields or types")
	}
	if err := decoder.Decode(new(json.RawMessage)); !errors.Is(err, io.EOF) {
		return errors.New("workflow: request must contain exactly one JSON value")
	}
	return nil
}

// Execute runs one selected script. Nested guest workflows share this process,
// agent() call budget and cancellation. It never creates an independent model loop.
func (app *App) Execute(ctx context.Context, parent *harness.Agent, call Call) (Result, error) {
	if parent == nil {
		return Result{}, errors.New("workflow: a calling agent is required")
	}
	if call.RunInBackground {
		return Result{}, errors.New("workflow: background execution requires StartBackground with a tool call identity")
	}
	runID := rand.Text()
	if call.ResumeFrom != "" {
		runID = call.ResumeFrom
	}
	return app.execute(ctx, parent, call, runID)
}

func (app *App) validate(ctx context.Context, call Call) error {
	if len(call.Args) > 1<<20 || len(call.Args) != 0 && !json.Valid(call.Args) {
		return errors.New("workflow: args must be bounded JSON")
	}
	if _, _, err := app.catalog.read(ctx, call.ScriptPath); err != nil {
		return err
	}
	return nil
}

func (app *App) execute(ctx context.Context, parent *harness.Agent, call Call, runID string) (Result, error) {
	if err := app.validate(ctx, call); err != nil {
		return Result{}, err
	}
	var ledger map[int]resumeStep
	if call.ResumeFrom != "" {
		if call.ResumeFrom != runID {
			return Result{}, errors.New("workflow: resumeFrom does not match the execution identity")
		}
		var err error
		ledger, err = loadResume(parent, call)
		if err != nil {
			return Result{}, err
		}
	}
	app.mu.Lock()
	if app.closed {
		app.mu.Unlock()
		return Result{}, point.ErrInactiveRun
	}
	if _, busy := app.live[runID]; busy {
		app.mu.Unlock()
		return Result{}, errors.New("workflow: that run is still executing")
	}
	if app.live == nil {
		app.live = map[string]struct{}{}
	}
	app.live[runID] = struct{}{}
	app.calls.Add(1)
	app.mu.Unlock()
	defer func() {
		app.mu.Lock()
		delete(app.live, runID)
		app.mu.Unlock()
		app.calls.Done()
	}()
	operation, cancel := context.WithCancel(ctx)
	stop := context.AfterFunc(app.owner, cancel)
	defer func() { stop(); cancel() }()
	run := &execution{app: app, parent: parent, ctx: operation, runID: runID, slots: make(chan struct{}, app.options.MaxConcurrentAgents), loaded: make(map[string]selectedScript), ledger: ledger}
	if call.ResumeFrom == "" {
		if err := run.record("start", progress{ScriptPath: call.ScriptPath, ArgsHash: hashArgs(call.Args)}); err != nil {
			return Result{}, err
		}
	} else if err := run.record("resume", progress{ScriptPath: call.ScriptPath, ArgsHash: hashArgs(call.Args)}); err != nil {
		return Result{}, err
	}
	result, err := run.process(call)
	if operation.Err() != nil {
		_, _ = app.h.Agents().AppendAgentLogExactAndFlush(context.WithoutCancel(ctx), parent, "workflow/end", progress{RunID: run.runID, StopReason: "cancelled"})
		return Result{RunID: run.runID}, operation.Err()
	}
	if err != nil {
		result = Result{Value: json.RawMessage(`null`), StopReason: "error", Error: err.Error()}
	}
	run.mu.Lock()
	result.AgentCalls = run.started
	if run.fatal != nil {
		result.StopReason, result.Error = "error", run.fatal.Error()
	}
	run.mu.Unlock()
	if len(result.Value) == 0 {
		result.Value = json.RawMessage(`null`)
	}
	result.RunID = run.runID
	if err := run.record("end", progress{StopReason: result.StopReason}); err != nil {
		return Result{RunID: run.runID}, err
	}
	return result, nil
}

func (run *execution) process(call Call) (Result, error) {
	ctx, cancel := context.WithCancel(run.ctx)
	defer cancel()
	command := exec.CommandContext(ctx, run.app.options.Node, "--max-old-space-size=128", "-e", workerSource)
	command.Dir = run.parent.Session().WorkingDirectory()
	command.Env = []string{"LANG=C.UTF-8", "TZ=UTC"}
	command.WaitDelay = 2 * time.Second
	configureWorkflowProcess(command)
	input, err := command.StdinPipe()
	if err != nil {
		return Result{}, err
	}
	defer input.Close()
	output, err := command.StdoutPipe()
	if err != nil {
		return Result{}, err
	}
	var stderr limitedStderr
	command.Stderr = &stderr
	if err := command.Start(); err != nil {
		return Result{}, errors.New("workflow: could not start configured Node executable")
	}
	defer cleanupWorkflowProcess(command)
	run.output = json.NewEncoder(input)
	if err := run.output.Encode(struct {
		Call
		MaxItems int `json:"maxItems"`
	}{call, 1024}); err != nil {
		cancel()
		_ = command.Wait()
		return Result{}, err
	}
	scanner := bufio.NewScanner(output)
	scanner.Buffer(make([]byte, 4096), maxWireBytes)
	var result *Result
	var protocolErr error
	for scanner.Scan() {
		var request wireRequest
		if err := decodeWire(scanner.Bytes(), &request); err != nil {
			protocolErr = err
			break
		}
		if request.Method == "done" {
			result = request.Result
			if result == nil || result.StopReason != "completed" && result.StopReason != "error" || len(result.Value) > 1<<20 {
				protocolErr = errors.New("workflow: invalid or oversized script result")
			}
			break
		}
		if request.Method == "agent" {
			run.mu.Lock()
			if run.started >= run.app.options.MaxAgentCalls {
				run.mu.Unlock()
				err := errors.New("workflow: agent() call budget exhausted")
				run.fail(err)
				_ = run.respond(wireResponse{ID: request.ID, Error: err.Error()})
				continue
			}
			run.started++
			request.sequence = run.started
			run.mu.Unlock()
			run.children.Add(1)
			go func() { defer run.children.Done(); run.agent(ctx, request) }()
			continue
		}
		if err := run.dispatch(ctx, request); err != nil {
			protocolErr = err
			break
		}
	}
	if protocolErr == nil {
		protocolErr = scanner.Err()
	}
	cancel()
	_ = input.Close()
	waitErr := command.Wait()
	run.children.Wait()
	if protocolErr != nil {
		return Result{}, protocolErr
	}
	if result == nil {
		return Result{}, fmt.Errorf("workflow: Node stopped before a workflow result (%v): %s", waitErr, stderr.String())
	}
	return *result, nil
}

func (run *execution) dispatch(ctx context.Context, request wireRequest) error {
	switch request.Method {
	case "load":
		selected, source, err := run.app.catalog.read(ctx, request.ScriptPath)
		if err != nil {
			run.fail(err)
			return run.respond(wireResponse{ID: request.ID, Error: err.Error()})
		}
		run.mu.Lock()
		run.loaded[request.ScriptPath] = selected
		run.mu.Unlock()
		return run.respond(wireResponse{ID: request.ID, Source: source})
	case "meta":
		if err := validateMeta(request.Meta); err != nil {
			return err
		}
		return run.record("meta", progress{ScriptPath: request.ScriptPath, Meta: request.Meta})
	case "phase", "log":
		if request.Method == "phase" && request.Message == "" || len(request.Message) > 64<<10 {
			return errors.New("workflow: phase/log requires bounded text")
		}
		run.logBytes += len(request.Message)
		if run.logBytes > 1<<20 {
			return errors.New("workflow: progress exceeded its 1 MiB budget")
		}
		return run.record(request.Method, progress{ScriptPath: request.ScriptPath, Message: request.Message})
	default:
		return errors.New("workflow: unsupported worker request")
	}
}

func (run *execution) agent(ctx context.Context, request wireRequest) {
	response := wireResponse{ID: request.ID}
	member := progress{RunID: run.runID, Sequence: request.sequence, Label: request.Label, Phase: request.Phase, Status: harness.SubagentRunning}
	var recorded, writeEnd bool
	recordEnd := func() {
		if recorded {
			return
		}
		recorded = true
		if !writeEnd {
			return
		}
		recordContext := run.ctx
		if ctx.Err() != nil {
			recordContext = context.WithoutCancel(run.ctx)
		}
		if member.Status == harness.SubagentRunning {
			member.Status = harness.SubagentFailed
			if ctx.Err() != nil {
				member.Status = harness.SubagentAborted
			}
		}
		member.Outcome = "failed"
		if member.Status == harness.SubagentCompleted {
			member.Outcome = "completed"
		} else if member.Status == harness.SubagentAborted {
			member.Outcome = "cancelled"
		}
		if _, err := run.app.h.Agents().AppendAgentLogExactAndFlush(recordContext, run.parent, "workflow/agent-end", member); err != nil {
			run.fail(err)
		}
	}
	defer recordEnd()
	respond := func(err error) {
		recordEnd()
		if err != nil {
			if ctx.Err() == nil || run.ctx.Err() != nil {
				run.fail(err)
			}
			response.Error = err.Error()
		}
		_ = run.respond(response)
	}
	fingerprint, err := callFingerprint(request)
	if err != nil {
		respond(err)
		return
	}
	member.Fingerprint = fingerprint
	if handled, err := run.replay(request, fingerprint, &response, &member, &recorded, &writeEnd); handled {
		respond(err)
		return
	}
	run.mu.Lock()
	selected, loaded := run.loaded[request.ScriptPath]
	run.mu.Unlock()
	if !loaded || strings.TrimSpace(request.Prompt) == "" || len(request.Prompt) > 1<<20 {
		respond(errors.New("workflow: agent requires a loaded script and bounded prompt"))
		return
	}
	if request.Provider != "" && request.Provider != run.app.options.Provider {
		respond(errors.New("workflow: provider override is not configured; use a declared model alias"))
		return
	}
	if _, err := run.app.h.Agents().AppendAgentLogExactAndFlush(ctx, run.parent, "workflow/agent-start", member); err != nil {
		respond(err)
		return
	}
	writeEnd = true
	select {
	case run.slots <- struct{}{}:
		defer func() { <-run.slots }()
	case <-ctx.Done():
		respond(ctx.Err())
		return
	}
	result, err := run.app.options.Agents.Invoke(ctx, run.parent, subagents.ClaudeInvocation{
		Definition: request.AgentType, Prompt: request.Prompt, Model: request.Model, Description: request.Label, Origin: selected.plugin, Isolation: request.Isolation, Effort: request.Effort, OutputSchema: request.Schema,
		ConfigureChild: func(ctx context.Context, owner *point.Run, child *harness.Agent) error {
			_, err := run.app.h.Tools().Restrict(ctx, owner, child, harness.ToolRestriction{Deny: []string{"Workflow"}})
			return err
		},
	})
	member.ChildID = result.ChildID
	if result.Status != "" {
		member.Status = result.Status
	}
	if err != nil || ctx.Err() != nil {
		if err == nil {
			err = ctx.Err()
		}
		respond(err)
		return
	}
	response.ChildID, response.Status = string(result.ChildID), string(result.Status)
	var text strings.Builder
	for _, block := range result.Output {
		if block.Type == harness.BlockText {
			text.WriteString(block.Text)
		}
	}
	response.Text = text.String()
	member.Text = response.Text
	if result.Structured != nil {
		response.Structured, err = json.Marshal(result.Structured)
		if err != nil {
			member.Status = harness.SubagentFailed
			respond(errors.New("workflow: child structured output is not JSON"))
			return
		}
		member.Structured = response.Structured
	}
	respond(nil)
}

func (run *execution) respond(response wireResponse) error {
	raw, err := json.Marshal(response)
	if err != nil || len(raw) > maxWireBytes {
		failure := errors.New("workflow: child reply exceeded its JSON budget")
		run.fail(failure)
		response = wireResponse{ID: response.ID, Error: failure.Error()}
	}
	run.writes.Lock()
	defer run.writes.Unlock()
	return run.output.Encode(response)
}

func (run *execution) fail(err error) {
	run.mu.Lock()
	if run.fatal == nil {
		run.fatal = err
	}
	run.mu.Unlock()
}

func (run *execution) record(event string, data progress) error {
	data.RunID = run.runID
	if event == "end" {
		_, err := run.app.h.Agents().AppendAgentLogExactAndFlush(run.ctx, run.parent, "workflow/end", data)
		return err
	}
	_, err := run.app.h.Agents().AppendAgentLogExact(run.ctx, run.parent, "workflow/"+event, data)
	return err
}

func validateMeta(meta *Meta) error {
	if meta == nil || strings.TrimSpace(meta.Name) == "" || strings.TrimSpace(meta.Description) == "" || len(meta.Name) > 256 || len(meta.Description) > 8192 || len(meta.Phases) > 64 {
		return errors.New("workflow: export const meta requires bounded name, description and optional phases")
	}
	for _, phase := range meta.Phases {
		if strings.TrimSpace(phase.Title) == "" || len(phase.Title) > 1024 {
			return errors.New("workflow: each declared phase requires a bounded title")
		}
	}
	return nil
}

type limitedStderr struct{ data []byte }

func (output *limitedStderr) Write(data []byte) (int, error) {
	output.data = append(output.data, data[:min(len(data), 2048-len(output.data))]...)
	return len(data), nil
}

func (output *limitedStderr) String() string { return string(output.data) }
