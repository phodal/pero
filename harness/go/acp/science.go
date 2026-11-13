package acp

import (
	"context"
	"encoding/json"
)

const ScienceSessionCapability = "pero.scienceSession"
const ScienceSessionMethod = "_pero/science/session"

// The transport binds the exact live Agent; the computation owner validates
// its command and owns execution, history, interruption and cleanup.
func (s *Server) scienceSessionRequest(ctx context.Context, raw json.RawMessage) (any, *rpcError) {
	if s.science == nil {
		return nil, invalid("Science kernels are not enabled for this Agent")
	}
	var params struct {
		SessionID string          `json:"sessionId"`
		Request   json.RawMessage `json:"request"`
	}
	if err := decodeParams(raw, &params); err != nil {
		return nil, invalid(err.Error())
	}
	record, finish, err := s.beginCommandRecord(params.SessionID)
	if err != nil {
		return nil, classify(err)
	}
	defer finish()
	value, err := s.science(ctx, record.agent, params.Request)
	if err != nil {
		return nil, classify(err)
	}
	return value, nil
}
