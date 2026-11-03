package pluginruntime

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
	harnessmcp "github.com/phodal/pero/harness/go/mcp"
)

func foldElicitation(decisions []claudehooks.Decision) claudehooks.Decision {
	var chosen claudehooks.Decision
	for _, decision := range decisions {
		if decision.Block || decision.Action == "decline" {
			return claudehooks.Decision{Action: "decline", Block: true}
		}
		if decision.Action == "accept" || decision.Action == "cancel" {
			chosen = decision
		}
	}
	return chosen
}

func bindElicitation(app *HookApp, configured, runtime string) func(context.Context, harnessmcp.ElicitationRequest, any) (harnessmcp.ElicitationReply, error) {
	name := configured
	if name == "" {
		name = runtime
	}
	return func(ctx context.Context, request harnessmcp.ElicitationRequest, caller any) (harnessmcp.ElicitationReply, error) {
		return app.answerElicitation(ctx, name, request, caller)
	}
}

func (app *HookApp) answerElicitation(ctx context.Context, server string, request harnessmcp.ElicitationRequest, caller any) (harnessmcp.ElicitationReply, error) {
	agent, _ := caller.(*harness.Agent)
	if app == nil || agent == nil {
		return harnessmcp.ElicitationReply{Action: "decline"}, nil
	}
	input := claudehooks.Input{
		Event: "Elicitation", MCPServerName: server, Message: request.Message, Mode: request.Mode,
		URL: request.URL, ElicitationID: request.ID, RequestedSchema: request.RequestedSchema,
	}
	decision, err := app.event(ctx, agent, input)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return harnessmcp.ElicitationReply{}, err
		}
		return harnessmcp.ElicitationReply{Action: "decline"}, nil
	}
	if decision.Action != "" {
		return elicitationReply(decision.Action, decision.Content, nil), nil
	}
	user := claudehooks.Decision{Action: "decline"}
	if app.options.AnswerElicitation != nil {
		user, err = app.options.AnswerElicitation(ctx, input)
		if err != nil {
			return harnessmcp.ElicitationReply{}, err
		}
		if user.Action != "accept" && user.Action != "decline" && user.Action != "cancel" {
			user.Action = "decline"
		}
	}
	resultInput := input
	resultInput.Event = "ElicitationResult"
	resultInput.Action = user.Action
	resultInput.Content = user.Content
	resultInput.Message = ""
	resultInput.URL = ""
	resultInput.RequestedSchema = nil
	revised, err := app.event(ctx, agent, resultInput)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return harnessmcp.ElicitationReply{}, err
		}
		return elicitationReply(user.Action, user.Content, nil), nil
	}
	if revised.Action == "" {
		return elicitationReply(user.Action, user.Content, nil), nil
	}
	kept := user.Content
	if revised.Action == "decline" {
		kept = nil
	}
	return elicitationReply(revised.Action, revised.Content, kept), nil
}

func elicitationReply(action string, content, fallback json.RawMessage) harnessmcp.ElicitationReply {
	if action != "accept" && action != "decline" && action != "cancel" {
		action = "decline"
	}
	if action == "decline" {
		content = nil
	} else if len(content) == 0 {
		content = fallback
	}
	return harnessmcp.ElicitationReply{Action: action, Content: content}
}
