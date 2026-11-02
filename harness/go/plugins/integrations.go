package plugins

import (
	"bytes"
	"encoding/json"
	"net/url"
	"path/filepath"
	"sort"
	"strings"
)

// HooksDefinition describes configuration, not a grant to execute a hook.
type HooksDefinition struct {
	InspectionOnly bool          `json:"inspectionOnly"`
	Hooks          []HookSummary `json:"hooks"`
}

// HookSummary deliberately excludes command, arguments, and handler payloads.
type HookSummary struct {
	Event            string   `json:"event"`
	Matcher          string   `json:"matcher,omitempty"`
	Type             string   `json:"type"`
	CommandForm      string   `json:"commandForm,omitempty"`
	ArgsPresent      bool     `json:"argsPresent"`
	TimeoutSeconds   *float64 `json:"timeoutSeconds,omitempty"`
	Async            bool     `json:"async"`
	RuntimeSupported bool     `json:"runtimeSupported"`
}

// MCPDefinition exposes only server identities and configuration shape.
type MCPDefinition struct {
	InspectionOnly bool               `json:"inspectionOnly"`
	Servers        []MCPServerSummary `json:"servers"`
}

// Merge applies later server definitions by name without changing the order in
// which each server first appeared. It does not modify either input definition.
func (d MCPDefinition) Merge(later MCPDefinition) MCPDefinition {
	merged := MCPDefinition{InspectionOnly: true, Servers: []MCPServerSummary{}}
	positions := make(map[string]int)
	for _, servers := range [][]MCPServerSummary{d.Servers, later.Servers} {
		for _, server := range servers {
			if position, exists := positions[server.Name]; exists {
				merged.Servers[position] = server
			} else {
				positions[server.Name] = len(merged.Servers)
				merged.Servers = append(merged.Servers, server)
			}
		}
	}
	return merged
}

type MCPServerSummary struct {
	Name                     string   `json:"name"`
	Transport                string   `json:"transport"`
	TransportInferred        bool     `json:"transportInferred"`
	EnvironmentKeys          []string `json:"environmentKeys,omitempty"`
	HeaderKeys               []string `json:"headerKeys,omitempty"`
	TimeoutMilliseconds      *float64 `json:"timeoutMilliseconds,omitempty"`
	CredentialLiteralPresent bool     `json:"credentialLiteralPresent"`
	RuntimeSupported         bool     `json:"runtimeSupported"`
}

