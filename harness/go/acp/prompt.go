package acp

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/phodal/pero/harness/go/harness"
)

func (s *Server) prompt(ctx context.Context, params PromptParams) (string, error) {
	record, err := s.currentRecord(harness.SessionID(params.SessionID))
	if err != nil {
		return "", err
	}
	record.mu.Lock()
	if record.closing {
		record.mu.Unlock()
		return "", invalidError("session is closing: " + params.SessionID)
	}
	if record.inflight || record.modelChanging {
		record.mu.Unlock()
		return "", invalidError("session already has an active prompt: " + params.SessionID)
	}
	// The prompt owns cancellation from admission through settlement, including
	// the interval before the Agent has installed its active-turn canceler.
	promptCtx, cancel := context.WithCancel(ctx)
	record.inflight = true
	record.promptCancel = cancel
	record.cancelRequested = false
	record.mu.Unlock()
	defer cancel()
	content, promptErr := promptBlocks(promptCtx, s.h.Attachments(), params.Prompt)
	var result harness.TurnResult
	var cleanup func()
	if promptErr == nil {
		message := harness.Message{Role: harness.RoleUser, Content: content}
		if s.preparePrompt != nil {
			var id harness.SessionID
			id, promptErr = randomSessionID()
			if promptErr == nil {
				message.ID = string(id)
				cleanup, promptErr = s.preparePrompt(promptCtx, record.agent, &message)
			}
		}
		if promptErr == nil {
			result, promptErr = record.agent.Prompt(promptCtx, message)
			for attempt := 1; promptErr == nil && promptCtx.Err() == nil && result.Reason == harness.FinishMaxTokens && attempt <= s.outputLimitRecoveries; attempt++ {
				source, _ := json.Marshal(struct {
					Kind    string `json:"kind"`
					Attempt int    `json:"attempt"`
					Turn    int    `json:"previous_turn"`
				}{"acp/output-limit-recovery", attempt, result.Turn})
				if _, promptErr = record.agent.Session().Append("acp/output-limit-recovery", json.RawMessage(source)); promptErr != nil {
					break
				}
				result, promptErr = record.agent.PromptFollowup(promptCtx, harness.Message{Role: harness.RoleUser, Source: source, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "The previous turn reached its output token limit. Incomplete tool calls were discarded and did not write files. Inspect the current files before continuing the original task. Use smaller complete operations: write a minimal working skeleton, then fill it with focused incremental edits. Do not resend the same large file or replay incomplete arguments. Preserve the original requirements and verify the completed artifacts."}}})
			}
		}
		// Prompt can return as soon as its context is canceled. Retain the ACP
		// slot until the worker has stopped, so the next turn cannot overlap it.
		if promptCtx.Err() != nil {
			promptErr = errors.Join(promptErr, record.agent.WhenIdle(context.WithoutCancel(ctx)))
		}
	}
	// Finish native staging before reopening the ACP prompt slot. A subsequent
	// prompt must not race cleanup of an earlier rejected/cancelled candidate.
	if cleanup != nil {
		cleanup()
	}
	record.mu.Lock()
	cancelled := record.cancelRequested
	record.inflight = false
	record.promptCancel = nil
	record.mu.Unlock()
	if cancelled {
		return "cancelled", nil
	}
	if promptErr != nil {
		// The native Session retains the budget failure. ACP represents this
		// expected execution limit as a stop reason, not a transport failure.
		if harness.ProviderFailureFromError(promptErr).Code == harness.RequestBudgetExhaustedCode {
			return "max_turn_requests", nil
		}
		return "", promptErr
	}
	if s.sessionTitles {
		record.agent.StartSessionTitle(result.Turn)
	}
	return promptStopReason(result.Reason), nil
}

func promptStopReason(reason harness.FinishKind) string {
	switch reason {
	case harness.FinishMaxTokens:
		return "max_tokens"
	case harness.FinishRefusal:
		return "refusal"
	default:
		return "end_turn"
	}
}
