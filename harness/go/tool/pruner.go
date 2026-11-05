package tool

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"

	harnessmodel "github.com/phodal/pero/harness/go/model"
	point "github.com/phodal/pero/harness/go/runtime"
	harnesssession "github.com/phodal/pero/harness/go/session"
)

const ToolResultPruneMarker = "\n\n[... tool result middle pruned ...]\n\n"

var ResultPrunerPolicyKey = point.NewKey[*ToolResultPrunerPolicy]("harness.tool-result-pruner.policy")

type ToolResultPruneConfig struct {
	ThresholdChars *int `json:"thresholdChars,omitempty"`
	HeadChars      *int `json:"headChars,omitempty"`
	TailChars      *int `json:"tailChars,omitempty"`
	// TotalChars enables history-wide clearing with a low watermark. Nil keeps
	// the source-compatible per-result policy. Recent results and unique errors survive.
	TotalChars        *int `json:"totalChars,omitempty"`
	LowWatermarkChars *int `json:"lowWatermarkChars,omitempty"`
	KeepRecent        *int `json:"keepRecent,omitempty"`
	DeduplicateErrors bool `json:"deduplicateErrors,omitempty"`
}

type resolvedToolResultPruneConfig struct {
	thresholdChars    int
	headChars         int
	tailChars         int
	marker            string
	totalChars        int
	lowWatermark      int
	keepRecent        int
	deduplicateErrors bool
}

type PrunedToolResult struct {
	OriginalSeq    uint64                  `json:"originalSeq"`
	ReplacementSeq uint64                  `json:"replacementSeq"`
	ToolCallID     harnessmodel.ToolCallID `json:"toolCallId"`
	CharsBefore    int                     `json:"charsBefore"`
	CharsAfter     int                     `json:"charsAfter"`
}

type ToolResultPruneResult struct {
	Pruned       []PrunedToolResult `json:"pruned"`
	CharsRemoved int                `json:"charsRemoved"`
}

type ToolResultPruner struct {
	config resolvedToolResultPruneConfig
}

type toolResultPrunerOverride struct {
	id     uint64
	pruner *ToolResultPruner
	active bool
}

// ToolResultPrunerPolicy owns root-scoped profile overrides for the
// model-free tool-result pruner. An active nil pruner is intentional: it
// disables pruning even when an Agent has an explicit local configuration.
// With no active override, each Agent keeps using its own mounted pruner.
type ToolResultPrunerPolicy struct {
	mu             sync.RWMutex
	nextOverrideID uint64
	overrides      []*toolResultPrunerOverride
	effective      *ToolResultPruner
	overridden     bool
}

type ToolResultPrunerPolicySnapshot struct {
	Overridden        bool `json:"overridden"`
	Enabled           bool `json:"enabled"`
	ThresholdChars    int  `json:"thresholdChars,omitempty"`
	HeadChars         int  `json:"headChars,omitempty"`
	TailChars         int  `json:"tailChars,omitempty"`
	TotalChars        int  `json:"totalChars,omitempty"`
	LowWatermark      int  `json:"lowWatermarkChars,omitempty"`
	KeepRecent        int  `json:"keepRecent,omitempty"`
	DeduplicateErrors bool `json:"deduplicateErrors,omitempty"`
}

// Snapshot reports the immutable effective generation without exposing its
// executable pruner. It is suitable for diagnostics and reload barriers.
func (p *ToolResultPrunerPolicy) Snapshot() ToolResultPrunerPolicySnapshot {
	pruner, overridden := p.Effective()
	snapshot := ToolResultPrunerPolicySnapshot{Overridden: overridden, Enabled: overridden && pruner != nil}
	if pruner != nil {
		snapshot.ThresholdChars = pruner.config.thresholdChars
		snapshot.HeadChars = pruner.config.headChars
		snapshot.TailChars = pruner.config.tailChars
		snapshot.TotalChars = pruner.config.totalChars
		snapshot.LowWatermark = pruner.config.lowWatermark
		snapshot.KeepRecent = pruner.config.keepRecent
		snapshot.DeduplicateErrors = pruner.config.deduplicateErrors
	}
	return snapshot
}

