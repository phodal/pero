package harness

import (
	"encoding/json"
	"errors"
)

// PlanModeState is derived from the existing permission log. The permission
// immediately preceding plan is its return point; no second mode store exists.
type PlanModeState struct {
	Active   bool
	previous *Event
}

func ReadPlanMode(events []Event) (PlanModeState, error) {
	var previous *Event
	state := PlanModeState{}
	for _, event := range events {
		if event.Type != "permission/preset" && event.Type != "permission/claude-mode" {
			continue
		}
		var payload struct {
			Mode string `json:"mode"`
		}
		if err := json.Unmarshal(event.Data, &payload); err != nil {
			return state, err
		}
		if event.Type == "permission/claude-mode" && payload.Mode == "plan" {
			if !state.Active {
				state = PlanModeState{Active: true, previous: previous}
			}
		} else {
			state = PlanModeState{}
		}
		copy := event
		previous = &copy
	}
	return state, nil
}

func EnterPlanMode(session *Session) error {
	if session == nil {
		return errors.New("plan mode requires a session")
	}
	state, err := ReadPlanMode(session.Events())
	if err != nil {
		return err
	}
	if state.Active {
		return errors.New("plan mode is already active")
	}
	_, err = SetClaudePermissionMode(session, "plan")
	return err
}

// ExitPlanMode restores only the prior permission fact. The caller must obtain
// approval for leaving plan through the existing broker before calling it.
func ExitPlanMode(session *Session) error {
	if session == nil {
		return errors.New("plan mode requires a session")
	}
	state, err := ReadPlanMode(session.Events())
	if err != nil {
		return err
	}
	if !state.Active {
		return errors.New("plan mode is not active")
	}
	if state.previous == nil {
		_, err = SetClaudePermissionMode(session, "default")
	} else {
		_, err = session.Append(state.previous.Type, json.RawMessage(state.previous.Data))
	}
	return err
}

// Planning admits a conservative read/control surface, including descendants.
// Unknown MCP tools are not assumed read-only merely because they lack approval.
func PlanningToolAllowed(agent *Agent, name string) bool {
	active := false
	for caller := agent; caller != nil; caller = caller.Parent() {
		state, err := ReadPlanMode(caller.Session().Events())
		if err != nil {
			return false
		}
		active = active || state.Active
	}
	if name == "EnterPlanMode" {
		return agent.Parent() == nil && !active
	}
	if name == "ExitPlanMode" {
		return agent.Parent() == nil && active
	}
	if !active {
		return true
	}
	switch name {
	case "Read", "read_file", "Glob", "glob_files", "Grep", "regex_search", "search_files", "list_directory", "ToolSearch", "tool_search", "NotebookRead", "notebook_read", "AskUserQuestion", "TaskOutput", "TaskStop", "list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource", "list_mcp_prompts", "get_mcp_prompt":
		return true
	default:
		return false
	}
}
