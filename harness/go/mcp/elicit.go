package mcp

import (
	"context"
	"encoding/json"
	"sync"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// activeToolCalls tracks exact calls on an MCP connection. Connection-level
// elicitation has no request correlation, so only one active caller is usable.
type activeToolCalls struct {
	mu      sync.Mutex
	callers map[*activeToolCaller]struct{}
}

type activeToolCaller struct{ caller any }

func (calls *activeToolCalls) push(ctx context.Context) func() {
	call := &activeToolCaller{caller: ToolCaller(ctx)}
	calls.mu.Lock()
	if calls.callers == nil {
		calls.callers = make(map[*activeToolCaller]struct{})
	}
	calls.callers[call] = struct{}{}
	calls.mu.Unlock()
	return func() {
		calls.mu.Lock()
		delete(calls.callers, call)
		calls.mu.Unlock()
	}
}

func (calls *activeToolCalls) current() any {
	calls.mu.Lock()
	defer calls.mu.Unlock()
	if len(calls.callers) == 1 {
		for call := range calls.callers {
			return call.caller
		}
	}
	return nil
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
	if caller == nil {
		return &mcp.ElicitResult{Action: "decline"}, nil
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