// Override installs one higher-priority profile policy until the returned
// disposer is called. The candidate is validated before the visible policy is
// changed, so a failed live reload retains the last-good generation.
func (p *ToolResultPrunerPolicy) Override(config ToolResultPruneConfig, enabled bool) (point.Dispose, error) {
	if p == nil {
		return nil, errors.New("harness: tool-result pruner policy is nil")
	}
	var next *ToolResultPruner
	var err error
	if enabled {
		next, err = NewToolResultPruner(config)
		if err != nil {
			return nil, err
		}
	}
	p.mu.Lock()
	p.nextOverrideID++
	override := &toolResultPrunerOverride{id: p.nextOverrideID, pruner: next, active: true}
	p.overrides = append(p.overrides, override)
	p.effective = next
	p.overridden = true
	p.mu.Unlock()
	var once sync.Once
	return func(context.Context) error {
		once.Do(func() {
			p.mu.Lock()
			override.active = false
			for len(p.overrides) > 0 && !p.overrides[len(p.overrides)-1].active {
				p.overrides = p.overrides[:len(p.overrides)-1]
			}
			p.effective = nil
			p.overridden = false
			if len(p.overrides) > 0 {
				p.effective = p.overrides[len(p.overrides)-1].pruner
				p.overridden = true
			}
			p.mu.Unlock()
		})
		return nil
	}, nil
}

