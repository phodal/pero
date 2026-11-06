package harness

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sync"

	harnessmcp "github.com/phodal/pero/harness/go/mcp"
	point "github.com/phodal/pero/harness/go/runtime"
)

// MCPSessionRequest is a session-scoped host command, never a model tool input.
type MCPSessionRequest struct {
	Action     string          `json:"action"`
	Server     string          `json:"server,omitempty"`
	Generation uint64          `json:"generation,omitempty"`
	Name       string          `json:"name,omitempty"`
	URI        string          `json:"uri,omitempty"`
	Cursor     string          `json:"cursor,omitempty"`
	Arguments  json.RawMessage `json:"arguments,omitempty"`
	Binding    string          `json:"binding,omitempty"`
}
type mcpAppBinding struct {
	server     string
	generation uint64
	resource   string
}

// MCPAccess owns App bindings for one Agent incarnation, on the existing MCP mount.
type MCPAccess struct {
	agent       *Agent
	run         *point.Run
	registry    *ToolRegistry
	connections *harnessmcp.SessionAccess
	policies    map[string]*harnessmcp.ToolPolicy
	names       map[string]string
	mu          sync.Mutex
	closed      bool
	bindings    map[string]mcpAppBinding
	calls       map[*context.CancelFunc]string
}

func (a *Agent) MCPAccess() *MCPAccess { return a.mcpAccess }
func MountAgentMCPServers(ctx context.Context, run *point.Run, registry *ToolRegistry, prompts *PromptRegistry, agent *Agent, servers []MCPServerConfig) error {
	access := &MCPAccess{agent: agent, run: run, registry: registry, connections: harnessmcp.NewSessionAccess(), policies: make(map[string]*harnessmcp.ToolPolicy), names: make(map[string]string), bindings: make(map[string]mcpAppBinding), calls: make(map[*context.CancelFunc]string)}
	for _, server := range servers {
		access.names[normalizeMCPServerName(server.Name)] = server.Name
	}
	if err := mountMCPServers(ctx, run, registry, prompts, servers, access); err != nil {
		return err
	}
	agent.mcpAccess = access
	return nil
}

