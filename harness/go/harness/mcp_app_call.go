package harness

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"

	harnessmcp "github.com/phodal/pero/harness/go/mcp"
)

// MCPAppDescriptor identifies an actual completed MCP call in this incarnation.
// The UI link comes from the mounted tool definition, never from result metadata.
type MCPAppDescriptor struct {
	Server      string     `json:"server"`
	Generation  uint64     `json:"generation"`
	ResourceURI string     `json:"resource_uri"`
	ToolCall    ToolCallID `json:"tool_call"`
}

type mcpAppCall struct {
	descriptor MCPAppDescriptor
	server     string
	tool       string
	input      json.RawMessage
	result     json.RawMessage
}

func (a *MCPAccess) recordAppCall(request ToolRequest, server string, definition harnessmcp.Tool, capture harnessmcp.AppResultCapture) {
	if request.Agent != a.agent || request.CallID == "" {
		return
	}
	result := capture.Wire()
	if len(result) == 0 {
		return
	}
	input := append(json.RawMessage(nil), request.Arguments...)
	if len(input) == 0 {
		input = json.RawMessage(`{}`)
	}
	call := mcpAppCall{
		descriptor: MCPAppDescriptor{a.names[server], definition.Generation, definition.ResourceURI, request.CallID},
		server:     server, tool: definition.Name, input: input, result: result,
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.closed {
		a.originals[request.CallID] = call
	}
}

func (a *MCPAccess) originalAppCall(id ToolCallID) (mcpAppCall, error) {
	if a == nil {
		return mcpAppCall{}, errors.New("MCP App call is unavailable")
	}
	a.mu.Lock()
	call, found := a.originals[id]
	closed := a.closed
	a.mu.Unlock()
	if !found || closed {
		return mcpAppCall{}, errors.New("MCP App call is outside this live session")
	}
	return call, nil
}

// AppDescriptor returns only locally captured identity. Server metadata cannot
// mint this receipt, and replay from another incarnation cannot restore it.
func (a *MCPAccess) AppDescriptor(id ToolCallID) *MCPAppDescriptor {
	call, err := a.originalAppCall(id)
	if err != nil {
		return nil
	}
	descriptor := call.descriptor
	return &descriptor
}

func (a *MCPAccess) prepareApp(ctx context.Context, server string, generation uint64, name string, original *mcpAppCall) (json.RawMessage, error) {
	uri, err := a.connections.AppResource(server, generation, name)
	if err != nil {
		return nil, err
	}
	if original == nil {
		if _, _, err = a.connections.AppTool(server, generation, name, "", true); err != nil {
			return nil, err
		}
	} else if uri != original.descriptor.ResourceURI {
		return nil, errors.New("MCP App resource changed since the original call")
	}
	resource, err := a.connections.Request(ctx, server, generation, "read", "", uri)
	if err != nil {
		return nil, err
	}
	var document struct {
		Contents []struct {
			MIMEType string `json:"mimeType"`
		} `json:"contents"`
	}
	if json.Unmarshal(resource, &document) != nil || len(document.Contents) != 1 || document.Contents[0].MIMEType != "text/html;profile=mcp-app" {
		return nil, errors.New("MCP App requires one text/html;profile=mcp-app document")
	}
	if err = a.connections.Check(server, generation); err != nil {
		return nil, err
	}
	var token [32]byte
	if _, err = rand.Read(token[:]); err != nil {
		return nil, err
	}
	id := hex.EncodeToString(token[:])
	prepared := struct {
		Binding     string          `json:"binding"`
		Resource    json.RawMessage `json:"resource"`
		Input       json.RawMessage `json:"input,omitempty"`
		Result      json.RawMessage `json:"result,omitempty"`
		Tool        string          `json:"tool"`
		ResourceURI string          `json:"resource_uri"`
	}{Binding: id, Resource: resource, Tool: name, ResourceURI: uri}
	if original != nil {
		prepared.Input, prepared.Result = original.input, original.result
	}
	response, err := harnessmcp.BoundedAccessResult(prepared)
	if err != nil {
		return nil, err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closed || ctx.Err() != nil {
		return nil, errors.New("MCP App prepare was cancelled or closed")
	}
	a.bindings[id] = mcpAppBinding{server, generation, uri}
	return response, nil
}
