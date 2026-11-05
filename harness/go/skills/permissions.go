package skills

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/shell"
)

// AllowsTool interprets a skill's allowed-tools pre-approval. The caller still
// applies the session's approval policy and explicit denials. A specifier that
// this matcher cannot interpret never grants permission.
func AllowsTool(rules []string, name string, arguments json.RawMessage) bool {
	if name == "Bash" {
		return allowsBash(rules, arguments)
	}
	// Claude permission rules treat NotebookEdit under the Edit family.
	if name == "NotebookEdit" && AllowsTool(rules, "Edit", arguments) {
		return true
	}
	for _, rule := range rules {
		tool, pattern, specified := strings.Cut(rule, "(")
		if tool != name {
			if specified || !strings.HasPrefix(tool, "mcp__") {
				continue
			}
			parts := strings.SplitN(tool, "__", 3)
			if len(parts) != 3 || strings.Contains(parts[1], "*") || !wildcard(tool, name) {
				continue
			}
			return true
		}
		if !specified {
			return true
		}
		if !strings.HasSuffix(pattern, ")") {
			continue
		}
	}
	return false
}

// MatchesToolRestriction matches deny/ask rules. A matching command segment is
// sufficient; preapproval's read-only exemptions never match a restriction.
// Unparseable Bash syntax stays restricted until a caller can interpret it.
func MatchesToolRestriction(rules []string, name string, arguments json.RawMessage) bool {
	if name != "Bash" {
		return AllowsTool(rules, name, arguments)
	}
	patterns, unrestricted := bashAllowPatterns(rules)
	if unrestricted || len(patterns) == 0 {
		return unrestricted
	}
	var input struct {
		Command string `json:"command"`
	}
	if json.Unmarshal(arguments, &input) != nil {
		return true
	}
	commands, ok := shell.ClaudeAllowCommands(input.Command)
	if !ok {
		return true
	}
	for _, command := range commands {
		stripped, ok := shell.ClaudeStripAllowWrappers(command)
		if !ok {
			return true
		}
		for _, pattern := range patterns {
			if bashPatternMatches(pattern, stripped) {
				return true
			}
		}
	}
	return false
}

func allowsBash(rules []string, arguments json.RawMessage) bool {
	var input struct {
		Command string `json:"command"`
	}
	if json.Unmarshal(arguments, &input) != nil || input.Command == "" {
		return false
	}
	patterns, unrestricted := bashAllowPatterns(rules)
	if unrestricted {
		return true
	}
	if len(patterns) == 0 {
		return false
	}
	commands, ok := shell.ClaudeAllowCommands(input.Command)
	if !ok {
		return false
	}
	for _, command := range commands {
		if !bashCommandAllowed(patterns, command) {
			return false
		}
	}
	return true
}

func bashAllowPatterns(rules []string) (patterns []string, unrestricted bool) {
	for _, rule := range rules {
		tool, pattern, specified := strings.Cut(rule, "(")
		if tool != "Bash" {
			continue
		}
		if !specified {
			return nil, true
		}
		if !strings.HasSuffix(pattern, ")") {
			continue
		}
		pattern = strings.TrimSuffix(pattern, ")")
		if pattern == "*" {
			return nil, true
		}
		if strings.HasSuffix(pattern, ":*") {
			pattern = strings.TrimSuffix(pattern, ":*") + " *"
		}
		patterns = append(patterns, pattern)
	}
	return patterns, false
}

func bashCommandAllowed(patterns []string, command string) bool {
	stripped, ok := shell.ClaudeStripAllowWrappers(command)
	if !ok {
		return false
	}
	if shell.ClaudeReadOnlyAllowCommand(stripped) {
		return true
	}
	blocked := prefixRuleBlocked(stripped)
	for _, pattern := range patterns {
		if !bashPatternMatches(pattern, stripped) {
			continue
		}
		if blocked && strings.Contains(pattern, "*") {
			continue
		}
		return true
	}
	return false
}

func bashPatternMatches(pattern, command string) bool {
	if strings.Count(pattern, "*") == 1 && strings.HasSuffix(pattern, " *") && command == strings.TrimSuffix(pattern, " *") {
		return true
	}
	return wildcard(pattern, command)
}

// prefixRuleBlocked mirrors Claude's Manual-mode refusal to auto-approve prefix
// rules for exec wrappers and find actions that run or delete files.
func prefixRuleBlocked(command string) bool {
	words, ok := shell.SimpleCommandWords(command)
	if !ok || len(words) == 0 {
		return false
	}
	switch filepath.Base(words[0]) {
	case "watch", "setsid", "ionice", "flock":
		return true
	case "find":
		for _, word := range words[1:] {
			switch word {
			case "-delete", "-exec", "-execdir", "-ok", "-okdir", "-fls", "-fprint", "-fprint0", "-fprintf", "-files0-from", "-rm":
				return true
			}
		}
	}
	return false
}

func wildcard(pattern, value string) bool {
	parts := strings.Split(pattern, "*")
	if len(parts) == 1 {
		return pattern == value
	}
	if !strings.HasPrefix(value, parts[0]) {
		return false
	}
	value = value[len(parts[0]):]
	for _, part := range parts[1 : len(parts)-1] {
		index := strings.Index(value, part)
		if index < 0 {
			return false
		}
		value = value[index+len(part):]
	}
	return strings.HasSuffix(value, parts[len(parts)-1])
}

// turnGrants reads durable invocation receipts, including receipts whose
// instructions have been compacted away. A new direct user message clears the
// previous grants; a new turn never inherits the previous turn's approval.
func turnGrants(ctx context.Context, catalog *Catalog, events []harness.Event) ([]string, error) {
	names, err := activeSkillInvocations(events, nil, 0)
	if err != nil {
		return nil, err
	}
	var rules []string
	for _, source := range names {
		catalog.mu.Lock()
		entry, err := catalog.lookup(ctx, source.Name, source.Digest)
		if err == nil && (entry.definition.Context != "fork" || source.Form == "fork-grant") {
			rules = append(rules, entry.definition.AllowedTools...)
		}
		catalog.mu.Unlock()
		if err != nil {
			return nil, err
		}
	}
	return rules, nil
}
