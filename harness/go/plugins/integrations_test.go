package plugins

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestHookInspection(t *testing.T) {
	tests := []struct {
		name       string
		content    string
		count      int
		form       string
		args       bool
		timeout    float64
		async      bool
		codes      []string
		errorCodes []string
	}{
		{
			name:    "prompt hook is executable configuration",
			content: `{"hooks":{"Stop":[{"hooks":[{"type":"prompt","prompt":"Check $ARGUMENTS","model":"fixture","continueOnBlock":true}]}]}}`,
			count:   1, form: "prompt",
			codes: []string{"HOOK_RUNTIME_UNSUPPORTED"},
		},
		{
			name:    "http hook is executable configuration",
			content: `{"hooks":{"PreToolUse":[{"matcher":"Write","hooks":[{"type":"http","url":"http://127.0.0.1/hooks","headers":{"Authorization":"Bearer hidden-token"},"allowedEnvVars":["TOKEN"]}]}]}}`,
			count:   1, form: "http",
			codes: []string{"HOOK_RUNTIME_UNSUPPORTED"},
		},
		{
			name:    "shell command remains inert",
			content: `{"hooks":{"PreToolUse":[{"matcher":"Write|Edit","hooks":[{"type":"command","command":"node /private/check.mjs --secret hidden-argument","timeout":5}]}]}}`,
			count:   1, form: "shell", timeout: 5,
			codes: []string{"HOOK_RUNTIME_UNSUPPORTED"},
		},
		{
			name:    "empty args selects direct execution",
			content: `{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"python3","args":[],"async":true,"timeout":120}]}]}}`,
			count:   1, form: "argv", args: true, timeout: 120, async: true,
			codes: []string{"HOOK_RUNTIME_UNSUPPORTED"},
		},
		{
			name:    "absolute executable path may contain spaces",
			content: `{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"/Applications/My Tool/check","args":["hidden-argument"]}]}]}}`,
			count:   1, form: "argv", args: true, codes: []string{"HOOK_RUNTIME_UNSUPPORTED"},
		},
		{
			name:    "inline arguments are invalid in argv form",
			content: `{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"python3 /private/check.py","args":["hidden-argument"]}]}]}}`,
			count:   1, form: "argv", args: true,
			codes:      []string{"HOOK_COMMAND_WITH_ARGS", "HOOK_RUNTIME_UNSUPPORTED"},
			errorCodes: []string{"HOOK_COMMAND_WITH_ARGS"},
		},
		{
			name:    "absolute interpreter cannot include inline arguments",
			content: `{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"/usr/bin/python3 /private/check.py","args":["hidden-argument"]}]}]}}`,
			count:   1, form: "argv", args: true,
			codes:      []string{"HOOK_COMMAND_WITH_ARGS", "HOOK_RUNTIME_UNSUPPORTED"},
			errorCodes: []string{"HOOK_COMMAND_WITH_ARGS"},
		},
		{
			name:    "bare event map is accepted",
			content: `{"PreToolUse":[{"matcher":"Write","hooks":[{"type":"command","command":"true"}]}]}`,
			count:   1, form: "shell",
			codes: []string{"HOOKS_WRAPPER_IMPLIED", "HOOK_RUNTIME_UNSUPPORTED"},
		},
		{
			name:    "empty args stays shell form",
			content: `{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"python3 /private/check.py","args":[]}]}]}}`,
			count:   1, form: "shell",
			codes: []string{"HOOK_EMPTY_ARGS_IGNORED", "HOOK_RUNTIME_UNSUPPORTED"},
		},
		{
			name:       "wrapper is required",
			content:    `{"description":"notes"}`,
			codes:      []string{"HOOKS_WRAPPER_REQUIRED"},
			errorCodes: []string{"HOOKS_WRAPPER_REQUIRED"},
		},
		{
			name:    "stop matcher has no effect",
			content: `{"hooks":{"Stop":[{"matcher":"*","hooks":[{"type":"command","command":"node guard.mjs"}]}]}}`,
			count:   1, form: "shell", codes: []string{"HOOK_MATCHER_IGNORED", "HOOK_RUNTIME_UNSUPPORTED"},
		},
		{
			name:    "unsupported handler is not represented as executable",
			content: `{"hooks":{"Stop":[{"hooks":[{"type":"agent","prompt":"sensitive-handler-content"}]}]}}`,
			count:   1, codes: []string{"UNSUPPORTED_HOOK_HANDLER", "UNSUPPORTED_HOOK_FIELD", "HOOK_RUNTIME_UNSUPPORTED"},
		},
		{
			name:    "unknown event and handler field are visible",
			content: `{"hooks":{"FutureEvent":[{"hooks":[{"type":"command","command":"true","futureField":true}]}]}}`,
			count:   1, form: "shell", codes: []string{"UNSUPPORTED_HOOK_EVENT", "UNKNOWN_HOOK_FIELD", "HOOK_RUNTIME_UNSUPPORTED"},
		},
		{
			name:    "malformed typed values",
			content: `{"hooks":{"PreToolUse":[{"matcher":false,"hooks":[{"type":"command","command":"","args":null,"async":"yes","timeout":0}]}]}}`,
			count:   1, form: "argv", args: true,
			codes:      []string{"INVALID_HOOK_MATCHER", "INVALID_HOOK_TIMEOUT", "INVALID_HOOK_ASYNC", "HOOK_COMMAND_REQUIRED", "INVALID_HOOK_ARGS", "HOOK_RUNTIME_UNSUPPORTED"},
			errorCodes: []string{"INVALID_HOOK_MATCHER", "INVALID_HOOK_TIMEOUT", "INVALID_HOOK_ASYNC", "HOOK_COMMAND_REQUIRED", "INVALID_HOOK_ARGS"},
		},
		{
			name: "event object is not a rule array", content: `{"hooks":{"Stop":{}}}`,
			codes: []string{"INVALID_HOOK_RULES"}, errorCodes: []string{"INVALID_HOOK_RULES"},
		},
		{
			name: "null is not a hook object", content: " \n null ",
			codes: []string{"INVALID_HOOKS"}, errorCodes: []string{"INVALID_HOOKS"},
		},
		{
			name:    "settings once and display fields stay inspectable",
			content: `{"hooks":{"PreToolUse":[{"hooks":[{"type":"command","command":"true","once":true,"statusMessage":"Checking","shell":"bash"}]}]}}`,
			count:   1, form: "shell",
			codes: []string{"HOOK_RUNTIME_UNSUPPORTED"},
		},
		{
			name:    "shell must be bash or powershell",
			content: `{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"true","shell":"zsh"}]}]}}`,
			count:   1, form: "shell",
			codes:      []string{"INVALID_HOOK_FIELD", "HOOK_RUNTIME_UNSUPPORTED"},
			errorCodes: []string{"INVALID_HOOK_FIELD"},
		},
		{name: "empty hooks", content: `{"hooks":{}}`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			definition, diagnostics := ParseHooks("hooks/hooks.json", []byte(tc.content))
			if !definition.InspectionOnly || len(definition.Hooks) != tc.count {
				t.Fatalf("unexpected inspection shape: %+v", definition)
			}
			if tc.count == 1 {
				h := definition.Hooks[0]
				if h.CommandForm != tc.form || h.ArgsPresent != tc.args || h.Async != tc.async || h.RuntimeSupported {
					t.Errorf("unexpected handler configuration: %+v", h)
				}
				if tc.timeout != 0 && (h.TimeoutSeconds == nil || *h.TimeoutSeconds != tc.timeout) {
					t.Errorf("timeout must preserve seconds: %+v", h)
				}
			}
			checkIntegrationDiagnostics(t, diagnostics, "hooks/hooks.json", tc.codes, tc.errorCodes)
			encoded, err := json.Marshal(struct {
				Definition  HooksDefinition
				Diagnostics []Diagnostic
			}{definition, diagnostics})
			if err != nil {
				t.Fatal(err)
			}
			for _, sensitive := range []string{"/private/check", "hidden-argument", "sensitive-handler-content"} {
				if strings.Contains(string(encoded), sensitive) {
					t.Errorf("inspection exposed handler content: %s", sensitive)
				}
			}
		})
	}
}

