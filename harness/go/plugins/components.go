package plugins

import (
	"fmt"
	"path/filepath"
	"strings"
	"unicode"
	"unicode/utf8"

	"gopkg.in/yaml.v3"
)

type ComponentKind string

const (
	ComponentSkill   ComponentKind = "skill"
	ComponentCommand ComponentKind = "command"
	ComponentAgent   ComponentKind = "agent"
)

type InvocationVisibility struct {
	User  bool `json:"user"`
	Model bool `json:"model"`
}

// Component contains parsed instructions, not a grant to execute their tools.
type Component struct {
	Kind          ComponentKind        `json:"kind"`
	Name          string               `json:"name"`
	QualifiedName string               `json:"qualifiedName"`
	Path          string               `json:"path"`
	Description   string               `json:"description,omitempty"`
	Content       string               `json:"-"`
	Visibility    InvocationVisibility `json:"visibility"`
	ArgumentHint  string               `json:"argumentHint,omitempty"`
	AllowedTools  []string             `json:"allowedTools,omitempty"`
	Tools         []string             `json:"tools,omitempty"`
	Model         string               `json:"model,omitempty"`
}

type componentHeader struct {
	Name                   componentText  `yaml:"name"`
	Description            componentText  `yaml:"description"`
	ArgumentHint           componentText  `yaml:"argument-hint"`
	AllowedTools           componentTools `yaml:"allowed-tools"`
	Tools                  componentTools `yaml:"tools"`
	Model                  componentText  `yaml:"model"`
	UserInvocable          *bool          `yaml:"user-invocable"`
	DisableModelInvocation *bool          `yaml:"disable-model-invocation"`
}

type componentText string

func (s *componentText) UnmarshalYAML(node *yaml.Node) error {
	if node.Kind != yaml.ScalarNode || node.Tag != "!!str" {
		return fmt.Errorf("expected a string at line %d", node.Line)
	}
	*s = componentText(node.Value)
	return nil
}

type componentTools []string

func (t *componentTools) UnmarshalYAML(node *yaml.Node) error {
	var values []string
	switch node.Kind {
	case yaml.ScalarNode:
		var text componentText
		if err := node.Decode(&text); err != nil {
			return err
		}
		values = []string{string(text)}
	case yaml.SequenceNode:
		for _, item := range node.Content {
			var text componentText
			if err := item.Decode(&text); err != nil {
				return err
			}
			values = append(values, string(text))
		}
	default:
		return fmt.Errorf("expected tool names at line %d", node.Line)
	}
	result := make(componentTools, 0)
	seen := make(map[string]bool)
	for _, value := range values {
		names, err := splitComponentTools(value)
		if err != nil {
			return err
		}
		for _, name := range names {
			if !seen[name] {
				result = append(result, name)
				seen[name] = true
			}
		}
	}
	*t = result
	return nil
}

// Tool expressions can contain spaces and commas inside a Bash(...) rule.
func splitComponentTools(value string) ([]string, error) {
	var result []string
	start, depth := 0, 0
	for i, r := range value {
		switch r {
		case '(':
			depth++
		case ')':
			depth--
			if depth < 0 {
				return nil, fmt.Errorf("unbalanced tool expression")
			}
		}
		if depth == 0 && (r == ',' || unicode.IsSpace(r)) {
			if name := strings.TrimSpace(value[start:i]); name != "" {
				result = append(result, name)
			}
			start = i + utf8.RuneLen(r)
		}
	}
	if depth != 0 {
		return nil, fmt.Errorf("unbalanced tool expression")
	}
	if name := strings.TrimSpace(value[start:]); name != "" {
		result = append(result, name)
	}
	return result, nil
}

