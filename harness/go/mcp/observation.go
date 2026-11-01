package mcp

import (
	"strings"
	"unicode"
)

type ConnectionStatus string

const (
	ConnectionConnecting   ConnectionStatus = "connecting"
	ConnectionConnected    ConnectionStatus = "connected"
	ConnectionDisconnected ConnectionStatus = "disconnected"
	ConnectionError        ConnectionStatus = "error"
	ConnectionClosed       ConnectionStatus = "closed"
)

// ConnectionObservation is transient evidence from the existing connection owner.
// It carries no transport configuration, diagnostics, credentials, or execution policy.
type ConnectionObservation struct {
	Server     string           `json:"server"`
	Generation uint64           `json:"generation"`
	Status     ConnectionStatus `json:"status"`
	Tools      []string         `json:"tools"`
}

func (s *mcpConnectionSupervisor) publish(status ConnectionStatus, tools []string) {
	if s.observe == nil {
		return
	}
	// Oversized or malformed catalogs remain unobservable rather than publishing
	// a silently truncated list as a complete discovery result.
	if len(tools) > 256 {
		status, tools = ConnectionError, nil
	}
	for _, name := range tools {
		if name == "" || len(name) > 128 || strings.IndexFunc(name, unicode.IsControl) >= 0 {
			status, tools = ConnectionError, nil
			break
		}
	}
	if tools == nil {
		tools = []string{}
	}
	s.observe(ConnectionObservation{Server: s.serverName, Generation: s.nextGeneration, Status: status, Tools: tools})
}
