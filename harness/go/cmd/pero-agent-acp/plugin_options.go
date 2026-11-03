package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/phodal/pero/harness/go/fstools"
	"github.com/phodal/pero/harness/go/plugins"
	"github.com/phodal/pero/harness/go/skills"
	"github.com/phodal/pero/harness/go/subagents"
)

type pluginOptions struct {
	Directories []string
	Models      []subagents.ModelRoute
}

func bindPluginOptions(flags *flag.FlagSet) *pluginOptions {
	options := &pluginOptions{}
	flags.Func("plugin-dir", "explicit local Claude plugin or marketplace directory (repeatable); enables plugin execution", func(value string) error {
		if strings.TrimSpace(value) == "" || len(options.Directories) >= 64 {
			return errors.New("plugin-dir requires an explicit directory (maximum 64)")
		}
		options.Directories = append(options.Directories, value)
		return nil
	})
	flags.Func("plugin-model", "explicit plugin model alias=provider-model-id (repeatable); inherits configured provider and declared capabilities", func(value string) error {
		alias, id, ok := strings.Cut(value, "=")
		if !ok || alias == "" || id == "" || strings.ContainsAny(alias+id, "\x00\r\n\t ") || len(options.Models) >= 32 {
			return errors.New("plugin-model requires alias=model-id (maximum 32)")
		}
		for _, route := range options.Models {
			if route.Alias == alias {
				return errors.New("plugin-model alias is already declared")
			}
		}
		options.Models = append(options.Models, subagents.ModelRoute{Alias: alias, Provider: "configured", Model: id})
		return nil
	})
	return options
}

func pluginSelections(packages []plugins.Package) ([]skills.FileSelection, []subagents.AgentDefinition) {
	var selections []skills.FileSelection
	var agents []subagents.AgentDefinition
	positions := make(map[string]int)
	for _, pkg := range packages {
		for _, component := range pkg.Definition.Components {
			if component.Kind == plugins.ComponentAgent {
				instructions := strings.NewReplacer("${CLAUDE_PLUGIN_ROOT}", pkg.Root).Replace(component.Content)
				agents = append(agents, subagents.AgentDefinition{Name: component.QualifiedName, Description: component.Description, Instructions: instructions, Model: component.Model, Effort: component.Effort, Isolation: component.Isolation, MaxTurns: component.MaxTurns, Background: component.Background != nil && *component.Background, Tools: component.Tools, DisallowedTools: component.DisallowedTools, Skills: component.Skills, Memory: component.Memory, AutoCompactWindow: component.AutoCompactWindow})
				continue
			}
			selection := skills.FileSelection{
				Root: pkg.Root, Path: component.Path,
				Definition:    skills.Definition{Summary: skills.Summary{Name: component.QualifiedName, Description: component.Description, Digest: component.Digest, ArgumentHint: component.ArgumentHint, Paths: component.Paths}, Content: component.Content, AllowedTools: component.AllowedTools, Model: component.Model, Effort: component.Effort, Context: component.Context, Agent: component.Agent, Background: component.Background, Shell: component.Shell, Hooks: component.Hooks},
				UserInvocable: component.Visibility.User, ModelInvocable: component.Visibility.Model, ResourcePaths: pkg.Resources,
			}
			if index, exists := positions[component.QualifiedName]; exists {
				// Skills supersede the legacy command with the same invocation name.
				if component.Kind == plugins.ComponentSkill {
					selections[index] = selection
				}
				continue
			}
			positions[component.QualifiedName] = len(selections)
			selections = append(selections, selection)
		}
	}
	return selections, agents
}

func pluginResourceReader(catalog *skills.Catalog, selections []skills.FileSelection) func(context.Context, string) (fstools.ScopedText, error) {
	type resource struct{ name, digest, path string }
	paths := make(map[string]resource)
	for _, selection := range selections {
		for _, path := range selection.ResourcePaths {
			absolute := filepath.Join(selection.Root, filepath.FromSlash(path))
			if _, exists := paths[absolute]; !exists {
				paths[absolute] = resource{selection.Definition.Name, selection.Definition.Digest, path}
			}
		}
	}
	return func(ctx context.Context, path string) (fstools.ScopedText, error) {
		selected, found := paths[filepath.Clean(path)]
		if !found || catalog == nil {
			return fstools.ScopedText{}, errors.New("plugin resource is outside the explicitly selected package files")
		}
		return catalog.ReadResource(ctx, selected.name, selected.digest, selected.path)
	}
}

func additionalPluginModels(primary string, selectable []string, routes []subagents.ModelRoute) ([]string, error) {
	models := append([]string(nil), selectable...)
	seen := map[string]bool{primary: true}
	for _, model := range selectable {
		if seen[model] {
			return nil, errors.New("invalid or duplicate selectable model")
		}
		seen[model] = true
	}
	for _, route := range routes {
		if !seen[route.Model] {
			models = append(models, route.Model)
			seen[route.Model] = true
		}
	}
	if len(models) > 32 {
		return nil, fmt.Errorf("plugin and selectable models exceed the configured catalog limit")
	}
	return models, nil
}

func pluginModelResolver(routes []subagents.ModelRoute) func(string) (string, string, error) {
	selected := append([]subagents.ModelRoute(nil), routes...)
	return func(alias string) (string, string, error) {
		for _, route := range selected {
			if route.Alias == alias {
				return route.Provider, route.Model, nil
			}
		}
		return "", "", errors.New("plugin skill model is not declared by --plugin-model")
	}
}
