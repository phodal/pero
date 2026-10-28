package acp

import (
	"bytes"
	"encoding/json"
	"fmt"

	"github.com/phodal/pero/harness/go/harness"
	harnessmcp "github.com/phodal/pero/harness/go/mcp"
)

// mcpServerMetaKey carries Pero's trusted operator policy for one mcpServers
// entry in the ACP `_meta` extension point. The ACP client is the operator's
// Rust runtime; the model can never write this value.
const mcpServerMetaKey = "pero.dev/mcp-server"

type mcpServerMeta struct {
	ToolPolicy         *harnessmcp.ToolPolicy `json:"toolPolicy,omitempty"`
	CleanEnvironment   bool                   `json:"cleanEnvironment,omitempty"`
	FailOnStartupError bool                   `json:"failOnStartupError,omitempty"`
}

// applyMCPServerMeta decodes the Pero extension strictly: a misspelled field
// must fail the session instead of silently dropping the policy it was meant
// to carry.
func applyMCPServerMeta(config *harness.MCPServerConfig, meta map[string]json.RawMessage, index int) error {
	raw, present := meta[mcpServerMetaKey]
	if !present {
		return nil
	}
	var decoded mcpServerMeta
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&decoded); err != nil {
		return invalidError(fmt.Sprintf("mcpServers[%d]._meta[%q] is invalid", index, mcpServerMetaKey))
	}
	if decoded.CleanEnvironment && config.Transport != harness.MCPStdio {
		return invalidError(fmt.Sprintf("mcpServers[%d]._meta[%q].cleanEnvironment applies only to stdio servers", index, mcpServerMetaKey))
	}
	config.ToolPolicy = decoded.ToolPolicy
	config.CleanEnvironment = decoded.CleanEnvironment
	config.FailOnStartupError = decoded.FailOnStartupError
	return nil
}
