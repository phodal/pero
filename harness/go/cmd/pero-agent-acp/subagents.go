package main

import (
	"context"
	"errors"
	"flag"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
	"github.com/phodal/pero/harness/go/subagents"
)

// Delegation is a trusted launch decision. Models receive only prompt/description
// arguments, never route, directory, approval, depth or resource authority.
type subagentOptions struct {
	Enabled   bool
	MaxActive int
}

func bindSubagents(flags *flag.FlagSet) *subagentOptions {
	o := &subagentOptions{}
	flags.BoolVar(&o.Enabled, "enable-subagents", false, "enable bounded one-level in-process spawn/fork tools; children cannot request approvals")
	flags.IntVar(&o.MaxActive, "max-active-subagents", 4, "maximum active children per root when --enable-subagents is selected")
	return o
}
func (o subagentOptions) validate() error {
	if o.MaxActive < 1 || o.MaxActive > 32 {
		return errors.New("--max-active-subagents must be between 1 and 32")
	}
	return nil
}
func mountSubagents(ctx context.Context, h *harness.Harness, persistence harness.SessionPersistence, o subagentOptions, compaction *harness.BasicCompactionConfig) error {
	if err := o.validate(); err != nil {
		return err
	}
	if !o.Enabled {
		return nil
	}
	if h.Subagents() == nil {
		return errors.New("subagent lifecycle must be enabled before mounting tools")
	}
	if err := h.Subagents().ReplaceConfig(harness.SubagentRuntimeConfig{MaxDepth: 1, MaxActiveSubagents: o.MaxActive}); err != nil {
		return err
	}
	if _, err := subagents.MountInProcess(ctx, h, subagents.InProcessOptions{Persistence: persistence, Compaction: compaction}); err != nil {
		return err
	}
	if _, err := subagents.MountForkInProcess(ctx, h, subagents.InProcessOptions{Persistence: persistence, Compaction: compaction}); err != nil {
		return err
	}
	for _, p := range []string{"spawn", "fork"} {
		if _, err := subagents.MountTool(ctx, h, subagents.ToolOptions{EntryID: "pero/subagents/" + p, Provider: p, ToolName: p + "_agent", MaxDepth: 1}); err != nil {
			return err
		}
	}
	const controlID = "pero/subagents/control"
	def := point.Define(point.Descriptor{ID: controlID, Provides: []point.AnyKey{harness.SubagentCatalogQueryKey.Any()}, Requires: []point.Requirement{point.Require(harness.SubagentRegistryKey), point.Require(harness.ToolRegistryKey)}}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
		if err := h.ProvideSubagentCatalogQuery(run, persistence); err != nil {
			return nil, err
		}
		for _, tool := range []harness.Tool{h.Subagents().WaitAgentTool(run.Context), h.Subagents().ListAgentsTool()} {
			if _, err := h.Tools().Register(run, tool); err != nil {
				return nil, err
			}
		}
		return nil, nil
	})
	instance, err := h.Runtime().Mount(nil, controlID, def, nil)
	if err != nil {
		return err
	}
	if err := instance.WaitStable(ctx); err != nil {
		return err
	}
	snapshot := instance.Snapshot()
	if snapshot.State == point.Failed {
		return errors.New(snapshot.LastError)
	}
	return nil
}
