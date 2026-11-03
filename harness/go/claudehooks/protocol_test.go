package claudehooks

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestMessageDisplayReadsNestedDisplayContent(t *testing.T) {
	got, err := ParseDecision("MessageDisplay", []byte(`{"hookSpecificOutput":{"hookEventName":"MessageDisplay","displayContent":"shown"}}`), nil, 0)
	if err != nil || got.DisplayContent == nil || *got.DisplayContent != "shown" || got.AdditionalContext != "" || got.SystemMessage != "" {
		t.Fatalf("nested = %+v %v", got, err)
	}
	got, err = ParseDecision("MessageDisplay", []byte(`{"displayContent":""}`), nil, 0)
	if err != nil || got.DisplayContent == nil || *got.DisplayContent != "" {
		t.Fatalf("empty = %+v %v", got, err)
	}
	got, err = ParseDecision("MessageDisplay", []byte(`{"systemMessage":"hidden","continue":false}`), nil, 0)
	if err != nil || got.DisplayContent != nil || got.SystemMessage != "" || got.Stop {
		t.Fatalf("discarded = %+v %v", got, err)
	}
}

func TestMatcher(t *testing.T) {
	for _, test := range []struct {
		pattern, value string
		match, fail    bool
	}{
		{"", "Write", true, false},
		{"*", "Stop", true, false},
		{"Write", "Write", true, false},
		{"Write", "WriteMore", false, false},
		{"Write|Edit", "Edit", true, false},
		{"Write, Edit", "Edit", true, false},
		{"Write|Edit", "NotebookEdit", false, false},
		{`mcp__.*`, "mcp__memory__save", true, false},
		{`^(Write|Edit)$`, "Edit", true, false},
		{`^(Write|Edit)$`, "NotebookEdit", false, false},
		{`Write.*`, "WriteMore", true, false},
		{`(?=Write)`, "Write", false, true},
		{`(Write)\1`, "WriteWrite", false, true},
		{"[", "Write", false, true},
	} {
		t.Run(test.pattern+"/"+test.value, func(t *testing.T) {
			match, err := Match(test.pattern, test.value)
			if match != test.match || (err != nil) != test.fail {
				t.Fatalf("match=%v error=%v", match, err)
			}
		})
	}
}

