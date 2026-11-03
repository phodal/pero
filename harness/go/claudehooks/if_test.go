package claudehooks

import (
	"encoding/json"
	"testing"
)

func TestHookIfMatchesOfficialBashAndPathRules(t *testing.T) {
	for _, test := range []struct {
		name, rule, event, tool, command, path string
		run                                    bool
	}{
		{name: "empty rule", event: "PreToolUse", tool: "Write", run: true},
		{name: "rule ignored off tool events", rule: "Bash(git *)", event: "SessionStart", tool: "Bash", command: "git status", run: false},
		{name: "leading assignment", rule: "Bash(git *)", event: "PreToolUse", tool: "Bash", command: "FOO=bar git push", run: true},
		{name: "any subcommand", rule: "Bash(git *)", event: "PreToolUse", tool: "Bash", command: "npm test && git push", run: true},
		{name: "no subcommand", rule: "Bash(git *)", event: "PreToolUse", tool: "Bash", command: "npm test", run: false},
		{name: "substitution inner command", rule: "Bash(rm *)", event: "PreToolUse", tool: "Bash", command: "echo $(rm -rf /)", run: true},
		{name: "substitution without match", rule: "Bash(rm *)", event: "PreToolUse", tool: "Bash", command: "echo $(date)", run: false},
		{name: "specific pattern runs on substitution", rule: "Bash(git push *)", event: "PreToolUse", tool: "Bash", command: "echo $(date)", run: true},
		{name: "unparsed redirection runs", rule: "Bash(git *)", event: "PreToolUse", tool: "Bash", command: "git status > log", run: true},
		{name: "different tool", rule: "Bash(git *)", event: "PreToolUse", tool: "Write", path: "main.go", run: false},
		{name: "file in cwd", rule: "Edit(*.ts)", event: "PostToolUse", tool: "Edit", path: "main.ts", run: true},
		{name: "nested file needs globstar", rule: "Edit(*.ts)", event: "PostToolUse", tool: "Edit", path: "src/main.ts", run: false},
		{name: "directory from cwd", rule: "Edit(src/**)", event: "PreToolUse", tool: "Edit", path: "src/main.ts", run: true},
		{name: "same directory name deeper", rule: "Edit(src/**)", event: "PreToolUse", tool: "Edit", path: "lib/src/main.ts", run: false},
		{name: "missing path still runs", rule: "Edit(*.ts)", event: "PreToolUse", tool: "Edit", run: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			input := Input{Event: test.event, ToolName: test.tool, FilePath: test.path}
			if test.command != "" {
				input.ToolInput = []byte(`{"command":` + jsonString(test.command) + `}`)
			}
			if IfMatches(test.rule, input) != test.run {
				t.Fatalf("IfMatches(%q) = %v, want %v", test.rule, !test.run, test.run)
			}
		})
	}
}

func jsonString(value string) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}
