package harness

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync/atomic"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	harnessmcp "github.com/phodal/pero/harness/go/mcp"
	point "github.com/phodal/pero/harness/go/runtime"
)

type MCPTransport = harnessmcp.MCPTransport

const (
	MCPStdio          = harnessmcp.MCPStdio
	MCPStreamableHTTP = harnessmcp.MCPStreamableHTTP
)

// MCPServerConfig is the transport-neutral server declaration accepted by
// Harness and ACP session creation. TestTransport is intentionally excluded
// from wire formats and lets conformance tests use the SDK's in-memory link.
type MCPServerConfig struct {
	Name               string            `json:"name"`
	Transport          MCPTransport      `json:"transport"`
	Command            string            `json:"command,omitempty"`
	Args               []string          `json:"args,omitempty"`
	Env                map[string]string `json:"env,omitempty"`
	CWD                string            `json:"cwd,omitempty"`
	URL                string            `json:"url,omitempty"`
	Headers            map[string]string `json:"headers,omitempty"`
	ToolCallTimeoutMS  int               `json:"toolCallTimeoutMs,omitempty"`
	FailOnStartupError bool              `json:"failOnStartupError,omitempty"`
	// ToolPolicy limits the server to the operator's listed tools and makes
	// mutating tools require approval; it is trusted operator configuration.
	ToolPolicy *harnessmcp.ToolPolicy `json:"toolPolicy,omitempty"`
	// CleanEnvironment starts a stdio server with only Env, inheriting nothing.
	CleanEnvironment        bool                `json:"cleanEnvironment,omitempty"`
	Reconnect               *MCPReconnectConfig `json:"reconnect,omitempty"`
	TestTransport           mcp.Transport       `json:"-"`
	testTransportFactory    func() (mcp.Transport, error)
	testListTools           func(context.Context, *mcp.ClientSession) ([]*mcp.Tool, error)
	resolvedReconnect       resolvedMCPReconnectPolicy
	resolvedToolCallTimeout time.Duration
}

// MountMCPServers validates and connects a complete server set before the
// owning Agent is published. Connections and contributed tools are owned by
// run and are removed in reverse order on failure or disposal. The prompt
// registry is the Harness root registry: agent-loop does not declare the
// system-prompt service, so this mount cannot resolve it from the agent run.
func MountMCPServers(ctx context.Context, run *point.Run, registry *ToolRegistry, prompts *PromptRegistry, servers []MCPServerConfig) error {
	if run == nil || !run.Active() {
		return point.ErrInactiveRun
	}
	if registry == nil {
		return errors.New("harness: MCP requires a tool registry")
	}
	configs, err := validateMCPConfigs(servers)
	if err != nil {
		return err
	}
	// A server under an operator tool policy is reachable only through its
	// listed tools, so it is kept out of the generic resource tools.
	var open []MCPServerConfig
	for _, config := range configs {
		if config.ToolPolicy == nil {
			open = append(open, config)
		}
	}
	directory := harnessmcp.NewResourceDirectory(mcpResourceTimeouts(open))
	if len(open) > 0 {
		if prompts == nil {
			return errors.New("harness: MCP requires a prompt registry")
		}
		if err := registerMCPResourceTools(run, registry, directory); err != nil {
			return err
		}
		if err := registerMCPResourcePrompt(run, prompts, directory); err != nil {
			return err
		}
	}
	for _, config := range configs {
		if err := mountMCPServer(ctx, run, registry, config, directory); err != nil {
			return fmt.Errorf("harness: MCP server %q: %w", config.Name, err)
		}
	}
	return nil
}

func mcpResourceTimeouts(configs []MCPServerConfig) map[string]time.Duration {
	timeouts := make(map[string]time.Duration, len(configs))
	for _, config := range configs {
		timeouts[config.Name] = config.resolvedToolCallTimeout
	}
	return timeouts
}

