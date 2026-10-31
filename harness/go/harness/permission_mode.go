package harness

import (
	"encoding/json"
	"errors"
	"fmt"
)

// PermissionMode is the session permission the composer selects. It does not
// change the process sandbox: shell commands stay unsandboxed unless launch
// configuration already confined them. ApprovalNever still rejects every ask.
type PermissionMode string

const (
	PermissionReadOnly       PermissionMode = "read-only"
	PermissionWorkspaceWrite PermissionMode = "workspace-write"
	PermissionFullAccess     PermissionMode = "full-access"
	PermissionAutoReview     PermissionMode = "auto-review"
)

func ValidatePermissionMode(mode PermissionMode) error {
	switch mode {
	case PermissionReadOnly, PermissionWorkspaceWrite, PermissionFullAccess, PermissionAutoReview:
		return nil
	default:
		return fmt.Errorf("harness: permission mode must be read-only, workspace-write, full-access or auto-review")
	}
}

// PermissionModeOverride folds the last durable permission/preset event.
func PermissionModeOverride(events []Event) (PermissionMode, bool, error) {
	for index := len(events) - 1; index >= 0; index-- {
		if events[index].Type != "permission/preset" {
			continue
		}
		var payload struct {
			Mode PermissionMode `json:"mode"`
		}
		if err := json.Unmarshal(events[index].Data, &payload); err != nil {
			return "", false, fmt.Errorf("harness: decode permission/preset at seq %d: %w", events[index].Seq, err)
		}
		if err := ValidatePermissionMode(payload.Mode); err != nil {
			return "", false, fmt.Errorf("harness: invalid permission/preset at seq %d: %w", events[index].Seq, err)
		}
		return payload.Mode, true, nil
	}
	return "", false, nil
}

func SetPermissionMode(session *Session, mode PermissionMode) (Event, error) {
	if session == nil {
		return Event{}, errors.New("harness: permission mode requires a session")
	}
	if err := ValidatePermissionMode(mode); err != nil {
		return Event{}, err
	}
	return session.Append("permission/preset", struct {
		Mode PermissionMode `json:"mode"`
	}{mode})
}

// permissionDecision reports the outcome for one approval ask. ask is true
// when an answerer must still be consulted. A missing mode keeps the ask policy.
func permissionDecision(policy ApprovalPolicy, request ApprovalRequest) (ApprovalOutcome, bool) {
	if policy == ApprovalNever {
		return ApprovalRejected, false
	}
	if request.Agent == nil {
		return ApprovalRejected, false
	}
	mode, found, err := PermissionModeOverride(request.Agent.Session().Events())
	if err != nil {
		return ApprovalRejected, false
	}
	if !found {
		return "", true
	}
	switch mode {
	case PermissionReadOnly:
		return ApprovalRejected, false
	case PermissionWorkspaceWrite:
		if permissionEscapesWorkspace(request) {
			return ApprovalRejected, false
		}
		return "", true
	case PermissionFullAccess:
		return "", true
	case PermissionAutoReview:
		return ApprovalAllowedOnce, false
	default:
		return ApprovalRejected, false
	}
}

func permissionEscapesWorkspace(request ApprovalRequest) bool {
	if request.Native != nil && request.Native.Operation == "shell" {
		return true
	}
	switch request.ToolName {
	case "shell", "bash":
		return true
	default:
		return false
	}
}

func permissionModePrompt(mode PermissionMode) string {
	switch mode {
	case PermissionReadOnly:
		return "Permission: view only. File changes and commands are rejected."
	case PermissionWorkspaceWrite:
		return "Permission: workspace edits. File changes may ask for approval. Commands are rejected because this session has no OS sandbox."
	case PermissionFullAccess:
		return "Permission: full access. File changes and commands may ask for approval. Commands are not OS-sandboxed."
	case PermissionAutoReview:
		return "Permission: auto-review. File changes and commands are allowed without asking. Commands are not OS-sandboxed."
	default:
		return ""
	}
}
