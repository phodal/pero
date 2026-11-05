package skills

import (
	"context"
	"encoding/json"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
)

func TestSlashExpansionGuardRunsOnlyForATypedCommand(t *testing.T) {
	requireCatalogPlatform(t)
	root := canonicalTempDir(t)
	selection := selectedFixture(t, root, "sample:check")
	catalog, err := OpenSelected(t.Context(), nil, []FileSelection{selection})
	if err != nil {
		t.Fatal(err)
	}
	var guarded, expanded, calls atomic.Int32
	var sawSkill, sawContext atomic.Bool
	adapter := harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		calls.Add(1)
		encoded, _ := json.Marshal(request.Messages)
		body := string(encoded)
		if strings.Contains(body, "Compiled allow") {
			sawSkill.Store(true)
		}
		if strings.Contains(body, "expansion checklist") {
			sawContext.Store(true)
		}
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}}, nil
	})
	h, err := harness.Boot(t.Context(), harness.Options{Adapter: adapter, AdapterProviders: []string{"fixture"}})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()); _ = catalog.Close() }()
	err = MountCatalog(t.Context(), h, catalog, MountOptions{
		Claude: true,
		Expand: func(_ context.Context, _ *harness.Agent, definition Definition, _ string) (Definition, error) {
			expanded.Add(1)
			return definition, nil
		},
		GuardSlash: func(_ context.Context, _ *harness.Agent, name, arguments, prompt string) (string, error) {
			guarded.Add(1)
			if name != "sample:check" || !strings.HasPrefix(prompt, "/sample:check") {
				t.Errorf("guard saw name=%q arguments=%q prompt=%q", name, arguments, prompt)
			}
			if strings.Contains(prompt, "block") {
				return "", &SlashBlockedError{Reason: "command gate"}
			}
			if arguments != "allow" {
				t.Errorf("arguments=%q", arguments)
			}
			return "expansion checklist", nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "expansion-guard", CWD: root, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	prompt := func(text string) error {
		_, err := agent.Prompt(t.Context(), harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: text}}})
		return err
	}
	if err := prompt("/sample:check block"); err == nil || !strings.Contains(err.Error(), "command gate") || expanded.Load() != 0 || calls.Load() != 0 || guarded.Load() != 1 {
		t.Fatalf("blocked prompt err=%v expanded=%d calls=%d guarded=%d", err, expanded.Load(), calls.Load(), guarded.Load())
	}
	if err := prompt("mention /sample:check later"); err != nil || guarded.Load() != 1 || calls.Load() != 1 {
		t.Fatalf("plain prompt err=%v guarded=%d calls=%d", err, guarded.Load(), calls.Load())
	}
	if err := prompt("/sample:check allow"); err != nil || expanded.Load() != 1 || !sawSkill.Load() || !sawContext.Load() {
		t.Fatalf("allowed prompt err=%v expanded=%d skill=%v context=%v", err, expanded.Load(), sawSkill.Load(), sawContext.Load())
	}
}
