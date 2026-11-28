package main

import (
	"context"
	"flag"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
)

func TestSubagentFlagsRequireExplicitOptIn(t *testing.T) {
	flags := flag.NewFlagSet("subagents", flag.ContinueOnError)
	options := bindSubagents(flags)
	if options.Enabled || options.MaxActive != 4 {
		t.Fatalf("implicit delegation: %+v", options)
	}
	if err := flags.Parse([]string{"--enable-subagents", "--max-active-subagents=2"}); err != nil {
		t.Fatal(err)
	}
	if !options.Enabled || options.MaxActive != 2 {
		t.Fatal(options)
	}
	for _, n := range []int{-1, 0, 33} {
		if err := (subagentOptions{Enabled: true, MaxActive: n}).validate(); err == nil {
			t.Fatalf("accepted capacity %d", n)
		}
	}
}
func TestSubagentCLICompositionUsesBoundedNativeRegistry(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		t.Run(map[bool]string{false: "disabled", true: "enabled"}[enabled], func(t *testing.T) {
			h, err := harness.Boot(t.Context(), harness.Options{EnableSubagents: enabled, Adapter: harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
				return harness.Completion{}, nil
			})})
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) }()
			if err := mountSubagents(t.Context(), h, nil, subagentOptions{Enabled: enabled, MaxActive: 2}, nil); err != nil {
				t.Fatal(err)
			}
			if !enabled {
				if h.Subagents() != nil {
					t.Fatal("default registry exposed")
				}
				return
			}
			if got := h.Subagents().Config(); got.MaxDepth != 1 || got.MaxActiveSubagents != 2 {
				t.Fatal(got)
			}
			rows := h.Subagents().ProviderDescriptors(h.Runtime().Root())
			if len(rows) != 2 {
				t.Fatalf("providers: %+v", rows)
			}
			for _, r := range rows {
				if r.Continuable || (r.Name != "spawn" && r.Name != "fork") {
					t.Fatalf("unrequested provider: %+v", r)
				}
			}
		})
	}
}

func TestSubagentCLIDiscoveryReadsOnlyReachableJournals(t *testing.T) {
	ctx := t.Context()
	persistence, err := harness.NewJSONLSessionPersistence(t.TempDir(), harness.JSONLPersistenceOptions{})
	if err != nil {
		t.Fatal(err)
	}
	h, err := harness.Boot(ctx, harness.Options{EnableSubagents: true, Adapter: harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		t.Error("discovery must not request inference")
		return harness.Completion{}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) })
	if err = mountSubagents(ctx, h, persistence, subagentOptions{Enabled: true, MaxActive: 2}, nil); err != nil {
		t.Fatal(err)
	}
	workspace := t.TempDir()
	root, err := h.Agents().Create(ctx, harness.AgentOptions{ID: "lead", CWD: workspace})
	if err != nil {
		t.Fatal(err)
	}
	add := func(parent *harness.Session, id, mode string) {
		t.Helper()
		label := id
		_, err := parent.Append("subagent/catalog", harness.SubagentCatalogFact{Version: 1, ChildID: harness.SessionID(id), Mode: mode, Label: &label})
		if err != nil {
			t.Fatal(err)
		}
	}
	save := func(session *harness.Session) {
		t.Helper()
		detach, err := persistence.Attach(ctx, session)
		if err != nil {
			t.Fatal(err)
		}
		if err := detach(); err != nil {
			t.Fatal(err)
		}
	}
	add(root.Session(), "review", "one-shot")
	add(root.Session(), "unreadable", "one-shot")
	review := harness.NewSession("review", workspace)
	add(review, "checker", "continuable")
	save(review)
	save(harness.NewSession("checker", workspace))
	forkAt := uint64(len(root.Session().Events()))
	fork, err := root.Session().ForkPublic("separate-fork", &forkAt)
	if err != nil {
		t.Fatal(err)
	}
	add(fork, "hidden", "continuable")
	save(fork)
	save(harness.NewSession("hidden", workspace))

	rows, err := h.Subagents().ListAgentsDSH(ctx, root, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 3 || rows[0].ID != "review" || rows[0].Mode != "one-shot" ||
		rows[1].ID != "checker" || rows[1].Mode != "continuable" || rows[1].Depth != 2 || rows[1].Activity != "inactive" ||
		rows[2].ID != "unreadable" || rows[2].Kind != "diagnostic" || rows[2].Reason != "unavailable" {
		t.Fatalf("unexpected discovery: %+v", rows)
	}
	forkRoot, err := h.Agents().Resume(ctx, fork, harness.AgentOptions{ID: "separate-fork", CWD: workspace})
	if err != nil {
		t.Fatal(err)
	}
	forkRows, err := h.Subagents().ListAgentsDSH(ctx, forkRoot, true)
	if err != nil || len(forkRows) != 1 || forkRows[0].ID != "hidden" {
		t.Fatalf("fork inherited source membership: %+v %v", forkRows, err)
	}
	for _, id := range []harness.SessionID{"review", "checker", "hidden"} {
		if _, loaded := h.Sessions().Get(id); loaded {
			t.Fatalf("discovery published a cold session: %s", id)
		}
	}
}