func TestMCPInspection(t *testing.T) {
	tests := []struct {
		name       string
		content    string
		count      int
		transport  string
		inferred   bool
		literal    bool
		env        []string
		headers    []string
		timeout    float64
		codes      []string
		errorCodes []string
	}{
		{
			name:    "wrapped stdio preserves binding keys only",
			content: `{"mcpServers":{"memory":{"command":"python3","args":["/private/server.py","sensitive-argument"],"env":{"TOKEN":"${TOKEN}","PROJECT":"${PROJECT}"}}}}`,
			count:   1, transport: "stdio", inferred: true, env: []string{"PROJECT", "TOKEN"},
			codes: []string{"MCP_RUNTIME_UNSUPPORTED"},
		},
		{
			name:    "inline remote preserves timeout units and warns on ignored value",
			content: `{"search":{"type":"http","url":"https://hidden-endpoint.invalid/mcp","headers":{"Authorization":"Bearer hidden-credential","X-Client":"hidden-header"},"timeout":120}}`,
			count:   1, transport: "http", literal: true, headers: []string{"Authorization", "X-Client"}, timeout: 120,
			codes: []string{"MCP_TIMEOUT_IGNORED", "MCP_LITERAL_CREDENTIAL", "MCP_RUNTIME_UNSUPPORTED"},
		},
		{
			name:    "inferred HTTP keeps endpoint and credentials out of report",
			content: `{"mcpServers":{"search":{"url":"${SERVER_URL}","headers":{"Authorization":"Bearer ${TOKEN}"}}}}`,
			count:   1, transport: "http", inferred: true, headers: []string{"Authorization"},
			codes: []string{"MCP_RUNTIME_UNSUPPORTED"},
		},
		{
			name:    "SSE is distinct from HTTP",
			content: `{"events":{"type":"sse","url":"https://hidden-endpoint.invalid/events","timeout":120000}}`,
			count:   1, transport: "sse", timeout: 120000, codes: []string{"MCP_RUNTIME_UNSUPPORTED"},
		},
		{
			name:    "literal environment credential",
			content: `{"memory":{"type":"stdio","command":"python3","env":{"API_TOKEN":"hidden-env-secret"}}}`,
			count:   1, transport: "stdio", env: []string{"API_TOKEN"}, literal: true,
			codes: []string{"MCP_LITERAL_CREDENTIAL", "MCP_RUNTIME_UNSUPPORTED"},
		},
		{
			name:    "invalid stdio fields",
			content: `{"memory":{"type":"stdio","args":"hidden-argument","env":{"TOKEN":false},"timeout":-2}}`,
			count:   1, transport: "stdio", env: []string{"TOKEN"},
			codes:      []string{"MCP_COMMAND_REQUIRED", "INVALID_MCP_ARGS", "INVALID_MCP_BINDING", "INVALID_MCP_TIMEOUT", "MCP_RUNTIME_UNSUPPORTED"},
			errorCodes: []string{"MCP_COMMAND_REQUIRED", "INVALID_MCP_ARGS", "INVALID_MCP_BINDING", "INVALID_MCP_TIMEOUT"},
		},
		{
			name:    "invalid remote URL",
			content: `{"memory":{"type":"http","url":"file:///hidden-path"}}`,
			count:   1, transport: "http", codes: []string{"INVALID_MCP_URL", "MCP_RUNTIME_UNSUPPORTED"}, errorCodes: []string{"INVALID_MCP_URL"},
		},
		{
			name:    "unknown transport and field",
			content: `{"search":{"type":"future-transport","futureField":"hidden-field-value"}}`,
			count:   1, transport: "future-transport", codes: []string{"UNSUPPORTED_MCP_TRANSPORT", "UNKNOWN_MCP_FIELD", "MCP_RUNTIME_UNSUPPORTED"},
		},
		{
			name: "null server map", content: `{"mcpServers":null}`,
			codes: []string{"INVALID_MCP_SERVERS"}, errorCodes: []string{"INVALID_MCP_SERVERS"},
		},
		{
			name: "non-object root", content: `[]`,
			codes: []string{"INVALID_MCP"}, errorCodes: []string{"INVALID_MCP"},
		},
		{name: "empty servers", content: `{"mcpServers":{}}`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			definition, diagnostics := ParseMCP(".mcp.json", []byte(tc.content))
			if !definition.InspectionOnly || len(definition.Servers) != tc.count {
				t.Fatalf("unexpected inspection shape: %+v", definition)
			}
			if tc.count == 1 {
				s := definition.Servers[0]
				if s.Transport != tc.transport || s.TransportInferred != tc.inferred || s.CredentialLiteralPresent != tc.literal || s.RuntimeSupported {
					t.Errorf("unexpected server configuration: %+v", s)
				}
				if !reflect.DeepEqual(s.EnvironmentKeys, tc.env) || !reflect.DeepEqual(s.HeaderKeys, tc.headers) {
					t.Errorf("unexpected binding keys: %+v", s)
				}
				if tc.timeout != 0 && (s.TimeoutMilliseconds == nil || *s.TimeoutMilliseconds != tc.timeout) {
					t.Errorf("timeout must preserve milliseconds: %+v", s)
				}
			}
			checkIntegrationDiagnostics(t, diagnostics, ".mcp.json", tc.codes, tc.errorCodes)
			encoded, err := json.Marshal(struct {
				Definition  MCPDefinition
				Diagnostics []Diagnostic
			}{definition, diagnostics})
			if err != nil {
				t.Fatal(err)
			}
			for _, sensitive := range []string{"/private/server", "sensitive-argument", "hidden-endpoint", "hidden-credential", "hidden-header", "hidden-env-secret", "hidden-argument", "hidden-path", "hidden-field-value", "${TOKEN}", "${SERVER_URL}"} {
				if strings.Contains(string(encoded), sensitive) {
					t.Errorf("inspection exposed server content: %s", sensitive)
				}
			}
		})
	}
}

