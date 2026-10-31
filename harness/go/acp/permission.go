package acp

import (
	"fmt"

	"github.com/phodal/pero/harness/go/harness"
)

func ensureAutoReview(agent *harness.Agent) error {
	_, found, err := harness.PermissionModeOverride(agent.Session().Events())
	if err != nil || found {
		return err
	}
	_, err = harness.SetPermissionMode(agent.Session(), harness.PermissionAutoReview)
	return err
}

func permissionConfig(session *harness.Session) (map[string]any, error) {
	mode := harness.PermissionAutoReview
	recorded, found, err := harness.PermissionModeOverride(session.Events())
	if err != nil {
		return nil, err
	}
	if found {
		mode = recorded
	}
	return map[string]any{
		"id": "permission", "name": "Permission", "category": "mode", "type": "select",
		"currentValue": string(mode),
		"options": []any{
			map[string]any{"value": "read-only", "name": "View only", "description": "Read the workspace. File changes and commands are rejected."},
			map[string]any{"value": "workspace-write", "name": "Edit in workspace", "description": "File changes ask for approval. Commands are rejected."},
			map[string]any{"value": "full-access", "name": "Full access", "description": "File changes and commands ask for approval. Commands are not OS-sandboxed."},
			map[string]any{"value": "auto-review", "name": "Auto-review", "description": "File changes and commands proceed without a prompt. Commands are not OS-sandboxed."},
		},
	}, nil
}

func (s *Server) setPermissionOption(record *activeSession, value string) (any, *rpcError) {
	mode := harness.PermissionMode(value)
	if err := harness.ValidatePermissionMode(mode); err != nil {
		return nil, invalid("permission is not advertised")
	}
	finish, denied := s.beginIdleConfig(record, "permission may only change while the session is idle")
	if denied != nil {
		return nil, denied
	}
	defer finish()
	previous, found, err := harness.PermissionModeOverride(record.agent.Session().Events())
	if err != nil {
		return nil, classify(err)
	}
	if !found {
		previous = harness.PermissionAutoReview
	}
	if previous != mode {
		if _, err = harness.SetPermissionMode(record.agent.Session(), mode); err != nil {
			s.requestRecordClose(record)
			return nil, classify(err)
		}
		_ = record.agent.Inject(harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{
			Type: harness.BlockText,
			Text: fmt.Sprintf("The permission mode changed from %q to %q (changed by the user).", previous, mode),
		}}})
	}
	options, err := s.configOptions(record.agent)
	if err != nil {
		return nil, classify(err)
	}
	return map[string]any{"configOptions": options}, nil
}
