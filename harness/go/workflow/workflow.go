// Package workflow executes explicitly selected JavaScript orchestration through
// the existing Harness subagent service. The Node VM is not an OS sandbox.
package workflow

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/plugins"
	point "github.com/phodal/pero/harness/go/runtime"
	"github.com/phodal/pero/harness/go/subagents"
)

type Options struct {
	Node, Provider string
	Agents         *subagents.ClaudeContribution
	// MaxConcurrentAgents bounds direct agent() calls shared by this script
	// and its nested workflows. Descendant model delegations use agent policy.
	MaxConcurrentAgents int
	// MaxAgentCalls bounds admitted script agent() calls, including nested
	// workflows. The provider request budget also covers descendant delegations.
	MaxAgentCalls int
}

type Phase struct {
	Title    string `json:"title"`
	Detail   string `json:"detail,omitempty"`
	Provider string `json:"provider,omitempty"`
	Model    string `json:"model,omitempty"`
}

type Meta struct {
	Name        string  `json:"name"`
	Description string  `json:"description"`
	WhenToUse   string  `json:"whenToUse,omitempty"`
	Phases      []Phase `json:"phases,omitempty"`
}

// Call is the model-facing request. Args remains JSON at this process boundary;
// a JSON string is passed verbatim for scripts that explicitly parse it.
type Call struct {
	ScriptPath      string          `json:"scriptPath"`
	Meta            *Meta           `json:"meta,omitempty"`
	Args            json.RawMessage `json:"args,omitempty"`
	RunInBackground bool            `json:"run_in_background,omitempty"`
	// ResumeFrom continues one recorded run. It is not a background admission
	// and it does not restore a JavaScript stack.
	ResumeFrom string `json:"resumeFrom,omitempty"`
}

type Result struct {
	RunID      string          `json:"runId,omitempty"`
	Value      json.RawMessage `json:"value"`
	StopReason string          `json:"stopReason"`
	Error      string          `json:"error,omitempty"`
	// AgentCalls counts script agent() calls, not all descendant agents.
	AgentCalls int `json:"agentCalls"`
}

type App struct {
	h          *harness.Harness
	options    Options
	catalog    *scriptCatalog
	instance   *point.Instance
	owner      context.Context
	mu         sync.Mutex
	closed     bool
	calls      sync.WaitGroup
	live       map[string]struct{}
	background map[string]*backgroundTask
	fenced     map[*harness.Agent]bool
}