// ParseHooks validates the supported configuration shapes without executing
// commands or returning their text in the inspection report.
func ParseHooks(path string, content []byte) (HooksDefinition, []Diagnostic) {
	result := HooksDefinition{InspectionOnly: true, Hooks: []HookSummary{}}
	var diagnostics []Diagnostic
	add := func(severity Severity, code, field, message string) {
		diagnostics = append(diagnostics, Diagnostic{Severity: severity, Code: code, Path: path, Field: field, Message: message})
	}
	root, ok := integrationObject(content)
	if !ok {
		add(SeverityError, "INVALID_HOOKS", "", "Hook configuration must be a JSON object.")
		return result, diagnostics
	}
	for _, key := range sortedIntegrationKeys(root) {
		if key != "hooks" && key != "description" {
			add(SeverityWarning, "UNKNOWN_HOOK_FIELD", key, "Unrecognized top-level hook field is not applied.")
		}
	}
	rules, ok := integrationObject(root["hooks"])
	if !ok {
		add(SeverityError, "HOOKS_WRAPPER_REQUIRED", "hooks", "Hook configuration requires a top-level hooks object.")
		return result, diagnostics
	}
	for _, event := range sortedIntegrationKeys(rules) {
		base := "hooks." + event
		if !knownHookEvent(event) {
			add(SeverityWarning, "UNSUPPORTED_HOOK_EVENT", base, "This hook event is not recognized by the inspection profile.")
		}
		var groups []json.RawMessage
		if !integrationDecode(rules[event], &groups) {
			add(SeverityError, "INVALID_HOOK_RULES", base, "Hook event rules must be an array.")
			continue
		}
		for _, rawGroup := range groups {
			group, ok := integrationObject(rawGroup)
			if !ok {
				add(SeverityError, "INVALID_HOOK_RULE", base, "A hook rule must be an object.")
				continue
			}
			var matcher string
			if raw, present := group["matcher"]; present && !integrationDecode(raw, &matcher) {
				add(SeverityError, "INVALID_HOOK_MATCHER", base+".matcher", "Hook matcher must be a string.")
			}
			if _, present := group["matcher"]; present && event == "Stop" {
				add(SeverityWarning, "HOOK_MATCHER_IGNORED", base+".matcher", "Stop does not support matcher; the configured matcher is ignored.")
			}
			for _, key := range sortedIntegrationKeys(group) {
				if key != "matcher" && key != "hooks" {
					add(SeverityWarning, "UNKNOWN_HOOK_FIELD", base+"."+key, "Unrecognized hook rule field is not applied.")
				}
			}
			var handlers []json.RawMessage
			if !integrationDecode(group["hooks"], &handlers) {
				add(SeverityError, "INVALID_HOOK_HANDLERS", base+".hooks", "Hook handlers must be an array.")
				continue
			}
			for _, rawHandler := range handlers {
				handler, ok := integrationObject(rawHandler)
				if !ok {
					add(SeverityError, "INVALID_HOOK_HANDLER", base+".hooks", "A hook handler must be an object.")
					continue
				}
				summary := HookSummary{Event: event, Matcher: matcher}
				if !integrationDecode(handler["type"], &summary.Type) || summary.Type == "" {
					add(SeverityError, "HOOK_TYPE_REQUIRED", base+".type", "A hook handler requires a string type.")
				} else if summary.Type != "command" {
					add(SeverityWarning, "UNSUPPORTED_HOOK_HANDLER", base+".type", "Only command handler configuration is inspected by this profile; no handler is executed.")
				}
				if raw, present := handler["timeout"]; present {
					var timeout float64
					if !integrationDecode(raw, &timeout) || timeout <= 0 {
						add(SeverityError, "INVALID_HOOK_TIMEOUT", base+".timeout", "Hook timeout must be a positive number of seconds.")
					} else {
						summary.TimeoutSeconds = &timeout
					}
				}
				if raw, present := handler["async"]; present && !integrationDecode(raw, &summary.Async) {
					add(SeverityError, "INVALID_HOOK_ASYNC", base+".async", "Hook async must be a boolean.")
				}
				if summary.Type == "command" {
					var command string
					if !integrationDecode(handler["command"], &command) || strings.TrimSpace(command) == "" {
						add(SeverityError, "HOOK_COMMAND_REQUIRED", base+".command", "A command hook requires a nonempty command string.")
					}
					summary.CommandForm = "shell"
					if raw, present := handler["args"]; present {
						summary.ArgsPresent = true
						summary.CommandForm = "argv"
						var args []string
						if !integrationDecode(raw, &args) {
							add(SeverityError, "INVALID_HOOK_ARGS", base+".args", "Hook args must be an array of strings.")
						}
						parts := strings.Fields(command)
						if len(parts) > 1 {
							switch filepath.Base(parts[0]) {
							case "python", "python3", "node", "nodejs", "bash", "sh", "zsh", "pwsh", "powershell", "ruby", "perl", "php", "bun", "deno":
								add(SeverityError, "HOOK_COMMAND_WITH_ARGS", base+".command", "When args is present, command must name one executable rather than an interpreter with inline arguments.")
							}
						}
					}
				}
				for _, key := range sortedIntegrationKeys(handler) {
					switch key {
					case "type", "command", "args", "timeout", "async":
					case "once", "statusMessage", "if", "onFailure", "shell", "url", "headers", "allowedEnvVars", "model", "prompt", "toolName", "input":
						add(SeverityWarning, "UNSUPPORTED_HOOK_FIELD", base+"."+key, "This handler field is recognized but its execution semantics are not implemented.")
					default:
						add(SeverityWarning, "UNKNOWN_HOOK_FIELD", base+"."+key, "Unrecognized hook handler field is not applied.")
					}
				}
				result.Hooks = append(result.Hooks, summary)
			}
		}
	}
	if len(result.Hooks) > 0 {
		add(SeverityWarning, "HOOK_RUNTIME_UNSUPPORTED", "hooks", "Hooks are inspected only; this profile does not register or execute them.")
	}
	return result, diagnostics
}

