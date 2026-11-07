package mcp

import (
	"strings"
	"testing"
)

func TestToolPolicy(t *testing.T) {
	for _, row := range []struct {
		name   string
		policy *ToolPolicy
		valid  bool
	}{
		{"legacy", nil, true},
		{"default deny", &ToolPolicy{Default: ToolDeny}, true},
		{"rules", &ToolPolicy{Default: ToolAsk, Tools: map[string]ToolDecision{"read": ToolAllow, "write": ToolDeny}}, true},
		{"missing default", &ToolPolicy{}, false},
		{"unknown default", &ToolPolicy{Default: "auto"}, false},
		{"unknown rule", &ToolPolicy{Default: ToolDeny, Tools: map[string]ToolDecision{"write": "auto"}}, false},
		{"empty name", &ToolPolicy{Default: ToolDeny, Tools: map[string]ToolDecision{" ": ToolAllow}}, false},
		{"long name", &ToolPolicy{Default: ToolDeny, Tools: map[string]ToolDecision{strings.Repeat("界", 43): ToolAllow}}, false},
		{"C1 control name", &ToolPolicy{Default: ToolDeny, Tools: map[string]ToolDecision{"write\u0085": ToolAllow}}, false},
		{"control name", &ToolPolicy{Default: ToolDeny, Tools: map[string]ToolDecision{"write\n": ToolAllow}}, false},
	} {
		t.Run(row.name, func(t *testing.T) {
			_, err := row.policy.Freeze()
			if (err == nil) != row.valid {
				t.Fatalf("valid=%v, err=%v", row.valid, err)
			}
		})
	}
	original := &ToolPolicy{Default: ToolDeny, Tools: map[string]ToolDecision{"read-data": ToolAllow, "read_data": ToolAsk}}
	frozen, err := original.Freeze()
	if err != nil {
		t.Fatal(err)
	}
	original.Default = ToolAllow
	original.Tools["read-data"] = ToolDeny
	for name, want := range map[string]ToolDecision{"new-tool": ToolDeny, "read-data": ToolAllow, "read_data": ToolAsk} {
		if got := frozen.Decision(name); got != want {
			t.Fatalf("%s = %s, want %s", name, got, want)
		}
	}
}