func mountMCPServer(ctx context.Context, run *point.Run, registry *ToolRegistry, config MCPServerConfig, directory *harnessmcp.ResourceDirectory) error {
	transportFactory, err := mcpTransportFactory(config)
	if err != nil {
		return err
	}
	policy := harnessmcp.ReconnectPolicy{
		Enabled: config.resolvedReconnect.enabled, InitialDelay: config.resolvedReconnect.initialDelay,
		MaxDelay: config.resolvedReconnect.maxDelay, MaxAttempts: config.resolvedReconnect.maxAttempts,
	}
	resources := directory
	if config.ToolPolicy != nil {
		resources = nil
	}
	return harnessmcp.MountConnection(ctx, run, harnessmcp.ConnectionOptions{
		ServerName: config.Name, Reconnect: policy, ToolCallTimeout: config.resolvedToolCallTimeout,
		FailOnStartupError: config.FailOnStartupError, TransportFactory: transportFactory, ListTools: config.testListTools,
		Resources: resources, ToolPolicy: config.ToolPolicy,
	}, func(owner *point.Run, generation string, definitions []harnessmcp.Tool) (point.Dispose, error) {
		tools := make([]Tool, len(definitions))
		for i, definition := range definitions {
			tools[i] = Tool{Schema: definition.Schema, Execute: definition.Execute, RequiresApproval: definition.RequiresApproval}
			if admit := definition.Admit; admit != nil {
				// Reject a call the policy would refuse before asking for approval.
				tools[i].ApprovalDescriptor = func(_ context.Context, request ToolRequest) (*NativeApprovalDescriptor, error) {
					return nil, admit(request.Arguments)
				}
			}
		}
		return registry.replaceGeneration(owner, generation, tools)
	})
}

func listMCPTools(ctx context.Context, session *mcp.ClientSession) ([]*mcp.Tool, error) {
	return harnessmcp.ListTools(ctx, session)
}

func PublicMCPToolName(serverName, rawName string) string {
	return harnessmcp.PublicMCPToolName(serverName, rawName)
}

type MCPReconnectConfig = harnessmcp.MCPReconnectConfig

type resolvedMCPReconnectPolicy struct {
	enabled                bool
	initialDelay, maxDelay time.Duration
	maxAttempts            int
}

func resolveMCPReconnectPolicy(config *MCPReconnectConfig) (resolvedMCPReconnectPolicy, error) {
	policy, err := harnessmcp.ResolveReconnectPolicy(config)
	return resolvedMCPReconnectPolicy{policy.Enabled, policy.InitialDelay, policy.MaxDelay, policy.MaxAttempts}, err
}

const (
	defaultMCPToolCallTimeoutMS = 60_000
	maxMCPTimerDelayMS          = 2_147_483_647
)

func validateMCPConfigs(servers []MCPServerConfig) ([]MCPServerConfig, error) {
	result := make([]MCPServerConfig, len(servers))
	names := make(map[string]struct{}, len(servers))
	for index, server := range servers {
		if strings.TrimSpace(server.Name) == "" || strings.IndexFunc(server.Name, func(char rune) bool {
			return char < 0x20 || char == 0x7f
		}) >= 0 {
			return nil, errors.New("harness: MCP server has an invalid name")
		}
		server.Name = normalizeMCPServerName(server.Name)
		if _, exists := names[server.Name]; exists {
			return nil, fmt.Errorf("harness: duplicate normalized MCP server name %q", server.Name)
		}
		names[server.Name] = struct{}{}
		if server.TestTransport == nil && server.testTransportFactory == nil {
			switch server.Transport {
			case MCPStdio:
				if !filepath.IsAbs(server.Command) {
					return nil, fmt.Errorf("harness: MCP server %q command must be absolute", server.Name)
				}
			case MCPStreamableHTTP:
				request, err := http.NewRequest(http.MethodPost, server.URL, nil)
				if err != nil || (request.URL.Scheme != "http" && request.URL.Scheme != "https") {
					return nil, fmt.Errorf("harness: MCP server %q URL must be absolute HTTP(S)", server.Name)
				}
			default:
				return nil, fmt.Errorf("harness: MCP server %q has unsupported transport %q", server.Name, server.Transport)
			}
		}
		for name, value := range server.Headers {
			if !validHTTPHeaderName(name) || strings.ContainsAny(value, "\r\n") {
				return nil, fmt.Errorf("harness: MCP server %q contains an invalid header", server.Name)
			}
		}
		for name, value := range server.Env {
			if name == "" || strings.ContainsAny(name, "=\x00") || strings.ContainsRune(value, '\x00') {
				return nil, fmt.Errorf("harness: MCP server %q contains an invalid environment entry", server.Name)
			}
		}
		if server.ToolPolicy != nil {
			if err := server.ToolPolicy.Validate(); err != nil {
				return nil, fmt.Errorf("harness: MCP server %q: %w", server.Name, err)
			}
		}
		policy, err := resolveMCPReconnectPolicy(server.Reconnect)
		if err != nil {
			return nil, fmt.Errorf("harness: MCP server %q reconnect: %w", server.Name, err)
		}
		server.resolvedReconnect = policy
		if server.ToolCallTimeoutMS == 0 {
			server.ToolCallTimeoutMS = defaultMCPToolCallTimeoutMS
		}
		if server.ToolCallTimeoutMS < 1 || server.ToolCallTimeoutMS > maxMCPTimerDelayMS {
			return nil, fmt.Errorf("harness: MCP server %q toolCallTimeoutMs must be a positive timer duration", server.Name)
		}
		server.resolvedToolCallTimeout = time.Duration(server.ToolCallTimeoutMS) * time.Millisecond
		result[index] = server
	}
	return result, nil
}

