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
	// AsyncRewake runs in the background with a timeout and wakes the agent on exit 2.
	AsyncRewake bool
	// If is one permission rule. It selects tool events and skips every other event.
	If string
	// Once removes a skill frontmatter hook after its first successful run.
	Once bool
	// OnFailure is "", "continue", or "block". Empty and continue leave the
	// triggering action in place when the hook fails. block denies it.
	OnFailure string
	// Shell is "" (the runner shell), "bash", or "powershell". It applies only
	// to shell-form commands. Settings hooks ignore Once; skill frontmatter does not.
	Shell string
	// StatusMessage is shown while this hook runs and cleared when it finishes.
	StatusMessage string
	// URL selects an HTTP hook. Command and Args are unused.
	URL            string
	Headers        map[string]string
	AllowedEnvVars []string
	// Prompt selects a prompt hook. The model answers with ok/reason JSON.
	// Agent selects an agent hook, which also carries Prompt.
	Prompt          string
	Model           string
	ContinueOnBlock bool
	Agent           bool
	// MCPServer and MCPTool select an MCP tool hook.
	MCPServer string
	MCPTool   string
	MCPInput  json.RawMessage
}

type Input struct {
	SessionID            string          `json:"session_id"`
	CWD                  string          `json:"cwd"`
	Event                string          `json:"hook_event_name"`
	ToolName             string          `json:"tool_name,omitempty"`
	ToolUseID            string          `json:"tool_use_id,omitempty"`
	ToolInput            json.RawMessage `json:"tool_input,omitempty"`
	FilePath             string          `json:"file_path,omitempty"`
	FileChange           string          `json:"event,omitempty"`
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
	Message              string          `json:"message,omitempty"`
	Title                string          `json:"title,omitempty"`
	NotificationType     string          `json:"notification_type,omitempty"`
	LastAssistantMessage string          `json:"last_assistant_message,omitempty"`
	Reason               string          `json:"reason,omitempty"`
	Name                 string          `json:"name,omitempty"`
	ToolCalls            json.RawMessage `json:"tool_calls,omitempty"`
	CustomInstructions   json.RawMessage `json:"custom_instructions,omitempty"`
	CompactSummary       string          `json:"compact_summary,omitempty"`
	TaskID               string          `json:"task_id,omitempty"`
	TaskSubject          string          `json:"task_subject,omitempty"`
	TaskDescription      string          `json:"task_description,omitempty"`
	ExpansionType        string          `json:"expansion_type,omitempty"`
	CommandName          string          `json:"command_name,omitempty"`
	CommandArgs          string          `json:"command_args,omitempty"`
	CommandSource        string          `json:"command_source,omitempty"`
	ErrorKind            string          `json:"error,omitempty"`
	ErrorDetails         string          `json:"error_details,omitempty"`
	FromModel            string          `json:"from_model,omitempty"`
	ToModel              string          `json:"to_model,omitempty"`
	RequestedModel       string          `json:"requested_model,omitempty"`
	ContextTokens        *int            `json:"context_tokens,omitempty"`
	TurnID               string          `json:"turn_id,omitempty"`
	MessageID            string          `json:"message_id,omitempty"`
	DisplayIndex         int             `json:"index,omitempty"`
	Final                bool            `json:"final,omitempty"`
	Delta                string          `json:"delta,omitempty"`
	MCPServerName        string          `json:"mcp_server_name,omitempty"`
	Mode                 string          `json:"mode,omitempty"`
	URL                  string          `json:"url,omitempty"`
	ElicitationID        string          `json:"elicitation_id,omitempty"`
	RequestedSchema      json.RawMessage `json:"requested_schema,omitempty"`
	Action               string          `json:"action,omitempty"`
	Content              json.RawMessage `json:"content,omitempty"`
	OldCWD               string          `json:"old_cwd,omitempty"`
	NewCWD               string          `json:"new_cwd,omitempty"`
	Directory            string          `json:"directory,omitempty"`
	// SessionTitle is the custom title already stored for this session.
	SessionTitle string `json:"session_title,omitempty"`
	// Model is the active model id for SessionStart.
	Model string `json:"model,omitempty"`
}

