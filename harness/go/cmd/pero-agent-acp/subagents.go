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
	Enabled       bool
	Continuations bool
	MaxActive     int
}

func bindSubagents(flags *flag.FlagSet) *subagentOptions {
	o := &subagentOptions{}
	flags.BoolVar(&o.Enabled, "enable-subagents", false, "enable bounded one-level in-process spawn/fork tools; children cannot request approvals")
	flags.BoolVar(&o.Continuations, "enable-dsh-continuations", false, "enable named continuable native subagents with ACP tree settlement; requires --enable-subagents")
	flags.IntVar(&o.MaxActive, "max-active-subagents", 4, "maximum active children per root when --enable-subagents is selected")
	return o
}
func (o subagentOptions) validate() error {
	if o.Continuations && !o.Enabled {
		return errors.New("--enable-dsh-continuations requires --enable-subagents")
	}
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
	depth := 1
	if o.Continuations {
		depth = 2
	}
	if err := h.Subagents().ReplaceConfig(harness.SubagentRuntimeConfig{MaxDepth: depth, MaxActiveSubagents: o.MaxActive}); err != nil {
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
	if o.Continuations {
		for _, mode := range []struct {
			mount          func(context.Context, *harness.Harness, subagents.InProcessOptions) (*point.Instance, error)
			provider, tool string
		}{
			{subagents.MountInProcess, "dsh-spawn", "subagent"},
			{subagents.MountForkInProcess, "dsh-fork", "subagent_fork"},
		} {
			if _, err := mode.mount(ctx, h, subagents.InProcessOptions{EntryID: "pero/provider/" + mode.provider, Name: mode.provider, Managed: true, DSHTreeResume: true, Persistence: persistence, Compaction: compaction}); err != nil {
				return err
			}
			if _, err := subagents.MountTool(ctx, h, subagents.ToolOptions{EntryID: "pero/subagents/" + mode.provider, Provider: mode.provider, ToolName: mode.tool, MaxDepth: depth, Continuable: true}); err != nil {
				return err
			}
		}
	}
	const controlID = "pero/subagents/control"
	def := point.Define(point.Descriptor{ID: controlID, Provides: []point.AnyKey{harness.SubagentCatalogQueryKey.Any()}, Requires: []point.Requirement{point.Require(harness.SubagentRegistryKey), point.Require(harness.ToolRegistryKey), point.Require(harness.PromptRegistryKey)}}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
		if err := h.ProvideSubagentCatalogQuery(run, persistence); err != nil {
			return nil, err
		}
		tools := []harness.Tool{h.Subagents().WaitAgentTool(run.Context), h.Subagents().ListAgentsTool()}
		if o.Continuations {
			tools = append(tools, h.Subagents().DSHControlTools()...)
			if _, err := h.Prompts().Register(run, harness.PromptSection{
				ID: "dsh:agent-identity", Order: 650, Guidance: h.Subagents().DSHIdentityGuidance,
			}); err != nil {
				return nil, err
			}
		}
		for _, tool := range tools {
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
