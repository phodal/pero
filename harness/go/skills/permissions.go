package skills

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/phodal/pero/harness/go/harness"
)

// AllowsTool interprets a skill's allowed-tools pre-approval. The caller still
// applies the session's approval policy and explicit denials. A specifier that
// this matcher cannot interpret never grants permission.
func AllowsTool(rules []string, name string, arguments json.RawMessage) bool {
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
		}
		if !specified {
			return true
		}
		if !strings.HasSuffix(pattern, ")") {
			continue
		}
		pattern = strings.TrimSuffix(pattern, ")")
		if name != "Bash" {
			continue
		}
		var input struct {
			Command string `json:"command"`
		}
		if json.Unmarshal(arguments, &input) != nil || input.Command == "" {
			continue
		}
		if pattern == "*" {
			return true
		}
		// Conditional grants cannot match past shell syntax that may execute
		// another program. Bare Bash grants cover all syntax explicitly.
		if strings.ContainsAny(input.Command, ";&|\n\r`$()<>\\") {
			continue
		}
		if strings.HasSuffix(pattern, ":*") {
			pattern = strings.TrimSuffix(pattern, ":*") + " *"
		}
		if strings.Count(pattern, "*") == 1 && strings.HasSuffix(pattern, " *") && input.Command == strings.TrimSuffix(pattern, " *") {
			return true
		}
		if wildcard(pattern, input.Command) {
			return true
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
	var names []skillInvocation
	for _, event := range events {
		if event.Type == "turn/start" {
			names = nil
			continue
		}
		if event.Type != "user/message" {
			continue
		}
		var message harness.Message
		if err := json.Unmarshal(event.Data, &message); err != nil {
			return nil, err
		}
		var source skillInvocation
		if json.Unmarshal(message.Source, &source) != nil {
			continue
		}
		if source.Kind == "user" {
			names = nil
		} else if source.Kind == "skill-invocation" && source.Form != "reattached" {
			names = append(names, source)
		}
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
