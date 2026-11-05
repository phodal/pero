package tool

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"

	harnessmodel "github.com/phodal/pero/harness/go/model"
	harnesssession "github.com/phodal/pero/harness/go/session"
)

const historyMarker = "[Earlier tool output omitted;"
const historyLocatorPrefix = "session-tool-result:"

func historyCleared(content []harnessmodel.ContentBlock) bool {
	for _, block := range content {
		if block.Type == harnessmodel.BlockText && strings.HasPrefix(block.Text, historyMarker) {
			return true
		}
	}
	return false
}

func clearedHistoryContent(content []harnessmodel.ContentBlock, owner string, seq uint64) []harnessmodel.ContentBlock {
	result := []harnessmodel.ContentBlock{{Type: harnessmodel.BlockText, Text: fmt.Sprintf(
		"%s recover the observed text with ReadToolOutput locator=%q. Discover the tool if deferred; reread before relying on omitted file content.]", historyMarker, fmt.Sprintf("%s%s:%d", historyLocatorPrefix, owner, seq))}}
	for _, block := range content {
		if block.Type != harnessmodel.BlockText {
			result = append(result, harnessmodel.CloneContentBlock(block))
		}
	}
	return result
}

// ReadSessionToolOutput reads only an exact tool/result in the supplied owner
// Session. Original events survive surface replacement and JSONL restart.
func ReadSessionToolOutput(session *harnesssession.Session, locator string, offset int64, limit int) (SpillTextLookup, error) {
	if !strings.HasPrefix(locator, historyLocatorPrefix) {
		return SpillTextLookup{}, nil
	}
	lookup := SpillTextLookup{Recognized: true}
	if session == nil {
		return lookup, errors.New("tool history: owner Session is required")
	}
	prefix := historyLocatorPrefix + string(session.Header().ID) + ":"
	if !strings.HasPrefix(locator, prefix) {
		// A fork owns a copied prefix; it never reads the parent's live store.
		header := session.Header()
		prefix = historyLocatorPrefix + string(header.ParentSession) + ":"
		if header.ParentSession == "" || !strings.HasPrefix(locator, prefix) {
			return lookup, nil
		}
		inherited, err := strconv.ParseUint(strings.TrimPrefix(locator, prefix), 10, 64)
		if err != nil || inherited > header.SeedLength {
			return lookup, nil
		}
	}
	seq, err := strconv.ParseUint(strings.TrimPrefix(locator, prefix), 10, 64)
	if err != nil || seq == 0 || offset < 0 || limit < utf8.UTFMax {
		return lookup, errors.New("tool history: invalid locator or byte range")
	}
	for _, event := range session.Events() {
		if event.Seq != seq || event.Type != "tool/result" {
			continue
		}
		var block harnessmodel.ContentBlock
		if err := json.Unmarshal(event.Data, &block); err != nil {
			return lookup, err
		}
		var parts []string
		for _, child := range block.Content {
			if child.Type == harnessmodel.BlockText {
				parts = append(parts, child.Text)
			}
		}
		text := strings.Join(parts, "\n")
		if offset > int64(len(text)) || offset < int64(len(text)) && !utf8.RuneStart(text[offset]) {
			return lookup, errors.New("tool history: offset must be within text at a UTF-8 boundary")
		}
		end := min(int64(len(text)), offset+int64(limit))
		for end < int64(len(text)) && !utf8.RuneStart(text[end]) {
			end--
		}
		lookup.Read = &SpillTextRead{Text: text[offset:end], Truncated: end < int64(len(text))}
		return lookup, nil
	}
	return lookup, nil
}

type historyCommandOutcome struct {
	ExitCode *int                   `json:"exitCode"`
	TimedOut bool                   `json:"timedOut"`
	Aborted  bool                   `json:"aborted"`
	Status   string                 `json:"status"`
	Result   *historyCommandOutcome `json:"result"`
}

func (o historyCommandOutcome) failed() bool {
	return o.ExitCode != nil && *o.ExitCode != 0 || o.TimedOut || o.Aborted || o.Status == "failed" || o.Status == "interrupted" || o.Result != nil && o.Result.failed()
}

func protectedHistoryResult(name string, block harnessmodel.ContentBlock) bool {
	if block.IsError {
		return true
	}
	if name != "Bash" && name != "shell" && name != "TaskOutput" {
		return false
	}
	for _, content := range block.Content {
		if content.Type != harnessmodel.BlockText {
			continue
		}
		var observed historyCommandOutcome
		if json.Unmarshal([]byte(content.Text), &observed) != nil {
			continue
		}
		if observed.failed() {
			return true
		}
	}
	return false
}

// PruneHistorySession runs at request boundaries independently of model-driven
// compaction. Legacy per-result-only policies keep their original trigger.
func (p *ToolResultPruner) PruneHistorySession(session *harnesssession.Session) (ToolResultPruneResult, error) {
	if p == nil || p.config.totalChars == 0 {
		return ToolResultPruneResult{}, nil
	}
	return p.PruneSession(session)
}
