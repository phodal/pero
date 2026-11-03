package shell

import "testing"

func TestClaudeAllowCommands(t *testing.T) {
	for _, test := range []struct {
		name, command string
		want          []string
		ok            bool
	}{
		{name: "simple", command: "git status", want: []string{"git status"}, ok: true},
		{name: "and", command: "git status && npm test", want: []string{"git status", "npm test"}, ok: true},
		{name: "or", command: "npm test || npm run test:ci", want: []string{"npm test", "npm run test:ci"}, ok: true},
		{name: "sequence", command: "false; printf ready", want: []string{"false", "printf ready"}, ok: true},
		{name: "pipe", command: "cat file | wc -l", want: []string{"cat file", "wc -l"}, ok: true},
		{name: "pipe and", command: "make |& tee log", want: []string{"make", "tee log"}, ok: true},
		{name: "newline", command: "git status\nnpm test", want: []string{"git status", "npm test"}, ok: true},
		{name: "background", command: "sleep 1 &", want: []string{"sleep 1"}, ok: true},
		{name: "quoted operators stay inside", command: `grep 'a && b' file`, want: []string{`grep 'a && b' file`}, ok: true},
		{name: "trailing and", command: "npm test &&", ok: false},
		{name: "trailing or", command: "npm test ||", ok: false},
		{name: "substitution", command: "printf $(touch file)", ok: false},
		{name: "redirection", command: "ls > out.txt", ok: false},
		{name: "subshell", command: "(git status)", ok: false},
		{name: "empty and", command: " && npm test", ok: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, ok := ClaudeAllowCommands(test.command)
			if ok != test.ok {
				t.Fatalf("ok=%v want=%v commands=%q", ok, test.ok, got)
			}
			if !ok {
				return
			}
			if len(got) != len(test.want) {
				t.Fatalf("commands=%q want=%q", got, test.want)
			}
			for i := range got {
				if got[i] != test.want[i] {
					t.Fatalf("commands=%q want=%q", got, test.want)
				}
			}
		})
	}
}

func TestClaudeStripAllowWrappers(t *testing.T) {
	for _, test := range []struct {
		name, command, want string
		ok                  bool
	}{
		{name: "timeout", command: "timeout 30 npm test", want: "npm test", ok: true},
		{name: "time", command: "time npm test", want: "npm test", ok: true},
		{name: "nohup", command: "nohup npm test", want: "npm test", ok: true},
		{name: "command", command: "command npm test", want: "npm test", ok: true},
		{name: "command query kept", command: "command -v npm", want: "command -v npm", ok: true},
		{name: "nice", command: "nice -n 10 npm test", want: "npm test", ok: true},
		{name: "stdbuf", command: "stdbuf -oL npm test", want: "npm test", ok: true},
		{name: "xargs", command: "xargs grep pattern", want: "grep pattern", ok: true},
		{name: "xargs flags kept", command: "xargs -n1 grep pattern", want: "xargs -n1 grep pattern", ok: true},
		{name: "safe env", command: "NODE_ENV=test npm test", want: "npm test", ok: true},
		{name: "unknown env refused", command: "SECRET=1 npm test", ok: false},
		{name: "stacked", command: "timeout 5 env npm test", want: "env npm test", ok: true},
		{name: "preserves spelling", command: "timeout 30 git status --short", want: "git status --short", ok: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, ok := ClaudeStripAllowWrappers(test.command)
			if ok != test.ok || got != test.want {
				t.Fatalf("got=%q ok=%v want=%q ok=%v", got, ok, test.want, test.ok)
			}
		})
	}
}

func TestClaudeReadOnlyAllowCommand(t *testing.T) {
	for _, test := range []struct {
		command string
		want    bool
	}{
		{"ls -la", true},
		{"git status", true},
		{"git --no-pager diff", true},
		{"git commit -m x", false},
		{"find . -name '*.go'", true},
		{"find . -delete", false},
		{"npm test", false},
	} {
		if got := ClaudeReadOnlyAllowCommand(test.command); got != test.want {
			t.Fatalf("%q readonly=%v want=%v", test.command, got, test.want)
		}
	}
}
