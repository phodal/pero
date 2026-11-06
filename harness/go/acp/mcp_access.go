package acp

import (
	"context"
	"encoding/json"
	"github.com/phodal/pero/harness/go/harness"
)

const MCPSessionCapability = "pero.mcpSession"
const MCPSessionMethod = "_pero/mcp/session"

func (s *Server) mcpSessionRequest(ctx context.Context, raw json.RawMessage) (any, *rpcError) {
	s.mu.Lock()
	negotiated := s.mcpSession
	s.mu.Unlock()
	if !negotiated {
		return nil, invalid("MCP session capability was not negotiated")
	}
	var params struct {
		SessionID string `json:"sessionId"`
		harness.MCPSessionRequest
	}
	if err := decodeParams(raw, &params); err != nil {
		return nil, invalid(err.Error())
	}
	record, finish, err := s.beginCommandRecord(params.SessionID)
	if err != nil {
		return nil, classify(err)
	}
	defer finish()
	result, err := record.agent.MCPAccess().Request(ctx, params.MCPSessionRequest)
	if err != nil {
		return nil, classify(err)
	}
	return result, nil
}
