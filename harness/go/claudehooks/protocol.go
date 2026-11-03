// Package claudehooks implements command-hook decisions independently of the
// agent loop. The host owns when hooks run and the authority of their effects.
package claudehooks

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
)

type Hook struct {
	Event, Matcher string
	Command        string
	Args           []string
	ExecForm       bool
	Timeout        time.Duration
	Async          bool
	// If is one permission rule. It selects tool events and skips every other event.
	If string
	// Once removes a skill frontmatter hook after its first successful run.
	Once bool
	// OnFailure is "", "continue", or "block". Empty and continue leave the
	// triggering action in place when the hook fails. block denies it.
	OnFailure string
}

type Input struct {
	SessionID            string          `json:"session_id"`
	CWD                  string          `json:"cwd"`
	Event                string          `json:"hook_event_name"`
	ToolName             string          `json:"tool_name,omitempty"`
	ToolUseID            string          `json:"tool_use_id,omitempty"`
	ToolInput            json.RawMessage `json:"tool_input,omitempty"`
	FilePath             string          `json:"file_path,omitempty"`
	NotebookPath         string          `json:"notebook_path,omitempty"`
	ToolResponse         json.RawMessage `json:"tool_response,omitempty"`
	TranscriptPath       string          `json:"transcript_path,omitempty"`
	AgentID              string          `json:"agent_id,omitempty"`
	AgentType            string          `json:"agent_type,omitempty"`
	AgentTranscriptPath  string          `json:"agent_transcript_path,omitempty"`
	StopHookActive       bool            `json:"stop_hook_active"`
	Source               string          `json:"source,omitempty"`
	Trigger              string          `json:"trigger,omitempty"`
	Prompt               string          `json:"prompt,omitempty"`
	LastAssistantMessage string          `json:"last_assistant_message,omitempty"`
	Reason               string          `json:"reason,omitempty"`
}

type Decision struct {
	Permission        string
	Reason            string
	AdditionalContext string
	SystemMessage     string
	UpdatedInput      json.RawMessage
	Block, Stop       bool
}

var ErrNonBlocking = errors.New("claudehooks: non-blocking hook error")

type output struct {
	Continue           *bool           `json:"continue"`
	StopReason         string          `json:"stopReason"`
	SystemMessage      string          `json:"systemMessage"`
	Decision           string          `json:"decision"`
	Reason             string          `json:"reason"`
	AdditionalContext  string          `json:"additionalContext"`
	SuppressOutput     bool            `json:"suppressOutput"`
	HookSpecificOutput *specificOutput `json:"hookSpecificOutput"`
}

type specificOutput struct {
	Event             string          `json:"hookEventName"`
	Permission        string          `json:"permissionDecision"`
	Reason            string          `json:"permissionDecisionReason"`
	UpdatedInput      json.RawMessage `json:"updatedInput"`
	AdditionalContext string          `json:"additionalContext"`
}

