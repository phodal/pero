package claudehooks

import (
	"encoding/json"
	"errors"
	"strings"
)

// PromptHookAllowed reports whether this event accepts a prompt hook.
// Unsupported events skip the hook instead of calling the model.
func PromptHookAllowed(event string) bool {
	switch event {
	case "PermissionDenied", "PermissionRequest", "PostToolBatch", "PostToolUse", "PostToolUseFailure", "PreToolUse", "Stop", "SubagentStop", "TaskCompleted", "TaskCreated", "TeammateIdle", "UserPromptExpansion", "UserPromptSubmit":
		return true
	default:
		return false
	}
}

// RenderPrompt inserts the hook input at $ARGUMENTS. A backslash keeps a
// following dollar sign literal. Without the placeholder, the input is appended.
func RenderPrompt(template, arguments string) string {
	var builder strings.Builder
	used := false
	for index := 0; index < len(template); index++ {
		if template[index] == '\\' && index+1 < len(template) && template[index+1] == '$' {
			builder.WriteByte('$')
			index++
			continue
		}
		if strings.HasPrefix(template[index:], "$ARGUMENTS") {
			builder.WriteString(arguments)
			used = true
			index += len("$ARGUMENTS") - 1
			continue
		}
		builder.WriteByte(template[index])
	}
	if used {
		return builder.String()
	}
	if builder.Len() > 0 && !strings.HasSuffix(builder.String(), "\n") {
		builder.WriteByte('\n')
	}
	builder.WriteString(arguments)
	return builder.String()
}

// AgentDecision maps an agent hook response. It always continues on block, and
// it ignores the prompt-hook impossible field.
func AgentDecision(event, response string) (Decision, error) {
	parsed, err := parsePromptResponse(response)
	if err != nil {
		return Decision{}, err
	}
	parsed.impossible = false
	return promptDecision(event, true, parsed)
}

// PromptDecision maps a model response onto the event's prompt-hook behavior.
func PromptDecision(event string, continueOnBlock bool, response string) (Decision, error) {
	parsed, err := parsePromptResponse(response)
	if err != nil {
		return Decision{}, err
	}
	return promptDecision(event, continueOnBlock, parsed)
}

func promptDecision(event string, continueOnBlock bool, parsed promptResponse) (Decision, error) {
	if parsed.ok {
		return Decision{}, nil
	}
	reason := strings.TrimSpace(parsed.reason)
	if reason == "" {
		reason = "Prompt hook blocked the action."
	}
	switch event {
	case "Stop", "SubagentStop":
		if parsed.impossible {
			return Decision{}, nil
		}
		return Decision{Block: true, Reason: reason}, nil
	case "PreToolUse":
		decision := Decision{Permission: "deny", Block: true, Reason: reason}
		if !continueOnBlock {
			decision.EndTurn = true
		}
		return decision, nil
	case "PostToolUse":
		if continueOnBlock {
			return Decision{AdditionalContext: reason}, nil
		}
		return Decision{EndTurn: true, Reason: reason}, nil
	case "PostToolBatch", "UserPromptSubmit", "UserPromptExpansion":
		return Decision{Block: true, Reason: reason}, nil
	case "PostToolUseFailure", "TaskCreated", "TaskCompleted":
		return Decision{Block: true, Reason: reason}, nil
	case "PermissionRequest", "PermissionDenied", "TeammateIdle":
		if event == "TeammateIdle" && !continueOnBlock {
			return Decision{Block: true, Reason: reason}, nil
		}
		if event == "TeammateIdle" && continueOnBlock {
			return Decision{AdditionalContext: reason}, nil
		}
		return Decision{}, nil
	default:
		return Decision{Block: true, Reason: reason}, nil
	}
}

type promptResponse struct {
	ok         bool
	reason     string
	impossible bool
}

func parsePromptResponse(response string) (promptResponse, error) {
	text := strings.TrimSpace(response)
	if strings.HasPrefix(text, "```") {
		text = strings.TrimPrefix(text, "```json")
		text = strings.TrimPrefix(text, "```")
		if end := strings.LastIndex(text, "```"); end >= 0 {
			text = text[:end]
		}
		text = strings.TrimSpace(text)
	}
	start := strings.IndexByte(text, '{')
	end := strings.LastIndexByte(text, '}')
	if start < 0 || end < start {
		return promptResponse{}, errors.New("claudehooks: prompt hook response is not JSON")
	}
	var parsed struct {
		OK         *bool  `json:"ok"`
		Reason     string `json:"reason"`
		Impossible bool   `json:"impossible"`
	}
	if json.Unmarshal([]byte(text[start:end+1]), &parsed) != nil || parsed.OK == nil {
		return promptResponse{}, errors.New("claudehooks: prompt hook response requires ok")
	}
	return promptResponse{ok: *parsed.OK, reason: parsed.Reason, impossible: parsed.Impossible}, nil
}
