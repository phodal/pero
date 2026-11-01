package acp

import (
	"encoding/json"

	"github.com/phodal/pero/harness/go/harness"
)

// MCPRuntimeMeta is an optional observation request, not transport configuration.
// The revision is echoed as evidence of the client's frozen session snapshot.
type MCPRuntimeMeta struct {
	Runtime *MCPRuntimeRequest `json:"pero.mcpRuntime,omitempty"`
}
type MCPRuntimeRequest struct {
	Revision uint64 `json:"revision"`
}

// UnmarshalJSON requires an explicit revision, including for revision zero.
func (r *MCPRuntimeRequest) UnmarshalJSON(raw []byte) error {
	var value struct {
		Revision *uint64 `json:"revision"`
	}
	if err := json.Unmarshal(raw, &value); err != nil {
		return err
	}
	if value.Revision == nil || *value.Revision > maxJSONSafeInteger {
		return invalidError("invalid MCP configuration revision")
	}
	r.Revision = *value.Revision
	return nil
}

type mcpRuntimeNotification struct {
	SessionID harness.SessionID `json:"sessionId"`
	Revision  uint64            `json:"revision"`
	harness.MCPConnectionObservation
}

func (s *Server) negotiateMCPRuntime(raw json.RawMessage) error {
	var params struct {
		Capabilities struct {
			Meta struct {
				Runtime int `json:"pero.mcpRuntime"`
			} `json:"_meta"`
		} `json:"clientCapabilities"`
	}
	if len(raw) != 0 {
		if err := json.Unmarshal(raw, &params); err != nil {
			return err
		}
	}
	s.mu.Lock()
	s.mcpRuntime = params.Capabilities.Meta.Runtime == 1
	s.mu.Unlock()
	return nil
}

func (s *Server) observeMCPServers(servers []harness.MCPServerConfig, id harness.SessionID, meta MCPRuntimeMeta) error {
	if meta.Runtime == nil {
		return nil
	}
	s.mu.Lock()
	negotiated, writer := s.mcpRuntime, s.writer
	s.mu.Unlock()
	if !negotiated || writer == nil {
		return nil
	}
	revision := meta.Runtime.Revision
	for index := range servers {
		// Harness normalizes names for its tool registry; UI identity is the exact
		// configured name and must not be reconstructed from a public tool name.
		name := servers[index].Name
		servers[index].Observe = func(observation harness.MCPConnectionObservation) {
			observation.Server = name
			payload, err := json.Marshal(mcpRuntimeNotification{SessionID: id, Revision: revision, MCPConnectionObservation: observation})
			if err == nil {
				_ = writer.write(request{JSONRPC: "2.0", Method: "_pero/mcp/runtime", Params: payload})
			}
		}
	}
	return nil
}
