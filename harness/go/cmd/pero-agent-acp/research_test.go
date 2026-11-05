package main

import (
	"context"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/subagents"
)

func TestResearchSelectionRequiresActualRuntimePrerequisites(t *testing.T) {
	if profile, err := configuredResearch(context.Background(), researchOptions{}, "", "", false, false, nil); profile != nil || err != nil {
		t.Fatal("unselected research prepared a package")
	}
	for _, test := range []struct {
		options    researchOptions
		workspace  string
		shell, web bool
		routes     []subagents.ModelRoute
		part       string
	}{
		{researchOptions{Python: "python3"}, "", false, false, nil, "requires --research-source"},
		{researchOptions{Source: "selected"}, "workspace", false, true, nil, "--enable-shell"},
		{researchOptions{Source: "selected"}, "workspace", true, false, nil, "--web-provider"},
		{researchOptions{Source: "selected"}, "workspace", true, true, nil, "--research-python"},
		{researchOptions{Source: "selected", Python: "python3"}, "workspace", true, true, nil, "opus"},
	} {
		if _, err := configuredResearch(context.Background(), test.options, t.TempDir(), test.workspace, test.shell, test.web, test.routes); err == nil || !strings.Contains(err.Error(), test.part) {
			t.Fatalf("prerequisite did not fail before execution: %v", err)
		}
	}
}