func validHTTPHeaderName(name string) bool {
	if name == "" {
		return false
	}
	const separators = "()<>@,;:\\\"/[]?={} \t"
	for _, char := range name {
		if char <= 31 || char >= 127 || strings.ContainsRune(separators, char) {
			return false
		}
	}
	return true
}

func normalizeMCPServerName(name string) string { return harnessmcp.NormalizeServerName(name) }

const (
	mcpResourceListSchema = `{"type":"object","additionalProperties":false,"required":["server"],"properties":{"server":{"type":"string","description":"Configured MCP server name."},"cursor":{"type":"string","description":"Continuation cursor returned by this server."}}}`
	mcpResourceReadSchema = `{"type":"object","additionalProperties":false,"required":["server","uri"],"properties":{"server":{"type":"string","description":"Configured MCP server name."},"uri":{"type":"string","description":"Resource URI to read."}}}`
)

func registerMCPResourceTools(run *point.Run, registry *ToolRegistry, directory *harnessmcp.ResourceDirectory) error {
	tools := []Tool{
		mcpResourceTool(directory, "list_mcp_resources", "List resources available from an MCP server.", mcpResourceListSchema, "resources/list"),
		mcpResourceTool(directory, "list_mcp_resource_templates", "List parameterized resource URI templates from an MCP server.", mcpResourceListSchema, "resources/templates/list"),
		mcpResourceTool(directory, "read_mcp_resource", "Read an MCP resource by URI from the named server. Use a listed URI or an expanded resource template.", mcpResourceReadSchema, "resources/read"),
	}
	_, err := registry.ReplaceGeneration(run, "mcp-resources", tools)
	return err
}

func registerMCPResourcePrompt(run *point.Run, prompts *PromptRegistry, directory *harnessmcp.ResourceDirectory) error {
	_, err := prompts.Register(run, PromptSection{
		ID: fmt.Sprintf("mcp-resource-servers:%p", run.Scope), Order: 3100,
		Content: func(context.Context, *Agent) (string, error) {
			names := directory.Names()
			if len(names) == 0 {
				return "", nil
			}
			encoded, marshalErr := json.Marshal(names)
			if marshalErr != nil {
				return "", marshalErr
			}
			return "## MCP resource servers\n\nUse list_mcp_resources, list_mcp_resource_templates, or read_mcp_resource with one of these names as the server argument: " + string(encoded) + ".", nil
		},
	})
	return err
}

func mcpResourceTool(directory *harnessmcp.ResourceDirectory, name, description, schema, method string) Tool {
	return Tool{
		Schema: ToolSchema{Name: name, Description: description, InputSchema: json.RawMessage(schema)},
		Execute: func(ctx context.Context, raw json.RawMessage) (ToolResult, error) {
			var args struct {
				Server string          `json:"server"`
				Cursor json.RawMessage `json:"cursor"`
				URI    string          `json:"uri"`
			}
			if err := json.Unmarshal(raw, &args); err != nil {
				return ToolResult{}, err
			}
			var cursor *string
			if len(args.Cursor) > 0 && string(args.Cursor) != "null" {
				var value string
				if err := json.Unmarshal(args.Cursor, &value); err != nil {
					return ToolResult{}, err
				}
				cursor = &value
			}
			payload, err := directory.Request(ctx, args.Server, method, cursor, args.URI)
			if err != nil {
				return ToolResult{IsError: true, Content: []ContentBlock{{Type: BlockText, Text: err.Error()}}}, nil
			}
			text, err := harnessmcp.RenderResourceResult(args.Server, payload)
			if err != nil {
				return ToolResult{}, err
			}
			meta, err := json.Marshal(struct {
				Value json.RawMessage `json:"value"`
			}{Value: payload})
			if err != nil {
				return ToolResult{}, err
			}
			return ToolResult{Content: []ContentBlock{{Type: BlockText, Text: text}}, Meta: meta}, nil
		},
	}
}