type Decision struct {
	Permission        string
	Reason            string
	AdditionalContext string
	SystemMessage     string
	UpdatedInput      json.RawMessage
	UpdatedToolOutput json.RawMessage
	WatchPaths        []string
	WorktreePath      string
	Block, Stop       bool
	// EndTurn stops the current turn after a prompt hook blocks. It is not a
	// command-hook field.
	EndTurn bool
	// DisplayContent replaces assistant text on screen. Nil keeps the original.
	DisplayContent *string
	// Action is an elicitation answer: accept, decline, or cancel. Empty means
	// the hook left the request unanswered.
	Action  string
	Content json.RawMessage
	// SessionTitle is the title a SessionStart or UserPromptSubmit hook asked to store.
	SessionTitle string
	// InitialUserMessage is the first turn supplied by a SessionStart hook.
	InitialUserMessage string
	// ReloadSkills asks the host to re-read its authorized skill roots.
	ReloadSkills bool
	// SuppressOriginalPrompt leaves the submitted text out of a blocked prompt message.
	SuppressOriginalPrompt bool
	// TerminalSequence is raw terminal bytes, such as a bell, written by the host.
	TerminalSequence string
	// SessionPermissions are rules kept for this session. Settings files are not written.
	SessionPermissions []PermissionUpdate
}

// PermissionUpdate is one session change from updatedPermissions.
// Op is add, replace, remove, addDir, or removeDir. Behavior is allow, deny,
// or ask for rule updates. Directories are session working directories.
type PermissionUpdate struct {
	Op, Behavior string
	Rules        []string
	Directories  []string
}

var ErrNonBlocking = errors.New("claudehooks: non-blocking hook error")

var ansiEscape = regexp.MustCompile(`\x1b\[[0-9;]*[A-Za-z]`)

type output struct {
	Continue           *bool           `json:"continue"`
	StopReason         string          `json:"stopReason"`
	SystemMessage      string          `json:"systemMessage"`
	Decision           string          `json:"decision"`
	Reason             string          `json:"reason"`
	AdditionalContext  string          `json:"additionalContext"`
	SuppressOutput     bool            `json:"suppressOutput"`
	HookSpecificOutput *specificOutput `json:"hookSpecificOutput"`
	// TerminalSequence is raw bytes the host writes to the controlling terminal.
	TerminalSequence string  `json:"terminalSequence,omitempty"`
	DisplayContent   *string `json:"displayContent,omitempty"`
}

type specificOutput struct {
	Event                  string                     `json:"hookEventName"`
	Permission             string                     `json:"permissionDecision"`
	Reason                 string                     `json:"permissionDecisionReason"`
	UpdatedInput           json.RawMessage            `json:"updatedInput"`
	AdditionalContext      string                     `json:"additionalContext"`
	RequestDecision        *permissionRequestDecision `json:"decision"`
	WorktreePath           string                     `json:"worktreePath"`
	UpdatedToolOutput      json.RawMessage            `json:"updatedToolOutput"`
	WatchPaths             []string                   `json:"watchPaths"`
	DisplayContent         *string                    `json:"displayContent,omitempty"`
	Action                 string                     `json:"action,omitempty"`
	Content                json.RawMessage            `json:"content,omitempty"`
	SessionTitle           string                     `json:"sessionTitle,omitempty"`
	SuppressOriginalPrompt bool                       `json:"suppressOriginalPrompt,omitempty"`
	InitialUserMessage     string                     `json:"initialUserMessage,omitempty"`
	// ReloadSkills is accepted so a SessionStart hook can request a skill
	// rescan. The catalog stays fixed for this process.
	ReloadSkills *bool `json:"reloadSkills,omitempty"`
}

// permissionRequestDecision is the PermissionRequest allow or deny object.
// updatedPermissions can add session rules. Other destinations are ignored and
// are not written to Claude settings files.
type permissionRequestDecision struct {
	Behavior           string          `json:"behavior"`
	UpdatedInput       json.RawMessage `json:"updatedInput"`
	Message            string          `json:"message"`
	Interrupt          bool            `json:"interrupt"`
	UpdatedPermissions json.RawMessage `json:"updatedPermissions"`
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
		} else if event == "SessionStart" || event == "UserPromptSubmit" || event == "PreCompact" || event == "PostCompact" || event == "PostModelSwitch" {
			decision.AdditionalContext = string(stdout)
		}
	}
	if exitCode == 2 && event == "PermissionRequest" {
		// Exit 2 does not decide this event. A parsed allow or deny still applies.
		if decision.Permission == "" {
			return Decision{}, nil
		}
		return decision, nil
	}
	if exitCode == 2 {
		if !blockingEvent(event) {
			return Decision{}, fmt.Errorf("%w for %s (exit 2): %s", ErrNonBlocking, event, strings.TrimSpace(string(stderr)))
		}
		decision.Block = true
		decision.Stop = false
		if event == "Elicitation" || event == "ElicitationResult" {
			return Decision{Action: "decline", Block: true}, nil
		}
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
	if event == "WorktreeCreate" && decision.WorktreePath == "" && (len(stdout) == 0 || stdout[0] != '{') {
		decision.WorktreePath = worktreePathLine(stdout)
	}
	return decision, nil
}