// Mount registers Workflow through the normal ToolRegistry. The caller closes
// App after Harness Dispose/Drain, preserving descriptor and process ownership.
func Mount(ctx context.Context, h *harness.Harness, packages []plugins.Package, options Options) (_ *App, err error) {
	if h == nil || options.Agents == nil || !filepath.IsAbs(options.Node) {
		return nil, errors.New("workflow: harness, Claude subagents and an explicit absolute Node executable are required")
	}
	if !workflowProcessSupported() {
		return nil, errors.New("workflow: Node process ownership requires a supported Unix host")
	}
	info, err := os.Stat(options.Node)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0111 == 0 {
		return nil, errors.New("workflow: Node executable is unavailable or not executable")
	}
	if options.MaxConcurrentAgents == 0 {
		options.MaxConcurrentAgents = 3
	}
	if options.MaxAgentCalls == 0 {
		options.MaxAgentCalls = 64
	}
	if options.MaxConcurrentAgents < 1 || options.MaxConcurrentAgents > 3 || options.MaxAgentCalls < 1 || options.MaxAgentCalls > 1024 {
		return nil, errors.New("workflow: agent() concurrency must be 1..3 and call budget 1..1024")
	}
	catalog, err := openCatalog(ctx, packages)
	if err != nil {
		return nil, err
	}
	app := &App{h: h, options: options, catalog: catalog, live: map[string]struct{}{}}
	defer func() {
		if err != nil {
			_ = catalog.close()
		}
	}()
	definition := point.Define(point.Descriptor{ID: "harness/selected-workflows", Requires: []point.Requirement{point.Require(harness.ToolRegistryKey), point.Require(harness.AgentHooksKey)}}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
		app.owner = run.Context
		if err := app.registerNoticeRecovery(run); err != nil {
			return nil, err
		}
		if err := app.registerBackground(run); err != nil {
			return nil, err
		}
		if err := run.BeforeCleanup("workflow/drain", app.drain); err != nil {
			return nil, err
		}
		_, _, err := h.Tools().RegisterWithIdentity(run, harness.Tool{Schema: harness.ToolSchema{Name: "Workflow", Description: "Run an original JavaScript workflow from an explicitly selected plugin workflows directory. Pass its absolute scriptPath and JSON args (or a JSON string when the script expects one). Its export const meta is authoritative. agent(prompt,{label,phase,model,schema,isolation}) delegates through the existing agent service; isolation \"worktree\" runs that child in a separate Git worktree; parallel and pipeline preserve input order. phase/log record progress. The concurrency and total call limits count script agent() calls across this run and nested workflow({scriptPath},args) calls; descendant delegation uses existing agent and provider policies. completed means the script returned; unfinished member agents are cancelled, recorded and joined before execution settles. run_in_background=true returns a durable task_id immediately; TaskOutput/TaskStop query or cancel and join this exact parent's workflow. Completed and failed runs deliver an automatic completion notice through the parent inbox after terminal persistence. Parent interruption or retirement cancels accepted work without waking the stopped parent. Lost process ownership becomes interrupted after restart and is not replayed. resumeFrom continues that recorded run in the foreground: completed agent() results are returned without invoking those children, a start without a terminal record is closed without invoking it, and only later calls run. A completed run cannot resume. Scripts are trusted package code: the Node VM is not an OS sandbox.", InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false,"required":["scriptPath"],"properties":{"scriptPath":{"type":"string","minLength":1},"meta":{"type":"object","additionalProperties":false,"required":["name","description"],"properties":{"name":{"type":"string"},"description":{"type":"string"},"whenToUse":{"type":"string"},"phases":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["title"],"properties":{"title":{"type":"string"},"detail":{"type":"string"},"provider":{"type":"string"},"model":{"type":"string"}}}}}},"args":{},"run_in_background":{"type":"boolean"},"resumeFrom":{"type":"string","minLength":1}}}`)}, ExecuteRequest: func(ctx context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
			var call Call
			if err := decodeWire(request.Arguments, &call); err != nil {
				return harness.ToolResult{}, err
			}
			if call.RunInBackground {
				return app.StartBackground(ctx, request, call)
			}
			result, err := app.Execute(ctx, request.Agent, call)
			if err != nil {
				return harness.ToolResult{}, err
			}
			data, err := json.Marshal(result)
			return harness.ToolResult{IsError: result.StopReason != "completed", Content: []harness.ContentBlock{{Type: harness.BlockText, Text: string(data)}}}, err
		}})
		return nil, err
	})
	app.instance, err = h.Runtime().Mount(nil, "selected-workflows", definition, nil)
	if err == nil {
		err = app.instance.WaitStable(ctx)
	}
	if err == nil && app.instance.Snapshot().State == point.Failed {
		err = fmt.Errorf("workflow: mount failed: %s", app.instance.Snapshot().LastError)
	}
	if err != nil && app.instance != nil {
		_ = app.instance.Dispose(context.Background())
	}
	return app, err
}

func (app *App) drain(ctx context.Context) error {
	app.mu.Lock()
	app.closed = true
	app.mu.Unlock()
	if err := app.stopBackground(ctx, nil, false); err != nil {
		return err
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

func (app *App) Dispose(ctx context.Context) error {
	if app == nil {
		return nil
	}
	if err := app.instance.Dispose(ctx); err != nil {
		return err
	}
	return app.catalog.close()
}

func (app *App) Close() error {
	if app == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	return app.Dispose(ctx)
}
