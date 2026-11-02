package skills

import (
	"encoding/json"
	"strings"

	"github.com/phodal/pero/harness/go/harness"
)

// skillInvocation attributes loaded instructions without granting user authorship
// or tool permissions. The digest identifies the approved launch-time content.
type skillInvocation struct {
	Kind      string                 `json:"kind"`
	Form      string                 `json:"form"`
	Name      string                 `json:"name"`
	Digest    string                 `json:"digest"`
	Arguments string                 `json:"arguments,omitempty"`
	Turn      int                    `json:"turn,omitempty"`
	ID        string                 `json:"id,omitempty"`
	Context   string                 `json:"context,omitempty"`
	ChildID   harness.SessionID      `json:"childId,omitempty"`
	Status    harness.SubagentStatus `json:"status,omitempty"`
}

type explicitInvocation struct {
	Summary
	Arguments string
}

// explicitInvocations recognizes claimed direct-user text. Claude's ACP/SDK
// mode loads only the first command at the start; legacy roots retain their
// existing whitespace-bounded gesture semantics.
func explicitInvocations(messages []harness.Message, rows []Summary, claude bool) []explicitInvocation {
	var selected []explicitInvocation
	seen := make(map[string]bool)
	for _, message := range messages {
		var source struct {
			Kind string `json:"kind"`
		}
		if message.Role != harness.RoleUser || json.Unmarshal(message.Source, &source) != nil || source.Kind != "user" {
			continue
		}
		for _, block := range message.Content {
			if block.Type != harness.BlockText {
				continue
			}
			if claude && strings.TrimSpace(block.Text) == "" {
				continue
			}
			cursor := 0
			for _, token := range strings.Fields(block.Text) {
				start := cursor + strings.Index(block.Text[cursor:], token)
				cursor = start + len(token)
				for _, row := range rows {
					if token == "/"+row.Name && !seen[row.Name] {
						arguments := strings.TrimSpace(block.Text[cursor:])
						selected = append(selected, explicitInvocation{Summary: row, Arguments: arguments})
						seen[row.Name] = true
					}
				}
				if claude {
					break
				}
			}
			if claude {
				break
			}
		}
	}
	return selected
}
