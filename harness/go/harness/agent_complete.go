package harness

import (
	"context"
	"errors"
	"strings"
)

// CompleteOnce runs one model call outside the turn loop. An empty model uses
// the session route. The call is not recorded as a conversation turn.
func (a *Agent) CompleteOnce(ctx context.Context, model, prompt string) (string, error) {
	if a == nil {
		return "", errors.New("harness: agent is required")
	}
	selection := a.ModelSelection()
	if strings.TrimSpace(model) != "" {
		selection.Model = model
		selection.ReasoningEffort = ""
	}
	return a.CompleteOnceWithSelection(ctx, selection, prompt)
}

// CompleteOnceWithSelection runs a one-shot call using a host-resolved route,
// without changing the agent's model selection or recording a turn.
func (a *Agent) CompleteOnceWithSelection(ctx context.Context, selection AgentModelSelection, prompt string) (string, error) {
	if a == nil {
		return "", errors.New("harness: agent is required")
	}
	prepared, _, _, _, err := prepareGenerateCall(ctx, a.adapter, a.modelInfo, GenerateRequest{Provider: selection.Provider, Model: selection.Model, Agent: a})
	if err != nil {
		return "", err
	}
	completion, err := prepared.Generate(ctx, GenerateRequest{
		Provider: selection.Provider, Model: selection.Model, Purpose: "hook", Agent: a,
		Messages:  []Message{{Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: prompt}}}},
		MaxTokens: 1024,
	}, func(StreamChunk) error { return nil })
	if err != nil {
		return "", err
	}
	var text []string
	for _, block := range completion.Message.Content {
		if block.Type == BlockText && block.Text != "" {
			text = append(text, block.Text)
		}
	}
	return strings.Join(text, "\n"), nil
}
