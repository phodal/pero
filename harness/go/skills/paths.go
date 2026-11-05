package skills

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"sync"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

type pathSkill struct {
	name  string
	paths []string
}

func mountSkillPaths(run *point.Run, h *harness.Harness, hooks *harness.AgentHooks, catalog *Catalog) error {
	skills := catalogPathSkills(catalog)
	if len(skills) == 0 || h.Tools() == nil {
		return nil
	}
	var mu sync.Mutex
	notes := map[*harness.Agent][]string{}
	if _, err := h.Tools().After.Use(run, func(_ context.Context, outcome harness.ToolOutcome, next point.Next[harness.ToolOutcome]) (harness.ToolOutcome, error) {
		agent := outcome.Request.Agent
		file := toolFilePath(outcome.Request)
		if agent != nil && file != "" {
			relative := file
			if agent.Session() != nil && agent.Session().WorkingDirectory() != "" {
				if rel, err := pathRel(agent.Session().WorkingDirectory(), file); err == nil {
					relative = rel
				}
			}
			var hits []string
			for _, skill := range skills {
				if skillPathMatches(skill.paths, relative) {
					hits = append(hits, skill.name)
				}
			}
			if len(hits) > 0 {
				note := "File " + relative + " matches skill " + strings.Join(hits, ", ") + ". Load that skill when its workflow applies."
				mu.Lock()
				if len(notes[agent]) < 8 {
					notes[agent] = append(notes[agent], note)
				}
				mu.Unlock()
			}
		}
		return next(outcome)
	}); err != nil {
		return err
	}
	_, err := hooks.PreStep.Use(run, func(_ context.Context, input harness.StepInput, next point.Next[harness.StepInput]) (harness.StepInput, error) {
		mu.Lock()
		pending := append([]string(nil), notes[input.Agent]...)
		delete(notes, input.Agent)
		mu.Unlock()
		if len(pending) > 0 {
			source, _ := json.Marshal(map[string]string{"kind": "skill-path"})
			input.Messages = append(input.Messages, harness.Message{Role: harness.RoleUser, Source: source, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: strings.Join(pending, "\n")}}})
		}
		return next(input)
	}, point.ListenerOptions{Prepend: true})
	return err
}

func catalogPathSkills(catalog *Catalog) []pathSkill {
	if catalog == nil {
		return nil
	}
	catalog.mu.Lock()
	defer catalog.mu.Unlock()
	var skills []pathSkill
	for _, entry := range catalog.entries {
		if !entry.modelInvocable || len(entry.definition.Paths) == 0 {
			continue
		}
		skills = append(skills, pathSkill{name: entry.definition.Name, paths: append([]string(nil), entry.definition.Paths...)})
	}
	return skills
}

func toolFilePath(request harness.ToolRequest) string {
	switch request.Name {
	case "Read", "Write", "Edit", "NotebookEdit":
	default:
		return ""
	}
	var fields struct {
		FilePath     string `json:"file_path"`
		Path         string `json:"path"`
		NotebookPath string `json:"notebook_path"`
	}
	if json.Unmarshal(request.Arguments, &fields) != nil {
		return ""
	}
	if fields.FilePath != "" {
		return fields.FilePath
	}
	if fields.NotebookPath != "" {
		return fields.NotebookPath
	}
	return fields.Path
}

func pathRel(root, file string) (string, error) {
	relative, err := pathRelSlash(root, file)
	if err != nil {
		return "", err
	}
	return relative, nil
}

func pathRelSlash(root, file string) (string, error) {
	root = strings.TrimPrefix(filepathToSlash(root), "./")
	file = strings.TrimPrefix(filepathToSlash(file), "./")
	if !strings.HasPrefix(file, "/") && !strings.Contains(file, ":") {
		return file, nil
	}
	rel, err := slashRel(root, file)
	if err != nil || rel == "" || strings.HasPrefix(rel, "../") {
		return "", err
	}
	return rel, nil
}

func slashRel(root, file string) (string, error) {
	return filepath.Rel(root, file)
}

func filepathToSlash(value string) string {
	return strings.ReplaceAll(value, "\\", "/")
}

func skillPathMatches(patterns []string, file string) bool {
	file = strings.TrimPrefix(filepathToSlash(file), "./")
	for _, pattern := range patterns {
		if matchSkillPath(filepathToSlash(pattern), file) {
			return true
		}
	}
	return false
}

func matchSkillPath(pattern, file string) bool {
	return matchPathParts(strings.Split(pattern, "/"), strings.Split(file, "/"))
}

func matchPathParts(pattern, file []string) bool {
	for {
		if len(pattern) == 0 {
			return len(file) == 0
		}
		if pattern[0] == "**" {
			if matchPathParts(pattern[1:], file) {
				return true
			}
			if len(file) == 0 {
				return false
			}
			file = file[1:]
			continue
		}
		if len(file) == 0 {
			return false
		}
		ok, err := filepath.Match(pattern[0], file[0])
		if err != nil || !ok {
			return false
		}
		pattern = pattern[1:]
		file = file[1:]
	}
}
