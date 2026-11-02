package skills

import (
	"fmt"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

var argumentToken = regexp.MustCompile(`\$ARGUMENTS\[([0-9]+)\]|\$([0-9]+)\b|\$ARGUMENTS\b`)

// RenderInvocation is a text transformation. Argument values are scanned once
// and never treated as templates, shell commands or environment references.
func RenderInvocation(definition Definition, arguments, sessionID, projectDirectory string) (Definition, error) {
	if !definition.Claude || definition.Rendered {
		return definition, nil
	}
	definition, receivedArguments, err := RenderInvocationFragment(definition, arguments, sessionID, projectDirectory)
	if err != nil {
		return Definition{}, err
	}
	if !receivedArguments && arguments != "" {
		definition.Content += "\n\nARGUMENTS: " + arguments
	}
	definition.Rendered = true
	return definition, nil
}

// RenderInvocationFragment shares invocation substitution without appending
// unused arguments. The caller combines source fragments and decides once
// whether the complete source consumed an argument.
func RenderInvocationFragment(definition Definition, arguments, sessionID, projectDirectory string) (Definition, bool, error) {
	if !definition.Claude || definition.Rendered {
		return definition, false, nil
	}
	content := strings.NewReplacer(
		"${CLAUDE_PLUGIN_ROOT}", definition.ResourceBase,
		"${CLAUDE_SKILL_DIR}", filepath.Join(definition.ResourceBase, filepath.FromSlash(definition.Directory)),
		"${CLAUDE_PROJECT_DIR}", projectDirectory,
		"${CLAUDE_SESSION_ID}", sessionID,
	).Replace(definition.Content)
	matches := argumentToken.FindAllStringSubmatchIndex(content, -1)
	var positional []string
	for _, match := range matches {
		if match[2] >= 0 || match[4] >= 0 {
			var err error
			positional, err = splitArguments(arguments)
			if err != nil {
				return Definition{}, false, err
			}
			break
		}
	}
	var rendered strings.Builder
	end := 0
	receivedArguments := false
	for _, match := range matches {
		rendered.WriteString(content[end:match[0]])
		if match[2] < 0 && match[4] < 0 {
			rendered.WriteString(arguments)
			receivedArguments = true
		} else {
			start, finish := match[2], match[3]
			if start < 0 {
				start, finish = match[4], match[5]
			}
			index, err := strconv.Atoi(content[start:finish])
			if err == nil && index < len(positional) {
				rendered.WriteString(positional[index])
				receivedArguments = true
			} else {
				rendered.WriteString(content[match[0]:match[1]])
			}
		}
		end = match[1]
	}
	rendered.WriteString(content[end:])
	definition.Content = rendered.String()
	return definition, receivedArguments, nil
}

func splitArguments(arguments string) ([]string, error) {
	var values []string
	var word strings.Builder
	var quote rune
	escaped, started := false, false
	for _, r := range arguments {
		if escaped {
			word.WriteRune(r)
			escaped = false
			continue
		}
		if r == '\\' && quote != '\'' {
			escaped, started = true, true
			continue
		}
		if quote != 0 {
			if r == quote {
				quote = 0
			} else {
				word.WriteRune(r)
			}
			continue
		}
		switch r {
		case '\'', '"':
			quote, started = r, true
		case ' ', '\t', '\n', '\r':
			if started {
				values = append(values, word.String())
				word.Reset()
				started = false
			}
		default:
			word.WriteRune(r)
			started = true
		}
	}
	if escaped || quote != 0 {
		return nil, fmt.Errorf("skills: arguments contain an unclosed quote or escape")
	}
	if started {
		values = append(values, word.String())
	}
	return values, nil
}