func TestMCPDefinitionMerge(t *testing.T) {
	tests := []struct {
		name     string
		earlier  []MCPServerSummary
		later    []MCPServerSummary
		expected []MCPServerSummary
	}{
		{
			name:     "later definition replaces in original position",
			earlier:  []MCPServerSummary{{Name: "second", Transport: "stdio"}, {Name: "first", Transport: "stdio"}},
			later:    []MCPServerSummary{{Name: "first", Transport: "http"}, {Name: "third", Transport: "sse"}, {Name: "second", Transport: "http"}},
			expected: []MCPServerSummary{{Name: "second", Transport: "http"}, {Name: "first", Transport: "http"}, {Name: "third", Transport: "sse"}},
		},
		{
			name:     "last definition of a newly introduced server wins",
			later:    []MCPServerSummary{{Name: "new", Transport: "stdio"}, {Name: "new", Transport: "http"}},
			expected: []MCPServerSummary{{Name: "new", Transport: "http"}},
		},
		{name: "empty definitions remain inspection only", expected: []MCPServerSummary{}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			original, err := json.Marshal(tc.earlier)
			if err != nil {
				t.Fatal(err)
			}
			got := (MCPDefinition{Servers: tc.earlier}).Merge(MCPDefinition{Servers: tc.later})
			if !got.InspectionOnly || !reflect.DeepEqual(got.Servers, tc.expected) {
				t.Errorf("merge result = %+v, want %+v", got, tc.expected)
			}
			unchanged, err := json.Marshal(tc.earlier)
			if err != nil {
				t.Fatal(err)
			}
			if string(unchanged) != string(original) {
				t.Error("merge mutated the earlier server definitions")
			}
		})
	}
}

func checkIntegrationDiagnostics(t *testing.T, diagnostics []Diagnostic, path string, codes, errorCodes []string) {
	t.Helper()
	var gotCodes, gotErrors []string
	for _, d := range diagnostics {
		if d.Path != path || d.Message == "" {
			t.Errorf("diagnostic has no source or explanation: %+v", d)
		}
		gotCodes = append(gotCodes, d.Code)
		if d.Severity == SeverityError {
			gotErrors = append(gotErrors, d.Code)
		}
	}
	if !reflect.DeepEqual(gotCodes, codes) || !reflect.DeepEqual(gotErrors, errorCodes) {
		t.Errorf("diagnostics codes=%v errors=%v, want codes=%v errors=%v", gotCodes, gotErrors, codes, errorCodes)
	}
}
