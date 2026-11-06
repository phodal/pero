package scienceenv

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/phodal/pero/harness/go/harness"
)

const (
	pythonTool = "python"
	rTool      = "r"
	replTool   = "repl"
	cellSchema = `{"type":"object","additionalProperties":false,"properties":{"code":{"type":"string","minLength":1,"maxLength":1048576}},"required":["code"]}`
)

// Options selects interpreters for the three session kernels.
// MCP answers repl host.mcp calls. Nil reports that no MCP server is connected.
type Options struct {
	Workspace string
	Python    string
	Rscript   string
	MCP       func(context.Context, *harness.Agent, MCPCall) (json.RawMessage, error)
}

type sessionKernels struct {
	python *Kernel
	repl   *Kernel
	r      *Kernel
}

// Env owns one python, repl, and R process per agent session.
type Env struct {
	mu        sync.Mutex
	workspace string
	pythonBin string
	rscript   string
	mcp       func(context.Context, *harness.Agent, MCPCall) (json.RawMessage, error)
	sessions  map[string]*sessionKernels
}

// Mount registers python, r, and repl. Each cell requires approval.
// The R tool stays registered when Rscript is absent and fails at the call.
func Mount(ctx context.Context, h *harness.Harness, opts Options) (*Env, error) {
	if h == nil {
		return nil, errors.New("science kernels require harness")
	}
	workspace, err := filepath.Abs(opts.Workspace)
	if err != nil {
		return nil, err
	}
	if opts.Python == "" {
		opts.Python = "python3"
	}
	if opts.Rscript == "" {
		opts.Rscript = "Rscript"
	}
	pythonBin, err := resolveInterpreter(opts.Python)
	if err != nil {
		return nil, fmt.Errorf("science python: %w", err)
	}
	env := &Env{workspace: workspace, pythonBin: pythonBin, rscript: opts.Rscript, mcp: opts.MCP}
	tools := []struct {
		id, name, description string
		language              Language
	}{
		{"science/python", pythonTool, "Run one cell in this session's persistent Python kernel. Names and imports survive later python calls. This process has no host.mcp; use repl for MCP. python and repl do not share state. Pass files through the workspace. Not a sandbox. Requires approval.", Python},
		{"science/repl", replTool, "Run one cell in this session's persistent Python repl kernel, a different process from python. import host, then host.mcp(server, tool, **arguments) calls an MCP tool already connected to this agent. State stays in this kernel. Not a sandbox. Requires approval.", Repl},
		{"science/r", rTool, "Run one cell in this session's persistent R kernel. The global environment survives later r calls. This process has no host.mcp. Not a sandbox. Requires approval.", R},
	}
	for _, tool := range tools {
		language := tool.language
		_, err := h.RegisterTool(ctx, tool.id, harness.Tool{
			Schema:           harness.ToolSchema{Name: tool.name, Description: tool.description, InputSchema: json.RawMessage(cellSchema)},
			RequiresApproval: true,
			ExecutionMode:    harness.ExecutionSerial,
			Timeout:          10 * time.Minute,
			ExecuteRequest: func(ctx context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
				return env.execute(ctx, request, language)
			},
		})
		if err != nil {
			_ = env.Close()
			return nil, err
		}
	}
	return env, nil
}

func (e *Env) execute(ctx context.Context, request harness.ToolRequest, language Language) (harness.ToolResult, error) {
	if request.Agent == nil || request.Agent.Session() == nil {
		return cellError("science kernel requires an agent session"), nil
	}
	cwd := request.Agent.Session().WorkingDirectory()
	if !sameDir(cwd, e.workspace) {
		return cellError("science kernel is bound to " + e.workspace), nil
	}
	var args struct {
		Code string `json:"code"`
	}
	if json.Unmarshal(request.Arguments, &args) != nil || strings.TrimSpace(args.Code) == "" {
		return cellError("science kernel requires code"), nil
	}
	kernel, err := e.kernel(string(request.Agent.ID()), language)
	if err != nil {
		return cellError(err.Error()), nil
	}
	var mcp MCPHandler
	if language == Repl && e.mcp != nil {
		agent := request.Agent
		mcp = func(ctx context.Context, call MCPCall) (json.RawMessage, error) {
			return e.mcp(ctx, agent, call)
		}
	}
	out, err := kernel.Exec(ctx, args.Code, mcp)
	if err != nil {
		return cellError(err.Error()), nil
	}
	return cellValue(out), nil
}