func TestCommandDecision(t *testing.T) {
	for _, test := range []struct {
		name, event, stdout, stderr string
		exit                        int
		permission, reason, context string
		block, stop, fail           bool
		patch                       string
	}{
		{name: "allow and replace input", event: "PreToolUse", stdout: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","updatedInput":{"file_path":"report.md"}}}`, permission: "allow", patch: `{"file_path":"report.md"}`},
		{name: "deny", event: "PreToolUse", stdout: `{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"write gate"}}`, permission: "deny", reason: "write gate", block: true},
		{name: "ask", event: "PreToolUse", stdout: `{"hookSpecificOutput":{"permissionDecision":"ask","permissionDecisionReason":"confirm"}}`, permission: "ask", reason: "confirm"},
		{name: "exit two overrides allow", event: "PreToolUse", exit: 2, stdout: `{"hookSpecificOutput":{"permissionDecision":"allow"}}`, stderr: "exit gate", permission: "deny", reason: "exit gate", block: true},
		{name: "exit two JSON reason wins", event: "Stop", exit: 2, stdout: `{"decision":"block","reason":"JSON gate"}`, stderr: "stderr gate", reason: "JSON gate", block: true},
		{name: "exit two invalid JSON still blocks", event: "Stop", exit: 2, stdout: "{", stderr: "stderr gate", reason: "stderr gate", block: true},
		{name: "exit two plain stdout is the reason", event: "PreToolUse", exit: 2, stdout: "read only\n", permission: "deny", reason: "read only", block: true},
		{name: "observational event cannot block", event: "SessionStart", exit: 2, stderr: "failure", fail: true},
		{name: "ordinary failure is not a block", event: "Stop", exit: 7, stderr: "failure", fail: true},
		{name: "stop gate continues agent", event: "Stop", stdout: `{"decision":"block","reason":"incomplete"}`, reason: "incomplete", block: true},
		{name: "subagent start cannot block or stop", event: "SubagentStart", stdout: `{"decision":"block","continue":false,"stopReason":"ignored","hookSpecificOutput":{"additionalContext":"child context"}}`, context: "child context"},
		{name: "subagent start exit two is nonblocking", event: "SubagentStart", exit: 2, stderr: "ignored", fail: true},
		{name: "subagent stop gate continues child", event: "SubagentStop", stdout: `{"decision":"block","reason":"finish the review"}`, reason: "finish the review", block: true},
		{name: "continue false ends processing", event: "Stop", stdout: `{"continue":false,"stopReason":"finished"}`, reason: "finished", stop: true},
		{name: "PreCompact block ignores run control and messages", event: "PreCompact", stdout: `{"decision":"block","reason":"checkpoint missing","continue":false,"systemMessage":"discarded","additionalContext":"discarded"}`, reason: "checkpoint missing", block: true},
		{name: "session plain context", event: "SessionStart", stdout: " restored context\n", context: "restored context"},
		{name: "prompt plain context", event: "UserPromptSubmit", stdout: "extra instructions", context: "extra instructions"},
		{name: "tool plain output does not become context", event: "PreToolUse", stdout: "unstructured diagnostic"},
		{name: "tool result context", event: "PostToolUse", stdout: `{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"update documentation"}}`, context: "update documentation"},
		{name: "event identity cannot drift", event: "PreToolUse", stdout: `{"hookSpecificOutput":{"hookEventName":"Stop","permissionDecision":"deny"}}`, fail: true},
		{name: "unknown permission cannot silently pass", event: "PreToolUse", stdout: `{"hookSpecificOutput":{"permissionDecision":"defer"}}`, fail: true},
		{name: "patch must be an object", event: "PreToolUse", stdout: `{"hookSpecificOutput":{"updatedInput":[]}}`, fail: true},
		{name: "patch cannot change completed tool", event: "PostToolUse", stdout: `{"hookSpecificOutput":{"updatedInput":{}}}`, fail: true},
		{name: "malformed JSON fails visibly", event: "Stop", stdout: "{", fail: true},
		{name: "unsupported output is diagnosed", event: "Stop", stdout: `{"unsupportedDecision":true}`, fail: true},
		{name: "empty success", event: "Stop"},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, err := ParseDecision(test.event, []byte(test.stdout), []byte(test.stderr), test.exit)
			if (err != nil) != test.fail {
				t.Fatalf("decision=%+v error=%v", got, err)
			}
			if test.fail {
				if test.exit != 0 && !strings.Contains(err.Error(), "non-blocking") {
					t.Errorf("ordinary hook failure must be identified as non-blocking: %v", err)
				}
				return
			}
			if got.Permission != test.permission || got.Reason != test.reason || got.AdditionalContext != test.context || got.Block != test.block || got.Stop != test.stop {
				t.Fatalf("unexpected decision: %+v", got)
			}
			if test.event == "PreCompact" && got.SystemMessage != "" {
				t.Error("PreCompact must discard systemMessage")
			}
			if string(got.UpdatedInput) != test.patch {
				t.Errorf("patch=%s want %s", got.UpdatedInput, test.patch)
			}
		})
	}
}

func TestDecisionAggregation(t *testing.T) {
	for _, test := range []struct {
		name        string
		decisions   []Decision
		permission  string
		reason      string
		context     string
		block, stop bool
		fail        bool
	}{
		{name: "deny has precedence", decisions: []Decision{{Permission: "allow", Reason: "allow"}, {Permission: "deny", Reason: "deny"}, {Permission: "ask", Reason: "ask"}}, permission: "deny", reason: "deny", block: true},
		{name: "ask precedes allow", decisions: []Decision{{Permission: "allow"}, {Permission: "ask", Reason: "ask"}}, permission: "ask", reason: "ask"},
		{name: "contexts accumulate", decisions: []Decision{{AdditionalContext: "first"}, {AdditionalContext: "second"}}, context: "first\nsecond"},
		{name: "stop reason has precedence", decisions: []Decision{{Permission: "deny", Reason: "deny"}, {Stop: true, Reason: "stop"}}, permission: "deny", reason: "stop", block: true, stop: true},
		{name: "same patch with reordered fields is compatible", decisions: []Decision{{UpdatedInput: json.RawMessage(`{"a":1,"b":{"x":2,"y":3}}`)}, {UpdatedInput: json.RawMessage(`{"b":{"y":3,"x":2},"a":1}`)}}},
		{name: "different patches conflict", decisions: []Decision{{UpdatedInput: json.RawMessage(`{"a":1}`)}, {UpdatedInput: json.RawMessage(`{"a":2}`)}}, fail: true},
		{name: "non object patch is rejected", decisions: []Decision{{UpdatedInput: json.RawMessage(`[]`)}}, fail: true},
		{name: "unknown permission is rejected", decisions: []Decision{{Permission: "unknown"}}, fail: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, err := Merge(test.decisions)
			if (err != nil) != test.fail {
				t.Fatalf("decision=%+v error=%v", got, err)
			}
			if test.fail {
				return
			}
			if got.Permission != test.permission || got.Reason != test.reason || got.AdditionalContext != test.context || got.Block != test.block || got.Stop != test.stop {
				t.Errorf("unexpected aggregate: %+v", got)
			}
		})
	}
}

