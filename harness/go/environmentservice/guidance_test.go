package environmentservice

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/nativetools"
	point "github.com/phodal/pero/harness/go/runtime"
)

func TestServiceGuidanceBeforeDiscovery(t *testing.T) {
	for _, row := range []struct {
		name              string
		deferred, allowed bool
	}{
		{"eager", false, true},
		{"deferred", true, true},
		{"restricted", true, false},
	} {
		t.Run(row.name, func(t *testing.T) {
			observed := false
			h, err := harness.Boot(t.Context(), harness.Options{Adapter: harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
				observed = true
				if strings.Contains(request.System, "ServiceStart") != row.allowed {
					t.Fatalf("service discovery guidance allowed=%v, system=%s", row.allowed, request.System)
				}
				declared := false
				for _, schema := range request.Tools {
					declared = declared || schema.Name == "ServiceStart"
				}
				if declared != (!row.deferred && row.allowed) {
					t.Fatal("guidance changed tool activation")
				}
				return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}}, nil
			})})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) })
			workspace := t.TempDir()
			native, err := nativetools.Mount(t.Context(), h, nativetools.Options{Workspace: workspace, EnableShell: true, ClaudeTools: true, DeferToolLoading: row.deferred})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = native.Close() })
			if err := Mount(t.Context(), h, Options{Directory: filepath.Join(t.TempDir(), "services"), Workspace: workspace}, native.CheckCWD); err != nil {
				t.Fatal(err)
			}
			agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "service-guidance", CWD: workspace, Configure: func(_ context.Context, run *point.Run, _ *harness.Agent) error {
				_, err := h.Tools().RestrictWhen(run, func(_ *harness.Agent, name string) bool { return row.allowed || name != "ServiceStart" })
				return err
			}})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := agent.Prompt(t.Context(), harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "Deliver a server"}}}); err != nil {
				t.Fatal(err)
			}
			if !observed {
				t.Fatal("provider request was not observed")
			}
		})
	}
}
