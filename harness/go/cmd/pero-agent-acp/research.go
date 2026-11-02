package main

import (
	"context"
	"errors"
	"flag"
	"path/filepath"

	"github.com/phodal/pero/harness/go/researchprofile"
	"github.com/phodal/pero/harness/go/subagents"
)

type researchOptions struct{ Source, Python string }

func bindResearchOptions(flags *flag.FlagSet) *researchOptions {
	options := &researchOptions{}
	flags.StringVar(&options.Source, "research-source", "", "explicit inspected Deep Research Skills checkout; prepares a private selected package view without global installation")
	flags.StringVar(&options.Python, "research-python", "", "explicit Python interpreter with PyYAML available in isolated mode; no automatic dependency installation")
	return options
}

func configuredResearch(ctx context.Context, options researchOptions, sessions, workspace string, shellEnabled, webEnabled bool, routes []subagents.ModelRoute) (*researchprofile.Profile, error) {
	if options.Source == "" {
		if options.Python != "" {
			return nil, errors.New("--research-python requires --research-source")
		}
		return nil, nil
	}
	if workspace == "" || !shellEnabled || !webEnabled {
		return nil, errors.New("--research-source requires --workspace, --enable-shell and an explicit --web-provider")
	}
	if options.Python == "" {
		return nil, errors.New("--research-source requires --research-python with PyYAML installed; no global installation is performed")
	}
	opus := false
	for _, route := range routes {
		opus = opus || route.Alias == "opus"
	}
	if !opus {
		return nil, errors.New("--research-source requires an explicit --plugin-model opus=MODEL mapping")
	}
	source, err := filepath.Abs(options.Source)
	if err != nil {
		return nil, errors.New("research source path cannot be resolved")
	}
	state, err := filepath.Abs(filepath.Join(sessions, "snapshots"))
	if err != nil {
		return nil, errors.New("research snapshot directory cannot be resolved")
	}
	profile, err := researchprofile.Prepare(ctx, researchprofile.Options{SourceRoot: source, StateDirectory: state, Python: options.Python})
	if err != nil {
		return nil, err
	}
	return &profile, nil
}
