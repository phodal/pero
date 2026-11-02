package skills

import "testing"

func TestInvocationArguments(t *testing.T) {
	for _, test := range []struct {
		name, content, arguments, want string
		invalid                        bool
	}{
		{"raw", "Topic: $ARGUMENTS", `the "whole topic"`, `Topic: the "whole topic"`, false},
		{"positions", "$0/$ARGUMENTS[1]/$2/$9", `first "two words" 'third'`, "first/two words/third/$9", false},
		{"missing index keeps arguments", "$9", "one", "$9\n\nARGUMENTS: one", false},
		{"empty quoted", "$0,$1", `"" tail`, ",tail", false},
		{"append", "Draft.", "one topic", "Draft.\n\nARGUMENTS: one topic", false},
		{"single pass", "$ARGUMENTS", "$ARGUMENTS ${CLAUDE_SESSION_ID}", "$ARGUMENTS ${CLAUDE_SESSION_ID}", false},
		{"variables", "${CLAUDE_PLUGIN_ROOT}|${CLAUDE_PROJECT_DIR}|${CLAUDE_SESSION_ID}", "", "/plugin|/project|session", false},
		{"unclosed", "$0", `"unfinished`, "", true},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, err := RenderInvocation(Definition{Content: test.content, Claude: true, ResourceBase: "/plugin"}, test.arguments, "session", "/project")
			if (err != nil) != test.invalid {
				t.Fatalf("error: %v", err)
			}
			if !test.invalid && got.Content != test.want {
				t.Fatalf("content=%q want=%q", got.Content, test.want)
			}
		})
	}
}
