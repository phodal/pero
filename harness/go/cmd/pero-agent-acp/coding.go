package main

import (
	"context"
	"errors"
	"flag"

	"github.com/phodal/pero/harness/go/agentinstructions"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/todos"
)

type codingOptions struct{ AgentInstructions, HierarchicalInstructions, Todos bool }

func bindCodingOptions(flags *flag.FlagSet) *codingOptions {
	options := &codingOptions{}
	flags.BoolVar(&options.AgentInstructions, "enable-agent-instructions", false, "load only explicit workspace/AGENTS.md as untrusted context (requires --workspace)")
	flags.BoolVar(&options.HierarchicalInstructions, "enable-hierarchical-instructions", false, "load workspace-contained CLAUDE.md/AGENTS.md along file tool paths, with scoped overrides (requires --workspace)")
	flags.BoolVar(&options.Todos, "enable-todos", false, "enable session-backed todo_write; whole-list replacement, reset at next turn")
	return options
}
func (options codingOptions) validate(workspace string) error {
	if (options.AgentInstructions || options.HierarchicalInstructions) && workspace == "" {
		return errors.New("workspace instructions require --workspace")
	}
	return nil
}
func mountCoding(ctx context.Context, h *harness.Harness, workspace string, options codingOptions) (*agentinstructions.App, error) {
	if err := options.validate(workspace); err != nil {
		return nil, err
	}
	if options.Todos {
		if _, err := todos.Mount(ctx, h, todos.Options{
			ContentNormalization:           todos.ContentNormalizationDSHAlpha3,
			ArgumentErrorMode:              harness.ArgumentErrorsDSHAlpha3Todo,
			AllowAdditionalInputProperties: true,
		}); err != nil {
			return nil, err
		}
	}
	if !options.AgentInstructions && !options.HierarchicalInstructions {
		return nil, nil
	}
	return agentinstructions.Mount(ctx, h, agentinstructions.Options{Workspace: workspace, Hierarchical: options.HierarchicalInstructions})
}