// ParseComponent reads one Claude Markdown definition without filesystem or
// process access. Paths are supplied by the loader and retained for diagnostics.
func ParseComponent(pluginName string, kind ComponentKind, path string, content []byte) (Component, []Diagnostic) {
	component := Component{Kind: kind, Path: path, Visibility: InvocationVisibility{User: true, Model: true}}
	var diagnostics []Diagnostic
	add := func(severity Severity, code, field, message string) {
		diagnostics = append(diagnostics, Diagnostic{Severity: severity, Code: code, Path: path, Field: field, Message: message})
	}
	if kind != ComponentSkill && kind != ComponentCommand && kind != ComponentAgent {
		add(SeverityError, "INVALID_COMPONENT_KIND", "kind", "Expected a skill, command, or agent definition.")
		return component, diagnostics
	}
	if !utf8.Valid(content) {
		add(SeverityError, "INVALID_COMPONENT_TEXT", "", "Component content must be valid UTF-8.")
		return component, diagnostics
	}
	text := strings.TrimPrefix(strings.ReplaceAll(string(content), "\r\n", "\n"), "\ufeff")
	var header componentHeader
	var fields *yaml.Node
	body := text
	if text == "---" || strings.HasPrefix(text, "---\n") {
		lines := strings.Split(text, "\n")
		closing := -1
		for i := 1; i < len(lines); i++ {
			if lines[i] == "---" {
				closing = i
				break
			}
		}
		if closing < 0 {
			add(SeverityError, "INVALID_FRONTMATTER", "", "YAML frontmatter is missing its closing delimiter.")
			return component, diagnostics
		}
		frontmatter := []byte(strings.Join(lines[1:closing], "\n"))
		var document yaml.Node
		if err := yaml.Unmarshal(frontmatter, &document); err != nil {
			add(SeverityError, "INVALID_FRONTMATTER", "", "YAML frontmatter is malformed.")
			return component, diagnostics
		}
		if len(document.Content) > 0 {
			fields = document.Content[0]
			if fields.Kind != yaml.MappingNode {
				add(SeverityError, "INVALID_FRONTMATTER", "", "YAML frontmatter must be an object.")
				return component, diagnostics
			}
			if err := fields.Decode(&header); err != nil {
				add(SeverityError, "INVALID_COMPONENT_FIELD", "", "Frontmatter has duplicate keys or a field with the wrong type.")
				return component, diagnostics
			}
		}
		body = strings.Join(lines[closing+1:], "\n")
	}
	component.Content = strings.TrimSpace(body)
	component.Description = strings.TrimSpace(string(header.Description))
	component.ArgumentHint = string(header.ArgumentHint)
	component.AllowedTools = []string(header.AllowedTools)
	component.Tools = []string(header.Tools)
	component.Model = strings.TrimSpace(string(header.Model))
	component.Name = strings.TrimSpace(string(header.Name))
	if kind == ComponentCommand {
		component.Name = strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	} else if kind == ComponentSkill && component.Name == "" {
		component.Name = filepath.Base(filepath.Dir(path))
		if component.Name == "." {
			component.Name = pluginName
		}
	}
	if kind == ComponentAgent {
		if component.Name == "" {
			add(SeverityError, "MISSING_AGENT_NAME", "name", "Agent frontmatter requires a name.")
		}
		if component.Description == "" {
			add(SeverityError, "MISSING_AGENT_DESCRIPTION", "description", "Agent frontmatter requires a description.")
		}
	}
	if component.Name != "" && !validComponentName(component.Name) {
		add(SeverityError, "INVALID_COMPONENT_NAME", "name", "Component names must contain lowercase letters, numbers, or hyphens and be at most 64 bytes.")
	}
	if kind != ComponentAgent && header.UserInvocable != nil {
		component.Visibility.User = *header.UserInvocable
	}
	if kind != ComponentAgent && header.DisableModelInvocation != nil {
		component.Visibility.Model = !*header.DisableModelInvocation
	}
	if component.Name != "" {
		component.QualifiedName = pluginName + ":" + component.Name
	}
	if fields != nil {
		for i := 0; i < len(fields.Content); i += 2 {
			key := fields.Content[i].Value
			switch {
			case kind == ComponentCommand && key == "name":
				add(SeverityWarning, "IGNORED_COMMAND_NAME", key, "Command names come from their filename; frontmatter name does not rename a command.")
			case kind == ComponentAgent && (key == "permissionMode" || key == "mcpServers" || key == "hooks" || key == "initialPrompt"):
				add(SeverityWarning, "IGNORED_PLUGIN_AGENT_FIELD", key, "Claude ignores this field on plugin agents.")
			case kind == ComponentAgent && key == "color":
				color := fields.Content[i+1]
				if color.Kind != yaml.ScalarNode || color.Tag != "!!str" || !validAgentColor(color.Value) {
					add(SeverityWarning, "INVALID_AGENT_COLOR", key, "Agent color is not one of the supported display colors.")
				}
			case knownComponentField(kind, key):
				// Parsed behavior and inert descriptive metadata are recognized.
			default:
				add(SeverityWarning, "UNSUPPORTED_COMPONENT_FIELD", key, "This field is not interpreted by the component parser; its execution behavior is unsupported.")
			}
		}
	}
	return component, diagnostics
}

func validComponentName(name string) bool {
	if len(name) > 64 {
		return false
	}
	for _, r := range name {
		if (r < 'a' || r > 'z') && (r < '0' || r > '9') && r != '-' {
			return false
		}
	}
	return name != ""
}

func knownComponentField(kind ComponentKind, key string) bool {
	switch key {
	case "name", "description", "model", "version", "license", "compatibility", "metadata", "homepage", "platforms":
		return true
	case "argument-hint", "allowed-tools", "user-invocable", "disable-model-invocation":
		return kind != ComponentAgent
	case "tools", "color":
		return kind == ComponentAgent
	}
	return false
}

func validAgentColor(color string) bool {
	switch color {
	case "red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan":
		return true
	}
	return false
}