// mcpTool applies the one trusted per-tool policy to both model and App calls.
func mcpTool(definition harnessmcp.Tool, policy *harnessmcp.ToolPolicy) Tool {
	tool := Tool{Schema: definition.Schema, Execute: definition.Execute, RequiresApproval: definition.RequiresApproval, PreserveInitialOutputPair: true,
		RenderOutput: func(_ context.Context, _ ToolRequest, value json.RawMessage) (ToolOutputProjection, error) {
			content, err := harnessmcp.RenderToolOutput(value)
			return ToolOutputProjection{Content: content}, err
		}}
	if policy != nil {
		switch policy.Decision(definition.Name) {
		case harnessmcp.ToolAsk:
			tool.AlwaysAskApproval = true
		case harnessmcp.ToolDeny:
			tool.DeniedReason = "MCP tool denied by operator policy"
		}
	}
	return tool
}
func (a *MCPAccess) Cancel() {
	if a == nil {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	for cancel := range a.calls {
		(*cancel)()
	}
}
func (a *MCPAccess) Close() {
	if a == nil {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.closed = true
	clear(a.bindings)
	for cancel := range a.calls {
		(*cancel)()
	}
}
func (a *MCPAccess) Request(ctx context.Context, request MCPSessionRequest) (json.RawMessage, error) {
	if a == nil || !a.run.Active() || a.agent.retired.Load() {
		return nil, errors.New("MCP session is closed")
	}
	operation, err := a.agent.beginOperation(ctx)
	if err != nil {
		return nil, err
	}
	defer operation.release()
	ctx, cancel := context.WithCancel(operation.context)
	a.mu.Lock()
	if a.closed {
		a.mu.Unlock()
		cancel()
		return nil, errors.New("MCP session is closed")
	}
	bound := ""
	if request.Action == "tool" || request.Action == "resource" {
		if _, ok := a.bindings[request.Binding]; !ok {
			a.mu.Unlock()
			cancel()
			return nil, errors.New("MCP App binding is closed or outside this session")
		}
		bound = request.Binding
	}
	a.calls[&cancel] = bound
	a.mu.Unlock()
	defer func() { cancel(); a.mu.Lock(); delete(a.calls, &cancel); a.mu.Unlock() }()
	switch request.Action {
	case "list":
		servers := a.connections.List()
		for index := range servers {
			servers[index].Name = a.names[servers[index].Name]
		}
		return harnessmcp.BoundedAccessResult(struct {
			Servers []harnessmcp.AccessServer `json:"servers"`
		}{servers})
	case "resources", "templates", "read":
		server, err := a.serverName(request.Server)
		if err != nil {
			return nil, err
		}
		return a.connections.Request(ctx, server, request.Generation, request.Action, request.Cursor, request.URI)
	case "close":
		a.mu.Lock()
		delete(a.bindings, request.Binding)
		for cancel, binding := range a.calls {
			if binding != "" && binding == request.Binding {
				(*cancel)()
			}
		}
		a.mu.Unlock()
		return json.RawMessage(`{}`), nil
	case "prepare":
		if len(request.Arguments) != 0 {
			return nil, errors.New("MCP App prepare does not accept tool arguments")
		}
		server, err := a.serverName(request.Server)
		if err != nil {
			return nil, err
		}
		_, uri, err := a.connections.AppTool(server, request.Generation, request.Name, "", true)
		if err != nil {
			return nil, err
		}
		resource, err := a.connections.Request(ctx, server, request.Generation, "read", "", uri)
		if err != nil {
			return nil, err
		}
		var document struct {
			Contents []struct {
				MIMEType string `json:"mimeType"`
			} `json:"contents"`
		}
		if json.Unmarshal(resource, &document) != nil || len(document.Contents) != 1 || document.Contents[0].MIMEType != "text/html;profile=mcp-app" {
			return nil, errors.New("MCP App requires one text/html;profile=mcp-app document")
		}
		if err = a.connections.Check(server, request.Generation); err != nil {
			return nil, err
		}
		var token [32]byte
		if _, err = rand.Read(token[:]); err != nil {
			return nil, err
		}
		id := hex.EncodeToString(token[:])
		response, err := harnessmcp.BoundedAccessResult(struct {
			Binding  string          `json:"binding"`
			Resource json.RawMessage `json:"resource"`
		}{id, resource})
		if err != nil {
			return nil, err
		}
		a.mu.Lock()
		if a.closed || ctx.Err() != nil {
			a.mu.Unlock()
			return nil, errors.New("MCP App prepare was cancelled or closed")
		}
		a.bindings[id] = mcpAppBinding{server, request.Generation, uri}
		a.mu.Unlock()
		return response, nil
	case "tool", "resource":
		binding, err := a.binding(request.Binding)
		if err != nil {
			return nil, err
		}
		if request.Action == "resource" {
			if request.URI != binding.resource {
				return nil, errors.New("resource is outside the MCP App binding")
			}
			return a.connections.Request(ctx, binding.server, binding.generation, "resource", "", request.URI)
		}
		definition, _, err := a.connections.AppTool(binding.server, binding.generation, request.Name, binding.resource, false)
		if err != nil {
			return nil, err
		}
		execute := definition.Execute
		definition.Execute = func(ctx context.Context, raw json.RawMessage) (ToolResult, error) {
			if _, err := a.binding(request.Binding); err != nil {
				return ToolResult{}, err
			}
			return execute(ctx, raw)
		}
		return a.execute(ctx, binding.server, request.Binding, definition, request.Arguments)
	default:
		return nil, errors.New("unsupported MCP session action")
	}
}
func (a *MCPAccess) execute(ctx context.Context, server string, binding string, definition harnessmcp.Tool, arguments json.RawMessage) (json.RawMessage, error) {
	tool, err := prepareTool(mcpTool(definition, a.policies[server]))
	if err != nil {
		return nil, err
	}
	if len(arguments) == 0 {
		arguments = json.RawMessage(`{}`)
	}
	var token [16]byte
	if _, err = rand.Read(token[:]); err != nil {
		return nil, err
	}
	request := ToolRequest{Agent: a.agent, CallID: ToolCallID("mcp-app-" + hex.EncodeToString(token[:])), Name: tool.Schema.Name, Arguments: arguments}
	ctx = context.WithValue(ctx, mcpAppApprovalKey{}, mcpAppApprovalScope{agent: a.agent, call: request.CallID, name: request.Name, binding: binding})
	outcome, err := a.registry.executeWithResolver(ctx, request, false, func(ctx context.Context, agent *Agent, name string) (Tool, bool, error) {
		if agent != a.agent || name != tool.Schema.Name || !a.run.Active() {
			return Tool{}, false, errors.New("MCP App call identity changed")
		}
		a.registry.mu.RLock()
		defer a.registry.mu.RUnlock()
		// Existing scoped restrictions still apply to the App audience. An
		// authoritative catalog owns the whole session, so it must explicitly
		// support Apps before any alternate audience can execute.
		for _, catalog := range a.registry.catalogs {
			if catalog.scope.Contains(agent.Scope()) && catalog.provider.Authoritative {
				return Tool{}, false, errors.New("this session catalog does not support MCP Apps")
			}
		}
		if !toolRestrictionsAdmit(visibleToolRestrictions(a.registry.restrictions, agent), name, a.run.Scope) {
			return Tool{}, false, errors.New("MCP App tool restricted in this session")
		}
		return tool, true, nil
	})
	if err != nil {
		return nil, err
	}
	if outcome.Result.IsError {
		return nil, errors.New("MCP App tool was denied, cancelled or failed")
	}
	if len(outcome.Result.Meta) == 0 {
		return nil, errors.New("MCP App result unavailable")
	}
	return harnessmcp.BoundedAccessResult(outcome.Result.Meta)
}

func (a *MCPAccess) serverName(raw string) (string, error) {
	for name, original := range a.names {
		if original == raw {
			return name, nil
		}
	}
	return "", errors.New("MCP server is outside this session")
}

// This receipt is minted only for the exact host-owned App execution. It
// permits ordinary audited approval outside a model turn, never approval itself.
type mcpAppApprovalKey struct{}
type mcpAppApprovalScope struct {
	agent   *Agent
	call    ToolCallID
	name    string
	binding string
}

func hasMCPAppApprovalScope(ctx context.Context, request ApprovalRequest) bool {
	scope, ok := ctx.Value(mcpAppApprovalKey{}).(mcpAppApprovalScope)
	return ok && ctx.Err() == nil && scope.agent == request.Agent && scope.call == request.CallID && scope.name == request.ToolName
}

func (a *MCPAccess) binding(id string) (mcpAppBinding, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	binding, ok := a.bindings[id]
	if !ok || a.closed {
		return mcpAppBinding{}, errors.New("MCP App binding is closed or outside this session")
	}
	return binding, nil
}

// MCPApprovalBinding identifies only the exact trusted App call whose approval
// is being routed. A model input cannot forge this context receipt.
func MCPApprovalBinding(ctx context.Context, request ApprovalRequest) string {
	scope, ok := ctx.Value(mcpAppApprovalKey{}).(mcpAppApprovalScope)
	if !ok || scope.agent != request.Agent || scope.call != request.CallID || scope.name != request.ToolName {
		return ""
	}
	return scope.binding
}
