package subagents

import (
	"context"

	"github.com/phodal/pero/harness/go/harness"
)

// These instructions belong to this profile. They implement the documented
// roles without copying Claude's internal prompts or guessing account-specific
// model routing. Every model inherits unless the operator maps an override.
func builtinClaudeAgents() []AgentDefinition {
	return []AgentDefinition{
		{Name: "general-purpose", Description: "Handle independent research and implementation using the parent's available tools and permissions.", Instructions: "Complete the delegated task using the inherited workspace and available tools. Follow the parent's approval policy. Return concrete findings, changed artifact paths, verification results and any remaining limitations.", Model: "inherit"},
		{Name: "Explore", Description: "Search and understand existing code using available read-only tools, including read-only Bash when the parent mounted shell.", Instructions: "Explore the existing codebase without making changes. Use the available read-only tools, including read-only shell commands when Bash is mounted, to find relevant files, trace behavior and verify claims. Cite file paths and line numbers in the result. Honor any requested search thoroughness. Do not write files, edit files, invoke workflows or run commands that change state.", Model: "inherit"},
		{Name: "Plan", Description: "Research existing code and propose an implementation plan without modifying files or beginning implementation.", Instructions: "Research the codebase with the available read-only tools, including read-only shell commands when Bash is mounted. Return a concrete implementation plan with affected files, ordering, tests and relevant constraints. Do not implement the plan, modify files, invoke workflows or run commands that change state or the parent permission mode.", Model: "inherit"},
	}
}

func (s *claudeDelegation) readOnlyTools(ctx context.Context, parent *harness.Agent) ([]string, error) {
	schemas, err := s.h.Tools().SchemasForAgent(ctx, parent)
	if err != nil {
		return nil, err
	}
	available := make(map[string]bool, len(schemas))
	for _, schema := range schemas {
		available[schema.Name] = true
	}
	result := []string{}
	for _, name := range []string{"Read", "Glob", "Grep", "Bash", "shell", "WebSearch", "WebFetch", "LSP", "read_file", "list_directory", "search_files"} {
		if available[name] {
			result = append(result, name)
		}
	}
	return result, nil
}
