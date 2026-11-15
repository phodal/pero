package scienceenv

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
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

// Options selects interpreters, the read-only skill root, and optional
// literature MCP servers. MCP answers repl host.mcp calls.
type Options struct {
	Workspace      string
	Python         string
	Rscript        string
	SkillRoot      string
	ContactEmail   string
	MCPPython      string
	MCPServersRoot string
	MCP            func(context.Context, *harness.Agent, MCPCall) (json.RawMessage, error)
}

// Env owns one python, repl, and R process per agent session.
type Env struct {
	mu        sync.Mutex
	workspace string
	pythonBin string
	rscript   string
	mcp       func(context.Context, *harness.Agent, MCPCall) (json.RawMessage, error)
	skillRoot string
	email     string
	mcpNames  []string
	harness   *harness.Harness
	sessions  map[*harness.Agent]map[Language]*computation
	closed    bool
	artifacts map[string]map[string]artifactRecord
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
	skillRoot := ""
	if opts.SkillRoot != "" {
		skillRoot, err = filepath.Abs(opts.SkillRoot)
		if err != nil {
			return nil, err
		}
		info, statErr := os.Stat(skillRoot)
		if statErr != nil || !info.IsDir() {
			return nil, errors.New("science skill root must be a directory")
		}
	}
	env := &Env{harness: h, workspace: workspace, pythonBin: pythonBin, rscript: opts.Rscript, mcp: opts.MCP, skillRoot: skillRoot, email: strings.TrimSpace(opts.ContactEmail)}
	if opts.MCPServersRoot != "" {
		names, mcpErr := env.mountLiteratureMCP(ctx, h, opts.MCPPython, opts.MCPServersRoot)
		if mcpErr != nil {
			return nil, mcpErr
		}
		env.mcpNames = names
	}
	tools := []struct {
		id, name, description string
		language              Language
	}{
		{"science/python", pythonTool, "Run one cell in this session's persistent Python kernel. Names and imports survive later python calls. host.get_user_email and host.artifact_path are available. host.mcp is not; use repl for MCP. python and repl do not share state. Pass files through the workspace. Not a sandbox. Requires approval.", Python},
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
	if err := env.registerSkillTools(ctx, h); err != nil {
		_ = env.Close()
		return nil, err
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
	current, err := e.computation(request.Agent, language)
	if err != nil {
		return cellError(err.Error()), nil
	}
	out, err := current.execute(ctx, args.Code, AgentCell, false)
	if err != nil {
		return cellError(err.Error()), nil
	}
	return cellValue(out), nil
}

// Close stops every kernel. A nil Env is safe.
func (e *Env) Close() error {
	if e == nil {
		return nil
	}
	e.mu.Lock()
	e.closed = true
	sessions := e.sessions
	e.sessions = nil
	e.mu.Unlock()
	var err error
	for _, languages := range sessions {
		for _, current := range languages {
			err = errors.Join(err, current.close())
		}
	}
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
