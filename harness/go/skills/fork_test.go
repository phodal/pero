package skills

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
)

func TestForkResultRetainsTerminalStatus(t *testing.T) {
	h, err := harness.Boot(t.Context(), harness.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Dispose(context.Background())
	parent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "fork-result-parent"})
	if err != nil {
		t.Fatal(err)
	}
	for _, status := range []harness.SubagentStatus{harness.SubagentCompleted, harness.SubagentFailed, harness.SubagentAborted} {
		t.Run(string(status), func(t *testing.T) {
			definition := Definition{Summary: Summary{Name: "sample:research", Digest: "digest"}, Context: "fork", Content: "private child instructions"}
			output, err := forkInvocation(t.Context(), MountOptions{Fork: func(_ context.Context, got *harness.Agent, selected Definition) (harness.SubagentResult, error) {
				if got != parent || selected.Agent != "general-purpose" {
					t.Error("default fork agent or exact parent was lost")
				}
				return harness.SubagentResult{ChildID: "real-child-identity", Status: status, Output: []harness.ContentBlock{{Type: harness.BlockText, Text: "child output"}}, Diagnostic: "fixture diagnostic"}, nil
			}}, parent, definition, "args", "invocation")
			if err != nil || output.status != status || len(output.messages) != 2 {
				t.Fatalf("fork output=%+v error=%v", output, err)
			}
			encoded, err := json.Marshal(output.messages)
			if err != nil || strings.Contains(string(encoded), definition.Content) {
				t.Fatal("fork instructions escaped into parent messages")
			}
			for _, message := range output.messages {
				var source skillInvocation
				if err := json.Unmarshal(message.Source, &source); err != nil || source.ChildID != "real-child-identity" || source.Status != status || source.Context != "fork" {
					t.Fatalf("child lifecycle metadata was lost: %+v %v", source, err)
				}
			}
		})
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	called := false
	_, err = forkInvocation(ctx, MountOptions{Fork: func(context.Context, *harness.Agent, Definition) (harness.SubagentResult, error) {
		called = true
		return harness.SubagentResult{}, nil
	}}, parent, Definition{Context: "fork"}, "", "")
	if !errors.Is(err, context.Canceled) || called {
		t.Fatalf("cancelled invocation admitted a child: called=%v error=%v", called, err)
	}
}

func TestForkBackgroundReportsARunningChild(t *testing.T) {
	h, err := harness.Boot(t.Context(), harness.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Dispose(context.Background())
	parent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "fork-background-parent"})
	if err != nil {
		t.Fatal(err)
	}
	background := true
	definition := Definition{Summary: Summary{Name: "sample:research", Digest: "digest"}, Context: "fork", Content: "private child instructions", Background: &background}
	output, err := forkInvocation(t.Context(), MountOptions{Fork: func(context.Context, *harness.Agent, Definition) (harness.SubagentResult, error) {
		return harness.SubagentResult{ChildID: "background-child", Status: harness.SubagentRunning}, nil
	}}, parent, definition, "args", "invocation")
	if err != nil || output.status != harness.SubagentRunning || len(output.messages) != 1 {
		t.Fatalf("output=%+v err=%v", output, err)
	}
	encoded, _ := json.Marshal(output.messages)
	if strings.Contains(string(encoded), definition.Content) || !strings.Contains(string(encoded), "background-child") || strings.Contains(string(encoded), "fork-result") {
		t.Fatalf("background message = %s", encoded)
	}
}

func TestForkRequiresConfiguredExecutor(t *testing.T) {
	requireCatalogPlatform(t)
	root := canonicalTempDir(t)
	selection := selectedFixture(t, root, "sample:research")
	selection.Definition.Context = "fork"
	catalog, err := OpenSelected(t.Context(), nil, []FileSelection{selection})
	if err != nil {
		t.Fatal(err)
	}
	defer catalog.Close()
	h, err := harness.Boot(t.Context(), harness.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Dispose(context.Background())
	if err := MountCatalog(t.Context(), h, catalog, MountOptions{Claude: true}); err == nil || !strings.Contains(err.Error(), "subagent executor") {
		t.Fatalf("fork was silently mounted inline: %v", err)
	}
}

func TestSelectedForkMetadataFrozen(t *testing.T) {
	requireCatalogPlatform(t)
	root := canonicalTempDir(t)
	selection := selectedFixture(t, root, "sample:research")
	background := false
	selection.Definition.Context, selection.Definition.Agent, selection.Definition.Model = "fork", "Explore", "analysis"
	selection.Definition.Background = &background
	catalog, err := OpenSelected(t.Context(), nil, []FileSelection{selection})
	if err != nil {
		t.Fatal(err)
	}
	defer catalog.Close()
	background = true
	for range 2 {
		definition, err := catalog.Read(t.Context(), selection.Definition.Name, selection.Definition.Digest)
		if err != nil || definition.Context != "fork" || definition.Agent != "Explore" || definition.Model != "analysis" || definition.Background == nil || *definition.Background {
			t.Fatalf("caller changed frozen fork metadata: %+v error=%v", definition, err)
		}
		*definition.Background = true
	}
}
