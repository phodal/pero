package harness

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	point "github.com/phodal/pero/harness/go/runtime"
)

func TestSubagentActivationResolvesDirectoryBeforeProviderPreparation(t *testing.T) {
	for _, local := range []bool{true, false} {
		for _, input := range []string{"", ".", "../sibling", "absolute"} {
			label := map[bool]string{true: "local", false: "external"}[local] + "/" + input
			t.Run(label, func(t *testing.T) {
				h := subagentTestHarness(t)
				ctx := activationTestContext(t)
				root := t.TempDir()
				parent, err := h.Agents().Create(ctx, AgentOptions{ID: "directory-parent", CWD: root})
				if err != nil {
					t.Fatal(err)
				}
				current := filepath.Join(root, "current")
				if _, err = parent.Session().Append("working-directory/change", struct {
					CWD string `json:"cwd"`
				}{current}); err != nil {
					t.Fatal(err)
				}
				requested, expected := input, filepath.Clean(filepath.Join(current, input))
				if input == "absolute" {
					// Official isAbsolute branch preserves the supplied absolute spelling.
					requested = root + string(filepath.Separator) + ".." + string(filepath.Separator) + "outside"
					expected = requested
				}
				stopped := errors.New("stop after exact provider request capture")
				var captured SubagentRequest
				calls := 0
				capture := func(request SubagentRequest) { captured = request; calls++ }
				base := retirementSubagentProvider{prepare: func(_ context.Context, request SubagentRequest) (SubagentProviderRun, error) {
					capture(request)
					return SubagentProviderRun{}, stopped
				}}
				var provider SubagentProvider = base
				if local {
					provider = activationProbeProvider{retirementSubagentProvider: base, prepareActivation: func(_ context.Context, request SubagentRequest) (SubagentContinuationProviderRun, error) {
						capture(request)
						return SubagentContinuationProviderRun{}, stopped
					}}
				}
				mountRetirementHooks(t, h, func(run *point.Run) error { _, err := h.Subagents().RegisterProvider(run, provider); return err })
				activation, err := h.Subagents().StartActivation(ctx, provider.Name(), SubagentRequest{Parent: parent, Prompt: "capture directory", CWD: requested, MaxDepth: 2}, "caller")
				if !errors.Is(err, stopped) || calls != 1 || captured.CWD != expected || captured.Parent != parent {
					t.Fatalf("capture=%+v calls=%d err=%v expected=%q", captured, calls, err, expected)
				}
				if activation.ChildID != "" || activation.MessageID != "" || len(h.Subagents().ListChildren(parent, true)) != 0 {
					t.Fatalf("failed preparation published ownership: %+v", activation)
				}
				if parent.Session().Header().CWD != root || parent.Session().WorkingDirectory() != current || parent.Delegated() {
					t.Fatal("directory resolution changed parent authority")
				}
			})
		}
	}
}