func worktreePathLine(stdout []byte) string {
	text := ansiEscape.ReplaceAllString(string(stdout), "")
	last := ""
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			last = line
		}
	}
	return last
}

func (wire output) decision(event string) (Decision, error) {
	if event == "Elicitation" || event == "ElicitationResult" {
		return wire.elicitationDecision(event)
	}
	result := Decision{Reason: wire.Reason, SystemMessage: wire.SystemMessage, AdditionalContext: wire.AdditionalContext, TerminalSequence: wire.TerminalSequence}
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
		if (event == "SessionStart" || event == "UserPromptSubmit") && specific.SessionTitle != "" {
			result.SessionTitle = specific.SessionTitle
		}
		if event == "UserPromptSubmit" && specific.SuppressOriginalPrompt {
			result.SuppressOriginalPrompt = true
		}
		if event == "SessionStart" && specific.ReloadSkills != nil && *specific.ReloadSkills {
			result.ReloadSkills = true
		}
		if event == "SessionStart" && specific.InitialUserMessage != "" {
			result.InitialUserMessage = specific.InitialUserMessage
		}
		if (event == "FileChanged" || event == "CwdChanged" || event == "SessionStart") && specific.WatchPaths != nil {
			result.WatchPaths = make([]string, len(specific.WatchPaths))
			copy(result.WatchPaths, specific.WatchPaths)
		}
		if len(specific.UpdatedToolOutput) > 0 && string(specific.UpdatedToolOutput) != "null" {
			if event != "PostToolUse" || !json.Valid(specific.UpdatedToolOutput) {
				return Decision{}, errors.New("claudehooks: updatedToolOutput requires PostToolUse JSON")
			}
			result.UpdatedToolOutput = append(json.RawMessage(nil), specific.UpdatedToolOutput...)
		}
		if specific.WorktreePath != "" {
			if event != "WorktreeCreate" {
				return Decision{}, errors.New("claudehooks: worktreePath is unsupported for this event")
			}
			result.WorktreePath = specific.WorktreePath
		}
		if event == "MessageDisplay" && specific.DisplayContent != nil {
			result.DisplayContent = specific.DisplayContent
		}
		if specific.RequestDecision != nil {
			if event != "PermissionRequest" {
				return Decision{}, errors.New("claudehooks: permission request decision is unsupported for this event")
			}
			switch specific.RequestDecision.Behavior {
			case "allow":
				result.Permission = "allow"
				result.Block = false
				if len(specific.RequestDecision.UpdatedInput) > 0 && string(specific.RequestDecision.UpdatedInput) != "null" {
					if !jsonObject(specific.RequestDecision.UpdatedInput) {
						return Decision{}, errors.New("claudehooks: permission updatedInput must be a JSON object")
					}
					result.UpdatedInput = append(json.RawMessage(nil), specific.RequestDecision.UpdatedInput...)
				}
			case "deny":
				result.Permission = "deny"
				result.Block = true
				if specific.RequestDecision.Message != "" {
					result.Reason = specific.RequestDecision.Message
				}
				result.Stop = specific.RequestDecision.Interrupt
			default:
				return Decision{}, errors.New("claudehooks: permission request behavior must be allow or deny")
			}
			updates, err := sessionPermissionUpdates(specific.RequestDecision.UpdatedPermissions)
			if err != nil {
				return Decision{}, err
			}
			result.SessionPermissions = updates
		}
	}
	if wire.Continue != nil && !*wire.Continue && runControlEvent(event) {
		result.Stop = true
		result.Reason = wire.StopReason
	}
	if event == "MessageDisplay" {
		if result.DisplayContent == nil {
			result.DisplayContent = wire.DisplayContent
		}
		result.SystemMessage = ""
		result.Stop = false
		result.AdditionalContext = ""
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
		merged.EndTurn = merged.EndTurn || decision.EndTurn
		if decision.DisplayContent != nil {
			merged.DisplayContent = decision.DisplayContent
		}
		merged.AdditionalContext = joinContext(merged.AdditionalContext, decision.AdditionalContext)
		merged.SystemMessage = joinContext(merged.SystemMessage, decision.SystemMessage)
		if merged.WorktreePath == "" {
			merged.WorktreePath = decision.WorktreePath
		}
		if decision.WatchPaths != nil {
			merged.WatchPaths = make([]string, len(decision.WatchPaths))
			copy(merged.WatchPaths, decision.WatchPaths)
		}
		if decision.SessionTitle != "" {
			merged.SessionTitle = decision.SessionTitle
		}
		merged.ReloadSkills = merged.ReloadSkills || decision.ReloadSkills
		if decision.InitialUserMessage != "" {
			merged.InitialUserMessage = decision.InitialUserMessage
		}
		merged.SuppressOriginalPrompt = merged.SuppressOriginalPrompt || decision.SuppressOriginalPrompt
		merged.TerminalSequence += decision.TerminalSequence
		merged.SessionPermissions = append(merged.SessionPermissions, decision.SessionPermissions...)
		if len(decision.UpdatedToolOutput) > 0 {
			if len(merged.UpdatedToolOutput) > 0 && !equalJSON(merged.UpdatedToolOutput, decision.UpdatedToolOutput) {
				return Decision{}, errors.New("claudehooks: conflicting updatedToolOutput from multiple hooks")
			}
			merged.UpdatedToolOutput = append(json.RawMessage(nil), decision.UpdatedToolOutput...)
		}
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

func sessionPermissionUpdates(raw json.RawMessage) ([]PermissionUpdate, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var updates []struct {
		Type        string   `json:"type"`
		Behavior    string   `json:"behavior"`
		Destination string   `json:"destination"`
		Directories []string `json:"directories"`
		Rules       []struct {
			ToolName    string `json:"toolName"`
			RuleContent string `json:"ruleContent"`
		} `json:"rules"`
	}
	if err := json.Unmarshal(raw, &updates); err != nil {
		return nil, errors.New("claudehooks: updatedPermissions must be an array")
	}
	var parsed []PermissionUpdate
	for _, update := range updates {
		switch update.Type {
		case "setMode":
			continue
		case "addRules", "replaceRules", "removeRules", "addDirectories", "removeDirectories":
		default:
			return nil, fmt.Errorf("claudehooks: updatedPermissions type %q is unsupported", update.Type)
		}
		if update.Destination != "" && update.Destination != "session" {
			continue
		}
		if update.Type == "addDirectories" || update.Type == "removeDirectories" {
			item := PermissionUpdate{Op: "addDir"}
			if update.Type == "removeDirectories" {
				item.Op = "removeDir"
			}
			for _, directory := range update.Directories {
				if strings.TrimSpace(directory) == "" || strings.ContainsAny(directory, "\r\n") {
					return nil, errors.New("claudehooks: updatedPermissions directory is invalid")
				}
				item.Directories = append(item.Directories, directory)
			}
			parsed = append(parsed, item)
			continue
		}
		switch update.Behavior {
		case "allow", "deny", "ask":
		default:
			return nil, errors.New("claudehooks: updatedPermissions behavior must be allow, deny, or ask")
		}
		item := PermissionUpdate{Op: strings.TrimSuffix(update.Type, "Rules"), Behavior: update.Behavior}
		for _, rule := range update.Rules {
			if rule.ToolName == "" || strings.ContainsAny(rule.ToolName+rule.RuleContent, "()\n\r") {
				return nil, errors.New("claudehooks: updatedPermissions rule is invalid")
			}
			text := rule.ToolName
			if rule.RuleContent != "" {
				text += "(" + rule.RuleContent + ")"
			}
			item.Rules = append(item.Rules, text)
		}
		parsed = append(parsed, item)
	}
	return parsed, nil
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
	case "PreToolUse", "UserPromptSubmit", "UserPromptExpansion", "PostToolUse", "PostToolUseFailure", "PostToolBatch", "Stop", "SubagentStop", "TaskCreated", "TaskCompleted", "TeammateIdle", "ConfigChange", "PreCompact", "PreModelSwitch", "WorktreeCreate", "Elicitation", "ElicitationResult":
		return true
	}
	return false
}

func runControlEvent(event string) bool {
	switch event {
	case "PreCompact", "PostCompact", "SessionEnd", "Notification", "StopFailure", "InstructionsLoaded", "DirectoryAdded", "TaskCreated", "SubagentStart", "FileChanged", "Setup", "PreModelSwitch", "PostModelSwitch", "MessageDisplay", "CwdChanged":
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
