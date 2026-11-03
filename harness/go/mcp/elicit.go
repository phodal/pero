package mcp

import (
	"context"
	"encoding/json"
	"sync"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// callStack is the tool caller waiting on one MCP session. The elicitation
// request arrives on the connection, not on the tool context.
type callStack struct {
	mu      sync.Mutex
	callers []any
}

func (stack *callStack) push(ctx context.Context) func() {
	caller := ToolCaller(ctx)
	if caller == nil {
		return func() {}
	}
	stack.mu.Lock()
	stack.callers = append(stack.callers, caller)
	stack.mu.Unlock()
	return func() {
		stack.mu.Lock()
		if n := len(stack.callers); n > 0 {
			stack.callers = stack.callers[:n-1]
		}
		stack.mu.Unlock()
	}
}

func (stack *callStack) current() any {
	stack.mu.Lock()
	defer stack.mu.Unlock()
	if len(stack.callers) == 0 {
		return nil
	}
	return stack.callers[len(stack.callers)-1]
}

type toolCallerKey struct{}

// ElicitationRequest is the user input an MCP server asked for during a tool call.
type ElicitationRequest struct {
	Message, Mode, URL, ID string
	RequestedSchema        json.RawMessage
}

// ElicitationReply is the action sent back to that server.
type ElicitationReply struct {
	Action  string
	Content json.RawMessage
}

// WithToolCaller records the agent that is executing a tool. An MCP elicitation
// arriving inside that call uses the same context.
func WithToolCaller(ctx context.Context, caller any) context.Context {
	if ctx == nil || caller == nil {
		return ctx
	}
	return context.WithValue(ctx, toolCallerKey{}, caller)
}

func ToolCaller(ctx context.Context) any {
	if ctx == nil {
		return nil
	}
	return ctx.Value(toolCallerKey{})
}

func elicit(ctx context.Context, answer func(context.Context, ElicitationRequest, any) (ElicitationReply, error), params *mcp.ElicitParams, caller any) (*mcp.ElicitResult, error) {
	mode := params.Mode
	if mode == "" {
		if params.URL != "" || params.ElicitationID != "" {
			mode = "url"
		} else {
			mode = "form"
		}
	}
	var schema json.RawMessage
	if params.RequestedSchema != nil {
		encoded, err := json.Marshal(params.RequestedSchema)
		if err != nil {
			return &mcp.ElicitResult{Action: "decline"}, nil
		}
		schema = encoded
	}
	if caller == nil {
		caller = ToolCaller(ctx)
	}
	reply, err := answer(ctx, ElicitationRequest{Message: params.Message, Mode: mode, URL: params.URL, ID: params.ElicitationID, RequestedSchema: schema}, caller)
	if err != nil {
		return nil, err
	}
	action := reply.Action
	if action != "accept" && action != "decline" && action != "cancel" {
		action = "decline"
	}
	result := &mcp.ElicitResult{Action: action}
	if action == "accept" && len(reply.Content) > 0 && string(reply.Content) != "null" {
		if err := json.Unmarshal(reply.Content, &result.Content); err != nil {
			return &mcp.ElicitResult{Action: "decline"}, nil
		}
	}
	return result, nil
}
