package main

import (
	"errors"
	"flag"
	"math"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/providers/openai"
)

// Capacity is an explicit operator declaration, never inferred from model names.
// Omission preserves the original no-compaction launch behavior.
type compactionFlags struct {
	ContextWindow     int
	Disabled          bool
	Threshold, Retain float64
	SummaryTokens     int
	TriggerTokens     int
	RetainTokens      int
}

func bindCompaction(flags *flag.FlagSet) *compactionFlags {
	c := &compactionFlags{}
	flags.IntVar(&c.ContextWindow, "context-window", 0, "declared model context tokens; positive enables automatic compaction (0 disables)")
	flags.BoolVar(&c.Disabled, "disable-compaction", false, "disable compaction even with a declared context window")
	flags.Float64Var(&c.Threshold, "compaction-threshold", .8, "compact at this context fraction, in (0, 1]")
	flags.Float64Var(&c.Retain, "compaction-retain-ratio", .16, "recent context fraction to retain, below threshold")
	flags.IntVar(&c.SummaryTokens, "compaction-summary-tokens", 0, "summary output cap; 0 chooses min(8192, context-window/8)")
	flags.IntVar(&c.TriggerTokens, "compaction-trigger-tokens", 0, "absolute automatic compaction trigger; 0 uses context fraction, requires context-window")
	flags.IntVar(&c.RetainTokens, "compaction-retain-tokens", 0, "recent token budget after compaction; 0 uses retain ratio")
	return c
}

// Reuse the effect-owned Point engine, sharing the configured provider's process
// request/token limits. Summary calls therefore cannot bypass provider budgets.
func configuredCompaction(provider *openai.Config, c compactionFlags) (*harness.BasicCompactionConfig, error) {
	// Keep float-to-int budget rounding exact and subtraction safe on all Go targets.
	if c.ContextWindow > 1<<30 {
		return nil, errors.New("context-window must not exceed 1073741824 tokens")
	}
	if c.ContextWindow < 0 || c.SummaryTokens < 0 || c.TriggerTokens < 0 || c.RetainTokens < 0 {
		return nil, errors.New("compaction token budgets must be nonnegative")
	}
	if math.IsNaN(c.Threshold) || math.IsInf(c.Threshold, 0) || c.Threshold <= 0 || c.Threshold > 1 {
		return nil, errors.New("compaction-threshold must be finite and in (0, 1]")
	}
	if math.IsNaN(c.Retain) || math.IsInf(c.Retain, 0) || c.Retain < 0 || c.Retain >= c.Threshold {
		return nil, errors.New("compaction-retain-ratio must be finite, nonnegative, and below threshold")
	}
	if provider == nil || len(provider.Models) != 1 {
		return nil, errors.New("compaction launch requires exactly one declared model")
	}
	if c.ContextWindow > 0 && provider.Models[0].MaxTokens >= c.ContextWindow {
		return nil, errors.New("max-tokens must be below context-window")
	}
	if c.ContextWindow == 0 || c.Disabled {
		if c.ContextWindow == 0 && (c.SummaryTokens != 0 || c.TriggerTokens != 0 || c.RetainTokens != 0) {
			return nil, errors.New("compaction token budgets require context-window")
		}
		provider.Models[0].ContextWindow = c.ContextWindow
		return nil, nil
	}
	summary := c.SummaryTokens
	if summary == 0 {
		summary = min(8192, c.ContextWindow/8)
	}
	if provider.MaxOutputTokens > 0 {
		summary = min(summary, provider.MaxOutputTokens)
	}
	// Reserve summary-sized headroom in addition to the main output reservation.
	// Validate the same integer-rounded budgets used by the existing engine.
	budget := c.ContextWindow - provider.Models[0].MaxTokens
	if c.TriggerTokens > 0 {
		c.Threshold = min(c.Threshold, float64(c.TriggerTokens)/float64(c.ContextWindow))
	}
	threshold := min(int(math.Floor(float64(c.ContextWindow)*c.Threshold)), budget-summary)
	retain := int(math.Floor(float64(budget) * c.Retain))
	var retainRatio, retainTokens = &c.Retain, (*int)(nil)
	if c.RetainTokens > 0 {
		retain, retainRatio, retainTokens = c.RetainTokens, nil, &c.RetainTokens
	}
	if summary < 1 || summary >= budget || threshold <= 0 || retain >= threshold || retain < 1 {
		return nil, errors.New("compaction context/output/headroom/retention settings leave no usable pressure budget")
	}
	provider.Models[0].ContextWindow = c.ContextWindow
	retries, overflow := 1, 1
	return &harness.BasicCompactionConfig{
		ThresholdRatio: c.Threshold, RetainRatio: retainRatio, RetainTokens: retainTokens,
		HeadroomTokens: &summary, MaxTokens: summary,
		CompactionRetries: &retries, MaxOverflowRetries: &overflow,
	}, nil
}
