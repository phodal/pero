package acp

import (
	"encoding/json"

	"github.com/phodal/pero/harness/go/harness"
)

const ProtocolVersion = 1

type request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type InitializeParams struct {
	ProtocolVersion int            `json:"protocolVersion"`
	Capabilities    map[string]any `json:"clientCapabilities"`
}

type NewSessionParams struct {
	Meta                  MCPRuntimeMeta    `json:"_meta,omitempty"`
	CWD                   string            `json:"cwd"`
	MCPServers            []json.RawMessage `json:"mcpServers"`
	AdditionalDirectories []string          `json:"additionalDirectories,omitempty"`
}

type PromptContent struct {
	Type     string `json:"type"`
	Text     string `json:"text,omitempty"`
	Name     string `json:"name,omitempty"`
	URI      string `json:"uri,omitempty"`
	Data     string `json:"data,omitempty"`
	MIMEType string `json:"mimeType,omitempty"`
}

type PromptParams struct {
	SessionID string          `json:"sessionId"`
	Prompt    []PromptContent `json:"prompt"`
}

type SessionParams struct {
	SessionID string `json:"sessionId"`
}

type CommandListParams struct {
	AgentID string `json:"agentId"`
}

type CommandExecuteParams struct {
	AgentID string                           `json:"agentId"`
	Line    string                           `json:"line"`
	Images  []harness.EncodedImageAttachment `json:"images,omitempty"`
}

type ResumeSessionParams struct {
	Meta       MCPRuntimeMeta    `json:"_meta,omitempty"`
	SessionID  string            `json:"sessionId"`
	CWD        string            `json:"cwd"`
	MCPServers []json.RawMessage `json:"mcpServers"`
}

type ListSessionParams struct {
	CWD    *string `json:"cwd,omitempty"`
	Cursor *string `json:"cursor,omitempty"`
}