// ParseMCP accepts a .mcp.json wrapper or an inline server object. Only
// non-secret configuration shape is retained; no server is connected.
func ParseMCP(path string, content []byte) (MCPDefinition, []Diagnostic) {
	result := MCPDefinition{InspectionOnly: true, Servers: []MCPServerSummary{}}
	var diagnostics []Diagnostic
	add := func(severity Severity, code, field, message string) {
		diagnostics = append(diagnostics, Diagnostic{Severity: severity, Code: code, Path: path, Field: field, Message: message})
	}
	servers, ok := integrationObject(content)
	if !ok {
		add(SeverityError, "INVALID_MCP", "", "MCP configuration must be a JSON object.")
		return result, diagnostics
	}
	if raw, wrapped := servers["mcpServers"]; wrapped {
		for _, key := range sortedIntegrationKeys(servers) {
			if key != "mcpServers" {
				add(SeverityWarning, "UNKNOWN_MCP_FIELD", key, "Unrecognized top-level MCP field is not applied.")
			}
		}
		servers, ok = integrationObject(raw)
		if !ok {
			add(SeverityError, "INVALID_MCP_SERVERS", "mcpServers", "mcpServers must be an object of named server definitions.")
			return result, diagnostics
		}
	}
	for _, name := range sortedIntegrationKeys(servers) {
		base := "mcpServers." + name
		server, ok := integrationObject(servers[name])
		if !ok {
			add(SeverityError, "INVALID_MCP_SERVER", base, "An MCP server definition must be an object.")
			continue
		}
		summary := MCPServerSummary{Name: name}
		if strings.TrimSpace(name) == "" {
			add(SeverityError, "MCP_NAME_REQUIRED", base, "An MCP server requires a nonempty name.")
		}
		if raw, present := server["type"]; present {
			if !integrationDecode(raw, &summary.Transport) || summary.Transport == "" {
				add(SeverityError, "INVALID_MCP_TYPE", base+".type", "MCP server type must be a nonempty string.")
			}
		} else {
			summary.Transport = "stdio"
			if _, present := server["url"]; present {
				summary.Transport = "http"
			}
			summary.TransportInferred = true
		}
		switch summary.Transport {
		case "stdio":
			var command string
			if !integrationDecode(server["command"], &command) || strings.TrimSpace(command) == "" {
				add(SeverityError, "MCP_COMMAND_REQUIRED", base+".command", "A stdio MCP server requires a nonempty command string.")
			}
			if raw, present := server["args"]; present {
				var args []string
				if !integrationDecode(raw, &args) {
					add(SeverityError, "INVALID_MCP_ARGS", base+".args", "MCP args must be an array of strings.")
				}
			}
		case "http", "sse":
			var endpoint string
			if !integrationDecode(server["url"], &endpoint) || strings.TrimSpace(endpoint) == "" {
				add(SeverityError, "MCP_URL_REQUIRED", base+".url", "A remote MCP server requires a nonempty URL string.")
			} else if !strings.Contains(endpoint, "${") {
				parsed, err := url.Parse(endpoint)
				if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
					add(SeverityError, "INVALID_MCP_URL", base+".url", "Remote MCP URL must use HTTP or HTTPS.")
				} else if parsed.User != nil {
					summary.CredentialLiteralPresent = true
				}
			}
		default:
			add(SeverityWarning, "UNSUPPORTED_MCP_TRANSPORT", base+".type", "This MCP transport is not recognized by the inspection profile.")
		}
		for _, key := range []string{"env", "headers"} {
			if raw, present := server[key]; present {
				values, valid := integrationObject(raw)
				if !valid {
					add(SeverityError, "INVALID_MCP_BINDINGS", base+"."+key, "MCP bindings must be an object of string values.")
					continue
				}
				for _, binding := range sortedIntegrationKeys(values) {
					var value string
					if !integrationDecode(values[binding], &value) {
						add(SeverityError, "INVALID_MCP_BINDING", base+"."+key+"."+binding, "An MCP binding must be a string.")
					} else if credentialBinding(binding) && strings.TrimSpace(value) != "" && !strings.Contains(value, "${") {
						summary.CredentialLiteralPresent = true
					}
				}
				if key == "env" {
					summary.EnvironmentKeys = sortedIntegrationKeys(values)
				} else {
					summary.HeaderKeys = sortedIntegrationKeys(values)
				}
			}
		}
		if raw, present := server["timeout"]; present {
			var timeout float64
			if !integrationDecode(raw, &timeout) || timeout < 0 {
				add(SeverityError, "INVALID_MCP_TIMEOUT", base+".timeout", "MCP timeout must be a nonnegative number of milliseconds.")
			} else {
				summary.TimeoutMilliseconds = &timeout
				if timeout < 1000 {
					add(SeverityWarning, "MCP_TIMEOUT_IGNORED", base+".timeout", "Claude ignores per-server timeout below 1000 milliseconds and falls back to the global timeout.")
				}
			}
		}
		for _, key := range sortedIntegrationKeys(server) {
			switch key {
			case "type", "command", "args", "env", "url", "headers", "timeout":
			case "headersHelper", "oauth", "disabled", "scope":
				add(SeverityWarning, "UNSUPPORTED_MCP_FIELD", base+"."+key, "This MCP field is recognized but its execution semantics are not implemented.")
			default:
				add(SeverityWarning, "UNKNOWN_MCP_FIELD", base+"."+key, "Unrecognized MCP server field is not applied.")
			}
		}
		if summary.CredentialLiteralPresent {
			add(SeverityWarning, "MCP_LITERAL_CREDENTIAL", base, "Server configuration contains a literal credential; use a runtime secret binding.")
		}
		result.Servers = append(result.Servers, summary)
	}
	if len(result.Servers) > 0 {
		add(SeverityWarning, "MCP_RUNTIME_UNSUPPORTED", "mcpServers", "MCP configuration is inspected only; this profile does not start or connect servers.")
	}
	return result, diagnostics
}