// Match implements exact alternatives and the Go-compatible portion of JS
// regular expressions. Unsupported regexp syntax is returned as an error.
func Match(matcher, value string) (bool, error) {
	matcher = strings.TrimSpace(matcher)
	if matcher == "" || matcher == "*" {
		return true, nil
	}
	if !strings.ContainsAny(matcher, `.^$*+?()[]{}\`) {
		for _, alternative := range strings.FieldsFunc(matcher, func(r rune) bool { return r == '|' || r == ',' }) {
			if strings.TrimSpace(alternative) == value {
				return true, nil
			}
		}
		return false, nil
	}
	compiled, err := regexp.Compile(matcher)
	if err != nil {
		return false, fmt.Errorf("claudehooks: unsupported matcher syntax: %w", err)
	}
	return compiled.MatchString(value), nil
}

// ParseDecision applies event-specific command-hook output semantics. Exit 2
// remains blocking on supported blocking events even if stdout JSON is invalid.
func ParseDecision(event string, stdout, stderr []byte, exitCode int) (Decision, error) {
	if exitCode != 0 && exitCode != 2 {
		return Decision{}, fmt.Errorf("%w for %s (exit %d): %s", ErrNonBlocking, event, exitCode, strings.TrimSpace(string(stderr)))
	}
	stdout = bytes.TrimSpace(stdout)
	var decision Decision
	var parseErr error
	if len(stdout) > 0 {
		if stdout[0] == '{' {
			decoder := json.NewDecoder(bytes.NewReader(stdout))
			decoder.DisallowUnknownFields()
			var wire output
			if err := decoder.Decode(&wire); err != nil || !json.Valid(stdout) {
				parseErr = errors.New("claudehooks: invalid or unsupported hook JSON output")
			} else {
				decision, parseErr = wire.decision(event)
			}
		} else if event == "SessionStart" || event == "UserPromptSubmit" {
			decision.AdditionalContext = string(stdout)
		}
	}
	if exitCode == 2 {
		if !blockingEvent(event) {
			return Decision{}, fmt.Errorf("%w for %s (exit 2): %s", ErrNonBlocking, event, strings.TrimSpace(string(stderr)))
		}
		decision.Block = true
		decision.Stop = false
		if event == "PreToolUse" {
			decision.Permission = "deny"
		}
		if decision.Reason == "" {
			decision.Reason = strings.TrimSpace(string(stderr))
		}
		if decision.Reason == "" && len(stdout) > 0 && stdout[0] != '{' {
			decision.Reason = string(stdout)
		}
		if decision.Reason == "" {
			decision.Reason = "Hook blocked the action."
		}
		return decision, nil
	}
	if parseErr != nil {
		return Decision{}, parseErr
	}
	return decision, nil
}

func (wire output) decision(event string) (Decision, error) {
	result := Decision{Reason: wire.Reason, SystemMessage: wire.SystemMessage, AdditionalContext: wire.AdditionalContext}
	if wire.Decision != "" && wire.Decision != "block" && wire.Decision != "approve" {
		return Decision{}, errors.New("claudehooks: unsupported top-level hook decision")
	}
	if wire.Decision == "block" && blockingEvent(event) {
		result.Block = true
	}
	if event == "PreToolUse" {
		if wire.Decision == "block" {
			result.Permission = "deny"
		} else if wire.Decision == "approve" {
			result.Permission = "allow"
		}
	}
	if specific := wire.HookSpecificOutput; specific != nil {
		if specific.Event != "" && specific.Event != event {
			return Decision{}, errors.New("claudehooks: hook output event does not match its invocation")
		}
		result.AdditionalContext = joinContext(result.AdditionalContext, specific.AdditionalContext)
		if specific.Permission != "" {
			if event != "PreToolUse" && event != "PreModelSwitch" {
				return Decision{}, errors.New("claudehooks: permission decision is unsupported for this event")
			}
			if permissionRank(specific.Permission) < 0 {
				return Decision{}, errors.New("claudehooks: unsupported permission decision")
			}
			result.Permission = specific.Permission
			result.Reason = specific.Reason
			result.Block = specific.Permission == "deny"
		}
		if len(specific.UpdatedInput) > 0 && string(specific.UpdatedInput) != "null" {
			if event != "PreToolUse" || !jsonObject(specific.UpdatedInput) {
				return Decision{}, errors.New("claudehooks: updatedInput requires a PreToolUse JSON object")
			}
			result.UpdatedInput = append(json.RawMessage(nil), specific.UpdatedInput...)
		}
	}
	if wire.Continue != nil && !*wire.Continue && runControlEvent(event) {
		result.Stop = true
		result.Reason = wire.StopReason
	}
	if event == "PreCompact" || event == "PostCompact" || event == "SessionEnd" {
		result.SystemMessage = ""
		result.Stop = false
		result.AdditionalContext = ""
	}
	return result, nil
}

// Merge makes permission precedence explicit and rejects contradictory input
// replacements instead of silently choosing whichever hook happened to finish.
func Merge(decisions []Decision) (Decision, error) {
	var merged Decision
	reasonRank := -1
	for _, decision := range decisions {
		rank := permissionRank(decision.Permission)
		if rank < 0 {
			return Decision{}, errors.New("claudehooks: unsupported permission decision")
		}
		if rank > permissionRank(merged.Permission) {
			merged.Permission = decision.Permission
		}
		merged.Block = merged.Block || decision.Block
		merged.Stop = merged.Stop || decision.Stop
		merged.AdditionalContext = joinContext(merged.AdditionalContext, decision.AdditionalContext)
		merged.SystemMessage = joinContext(merged.SystemMessage, decision.SystemMessage)
		if len(decision.UpdatedInput) > 0 {
			if !jsonObject(decision.UpdatedInput) {
				return Decision{}, errors.New("claudehooks: updatedInput must be a JSON object")
			}
			if len(merged.UpdatedInput) > 0 && !equalJSON(merged.UpdatedInput, decision.UpdatedInput) {
				return Decision{}, errors.New("claudehooks: conflicting updatedInput from multiple hooks")
			}
			merged.UpdatedInput = append(json.RawMessage(nil), decision.UpdatedInput...)
		}
		if decision.Block && rank < 3 {
			rank = 3
		}
		if decision.Stop {
			rank = 4
		}
		if decision.Reason != "" && rank > reasonRank {
			merged.Reason, reasonRank = decision.Reason, rank
		} else if decision.Reason != "" && rank == reasonRank {
			merged.Reason = joinContext(merged.Reason, decision.Reason)
		}
	}
	if merged.Permission == "deny" {
		merged.Block = true
	}
	return merged, nil
}

func permissionRank(value string) int {
	switch value {
	case "":
		return 0
	case "allow":
		return 1
	case "ask":
		return 2
	case "deny":
		return 3
	}
	return -1
}

func blockingEvent(event string) bool {
	switch event {
	case "PreToolUse", "UserPromptSubmit", "UserPromptExpansion", "PostToolUse", "PostToolUseFailure", "PostToolBatch", "Stop", "SubagentStop", "TaskCreated", "TaskCompleted", "TeammateIdle", "ConfigChange", "PreCompact", "PreModelSwitch", "WorktreeCreate":
		return true
	}
	return false
}

func runControlEvent(event string) bool {
	switch event {
	case "PreCompact", "PostCompact", "SessionEnd", "Notification", "StopFailure", "InstructionsLoaded", "DirectoryAdded", "TaskCreated", "SubagentStart":
		return false
	}
	return true
}

func joinContext(a, b string) string {
	if a == "" || a == b {
		return b
	}
	if b == "" {
		return a
	}
	return a + "\n" + b
}

func jsonObject(raw json.RawMessage) bool {
	raw = bytes.TrimSpace(raw)
	return len(raw) > 0 && raw[0] == '{' && json.Valid(raw)
}

func equalJSON(a, b json.RawMessage) bool {
	var compactA, compactB bytes.Buffer
	if json.Compact(&compactA, a) != nil || json.Compact(&compactB, b) != nil {
		return false
	}
	if bytes.Equal(compactA.Bytes(), compactB.Bytes()) {
		return true
	}
	var objectA, objectB map[string]json.RawMessage
	if json.Unmarshal(a, &objectA) == nil && json.Unmarshal(b, &objectB) == nil && objectA != nil && objectB != nil {
		if len(objectA) != len(objectB) {
			return false
		}
		for key, value := range objectA {
			other, exists := objectB[key]
			if !exists || !equalJSON(value, other) {
				return false
			}
		}
		return true
	}
	var arrayA, arrayB []json.RawMessage
	if json.Unmarshal(a, &arrayA) == nil && json.Unmarshal(b, &arrayB) == nil && arrayA != nil && arrayB != nil {
		if len(arrayA) != len(arrayB) {
			return false
		}
		for index := range arrayA {
			if !equalJSON(arrayA[index], arrayB[index]) {
				return false
			}
		}
		return true
	}
	return false
}
