package pluginruntime

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
	harnessmcp "github.com/phodal/pero/harness/go/mcp"
)

// mcpHookCall marks a tool call made by an MCP tool hook so that call does not
// run plugin hooks again.
type mcpHookCall struct{}

func (app *HookApp) runMCPHook(ctx context.Context, agent *harness.Agent, plugin string, hook claudehooks.Hook, input claudehooks.Input) (claudehooks.Decision, error) {
	arguments, err := substituteMCPInput(hook.MCPInput, input)
	if err != nil {
		return claudehooks.Decision{}, fmt.Errorf("%w for %s: %s", claudehooks.ErrNonBlocking, hook.Event, err.Error())
	}
	name, err := app.mcpHookTool(ctx, agent, plugin, hook.MCPServer, hook.MCPTool)
	if err != nil {
		return claudehooks.Decision{}, fmt.Errorf("%w for %s: %s", claudehooks.ErrNonBlocking, hook.Event, err.Error())
	}
	timeout, err := claudehooks.HookTimeout(hook)
	if err != nil {
		return claudehooks.Decision{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	outcome, err := app.h.Tools().Execute(context.WithValue(ctx, mcpHookCall{}, true), harness.ToolRequest{Agent: agent, Name: name, Arguments: arguments})
	if err != nil {
		return claudehooks.Decision{}, fmt.Errorf("%w for %s: %s", claudehooks.ErrNonBlocking, hook.Event, err.Error())
	}
	if outcome.Result.IsError {
		return claudehooks.Decision{}, fmt.Errorf("%w for %s: %s", claudehooks.ErrNonBlocking, hook.Event, toolResultText(outcome.Result))
	}
	return claudehooks.ParseDecision(hook.Event, []byte(toolResultText(outcome.Result)), nil, 0)
}

func (app *HookApp) mcpHookTool(ctx context.Context, agent *harness.Agent, plugin, server, tool string) (string, error) {
	schemas, err := app.h.Tools().SchemasForAgent(ctx, agent)
	if err != nil {
		return "", err
	}
	available := make(map[string]bool, len(schemas))
	for _, schema := range schemas {
		available[schema.Name] = true
	}
	for _, name := range mcpHookToolNames(plugin, server, tool) {
		if available[name] {
			return name, nil
		}
	}
	return "", fmt.Errorf("MCP tool %s on %s is not connected", tool, server)
}

func mcpHookToolNames(plugin, server, tool string) []string {
	var servers []string
	if rest, ok := strings.CutPrefix(server, "plugin:"); ok {
		pluginName, serverName, found := strings.Cut(rest, ":")
		if found && pluginName != "" && serverName != "" {
			servers = append(servers, pluginMCPName(pluginName, serverName))
		}
	}
	if plugin != "" && server != "" {
		servers = append(servers, pluginMCPName(plugin, server))
	}
	if server != "" {
		servers = append(servers, server)
	}
	names := make([]string, 0, len(servers))
	seen := map[string]bool{}
	for _, candidate := range servers {
		name := harnessmcp.PublicMCPToolName(candidate, tool)
		if !seen[name] {
			seen[name] = true
			names = append(names, name)
		}
	}
	return names
}

func substituteMCPInput(raw json.RawMessage, input claudehooks.Input) (json.RawMessage, error) {
	if len(bytes.TrimSpace(raw)) == 0 {
		return []byte("{}"), nil
	}
	payload, err := json.Marshal(input)
	if err != nil {
		return nil, err
	}
	var source any
	if json.Unmarshal(payload, &source) != nil {
		return nil, fmt.Errorf("hook input cannot be read")
	}
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return nil, fmt.Errorf("MCP hook input must be an object")
	}
	encoded, err := json.Marshal(substituteHookValue(value, source))
	if err != nil {
		return nil, err
	}
	return encoded, nil
}

func substituteHookValue(value, source any) any {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			typed[key] = substituteHookValue(child, source)
		}
		return typed
	case []any:
		for index, child := range typed {
			typed[index] = substituteHookValue(child, source)
		}
		return typed
	case string:
		return substituteHookString(typed, source)
	default:
		return value
	}
}

func substituteHookString(value string, source any) string {
	var builder strings.Builder
	for {
		start := strings.Index(value, "${")
		if start < 0 {
			builder.WriteString(value)
			return builder.String()
		}
		builder.WriteString(value[:start])
		end := strings.IndexByte(value[start+2:], '}')
		if end < 0 {
			builder.WriteString(value[start:])
			return builder.String()
		}
		path := value[start+2 : start+2+end]
		if found, ok := hookPath(source, path); ok {
			builder.WriteString(found)
		} else {
			builder.WriteString(value[start : start+2+end+1])
		}
		value = value[start+2+end+1:]
	}
}

func hookPath(source any, path string) (string, bool) {
	current := source
	for _, part := range strings.Split(path, ".") {
		object, ok := current.(map[string]any)
		if !ok {
			return "", false
		}
		next, exists := object[part]
		if !exists {
			return "", false
		}
		current = next
	}
	switch typed := current.(type) {
	case string:
		return typed, true
	default:
		encoded, err := json.Marshal(typed)
		if err != nil {
			return "", false
		}
		return string(encoded), true
	}
}

func toolResultText(result harness.ToolResult) string {
	var text []string
	for _, block := range result.Content {
		if block.Type == harness.BlockText && block.Text != "" {
			text = append(text, block.Text)
		}
	}
	return strings.Join(text, "\n")
}