func integrationObject(content []byte) (map[string]json.RawMessage, bool) {
	var object map[string]json.RawMessage
	valid := integrationDecode(content, &object) && object != nil
	return object, valid
}

func integrationDecode(content []byte, target any) bool {
	content = bytes.TrimSpace(content)
	return len(content) > 0 && !bytes.Equal(content, []byte("null")) && json.Unmarshal(content, target) == nil
}

func sortedIntegrationKeys(object map[string]json.RawMessage) []string {
	keys := make([]string, 0, len(object))
	for key := range object {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func credentialBinding(name string) bool {
	name = strings.ToLower(name)
	for _, part := range []string{"authorization", "token", "password", "secret", "api_key", "api-key", "apikey"} {
		if strings.Contains(name, part) {
			return true
		}
	}
	return false
}

func knownHookEvent(event string) bool {
	switch event {
	case "SessionStart", "Setup", "InstructionsLoaded", "UserPromptSubmit", "UserPromptExpansion", "MessageDisplay", "PreToolUse", "PermissionRequest", "PostToolUse", "PostToolUseFailure", "PostToolBatch", "PermissionDenied", "Notification", "SubagentStart", "SubagentStop", "TaskCreated", "TaskCompleted", "Stop", "StopFailure", "TeammateIdle", "ConfigChange", "CwdChanged", "DirectoryAdded", "FileChanged", "WorktreeCreate", "WorktreeRemove", "PreCompact", "PostCompact", "PreModelSwitch", "PostModelSwitch", "SessionEnd", "Elicitation", "ElicitationResult":
		return true
	}
	return false
}
