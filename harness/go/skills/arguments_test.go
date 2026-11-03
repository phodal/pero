package skills

import (
	"os"
	"path/filepath"
	"testing"
)

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

func TestSkillBodySubstitutesPluginDataDirectory(t *testing.T) {
	home := t.TempDir()
	t.Setenv("PERO_PLUGIN_DATA_HOME", home)
	got, err := RenderInvocation(Definition{Summary: Summary{Name: "sample:draft"}, Content: "data=${CLAUDE_PLUGIN_DATA}", Claude: true, ResourceBase: "/plugin"}, "", "session", "/project")
	if err != nil {
		t.Fatal(err)
	}
	directory := filepath.Join(home, "sample")
	info, statErr := os.Stat(directory)
	if statErr != nil || !info.IsDir() || got.Content != "data="+directory {
		t.Fatalf("content=%q directory=%v", got.Content, statErr)
	}
}
