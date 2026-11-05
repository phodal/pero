package harness

import (
	"context"
	"errors"

	point "github.com/phodal/pero/harness/go/runtime"
	harnesstool "github.com/phodal/pero/harness/go/tool"
)

const ToolResultPruneMarker = harnesstool.ToolResultPruneMarker

type ToolResultPruneConfig = harnesstool.ToolResultPruneConfig
type PrunedToolResult = harnesstool.PrunedToolResult
type ToolResultPruneResult = harnesstool.ToolResultPruneResult
type ToolResultPruner = harnesstool.ToolResultPruner
type ToolResultPrunerPolicy = harnesstool.ToolResultPrunerPolicy
type ToolResultPrunerPolicySnapshot = harnesstool.ToolResultPrunerPolicySnapshot

func NewToolResultPruner(config ToolResultPruneConfig) (*ToolResultPruner, error) {
	return harnesstool.NewToolResultPruner(config)
}

func MountToolResultPruner(run *point.Run, agent *Agent, config ToolResultPruneConfig) error {
	if run == nil || !run.Active() {
		return point.ErrInactiveRun
	}
	if agent == nil {
		return errors.New("harness: tool-result pruning requires an agent")
	}
	pruner, err := NewToolResultPruner(config)
	if err != nil {
		return err
	}
	agent.prunerMu.Lock()
	if agent.pruner != nil {
		agent.prunerMu.Unlock()
		return errors.New("harness: tool-result pruner is already mounted for this agent")
	}
	agent.pruner = pruner
	agent.prunerMu.Unlock()
	clear := func() {
		agent.prunerMu.Lock()
		if agent.pruner == pruner {
			agent.pruner = nil
		}
		agent.prunerMu.Unlock()
	}
	if err := run.Defer("tool-result-pruner:clear", func(context.Context) error {
		clear()
		return nil
	}); err != nil {
		clear()
		return err
	}
	return nil
}

func (a *Agent) effectiveToolResultPruner() *ToolResultPruner {
	if a.scope != nil {
		if policy, ok := point.Lookup(a.scope.Runtime(), a.scope, ToolResultPrunerPolicyKey); ok {
			if pruner, overridden := policy.Effective(); overridden {
				if pruner == nil {
					return nil
				}
				return pruner
			}
		}
	}
	a.prunerMu.RLock()
	pruner := a.pruner
	a.prunerMu.RUnlock()
	return pruner
}

func (a *Agent) pruneToolResults() (ToolResultPruneResult, error) {
	pruner := a.effectiveToolResultPruner()
	if pruner == nil {
		return ToolResultPruneResult{}, nil
	}
	return pruner.PruneSession(a.session)
}
