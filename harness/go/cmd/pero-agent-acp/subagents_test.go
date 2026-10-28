package main

import (
	"context"
	"flag"
	"github.com/phodal/pero/harness/go/harness"
	"testing"
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
