package skills

import (
	"encoding/json"
	"strings"

	"github.com/phodal/pero/harness/go/harness"
)

// skillInvocation attributes loaded instructions without granting user authorship
// or tool permissions. The digest identifies the approved launch-time content.
type skillInvocation struct {
	Kind   string `json:"kind"`
	Form   string `json:"form"`
	Name   string `json:"name"`
	Digest string `json:"digest"`
}

// invokedSkills selects only whole whitespace-bounded tokens in this step's
// claimed direct-user text, never history or nested tool/external content.
// Known launch-time names provide both the grammar and the authority boundary.
func invokedSkills(messages []harness.Message, rows []Summary) []Summary {
	var selected []Summary
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
			for _, token := range strings.Fields(block.Text) {
				for _, row := range rows {
					if token == "/"+row.Name && !seen[row.Name] {
						selected = append(selected, row)
						seen[row.Name] = true
					}
				}
			}
		}
	}
	return selected
}
