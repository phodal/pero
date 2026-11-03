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
		return app.deliverElicitation(agent, harnessmcp.ElicitationReply{Action: "decline"})
	}
	app.rememberElicitation(request.ID, agent)
	if decision.Action != "" {
		return app.deliverElicitation(agent, elicitationReply(decision.Action, decision.Content, nil))
	}
	user := claudehooks.Decision{Action: "decline"}
	if app.options.AnswerElicitation != nil {
		stop := app.watchElicitationDialog(agent, request.Mode)
		user, err = app.options.AnswerElicitation(ctx, input)
		stop()
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
		return app.deliverElicitation(agent, elicitationReply(user.Action, user.Content, nil))
	}
	if revised.Action == "" {
		return app.deliverElicitation(agent, elicitationReply(user.Action, user.Content, nil))
	}
	kept := user.Content
	if revised.Action == "decline" {
		kept = nil
	}
	return app.deliverElicitation(agent, elicitationReply(revised.Action, revised.Content, kept))
}

func (app *HookApp) deliverElicitation(agent *harness.Agent, reply harnessmcp.ElicitationReply) (harnessmcp.ElicitationReply, error) {
	app.noteElicitation(agent, "elicitation_response", "Elicitation response "+reply.Action, "Elicitation")
	return reply, nil
}

func (app *HookApp) rememberElicitation(id string, agent *harness.Agent) {
	if app == nil || agent == nil || id == "" {
		return
	}
	app.mu.Lock()
	defer app.mu.Unlock()
	if app.elicitationAgents == nil {
		app.elicitationAgents = map[string]*harness.Agent{}
	}
	app.elicitationAgents[id] = agent
}

func (app *HookApp) noteElicitationComplete(caller any, id string) {
	agent, _ := caller.(*harness.Agent)
	if id != "" {
		app.mu.Lock()
		if saved := app.elicitationAgents[id]; saved != nil {
			agent = saved
			delete(app.elicitationAgents, id)
		}
		app.mu.Unlock()
	}
	app.noteElicitation(agent, "elicitation_complete", "URL elicitation completed", "Elicitation")
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
