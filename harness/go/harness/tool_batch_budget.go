package harness

import (
	"context"
	"sort"
)

// toolBatchBudget records text bytes only. Images, envelopes and provider token
// accounting are separate measurements. Unrecoverable output is never discarded.
type toolBatchBudget struct {
	BudgetBytes int  `json:"budget_bytes"`
	BeforeBytes int  `json:"before_bytes"`
	AfterBytes  int  `json:"after_bytes"`
	Projected   int  `json:"projected_results"`
	Met         bool `json:"met"`
}

func (a *Agent) projectToolBatch(ctx context.Context, outcomes []ToolOutcome, blocks []ContentBlock) error {
	budget := a.agentLoopConfig.ToolOutputBatchBytes()
	if budget == 0 {
		return nil
	}
	measurement := toolBatchBudget{BudgetBytes: budget}
	indices, sizes := []int{}, make([]int, len(blocks))
	for i, block := range blocks {
		for _, part := range block.Content {
			measurement.BeforeBytes += len(part.Text)
		}
		if text, ok := flattenToolText(block.Content); ok {
			indices = append(indices, i)
			sizes[i] = len(text)
		}
	}
	remaining := budget
	// Small results keep their whole allocation; remaining text shares the cap.
	sort.SliceStable(indices, func(i, j int) bool { return sizes[indices[i]] < sizes[indices[j]] })
	entry, found, err := a.tools.spills.projection(a.Scope())
	if err != nil {
		return err
	}
	for position, i := range indices {
		allocation := max(0, remaining/(len(indices)-position))
		if sizes[i] > allocation && found {
			entry.options.MaxInlineBytes = allocation
			result := outcomes[i].Result
			result.Content = blocks[i].Content
			projected, err := projectToolResult(ctx, outcomes[i].Request, result, "batch", outcomes[i].Request.Name+".txt", entry)
			if err != nil {
				return err
			}
			if !sameContent(projected.Content, blocks[i].Content) {
				measurement.Projected++
			}
			blocks[i].Content = projected.Content
		}
		text, _ := flattenToolText(blocks[i].Content)
		remaining -= len(text)
	}
	for _, block := range blocks {
		for _, part := range block.Content {
			measurement.AfterBytes += len(part.Text)
		}
	}
	measurement.Met = measurement.AfterBytes <= budget
	_, err = a.session.Append("tool/batch-budget", measurement)
	return err
}
