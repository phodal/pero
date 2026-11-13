package acp

import (
	"context"

	"github.com/phodal/pero/harness/go/harness"
)

func (s *Server) scientificReviewConfig(agent *harness.Agent) (map[string]any, error) {
	automatic, err := s.scientificReviewer.Automatic(agent)
	if err != nil {
		return nil, err
	}
	value := "off"
	if automatic {
		value = "auto"
	}
	return map[string]any{
		"id": "scientific_review", "name": "Scientific Reviewer", "category": "review", "type": "select",
		"currentValue": value,
		"options": []any{
			map[string]any{"value": "off", "name": "Manual", "description": "Use /review to request an evidence consistency review."},
			map[string]any{"value": "auto", "name": "Automatic", "description": "One bounded review per turn. Model opinion only."},
		},
	}, nil
}

func (s *Server) setScientificReviewOption(ctx context.Context, record *activeSession, value string) (any, *rpcError) {
	if s.scientificReviewer == nil || (value != "off" && value != "auto") {
		return nil, invalid("scientific review setting is not advertised")
	}
	finish, denied := s.beginIdleConfig(record, "scientific review may only change while the session is idle")
	if denied != nil {
		return nil, denied
	}
	defer finish()
	if err := s.scientificReviewer.SetAutomatic(ctx, record.agent, value == "auto"); err != nil {
		return nil, classify(err)
	}
	options, err := s.configOptions(record.agent)
	if err != nil {
		return nil, classify(err)
	}
	return map[string]any{"configOptions": options}, nil
}

func (s *Server) advertiseScientificReview(id harness.SessionID) error {
	return s.writer.write(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{
		"sessionId": id, "update": map[string]any{"sessionUpdate": "available_commands_update", "availableCommands": []any{
			map[string]any{"name": "review", "description": "Review scientific evidence consistency; model opinion is not scientific acceptance", "input": map[string]any{"hint": "[status | auto on|off | resolve|dismiss <finding-id> <reason>]"}},
		}},
	}})
}
