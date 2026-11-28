package acp

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/team"
)

const teamBoardCapability = "pero.teamBoard"
const teamBoardMethod = "_pero/team/board"

func (s *Server) teamBoardRequest(raw json.RawMessage) (any, *rpcError) {
	if s.teamBoard == nil {
		return nil, invalid("Agent Teams are not available")
	}
	var params SessionParams
	if err := decodeParams(raw, &params); err != nil {
		return nil, invalid(err.Error())
	}
	record, finish, err := s.beginCommandRecord(params.SessionID)
	if err != nil {
		return nil, classify(err)
	}
	defer finish()
	snapshot, err := s.teamBoard.Snapshot(record.agent)
	if errors.Is(err, team.ErrDisabled) || errors.Is(err, team.ErrForbidden) {
		return nil, invalid("Agent Teams are only available on an eligible root session")
	}
	if err != nil {
		return nil, classify(err)
	}
	return snapshot, nil
}

func (s *Server) teamConfig(agent *harness.Agent) (map[string]any, error) {
	if s.teamBoard == nil {
		return nil, nil
	}
	enabled, err := s.teamBoard.Mode(agent)
	if errors.Is(err, team.ErrDisabled) || errors.Is(err, team.ErrForbidden) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	current := "off"
	if enabled {
		current = "on"
	}
	return map[string]any{
		"id": "team", "name": "Agent Teams", "category": "team", "type": "select",
		"currentValue": current,
		"options": []any{
			map[string]any{"value": "off", "name": "Off", "description": "Hide shared task tools and retain the board."},
			map[string]any{"value": "on", "name": "On", "description": "Share the root session's task board with its agents."},
		},
	}, nil
}

func (s *Server) setTeamOption(ctx context.Context, record *activeSession, value string) (any, *rpcError) {
	if s.teamBoard == nil || (value != "off" && value != "on") {
		return nil, invalid("Agent Teams setting is not advertised")
	}
	finish, denied := s.beginIdleConfig(record, "Agent Teams may only change while the session is idle")
	if denied != nil {
		return nil, denied
	}
	defer finish()
	if err := s.teamBoard.SetEnabled(ctx, record.agent, value == "on"); err != nil {
		if errors.Is(err, team.ErrForbidden) || errors.Is(err, team.ErrDisabled) {
			return nil, invalid("Agent Teams is only available on an eligible root session")
		}
		return nil, classify(err)
	}
	options, err := s.configOptions(record.agent)
	if err != nil {
		return nil, classify(err)
	}
	return map[string]any{"configOptions": options}, nil
}
