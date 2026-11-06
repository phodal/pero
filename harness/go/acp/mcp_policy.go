package acp

import (
	"bytes"
	"encoding/json"

	"github.com/phodal/pero/harness/go/harness"
	harnessmcp "github.com/phodal/pero/harness/go/mcp"
)

const MCPToolPolicyCapability = "pero.mcpToolPolicy"

// decodeSessionMCPServers admits policy only from the negotiated ACP client,
// never from discovery metadata. The complete set is decoded before any mount.
func (s *Server) decodeSessionMCPServers(raw []json.RawMessage, cwd string) ([]harness.MCPServerConfig, error) {
	servers, err := decodeMCPServers(raw, cwd)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	negotiated := s.mcpToolPolicy
	s.mu.Unlock()
	for index, entry := range raw {
		var envelope struct {
			Meta map[string]json.RawMessage `json:"_meta"`
		}
		if err := json.Unmarshal(entry, &envelope); err != nil {
			return nil, invalidError("invalid MCP metadata")
		}
		policy, present := envelope.Meta[MCPToolPolicyCapability]
		if !present {
			continue
		}
		if !negotiated {
			return nil, invalidError("MCP tool policy capability was not negotiated")
		}
		if bytes.Equal(bytes.TrimSpace(policy), []byte("null")) {
			return nil, invalidError("MCP tool policy must be an object")
		}
		var value harnessmcp.ToolPolicy
		decoder := json.NewDecoder(bytes.NewReader(policy))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&value); err != nil {
			return nil, invalidError("invalid MCP tool policy")
		}
		servers[index].ToolPolicy = &value
	}
	return servers, nil
}