func mcpTransportFactory(config MCPServerConfig) (func() (mcp.Transport, error), error) {
	if config.testTransportFactory != nil {
		return config.testTransportFactory, nil
	}
	if config.TestTransport != nil {
		transport := config.TestTransport
		used := false
		return func() (mcp.Transport, error) {
			if used {
				return nil, errors.New("single-use test transport cannot reconnect")
			}
			used = true
			return transport, nil
		}, nil
	}
	switch config.Transport {
	case MCPStdio, MCPStreamableHTTP:
		return func() (mcp.Transport, error) { return newMCPTransport(config) }, nil
	default:
		return nil, fmt.Errorf("unsupported transport %q", config.Transport)
	}
}

func newMCPTransport(config MCPServerConfig) (mcp.Transport, error) {
	if config.Transport == MCPStdio {
		command := exec.Command(config.Command, config.Args...)
		command.Dir = config.CWD
		command.Env = mcpEnvironment(config)
		return &mcp.CommandTransport{Command: command}, nil
	}
	headers := &headerRoundTripper{base: http.DefaultTransport, headers: config.Headers}
	client := &http.Client{Transport: headers, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	return &authenticationTransport{StreamableClientTransport: &mcp.StreamableClientTransport{Endpoint: config.URL, HTTPClient: client}, headers: headers}, nil
}

func mcpEnvironment(config MCPServerConfig) []string {
	if config.CleanEnvironment {
		return mergedEnvironmentFrom(nil, config.Env)
	}
	return mergedEnvironment(config.Env)
}

func mergedEnvironment(overrides map[string]string) []string {
	return mergedEnvironmentFrom(os.Environ(), overrides)
}

func mergedEnvironmentFrom(inherited []string, overrides map[string]string) []string {
	values := make(map[string]string)
	for _, entry := range inherited {
		if index := strings.IndexByte(entry, '='); index >= 0 {
			name := entry[:index]
			if !scrubMCPEnvironmentName(name) {
				values[name] = entry[index+1:]
			}
		}
	}
	for name, value := range overrides {
		values[name] = value
	}
	names := make([]string, 0, len(values))
	for name := range values {
		names = append(names, name)
	}
	sort.Strings(names)
	result := make([]string, 0, len(names))
	for _, name := range names {
		result = append(result, name+"="+values[name])
	}
	return result
}

func scrubMCPEnvironmentName(name string) bool {
	upper := strings.ToUpper(name)
	return strings.HasPrefix(upper, "POINT_") || strings.Contains(upper, "KEY") ||
		strings.Contains(upper, "PASSWORD") || strings.Contains(upper, "SECRET") || strings.Contains(upper, "TOKEN")
}

// Retain authentication classification independently of SDK error wrapping and
// discovery fallback. Each configured connection remains terminal until reloaded.
type authenticationTransport struct {
	*mcp.StreamableClientTransport
	headers *headerRoundTripper
}

func (t *authenticationTransport) TerminalError() error {
	if t.headers.authenticationRejected.Load() {
		return harnessmcp.ErrAuthentication
	}
	return nil
}

type headerRoundTripper struct {
	authenticationRejected atomic.Bool
	base                   http.RoundTripper
	headers                map[string]string
}

func (t *headerRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	if t.authenticationRejected.Load() {
		return nil, harnessmcp.ErrAuthentication
	}
	clone := request.Clone(request.Context())
	clone.Header = request.Header.Clone()
	for name, value := range t.headers {
		clone.Header.Set(name, value)
	}
	response, err := t.base.RoundTrip(clone)
	if err == nil && response != nil && (response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden) {
		t.authenticationRejected.Store(true)
		// Never expose an authentication error body to the SDK, logs, or model.
		// A typed sentinel survives SDK wrapping and stops the outer supervisor.
		if response.Body != nil {
			_ = response.Body.Close()
		}
		return nil, harnessmcp.ErrAuthentication
	}
	return response, err
}
