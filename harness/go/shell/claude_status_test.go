package shell

import "testing"

func TestSkillCommandExitStatus(t *testing.T) {
	for _, test := range []struct {
		name, command string
		exit          int
		missing       bool
		valid         bool
	}{
		{name: "ordinary success", command: "printf ready", valid: true},
		{name: "successful compound", command: "false; printf ready", valid: true},
		{name: "no exit status", command: "grep missing file", missing: true},
		{name: "grep", command: "grep missing file", exit: 1, valid: true},
		{name: "rg", command: "rg missing .", exit: 1, valid: true},
		{name: "egrep", command: "egrep missing file", exit: 1, valid: true},
		{name: "fgrep", command: "fgrep missing file", exit: 1, valid: true},
		{name: "find", command: "find . -name missing", exit: 1, valid: true},
		{name: "diff", command: "diff a b", exit: 1, valid: true},
		{name: "test", command: "test -f missing", exit: 1, valid: true},
		{name: "bracket", command: "[ -f missing ]", exit: 1, valid: true},
		{name: "git diff", command: "git diff --exit-code", exit: 1, valid: true},
		{name: "git grep", command: "git grep missing", exit: 1, valid: true},
		{name: "git directory option", command: "git -C 'directory with spaces' diff --exit-code", exit: 1, valid: true},
		{name: "git attached directory option", command: "git -C./fixture grep missing", exit: 1, valid: true},
		{name: "git paging option", command: "git --no-pager -C . diff", exit: 1, valid: true},
		{name: "absolute executable", command: "/usr/bin/grep missing file", exit: 1, valid: true},
		{name: "quoted executable", command: "'/usr/bin/grep' missing file", exit: 1, valid: true},
		{name: "quoted operators are arguments", command: "grep 'a; b | c && d' file", exit: 1, valid: true},
		{name: "double quoted operators are arguments", command: "grep \"a; b | c && d\" file", exit: 1, valid: true},
		{name: "escaped operators are arguments", command: "grep a\\;b file", exit: 1, valid: true},
		{name: "single quoted substitution is literal", command: "grep '$(false) `false` $TERM' file", exit: 1, valid: true},
		{name: "escaped substitution is literal", command: "grep \"\\$(false) \\`false\\`\" file", exit: 1, valid: true},
		{name: "surrounding whitespace", command: " \tgrep missing file\n", exit: 1, valid: true},
		{name: "pgrep excluded", command: "pgrep missing", exit: 1},
		{name: "jq excluded", command: "jq -e false file", exit: 1},
		{name: "cmp excluded", command: "cmp a b", exit: 1},
		{name: "ordinary failure", command: "false", exit: 1},
		{name: "error status always fails", command: "grep missing file", exit: 2},
		{name: "negative status fails", command: "grep missing file", exit: -1},
		{name: "large status fails", command: "git diff", exit: 128},
		{name: "unrelated git subcommand", command: "git status", exit: 1},
		{name: "git without subcommand", command: "git --no-pager", exit: 1},
		{name: "git missing directory argument", command: "git -C", exit: 1},
		{name: "unclassified git option", command: "git --unknown diff", exit: 1},
		{name: "wrapper is not inferred", command: "env grep missing file", exit: 1},
		{name: "assignment prefix is not inferred", command: "TERM=dumb grep missing file", exit: 1},
		{name: "sequence", command: "grep missing file; false", exit: 1},
		{name: "newline sequence", command: "grep missing file\nfalse", exit: 1},
		{name: "conditional", command: "grep missing file && false", exit: 1},
		{name: "alternative", command: "grep missing file || false", exit: 1},
		{name: "pipeline", command: "grep missing file | false", exit: 1},
		{name: "background", command: "grep missing file &", exit: 1},
		{name: "redirection", command: "grep missing file > output", exit: 1},
		{name: "input redirection", command: "grep missing < file", exit: 1},
		{name: "subshell", command: "(grep missing file)", exit: 1},
		{name: "command substitution", command: "grep $(false) file", exit: 1},
		{name: "quoted command substitution", command: "grep \"$(false)\" file", exit: 1},
		{name: "backtick substitution", command: "grep `false` file", exit: 1},
		{name: "variable expansion remains unclassified", command: "grep \"$TERM\" file", exit: 1},
		{name: "comment syntax remains unclassified", command: "grep missing file # comment", exit: 1},
		{name: "unterminated quote", command: "grep 'missing file", exit: 1},
		{name: "trailing escape", command: "grep missing file\\", exit: 1},
		{name: "empty", exit: 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			code := test.exit
			var status *int
			if !test.missing {
				status = &code
			}
			if got := ClaudeCommandSucceeded(test.command, status); got != test.valid {
				t.Fatalf("ClaudeCommandSucceeded(%q, %v) = %v, want %v", test.command, status, got, test.valid)
			}
		})
	}
}
