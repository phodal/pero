package mcp

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	harnessmodel "github.com/phodal/pero/harness/go/model"
	harnesstool "github.com/phodal/pero/harness/go/tool"
)

// Tool is an MCP contribution body; admission and execution remain in the owning registry.
type Tool struct {
	Schema harnessmodel.ToolSchema
	// RequiresApproval is set only from an operator ToolPolicy, never from
	// server annotations.
	RequiresApproval bool
	// Admit checks arguments against the operator policy before approval is
	// requested. Nil for tools without a policy.
	Admit   func(json.RawMessage) error
	Execute func(context.Context, json.RawMessage) (harnesstool.Result, error)
}

func ListTools(ctx context.Context, session *mcp.ClientSession) ([]*mcp.Tool, error) {
	var tools []*mcp.Tool
	for cursor := ""; ; {
		page, err := session.ListTools(ctx, &mcp.ListToolsParams{Cursor: cursor})
		if err != nil {
			return nil, SafeError(err)
		}
		tools = append(tools, page.Tools...)
		if page.NextCursor == "" {
			return tools, nil
		}
		cursor = page.NextCursor
	}
}

func buildMCPTools(session *mcp.ClientSession, serverName string, remotes []*mcp.Tool, callTimeout time.Duration, policy *ToolPolicy) ([]Tool, error) {
	definitions := make([]Tool, 0, len(remotes))
	publicNames := make(map[string]string, len(remotes))
	for _, remote := range remotes {
		if remote == nil || strings.TrimSpace(remote.Name) == "" {
			return nil, errors.New("harness: MCP server listed a tool without a name")
		}
		if !modelVisible(remote.Meta) {
			continue
		}
		var rule ToolRule
		if policy != nil {
			if !policy.Exposes(remote.Name) {
				continue
			}
			rule, _ = policy.Rule(remote.Name)
		}
		schema, marshalErr := json.Marshal(remote.InputSchema)
		if marshalErr != nil {
			return nil, fmt.Errorf("encode schema for %q: %w", remote.Name, marshalErr)
		}
		remoteName := remote.Name
		name := PublicMCPToolName(serverName, remoteName)
		if previous, exists := publicNames[name]; exists {
			return nil, fmt.Errorf("harness: MCP tools %q and %q share public name %q", previous, remoteName, name)
		}
		publicNames[name] = remoteName
		tool := Tool{
			Schema: harnessmodel.ToolSchema{Name: name, Description: remote.Description, InputSchema: schema},
			Execute: func(callCtx context.Context, raw json.RawMessage) (harnesstool.Result, error) {
				if policy != nil {
					admitted, admitErr := rule.Admit(raw)
					if admitErr != nil {
						return harnesstool.Result{IsError: true, Content: []harnessmodel.ContentBlock{{Type: harnessmodel.BlockText, Text: admitErr.Error()}}}, nil
					}
					raw = admitted
				}
				arguments := any(map[string]any{})
				if len(raw) > 0 {
					if err := json.Unmarshal(raw, &arguments); err != nil {
						return harnesstool.Result{}, fmt.Errorf("invalid MCP arguments: %w", err)
					}
				}
				requestCtx, cancel := context.WithTimeout(callCtx, callTimeout)
				defer cancel()
				result, err := session.CallTool(requestCtx, &mcp.CallToolParams{Name: remoteName, Arguments: arguments})
				if err != nil {
					return harnesstool.Result{}, SafeError(err)
				}
				return fromMCPResult(result), nil
			},
		}
		if policy != nil {
			tool.RequiresApproval = rule.RequiresApproval()
			tool.Admit = func(raw json.RawMessage) error { _, err := rule.Admit(raw); return err }
		}
		definitions = append(definitions, tool)
	}
	return definitions, nil
}

// Explicit app-only or malformed visibility never reaches a model catalog.
func modelVisible(meta mcp.Meta) bool {
	ui, ok := meta["ui"].(map[string]any)
	if !ok {
		return meta["ui"] == nil
	}
	raw, present := ui["visibility"]
	if !present {
		return true
	}
	data, err := json.Marshal(raw)
	if err != nil {
		return false
	}
	var audiences []string
	if json.Unmarshal(data, &audiences) != nil || len(audiences) == 0 {
		return false
	}
	visible := false
	for _, audience := range audiences {
		if audience != "app" && audience != "model" {
			return false
		}
		visible = visible || audience == "model"
	}
	return visible
}

// PublicMCPToolName derives the same model-facing function name as DeepSeek
// Harness and the Kotlin harness. Lossy normalization always carries a digest
// of the unmodified server/tool identity so distinct tools cannot collapse.
func PublicMCPToolName(serverName, rawName string) string {
	joined := "mcp__" + serverName + "__" + rawName
	normalized := strings.Map(func(char rune) rune {
		if char <= unicode.MaxASCII && (unicode.IsLetter(char) || unicode.IsDigit(char) || char == '_' || char == '-') {
			return char
		}
		return '_'
	}, joined)
	const maxLength = 64
	const hashLength = 12
	if normalized == joined && len(normalized) <= maxLength {
		return normalized
	}
	digest := sha256.Sum256([]byte(serverName + "\x00" + rawName))
	suffix := hex.EncodeToString(digest[:])[:hashLength]
	return normalized[:min(len(normalized), maxLength-hashLength-1)] + "_" + suffix
}

func fromMCPResult(result *mcp.CallToolResult) harnesstool.Result {
	converted := harnesstool.Result{IsError: result.IsError}
	for _, content := range result.Content {
		switch value := content.(type) {
		case *mcp.TextContent:
			converted.Content = append(converted.Content, harnessmodel.ContentBlock{Type: harnessmodel.BlockText, Text: value.Text})
		case *mcp.ImageContent:
			converted.Content = append(converted.Content, harnessmodel.ContentBlock{Type: harnessmodel.BlockImage, Data: append([]byte(nil), value.Data...), MIMEType: value.MIMEType})
		case *mcp.AudioContent:
			converted.Content = append(converted.Content, harnessmodel.ContentBlock{Type: harnessmodel.BlockText, Text: "[MCP audio content: " + value.MIMEType + "]"})
		case *mcp.ResourceLink:
			converted.Content = append(converted.Content, harnessmodel.ContentBlock{Type: harnessmodel.BlockText, Text: fmt.Sprintf("[resource_link name=%q uri=%q]", value.Name, value.URI)})
		case *mcp.EmbeddedResource:
			if value.Resource != nil && value.Resource.Text != "" {
				converted.Content = append(converted.Content, harnessmodel.ContentBlock{Type: harnessmodel.BlockText, Text: value.Resource.Text})
			} else if value.Resource != nil {
				converted.Content = append(converted.Content, harnessmodel.ContentBlock{Type: harnessmodel.BlockText, Text: "[embedded_resource uri=" + value.Resource.URI + "]"})
			}
		default:
			if data, err := content.MarshalJSON(); err == nil {
				converted.Content = append(converted.Content, harnessmodel.ContentBlock{Type: harnessmodel.BlockText, Text: string(data)})
			}
		}
	}
	if len(converted.Content) == 0 && result.StructuredContent != nil {
		if data, err := json.Marshal(result.StructuredContent); err == nil {
			converted.Content = append(converted.Content, harnessmodel.ContentBlock{Type: harnessmodel.BlockText, Text: string(data)})
		}
	}
	return converted
}