func (e *Env) kernel(session string, language Language) (*Kernel, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.sessions == nil {
		e.sessions = map[string]*sessionKernels{}
	}
	current := e.sessions[session]
	if current == nil {
		current = &sessionKernels{}
		e.sessions[session] = current
	}
	switch language {
	case Python:
		return e.cached(&current.python, Config{Language: Python, Interpreter: e.pythonBin, Workspace: e.workspace})
	case Repl:
		return e.cached(&current.repl, Config{Language: Repl, Interpreter: e.pythonBin, Workspace: e.workspace})
	case R:
		bin, err := resolveInterpreter(e.rscript)
		if err != nil {
			return nil, fmt.Errorf("science R: %w", err)
		}
		return e.cached(&current.r, Config{Language: R, Interpreter: bin, Workspace: e.workspace})
	default:
		return nil, errors.New("unknown science kernel")
	}
}

func (e *Env) cached(slot **Kernel, cfg Config) (*Kernel, error) {
	if *slot != nil {
		return *slot, nil
	}
	kernel, err := Start(cfg)
	if err != nil {
		return nil, err
	}
	*slot = kernel
	return kernel, nil
}

// Close stops every kernel. A nil Env is safe.
func (e *Env) Close() error {
	if e == nil {
		return nil
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	var err error
	for _, current := range e.sessions {
		err = errors.Join(err, current.python.Close(), current.repl.Close(), current.r.Close())
	}
	e.sessions = nil
	return err
}

// AgentMCP routes repl host.mcp through the tools already registered for the agent.
func AgentMCP(h *harness.Harness) func(context.Context, *harness.Agent, MCPCall) (json.RawMessage, error) {
	var seq atomic.Uint64
	return func(ctx context.Context, agent *harness.Agent, call MCPCall) (json.RawMessage, error) {
		if h == nil || agent == nil {
			return nil, errors.New("repl MCP requires an agent")
		}
		if len(call.Arguments) == 0 {
			call.Arguments = json.RawMessage(`{}`)
		}
		outcome, err := h.Tools().Execute(ctx, harness.ToolRequest{
			Agent: agent, Name: harness.PublicMCPToolName(call.Server, call.Tool),
			CallID: harness.ToolCallID(fmt.Sprintf("repl-mcp-%d", seq.Add(1))), Arguments: call.Arguments,
		})
		if err != nil {
			return nil, err
		}
		if outcome.Result.IsError {
			text := "MCP tool failed"
			if len(outcome.Result.Content) > 0 && outcome.Result.Content[0].Text != "" {
				text = outcome.Result.Content[0].Text
			}
			return nil, errors.New(text)
		}
		if len(outcome.Result.Value) > 0 {
			return append(json.RawMessage(nil), outcome.Result.Value...), nil
		}
		if len(outcome.Result.Content) > 0 && outcome.Result.Content[0].Text != "" {
			return json.Marshal(outcome.Result.Content[0].Text)
		}
		return json.RawMessage(`null`), nil
	}
}

func resolveInterpreter(name string) (string, error) {
	if strings.TrimSpace(name) == "" {
		return "", errors.New("interpreter is empty")
	}
	if filepath.IsAbs(name) {
		return name, nil
	}
	path, err := exec.LookPath(name)
	if err != nil {
		return "", err
	}
	return path, nil
}

func sameDir(left, right string) bool {
	a, errA := filepath.Abs(left)
	b, errB := filepath.Abs(right)
	if errA != nil || errB != nil {
		return left == right
	}
	return a == b
}

func cellValue(out Output) harness.ToolResult {
	text := out.Stdout
	if out.Stderr != "" {
		if text != "" {
			text += "\n"
		}
		text += out.Stderr
	}
	if out.Error != "" {
		if text != "" {
			text += "\n"
		}
		text += out.Error
	}
	raw, _ := json.Marshal(out)
	return harness.ToolResult{
		IsError: out.Error != "",
		Value:   raw,
		Content: []harness.ContentBlock{{Type: harness.BlockText, Text: text}},
	}
}

func cellError(message string) harness.ToolResult {
	return harness.ToolResult{IsError: true, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: message}}}
}
