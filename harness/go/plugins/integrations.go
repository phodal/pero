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
	_, wrapped := root["hooks"]
	for _, key := range sortedIntegrationKeys(root) {
		if key == "hooks" || key == "description" || (!wrapped && knownHookEvent(key)) {
			continue
		}
		add(SeverityWarning, "UNKNOWN_HOOK_FIELD", key, "Unrecognized top-level hook field is not applied.")
	}
	rules, ok := integrationObject(root["hooks"])
	if !ok {
		if bare, bareOK := bareHookEvents(root); bareOK {
			rules = bare
			add(SeverityWarning, "HOOKS_WRAPPER_IMPLIED", "hooks", "A bare event map is accepted. Settings files should wrap events in a hooks object.")
		} else {
			add(SeverityError, "HOOKS_WRAPPER_REQUIRED", "hooks", "Hook configuration requires a top-level hooks object.")
			return result, diagnostics
		}
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
				} else if summary.Type == "http" {
					summary.CommandForm = "http"
					var endpoint string
					if !integrationDecode(handler["url"], &endpoint) || !validHookURL(endpoint) {
						add(SeverityError, "HOOK_URL_REQUIRED", base+".url", "An HTTP hook requires an http or https URL.")
					}
					if raw, present := handler["headers"]; present {
						var headers map[string]string
						if !integrationDecode(raw, &headers) {
							add(SeverityError, "INVALID_HOOK_FIELD", base+".headers", "HTTP hook headers must be an object of strings.")
						}
					}
					if raw, present := handler["allowedEnvVars"]; present {
						var names []string
						if !integrationDecode(raw, &names) {
							add(SeverityError, "INVALID_HOOK_FIELD", base+".allowedEnvVars", "HTTP hook allowedEnvVars must be an array of strings.")
						}
					}
					if summary.Async {
						add(SeverityError, "INVALID_HOOK_FIELD", base+".async", "HTTP hooks cannot be asynchronous.")
					}
				} else if summary.Type == "prompt" {
					summary.CommandForm = "prompt"
					var prompt string
					if !integrationDecode(handler["prompt"], &prompt) || strings.TrimSpace(prompt) == "" {
						add(SeverityError, "HOOK_PROMPT_REQUIRED", base+".prompt", "A prompt hook requires a nonempty prompt.")
					}
					if raw, present := handler["model"]; present {
						var model string
						if !integrationDecode(raw, &model) || strings.TrimSpace(model) == "" {
							add(SeverityError, "INVALID_HOOK_FIELD", base+".model", "Prompt hook model must be a nonempty string.")
						}
					}
					if raw, present := handler["continueOnBlock"]; present {
						var value bool
						if !integrationDecode(raw, &value) {
							add(SeverityError, "INVALID_HOOK_FIELD", base+".continueOnBlock", "Prompt hook continueOnBlock must be a boolean.")
						}
					}
					if summary.Async {
						add(SeverityError, "INVALID_HOOK_FIELD", base+".async", "Prompt hooks cannot be asynchronous.")
					}
				} else if summary.Type == "agent" {
					summary.CommandForm = "agent"
					var prompt string
					if !integrationDecode(handler["prompt"], &prompt) || strings.TrimSpace(prompt) == "" {
						add(SeverityError, "HOOK_PROMPT_REQUIRED", base+".prompt", "An agent hook requires a nonempty prompt.")
					}
					if raw, present := handler["model"]; present {
						var model string
						if !integrationDecode(raw, &model) || strings.TrimSpace(model) == "" {
							add(SeverityError, "INVALID_HOOK_FIELD", base+".model", "Agent hook model must be a nonempty string.")
						}
					}
					if _, present := handler["continueOnBlock"]; present {
						add(SeverityError, "INVALID_HOOK_FIELD", base+".continueOnBlock", "Agent hooks do not accept continueOnBlock.")
					}
				} else if summary.Type == "mcp_tool" {
					summary.CommandForm = "mcp_tool"
					var server, tool string
					if !integrationDecode(handler["server"], &server) || strings.TrimSpace(server) == "" {
						add(SeverityError, "HOOK_MCP_SERVER_REQUIRED", base+".server", "An MCP tool hook requires a server name.")
					}
					if !integrationDecode(handler["tool"], &tool) || strings.TrimSpace(tool) == "" {
						add(SeverityError, "HOOK_MCP_TOOL_REQUIRED", base+".tool", "An MCP tool hook requires a tool name.")
					}
					if raw, present := handler["input"]; present {
						var object map[string]json.RawMessage
						if !integrationDecode(raw, &object) {
							add(SeverityError, "INVALID_HOOK_FIELD", base+".input", "MCP tool hook input must be an object.")
						}
					}
				} else if summary.Type != "command" {
					add(SeverityWarning, "UNSUPPORTED_HOOK_HANDLER", base+".type", "Only command, HTTP, prompt, agent, and MCP tool handler configuration is executed.")
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
				if summary.Async && (summary.Type == "http" || summary.Type == "prompt" || summary.Type == "mcp_tool" || summary.Type == "agent") {
					add(SeverityError, "INVALID_HOOK_FIELD", base+".async", "HTTP, prompt, MCP tool, and agent hooks cannot be asynchronous.")
				}
				if summary.Type == "command" {
					var command string
					if !integrationDecode(handler["command"], &command) || strings.TrimSpace(command) == "" {
						add(SeverityError, "HOOK_COMMAND_REQUIRED", base+".command", "A command hook requires a nonempty command string.")
					}
					summary.CommandForm = "shell"
					if raw, present := handler["args"]; present {
						var args []string
						if !integrationDecode(raw, &args) {
							summary.ArgsPresent = true
							summary.CommandForm = "argv"
							add(SeverityError, "INVALID_HOOK_ARGS", base+".args", "Hook args must be an array of strings.")
						} else if len(args) == 0 && len(strings.Fields(command)) > 1 {
							add(SeverityWarning, "HOOK_EMPTY_ARGS_IGNORED", base+".args", "Empty args on a multi-word command keeps shell form.")
						} else {
							summary.ArgsPresent = true
							summary.CommandForm = "argv"
							if len(args) > 0 {
								parts := strings.Fields(command)
								if len(parts) > 1 {
									switch filepath.Base(parts[0]) {
									case "python", "python3", "node", "nodejs", "bash", "sh", "zsh", "pwsh", "powershell", "ruby", "perl", "php", "bun", "deno":
										add(SeverityError, "HOOK_COMMAND_WITH_ARGS", base+".command", "When args is present, command must name one executable rather than an interpreter with inline arguments.")
									}
								}
							}
						}
					}
				}
				for _, key := range sortedIntegrationKeys(handler) {
					switch key {
					case "type", "command", "args", "timeout", "async", "if", "onFailure", "once", "statusMessage", "shell":
						switch key {
						case "onFailure":
							var value string
							if !integrationDecode(handler[key], &value) || value != "continue" && value != "block" {
								add(SeverityError, "INVALID_HOOK_FIELD", base+".onFailure", "Hook onFailure must be continue or block.")
							}
						case "once":
							var value bool
							if !integrationDecode(handler[key], &value) {
								add(SeverityError, "INVALID_HOOK_FIELD", base+".once", "Hook once must be a boolean. Settings hooks ignore it.")
							}
						case "statusMessage":
							var value string
							if !integrationDecode(handler[key], &value) {
								add(SeverityError, "INVALID_HOOK_FIELD", base+".statusMessage", "Hook statusMessage must be a string.")
							}
						case "shell":
							var value string
							if !integrationDecode(handler[key], &value) || value != "bash" && value != "powershell" {
								add(SeverityError, "INVALID_HOOK_FIELD", base+".shell", "Hook shell must be bash or powershell.")
							}
						}
					case "url", "headers", "allowedEnvVars":
						if summary.Type != "http" {
							add(SeverityWarning, "UNSUPPORTED_HOOK_FIELD", base+"."+key, "This handler field is recognized but its execution semantics are not implemented.")
						}
					case "prompt", "model":
						if summary.Type != "prompt" && summary.Type != "agent" {
							add(SeverityWarning, "UNSUPPORTED_HOOK_FIELD", base+"."+key, "This handler field is recognized but its execution semantics are not implemented.")
						}
					case "continueOnBlock":
						if summary.Type != "prompt" {
							add(SeverityWarning, "UNSUPPORTED_HOOK_FIELD", base+"."+key, "This handler field is recognized but its execution semantics are not implemented.")
						}
					case "server", "tool", "input":
						if summary.Type != "mcp_tool" {
							add(SeverityWarning, "UNSUPPORTED_HOOK_FIELD", base+"."+key, "This handler field is recognized but its execution semantics are not implemented.")
						}
					case "toolName":
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

func bareHookEvents(root map[string]json.RawMessage) (map[string]json.RawMessage, bool) {
	events := map[string]json.RawMessage{}
	for key, raw := range root {
		if !knownHookEvent(key) {
			continue
		}
		var groups []json.RawMessage
		if !integrationDecode(raw, &groups) {
			return nil, false
		}
		events[key] = raw
	}
	return events, len(events) > 0
}

func validHookURL(raw string) bool {
	parsed, err := url.Parse(raw)
	return err == nil && parsed.Host != "" && (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Fragment == ""
}

func knownHookEvent(event string) bool {
	switch event {
	case "SessionStart", "Setup", "InstructionsLoaded", "UserPromptSubmit", "UserPromptExpansion", "MessageDisplay", "PreToolUse", "PermissionRequest", "PostToolUse", "PostToolUseFailure", "PostToolBatch", "PermissionDenied", "Notification", "SubagentStart", "SubagentStop", "TaskCreated", "TaskCompleted", "Stop", "StopFailure", "TeammateIdle", "ConfigChange", "CwdChanged", "DirectoryAdded", "FileChanged", "WorktreeCreate", "WorktreeRemove", "PreCompact", "PostCompact", "PreModelSwitch", "PostModelSwitch", "SessionEnd", "Elicitation", "ElicitationResult":
		return true
	}
	return false
}
