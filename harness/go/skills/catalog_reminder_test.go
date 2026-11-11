package skills

import (
	"context"
	"encoding/json"
	"os"
	"slices"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/phodal/pero/harness/go/harness"
)

// The official hook runner consumes this exact fixture too; the network-free
// Go suite does not mistake the shared fixture for a full runtime comparison.
func TestCatalogPublicationTransitions(t *testing.T) {
	data, err := os.ReadFile("testdata/catalog-publication.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name  string
		Steps []struct {
			Visible, Compact, Publish, Update bool
			Entries                           []catalogReminderEntry
			Names                             []string
		}
	}
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	for _, tc := range cases {
		t.Run(tc.Name, func(t *testing.T) {
			var events []harness.Event
			var surface []uint64
			for i, step := range tc.Steps {
				if step.Compact {
					surface = nil
				}
				var rows []Summary
				if step.Visible {
					for _, e := range step.Entries {
						rows = append(rows, Summary{Name: e.Name, Description: e.Description})
					}
				}
				messages, err := newCatalogReminder(rows, "skill", 8192).reconcile(events, surface, nil)
				if err != nil || (len(messages) > 0) != step.Publish {
					t.Fatalf("step %d: messages=%+v err=%v", i, messages, err)
				}
				if len(messages) == 0 {
					continue
				}
				source, ok := readCatalogReminder(messages[0])
				var names []string
				for _, e := range source.Entries {
					names = append(names, e.Name)
				}
				if !ok || source.Update != step.Update || !slices.Equal(names, step.Names) {
					t.Fatalf("step %d: source=%+v", i, source)
				}
				data, _ := json.Marshal(messages[0])
				seq := uint64(len(events) + 1)
				events = append(events, harness.Event{Seq: seq, Type: "user/message", Data: data})
				surface = append(surface, seq)
			}
		})
	}
}

func TestCatalogReminderBudgetAndPending(t *testing.T) {
	rows := make([]Summary, 512)
	for i := range rows {
		rows[i] = Summary{Name: strings.Repeat("n", 256), Description: strings.Repeat("科研<&>\n", 300), Digest: "never-publish"}
	}
	for _, budget := range []int{1024, 8192, 65536} {
		r := newCatalogReminder(rows, "Skill", budget)
		text := r.text()
		if len(text) > budget || !utf8.ValidString(text) || !strings.Contains(text, "512 summaries") || strings.Contains(text, "never-publish") || strings.Contains(text, "<&>") {
			t.Fatalf("budget %d: bytes=%d text=%s", budget, len(text), text)
		}
		if budget > 1024 && len(r.Entries) == 0 {
			t.Fatalf("budget %d lost all rows", budget)
		}
	}
	r := newCatalogReminder([]Summary{{Name: "demo", Description: "a workflow"}}, "skill", 8192)
	pending, err := r.reconcile(nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	user := harness.Message{Role: harness.RoleUser, Source: json.RawMessage(`{"kind":"user"}`), Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "keep me"}}}
	pending = append(pending, user)
	got, err := r.reconcile(nil, nil, pending)
	if err != nil || len(got) != 2 || got[0].Content[0].Text != "keep me" {
		t.Fatalf("pending replay: %+v %v", got, err)
	}
}

func TestCatalogReminderVisibilityAndResume(t *testing.T) {
	requireCatalogPlatform(t)
	for _, shadow := range []bool{false, true} {
		t.Run(map[bool]string{false: "restricted", true: "shadowed"}[shadow], func(t *testing.T) {
			root := canonicalTempDir(t)
			fixture(t, root, "demo", "---\nname: demo\ndescription: selected workflow\n---\nprivate-body")
			fixture(t, root, "hidden", "---\nname: hidden\ndescription: secret-description\ndisable-model-invocation: true\n---\nsecret-body")
			want := 1
			calls := 0
			h, err := harness.Boot(t.Context(), harness.Options{ApprovalPolicy: harness.ApprovalNever, AdapterProviders: []string{"fixture"}, Adapter: harness.AdapterFunc(func(_ context.Context, req harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
				calls++
				var latest *catalogReminder
				for _, message := range req.Messages {
					if r, ok := readCatalogReminder(message); ok {
						latest = &r
						if strings.Contains(message.Content[0].Text, "private-body") || strings.Contains(message.Content[0].Text, "secret-") || strings.Contains(message.Content[0].Text, root) {
							t.Error("catalog disclosed non-summary content")
						}
					}
				}
				if latest == nil || len(latest.Entries) != want {
					t.Errorf("latest catalog=%+v want %d rows", latest, want)
				}
				return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}}, nil
			})})
			if err != nil {
				t.Fatal(err)
			}
			catalog, err := Mount(t.Context(), h, []string{root})
			if err != nil {
				t.Fatal(err)
			}
			defer func() { h.Dispose(context.Background()); h.Drain(context.Background()); catalog.Close() }()
			options := harness.AgentOptions{ID: "catalog-resume", CWD: root, Provider: "fixture", Model: "scripted"}
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
			defer detach()
			prompt := func() {
				t.Helper()
				if _, err := a.Prompt(t.Context(), harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "continue"}}}); err != nil {
					t.Fatal(err)
				}
			}
			count := func() int {
				n := 0
				for _, e := range a.Session().Events() {
					if e.Type == "user/message" {
						var m harness.Message
						json.Unmarshal(e.Data, &m)
						if _, ok := readCatalogReminder(m); ok {
							n++
						}
					}
				}
				return n
			}
			prompt()
			prompt()
			if count() != 1 {
				t.Fatal("unchanged catalog duplicated")
			}
			if err := h.Agents().Remove(t.Context(), a.ID()); err != nil {
				t.Fatal(err)
			}
			if err := detach(); err != nil {
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
			prompt()
			if count() != 1 {
				t.Fatal("resume republished visible catalog")
			}
			var dispose func(context.Context) error
			if shadow {
				inst, err := h.RegisterToolAt(t.Context(), a.Scope(), "shadow", harness.Tool{Schema: harness.ToolSchema{Name: "skill", InputSchema: json.RawMessage(`{"type":"object"}`)}, Execute: func(context.Context, json.RawMessage) (harness.ToolResult, error) { return harness.ToolResult{}, nil }})
				if err != nil {
					t.Fatal(err)
				}
				dispose = inst.Dispose
			} else {
				inst, err := h.RegisterToolRestrictionAt(t.Context(), a, "deny", harness.ToolRestriction{Deny: []string{"skill"}})
				if err != nil {
					t.Fatal(err)
				}
				dispose = inst.Dispose
			}
			want = 0
			prompt()
			prompt()
			if count() != 2 {
				t.Fatal("revocation was missing or repeated")
			}
			if err := dispose(t.Context()); err != nil {
				t.Fatal(err)
			}
			want = 1
			prompt()
			if count() != 3 || calls != 6 {
				t.Fatalf("restore: publications=%d calls=%d", count(), calls)
			}
		})
	}
}
