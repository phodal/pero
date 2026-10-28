package harness

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf16"
)

// Managed activations follow the current continuation message contract. Keep
// this separate from DeliverParentNotice, which is a legacy compatibility API.
func subagentSettlementSummary(childID SessionID, result SubagentResult, continuable bool) string {
	subject := "Background subagent " + string(childID)
	switch result.Reason {
	case FinishMaxTokens:
		return subject + " ran out of room before it finished."
	case FinishRefusal:
		return subject + " declined the task."
	case FinishAborted:
		return subject + " was stopped before it finished."
	case FinishError:
		return subject + " failed before it finished."
	case "", FinishStop:
		// Legacy native providers may omit Reason; retain their explicit status.
	default:
		return fmt.Sprintf("%s ended abnormally (%s) before it finished.", subject, result.Reason)
	}
	switch result.Status {
	case SubagentCompleted:
		if continuable {
			return subject + " finished and will do no further work unless you send it more."
		}
		return subject + " finished. It cannot receive follow-up messages."
	case SubagentAborted:
		return subject + " was stopped before it finished."
	default:
		return subject + " failed before it finished."
	}
}

func newSubagentSettlementMessage(childID SessionID, result SubagentResult, continuable bool) (Message, error) {
	if childID == "" {
		return Message{}, errors.New("harness: activation settlement requires a child identity")
	}
	summary := subagentSettlementSummary(childID, result, continuable)
	content := []ContentBlock{{Type: BlockText, Text: summary}}
	var closing []ContentBlock
	for _, block := range result.Output {
		// Parent model providers receive a user message, so assistant-only image,
		// reasoning and tool blocks must not be relayed as user content.
		if block.Type == BlockText && block.Text != "" {
			closing = append(closing, block)
		}
	}
	if len(closing) == 0 {
		content = append(content, ContentBlock{Type: BlockText, Text: "It left no closing message."})
	} else {
		content = append(content, ContentBlock{Type: BlockText, Text: "Its closing message:"})
		content = append(content, cloneContentBlocks(closing)...)
	}
	if result.Structured != nil {
		var encoded bytes.Buffer
		encoder := json.NewEncoder(&encoded)
		encoder.SetEscapeHTML(false)
		if err := encoder.Encode(result.Structured); err != nil {
			return Message{}, fmt.Errorf("harness: encode activation settlement: %w", err)
		}
		content = append(content, ContentBlock{Type: BlockText, Text: "Structured result: " + strings.TrimSuffix(encoded.String(), "\n")})
	}
	if result.Diagnostic != "" {
		content = append(content, ContentBlock{Type: BlockText, Text: result.Diagnostic})
	}
	// Match the upstream 120 UTF-16-code-unit source-summary bound. The full
	// model-facing summary is retained above; only the compact source is bounded.
	units := utf16.Encode([]rune(summary))
	if len(units) > 120 {
		summary = string(utf16.Decode(units[:119])) + "…"
	}
	source, err := json.Marshal(map[string]any{"kind": "subagent-settled", "form": "notice", "summary": summary, "senderSessionId": childID})
	if err != nil {
		return Message{}, err
	}
	id, err := newMessageID()
	if err != nil {
		return Message{}, fmt.Errorf("harness: create activation settlement identity: %w", err)
	}
	return Message{ID: id, Role: RoleUser, Content: content, Source: source}, nil
}

func deliverActivationParentNotice(parent *Agent, childID SessionID, result SubagentResult, continuable bool) error {
	if parent == nil {
		return errors.New("harness: activation settlement requires an exact parent")
	}
	message, err := newSubagentSettlementMessage(childID, result, continuable)
	if err != nil {
		return err
	}
	return parent.Deliver(message, true)
}
