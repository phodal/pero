package claudehooks

import (
	"encoding/json"
	"strings"

	"github.com/phodal/pero/harness/go/shell"
)

// IfMatches reports whether a hook's single permission rule selects this event.
// Tool events that cannot be classified still run the hook. A rule on any other
// event does not run. An empty rule matches.
func IfMatches(rule string, input Input) bool {
	rule = strings.TrimSpace(rule)
	if rule == "" {
		return true
	}
	switch input.Event {
	case "PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest", "PermissionDenied":
	default:
		return false
	}
	tool, pattern, specified := strings.Cut(rule, "(")
	tool = strings.TrimSpace(tool)
	if specified {
		if !strings.HasSuffix(pattern, ")") {
			return true
		}
		pattern = strings.TrimSpace(strings.TrimSuffix(pattern, ")"))
	}
	if tool == "" || tool == "*" {
		return true
	}
	if tool != input.ToolName && !(tool == "Bash" && input.ToolName == "shell") {
		return false
	}
	if !specified || pattern == "" || pattern == "*" {
		return true
	}
	if tool == "Bash" || input.ToolName == "Bash" || input.ToolName == "shell" {
		return bashIfMatches(pattern, toolCommand(input))
	}
	path := toolPath(input)
	if path == "" {
		return true
	}
	return pathMatches(pattern, path)
}

func toolCommand(input Input) string {
	var body struct {
		Command string `json:"command"`
	}
	if json.Unmarshal(input.ToolInput, &body) != nil {
		return ""
	}
	return body.Command
}

func toolPath(input Input) string {
	if input.FilePath != "" {
		return input.FilePath
	}
	if input.NotebookPath != "" {
		return input.NotebookPath
	}
	var body struct {
		FilePath     string `json:"file_path"`
		Path         string `json:"path"`
		NotebookPath string `json:"notebook_path"`
	}
	if json.Unmarshal(input.ToolInput, &body) != nil {
		return ""
	}
	if body.FilePath != "" {
		return body.FilePath
	}
	if body.NotebookPath != "" {
		return body.NotebookPath
	}
	return body.Path
}

func bashIfMatches(pattern, command string) bool {
	command = strings.TrimSpace(command)
	if command == "" {
		return true
	}
	if containsSubstitution(command) {
		if patternSpecifiesArguments(pattern) {
			return true
		}
		if bashPatternMatches(pattern, stripAssignments(commandWithoutSubstitutions(command))) {
			return true
		}
		for _, body := range substitutionBodies(command) {
			if bashIfMatches(pattern, body) {
				return true
			}
		}
		return false
	}
	commands, ok := shell.ClaudeAllowCommands(command)
	if !ok {
		return true
	}
	for _, part := range commands {
		if bashPatternMatches(pattern, stripAssignments(part)) {
			return true
		}
	}
	return false
}

func patternSpecifiesArguments(pattern string) bool {
	pattern = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(pattern), "*"))
	return len(strings.Fields(pattern)) > 1
}

func containsSubstitution(command string) bool {
	var quote byte
	for i := 0; i < len(command); i++ {
		c := command[i]
		if quote == '\'' {
			if c == '\'' {
				quote = 0
			}
			continue
		}
		if c == '\\' {
			i++
			continue
		}
		if c == '\'' {
			quote = c
			continue
		}
		if c == '`' {
			return true
		}
		if c == '$' && i+1 < len(command) {
			next := command[i+1]
			if next == '(' || next == '{' || nameStart(next) {
				return true
			}
		}
	}
	return false
}

func nameStart(c byte) bool {
	return c == '_' || c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z'
}

func substitutionBodies(command string) []string {
	var bodies []string
	for i := 0; i < len(command); i++ {
		if command[i] == '`' {
			end := strings.IndexByte(command[i+1:], '`')
			if end >= 0 {
				bodies = append(bodies, command[i+1:i+1+end])
				i += end + 1
			}
			continue
		}
		if command[i] == '$' && i+1 < len(command) && command[i+1] == '(' {
			depth := 1
			start := i + 2
			for j := start; j < len(command); j++ {
				switch command[j] {
				case '(':
					depth++
				case ')':
					depth--
					if depth == 0 {
						bodies = append(bodies, command[start:j])
						i = j
						j = len(command)
					}
				}
			}
		}
	}
	return bodies
}

func commandWithoutSubstitutions(command string) string {
	var b strings.Builder
	for i := 0; i < len(command); i++ {
		if command[i] == '`' {
			end := strings.IndexByte(command[i+1:], '`')
			if end >= 0 {
				b.WriteByte(' ')
				i += end + 1
				continue
			}
		}
		if command[i] == '$' && i+1 < len(command) && command[i+1] == '(' {
			depth := 1
			j := i + 2
			for ; j < len(command) && depth > 0; j++ {
				switch command[j] {
				case '(':
					depth++
				case ')':
					depth--
				}
			}
			b.WriteByte(' ')
			i = j - 1
			continue
		}
		b.WriteByte(command[i])
	}
	return b.String()
}

func stripAssignments(command string) string {
	words, ok := shell.SimpleCommandWords(command)
	if !ok || len(words) == 0 {
		return strings.TrimSpace(command)
	}
	index := 0
	for index < len(words) && assignment(words[index]) {
		index++
	}
	return strings.Join(words[index:], " ")
}

func assignment(word string) bool {
	name, _, found := strings.Cut(word, "=")
	if !found || name == "" || !nameStart(name[0]) {
		return false
	}
	for i := 1; i < len(name); i++ {
		if !nameStart(name[i]) && (name[i] < '0' || name[i] > '9') {
			return false
		}
	}
	return true
}

func bashPatternMatches(pattern, command string) bool {
	command = strings.TrimSpace(command)
	if strings.Count(pattern, "*") == 1 && strings.HasSuffix(pattern, " *") && command == strings.TrimSuffix(pattern, " *") {
		return true
	}
	parts := strings.Split(pattern, "*")
	if len(parts) == 1 {
		return pattern == command
	}
	if !strings.HasPrefix(command, parts[0]) {
		return false
	}
	command = command[len(parts[0]):]
	for _, part := range parts[1 : len(parts)-1] {
		index := strings.Index(command, part)
		if index < 0 {
			return false
		}
		command = command[index+len(part):]
	}
	return strings.HasSuffix(command, parts[len(parts)-1])
}

func pathMatches(pattern, file string) bool {
	pattern = strings.TrimPrefix(strings.ReplaceAll(pattern, "\\", "/"), "./")
	file = strings.TrimPrefix(strings.ReplaceAll(file, "\\", "/"), "./")
	return matchSegments(strings.Split(pattern, "/"), strings.Split(file, "/"))
}

func matchSegments(pattern, value []string) bool {
	for {
		if len(pattern) == 0 {
			return len(value) == 0
		}
		if pattern[0] == "**" {
			if matchSegments(pattern[1:], value) {
				return true
			}
			if len(value) == 0 {
				return false
			}
			value = value[1:]
			continue
		}
		if len(value) == 0 || !bashPatternMatches(pattern[0], value[0]) {
			return false
		}
		pattern, value = pattern[1:], value[1:]
	}
}
