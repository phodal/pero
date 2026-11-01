package skills

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
)

func TestExplicitSkillProviderRequest(t *testing.T) {
	requireCatalogPlatform(t)
	for _, tc := range []struct {
		name, text, secondText, source               string
		disabled, changed, noRoots, masked, shadowed bool
		want                                         int
	}{
		{name: "direct", text: "please /demo now", want: 1},
		{name: "repeated", text: "/demo\n/demo\t/demo", want: 1},
		{name: "multiple text blocks", text: "first block", secondText: "/demo", want: 1},
		{name: "unknown", text: "/unknown"},
		{name: "paths and fractions", text: "/demo/file /tmp/demo 5/8 x/demo /demo, /demo."},
		{name: "plugin", text: "/demo", source: `{"kind":"plugin"}`},
		{name: "tool", text: "/demo", source: `{"kind":"tool"}`},
		{name: "external", text: "/demo", source: `{"kind":"external"}`},
		{name: "invocation", text: "/demo", source: `{"kind":"skill-invocation"}`},
		{name: "disabled", text: "/demo", disabled: true},
		{name: "unmounted", text: "/demo", noRoots: true},
		{name: "changed", text: "/demo", changed: true},
		{name: "masked", text: "/demo", masked: true},
		{name: "shadowed", text: "/demo", shadowed: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := canonicalTempDir(t)
			const body = "exact body\n\n/code $(never execute)"
			header := "---\nname: demo\ndescription: selected workflow\n"
			if tc.disabled {
				header += "disable-model-invocation: true\n"
			}
			path := fixture(t, root, "demo", header+"---\n"+body)
			var calls atomic.Int32
			var expectedDigest string
			adapter := harness.AdapterFunc(func(_ context.Context, req harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
				calls.Add(1)
				count := 0
				for _, message := range req.Messages {
					var source skillInvocation
					_ = json.Unmarshal(message.Source, &source)
					if source.Kind != "skill-invocation" || source.Form != "instructions" {
						continue
					}
					count++
					if source.Name != "demo" || source.Digest != expectedDigest || len(message.Content) != 1 || message.Content[0].Text != "<skill_content name=\"demo\">\n"+body+"\n</skill_content>" {
						t.Errorf("wrong loaded instructions: %+v", message)
					}
				}
				if count != tc.want {
					t.Errorf("loaded %d skills, want %d", count, tc.want)
				}
				return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}}, nil
			})
			h, err := harness.Boot(t.Context(), harness.Options{Adapter: adapter, AdapterProviders: []string{"fixture"}})
			if err != nil {
				t.Fatal(err)
			}
			var catalog *Catalog
			defer func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()); _ = catalog.Close() }()
			roots := []string{root}
			if tc.noRoots {
				roots = nil
			}
			catalog, err = Mount(t.Context(), h, roots)
			if err != nil {
				t.Fatal(err)
			}
			if catalog != nil {
				rows, listErr := catalog.List(t.Context())
				if listErr != nil {
					t.Fatal(listErr)
				}
				if len(rows) > 0 {
					expectedDigest = rows[0].Digest
				}
			}
			if tc.changed {
				if err = os.WriteFile(path, []byte(header+"---\nchanged body"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			a, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "explicit", CWD: root, Provider: "fixture", Model: "scripted"})
			if err != nil {
				t.Fatal(err)
			}
			if tc.masked {
				if _, err = h.RegisterToolRestrictionAt(t.Context(), a, "mask-skill", harness.ToolRestriction{Deny: []string{"skill"}}); err != nil {
					t.Fatal(err)
				}
			}
			if tc.shadowed {
				if _, err = h.RegisterToolAt(t.Context(), a.Scope(), "shadow-skill", harness.Tool{Schema: harness.ToolSchema{Name: "skill", InputSchema: json.RawMessage(`{"type":"object"}`)}, Execute: func(context.Context, json.RawMessage) (harness.ToolResult, error) { return harness.ToolResult{}, nil }}); err != nil {
					t.Fatal(err)
				}
			}
			_, err = a.Prompt(t.Context(), harness.Message{Role: harness.RoleUser, Source: json.RawMessage(tc.source), Content: []harness.ContentBlock{{Type: harness.BlockText, Text: tc.text}, {Type: harness.BlockText, Text: tc.secondText}}})
			if tc.changed {
				if err == nil || !strings.Contains(err.Error(), "restart") || calls.Load() != 0 {
					t.Fatalf("changed content reached provider: calls=%d err=%v", calls.Load(), err)
				}
			} else if err != nil || calls.Load() != 1 {
				t.Fatalf("expected one provider request without tool roundtrip: calls=%d err=%v", calls.Load(), err)
			}
		})
	}
}

// Cancellation and resume retain admitted instructions as history, but never
// interpret the old gesture as a fresh load (even if its file changed).
func TestExplicitSkillCancellationResume(t *testing.T) {
	requireCatalogPlatform(t)
	root := canonicalTempDir(t)
	path := fixture(t, root, "demo", "---\nname: demo\ndescription: workflow\n---\noriginal instructions")
	entered := make(chan struct{})
	var calls atomic.Int32
	adapter := harness.AdapterFunc(func(ctx context.Context, req harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		n := calls.Add(1)
		count := 0
		for _, message := range req.Messages {
			var source skillInvocation
			_ = json.Unmarshal(message.Source, &source)
			if source.Kind == "skill-invocation" {
				count++
			}
		}
		if count != 1 {
			t.Errorf("instructions duplicated or lost: %d", count)
		}
		if n == 1 {
			close(entered)
			<-ctx.Done()
			return harness.Completion{}, ctx.Err()
		}
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}}, nil
	})
	h, err := harness.Boot(t.Context(), harness.Options{Adapter: adapter, AdapterProviders: []string{"fixture"}})
	if err != nil {
		t.Fatal(err)
	}
	var catalog *Catalog
	defer func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()); _ = catalog.Close() }()
	catalog, err = Mount(t.Context(), h, []string{root})
	if err != nil {
		t.Fatal(err)
	}
	options := harness.AgentOptions{ID: "resume-explicit", CWD: root, Provider: "fixture", Model: "scripted"}
	a, err := h.Agents().Create(t.Context(), options)
	if err != nil {
		t.Fatal(err)
	}
	persistence, err := harness.NewJSONLSessionPersistence(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	detach, err := persistence.Attach(t.Context(), a.Session())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = detach() }()
	prompt := func(agent *harness.Agent, text string) error {
		_, err := agent.Prompt(t.Context(), harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: text}}})
		return err
	}
	done := make(chan error, 1)
	go func() { done <- prompt(a, "/demo") }()
	<-entered
	a.Cancel(context.Canceled)
	if err = <-done; err == nil {
		t.Fatal("cancelled request succeeded")
	}
	if err = os.WriteFile(path, []byte("changed after cancelled turn"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = h.Agents().Remove(t.Context(), a.ID()); err != nil {
		t.Fatal(err)
	}
	if err = detach(); err != nil {
		t.Fatal(err)
	}
	restored, err := persistence.Load(t.Context(), options.ID)
	if err != nil {
		t.Fatal(err)
	}
	a, err = h.Agents().Resume(t.Context(), restored, options)
	if err != nil {
		t.Fatal(err)
	}
	if err = prompt(a, "continue without reloading"); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 {
		t.Fatalf("unexpected replay: %d requests", calls.Load())
	}
}