func TestTerminalSequenceStaysOnTheDecision(t *testing.T) {
	got, err := ParseDecision("Stop", []byte(`{"terminalSequence":"\u0007"}`), nil, 0)
	if err != nil || got.TerminalSequence != "\a" {
		t.Fatalf("sequence = %q %v", got.TerminalSequence, err)
	}
}

func TestSessionStartTitleParsesAlongsideTheOtherFields(t *testing.T) {
	got, err := ParseDecision("SessionStart", []byte(`{"hookSpecificOutput":{"hookEventName":"SessionStart","sessionTitle":"auth-refactor","initialUserMessage":"begin","reloadSkills":true,"additionalContext":"branch"}}`), nil, 0)
	if err != nil || got.SessionTitle != "auth-refactor" || got.InitialUserMessage != "begin" || !got.ReloadSkills || got.AdditionalContext != "branch" {
		t.Fatalf("title = %+v %v", got, err)
	}
}

func TestSessionStartAndCwdChangedKeepWatchPaths(t *testing.T) {
	for _, event := range []string{"SessionStart", "CwdChanged", "FileChanged"} {
		got, err := ParseDecision(event, []byte(`{"hookSpecificOutput":{"hookEventName":"`+event+`","watchPaths":[]}}`), nil, 0)
		if err != nil || got.WatchPaths == nil || len(got.WatchPaths) != 0 {
			t.Fatalf("%s empty = %+v %v", event, got.WatchPaths, err)
		}
		got, err = ParseDecision(event, []byte(`{"hookSpecificOutput":{"hookEventName":"`+event+`","watchPaths":["/tmp/a"]}}`), nil, 0)
		if err != nil || len(got.WatchPaths) != 1 || got.WatchPaths[0] != "/tmp/a" {
			t.Fatalf("%s paths = %+v %v", event, got.WatchPaths, err)
		}
	}
}

func TestSessionPermissionUpdatesKeepOnlySessionRules(t *testing.T) {
	got, err := ParseDecision("PermissionRequest", []byte(`{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow","updatedPermissions":[{"type":"addRules","behavior":"allow","destination":"session","rules":[{"toolName":"Bash","ruleContent":"printf *"}]},{"type":"addRules","behavior":"allow","destination":"userSettings","rules":[{"toolName":"Write"}]},{"type":"setMode","mode":"acceptEdits","destination":"localSettings"}]}}}`), nil, 0)
	if err != nil || len(got.SessionPermissions) != 1 || got.SessionPermissions[0].Op != "add" || got.SessionPermissions[0].Behavior != "allow" || len(got.SessionPermissions[0].Rules) != 1 || got.SessionPermissions[0].Rules[0] != "Bash(printf *)" {
		t.Fatalf("updates = %+v %v", got.SessionPermissions, err)
	}
	if _, err := ParseDecision("PermissionRequest", []byte(`{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow","updatedPermissions":[{"type":"invented"}]}}}`), nil, 0); err == nil || !strings.Contains(err.Error(), "unsupported") {
		t.Fatal(err)
	}
}

func TestElicitationDecisions(t *testing.T) {
	for _, test := range []struct {
		name, stdout, action, content string
		exit                          int
	}{
		{name: "accept", stdout: `{"hookSpecificOutput":{"hookEventName":"Elicitation","action":"accept","content":{"project_key":"DOCS"}}}`, action: "accept", content: `{"project_key":"DOCS"}`},
		{name: "exit 2 declines and ignores the answer", stdout: `{"hookSpecificOutput":{"hookEventName":"Elicitation","action":"accept","content":{"project_key":"DOCS"}}}`, exit: 2, action: "decline"},
		{name: "block overrides accept", stdout: `{"decision":"block","reason":"no","hookSpecificOutput":{"hookEventName":"Elicitation","action":"accept","content":{"project_key":"DOCS"}}}`, action: "decline"},
		{name: "silence leaves the dialog", stdout: ``},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, err := ParseDecision("Elicitation", []byte(test.stdout), nil, test.exit)
			if err != nil || got.Action != test.action || string(got.Content) != test.content || got.Reason != "" || got.SystemMessage != "" || got.Stop {
				t.Fatalf("decision=%+v content=%s err=%v", got, got.Content, err)
			}
		})
	}
}
