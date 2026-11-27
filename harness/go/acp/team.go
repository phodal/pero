package acp

import (
	"context"
	"errors"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/team"
)

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