// Effective returns the active profile override and whether one is installed.
// A nil pruner with overridden=true intentionally disables local pruning.
func (p *ToolResultPrunerPolicy) Effective() (*ToolResultPruner, bool) {
	if p == nil {
		return nil, false
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.effective, p.overridden
}

func NewToolResultPruner(config ToolResultPruneConfig) (*ToolResultPruner, error) {
	resolved := resolvedToolResultPruneConfig{
		thresholdChars: 8192,
		headChars:      4096,
		tailChars:      1024,
		marker:         ToolResultPruneMarker,
	}
	if config.ThresholdChars != nil {
		resolved.thresholdChars = *config.ThresholdChars
	}
	if config.HeadChars != nil {
		resolved.headChars = *config.HeadChars
	}
	if config.TailChars != nil {
		resolved.tailChars = *config.TailChars
	}
	if resolved.thresholdChars <= 0 || resolved.headChars < 0 || resolved.tailChars < 0 {
		return nil, errors.New("harness: invalid tool-result prune character limits")
	}
	if resolved.headChars+len([]rune(resolved.marker))+resolved.tailChars > resolved.thresholdChars {
		return nil, errors.New("harness: tool-result prune head, marker, and tail exceed threshold")
	}
	if config.TotalChars != nil {
		resolved.totalChars = *config.TotalChars
		resolved.lowWatermark = resolved.totalChars / 2
		resolved.keepRecent = 4
	}
	if config.LowWatermarkChars != nil {
		resolved.lowWatermark = *config.LowWatermarkChars
	}
	if config.KeepRecent != nil {
		resolved.keepRecent = *config.KeepRecent
	}
	if resolved.totalChars < 0 || resolved.lowWatermark < 0 || resolved.keepRecent < 0 ||
		(resolved.totalChars > 0 && resolved.lowWatermark >= resolved.totalChars) ||
		(resolved.totalChars == 0 && (config.LowWatermarkChars != nil || config.KeepRecent != nil)) {
		return nil, errors.New("harness: invalid tool history watermark or recent-result protection")
	}
	if config.DeduplicateErrors && resolved.totalChars == 0 {
		return nil, errors.New("harness: duplicate error projection requires history watermarks")
	}
	resolved.deduplicateErrors = config.DeduplicateErrors
	return &ToolResultPruner{config: resolved}, nil
}

func (p *ToolResultPruner) MeasureContent(content []harnessmodel.ContentBlock) int {
	if p == nil {
		return 0
	}
	total := 0
	for _, block := range content {
		if block.Type == harnessmodel.BlockText {
			total += len([]rune(block.Text))
		}
	}
	return total
}

func (p *ToolResultPruner) PruneContent(content []harnessmodel.ContentBlock) ([]harnessmodel.ContentBlock, bool, error) {
	if p == nil {
		return nil, false, errors.New("harness: tool-result pruner is nil")
	}
	total := p.MeasureContent(content)
	if total <= p.config.thresholdChars {
		return harnessmodel.CloneContentBlocks(content), false, nil
	}
	headRemaining, tailStart := p.config.headChars, total-p.config.tailChars
	textOffset, markerWritten := 0, false
	result := make([]harnessmodel.ContentBlock, 0, len(content)+1)
	for _, source := range content {
		if source.Type != harnessmodel.BlockText {
			result = append(result, harnessmodel.CloneContentBlock(source))
			continue
		}
		characters := []rune(source.Text)
		blockStart, blockEnd := textOffset, textOffset+len(characters)
		keepHead := min(len(characters), max(0, headRemaining-blockStart))
		keepTailFrom := max(0, tailStart-blockStart)
		if keepTailFrom > len(characters) {
			keepTailFrom = len(characters)
		}
		removedStart, removedEnd := blockStart+keepHead, blockStart+keepTailFrom
		marker := ""
		if removedEnd > removedStart && !markerWritten {
			marker = p.config.marker
			markerWritten = true
		}
		text := string(characters[:keepHead]) + marker + string(characters[keepTailFrom:])
		if text != "" {
			block := harnessmodel.CloneContentBlock(source)
			block.Text = text
			result = append(result, block)
		}
		textOffset = blockEnd
	}
	if !markerWritten {
		return nil, false, errors.New("harness: over-budget tool result produced no prunable span")
	}
	after := p.MeasureContent(result)
	if after > p.config.thresholdChars || after >= total {
		return nil, false, errors.New("harness: tool-result replacement must shrink within threshold")
	}
	return result, true, nil
}

func (p *ToolResultPruner) PruneSession(session *harnesssession.Session) (ToolResultPruneResult, error) {
	if p == nil || session == nil {
		return ToolResultPruneResult{}, errors.New("harness: tool-result pruning requires a pruner and session")
	}
	events, surface := session.HistorySnapshot()
	if active, err := harnesssession.InspectCompactionLog(events); err != nil {
		return ToolResultPruneResult{}, err
	} else if active {
		return ToolResultPruneResult{}, errors.New("harness: tool-result pruning found an open compaction bracket")
	}
	if open, err := harnesssession.InspectOpenTurn(events); err != nil {
		return ToolResultPruneResult{}, err
	} else if open == nil {
		return ToolResultPruneResult{}, errors.New("harness: tool-result pruning requires an open turn")
	}
	eventsBySeq := make(map[uint64]harnessmodel.Event, len(events))
	type callInfo struct {
		CallID    harnessmodel.ToolCallID `json:"callId"`
		Name      string                  `json:"name"`
		Arguments json.RawMessage         `json:"arguments"`
	}
	pending := make(map[harnessmodel.ToolCallID]callInfo)
	callsByResult := make(map[uint64]callInfo)
	for _, event := range events {
		eventsBySeq[event.Seq] = event
		if event.Type == "tool/call" {
			var call callInfo
			if json.Unmarshal(event.Data, &call) == nil {
				pending[call.CallID] = call
			}
		}
		if event.Type == "tool/result" {
			var result harnessmodel.ContentBlock
			if json.Unmarshal(event.Data, &result) == nil {
				var operation struct {
					Op    string `json:"op"`
					Start uint64 `json:"start"`
					End   uint64 `json:"end"`
				}
				projection := json.Unmarshal(event.SurfaceOp, &operation) == nil && operation.Op == "replace" && len(event.SourceEventSeqs) == 1 && operation.Start == event.SourceEventSeqs[0] && operation.End == operation.Start
				if projection {
					source := callsByResult[event.SourceEventSeqs[0]]
					if source.CallID == result.ToolCallID {
						callsByResult[event.Seq] = source
					}
				} else {
					callsByResult[event.Seq] = pending[result.ToolCallID]
					delete(pending, result.ToolCallID)
				}
			}
		}
	}
	// Capture one stable surface before appending replacements.
	type candidate struct {
		event        harnessmodel.Event
		block        harnessmodel.ContentBlock
		chars        int
		protected    bool
		duplicateKey string
		latestSeq    uint64
	}
	var candidates []candidate
	total, recent := 0, 0
	for _, seq := range surface {
		event, ok := eventsBySeq[seq]
		if !ok || event.Type != "tool/result" {
			continue
		}
		var block harnessmodel.ContentBlock
		if err := json.Unmarshal(event.Data, &block); err != nil {
			return ToolResultPruneResult{}, fmt.Errorf("harness: decode tool/result at seq %d: %w", seq, err)
		}
		chars := p.MeasureContent(block.Content)
		call := callsByResult[event.Seq]
		protected := protectedHistoryResult(call.Name, block)
		c := candidate{event: event, block: block, chars: chars, protected: protected}
		if p.config.deduplicateErrors && protected && !historyCleared(block.Content) {
			diagnostic := ObserveDiagnostic(call.Name, call.Arguments, block.Content, block.IsError)
			if diagnostic.Deduplicable {
				c.duplicateKey = call.Name + ":" + diagnosticHash(string(call.Arguments)) + ":" + diagnostic.Fingerprint
			}
		}
		candidates = append(candidates, c)
		total += chars
	}
	// The latest identical complete diagnostic is always retained. Count recent
	// protection after identifying eligible duplicates, not before.
	latest := make(map[string]uint64)
	for _, c := range candidates {
		if c.duplicateKey != "" {
			latest[c.duplicateKey] = c.event.Seq
		}
	}
	recent = 0
	for i := range candidates {
		c := &candidates[i]
		if seq := latest[c.duplicateKey]; c.duplicateKey != "" && seq > c.event.Seq {
			c.protected = false
			c.latestSeq = seq
		}
		if c.chars > 0 && !c.protected && !historyCleared(c.block.Content) {
			recent++
		}
	}
	clearing := p.config.totalChars > 0 && total > p.config.totalChars
	result := ToolResultPruneResult{}
	for _, c := range candidates {
		event, block, before := c.event, c.block, c.chars
		if p.config.totalChars > 0 {
			if c.protected || before == 0 || historyCleared(block.Content) {
				continue
			}
			recent--
			if recent < p.config.keepRecent || !clearing || total <= p.config.lowWatermark {
				continue
			}
		}
		var pruned []harnessmodel.ContentBlock
		var changed bool
		if p.config.totalChars > 0 {
			pruned = clearedHistoryContent(block.Content, string(session.Header().ID), event.Seq)
			if c.latestSeq > 0 {
				pruned[0].Text += fmt.Sprintf(" Identical complete diagnostic retained at result seq %d; this remains a failed operation.", c.latestSeq)
			}
			changed = p.MeasureContent(pruned) < before
		} else {
			var err error
			pruned, changed, err = p.PruneContent(block.Content)
			if err != nil {
				return result, fmt.Errorf("harness: prune tool/result at seq %d: %w", event.Seq, err)
			}
		}
		if !changed {
			continue
		}
		var raw map[string]json.RawMessage
		if err := json.Unmarshal(event.Data, &raw); err != nil {
			return result, fmt.Errorf("harness: preserve tool/result at seq %d: %w", event.Seq, err)
		}
		content, err := json.Marshal(pruned)
		if err != nil {
			return result, err
		}
		raw["content"] = content
		replacement, err := json.Marshal(raw)
		if err != nil {
			return result, err
		}
		shadowedTokens := harnessmodel.EstimateMessageTokens(harnessmodel.Message{
			Role:    harnessmodel.RoleTool,
			Content: []harnessmodel.ContentBlock{block},
		})
		committed, err := session.AppendPrunedToolResult(event.Seq, replacement, shadowedTokens)
		if err != nil {
			return result, err
		}
		after := p.MeasureContent(pruned)
		result.Pruned = append(result.Pruned, PrunedToolResult{
			OriginalSeq: event.Seq, ReplacementSeq: committed.Seq, ToolCallID: block.ToolCallID,
			CharsBefore: before, CharsAfter: after,
		})
		result.CharsRemoved += before - after
		total -= before - after
	}
	return result, nil
}
