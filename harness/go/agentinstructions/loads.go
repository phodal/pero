package agentinstructions

import (
	"encoding/json"
	"path/filepath"

	"github.com/phodal/pero/harness/go/harness"
)

// LoadedFile is provenance for instruction text admitted to the request. Omitted
// files are absent. AGENTS.md is not a Claude InstructionsLoaded event.
type LoadedFile struct {
	Path   string `json:"path"`
	Digest string `json:"digest"`
	Reason string `json:"reason"`
}

func LoadedBaseline(messages []harness.Message) ([]LoadedFile, bool) {
	for i := len(messages) - 1; i >= 0; i-- {
		var provenance source
		if json.Unmarshal(messages[i].Source, &provenance) != nil || provenance.Kind != sourceKind || !provenance.Baseline || !filepath.IsAbs(provenance.Workspace) {
			continue
		}
		files := []LoadedFile{}
		for _, change := range provenance.Changes {
			if change.Action != "set" || filepath.Base(change.Path) != "CLAUDE.md" || !filepath.IsLocal(change.Path) {
				continue
			}
			reason := "nested_traversal"
			if filepath.Dir(change.Path) == "." {
				reason = "session_start"
			}
			files = append(files, LoadedFile{Path: filepath.Join(provenance.Workspace, change.Path), Digest: change.Digest, Reason: reason})
		}
		return files, true
	}
	return nil, false
}
