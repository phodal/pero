package pluginruntime

import (
	"context"
	"encoding/json"
	"os"
	"time"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
)

// permissionNotifyDelay matches Claude's Agent SDK permission_prompt wait.
// idleNotifyDelay matches the idle_prompt wait after a finished response.
// Tests shorten them; production stays at the documented intervals.
var (
	permissionNotifyDelay = 6 * time.Second
	idleNotifyDelay       = 60 * time.Second
)

// schedulePermissionNotification fires Notification permission_prompt when an
// approval prompt is still unanswered. An earlier answer skips it.
func (app *HookApp) schedulePermissionNotification(request harness.ApprovalRequest) {
	if app == nil || request.Agent == nil || request.ID == "" || !app.hasHookEvent("Notification") {
		return
	}
	if os.Getenv("CLAUDE_CODE_DISABLE_PERMISSION_PROMPT_NOTIFY_HOOKS") == "1" {
		return
	}
	parent := app.owner
	if parent == nil {
		parent = context.Background()
	}
	agent, id := request.Agent, request.ID
	app.calls.Add(1)
	go func() {
		defer app.calls.Done()
		timer := time.NewTimer(permissionNotifyDelay)
		defer timer.Stop()
		select {
		case <-parent.Done():
			return
		case <-timer.C:
		}
		if approvalDecided(agent.Session(), id) {
			return
		}
		_, _ = app.event(context.WithoutCancel(parent), agent, claudehooks.Input{
			Event: "Notification", NotificationType: "permission_prompt",
			Message: "Claude needs your permission", Title: "Permission needed",
		})
	}()
}

func (app *HookApp) noteElicitation(agent *harness.Agent, kind, message, title string) {
	if app == nil || agent == nil || kind == "" || !app.hasHookEvent("Notification") {
		return
	}
	_, _ = app.event(context.Background(), agent, claudehooks.Input{
		Event: "Notification", NotificationType: kind, Message: message, Title: title,
	})
}

// watchElicitationDialog notifies when a form or URL dialog is still open
// after the permission prompt wait. An earlier answer cancels it.
func (app *HookApp) watchElicitationDialog(agent *harness.Agent, mode string) func() {
	if app == nil || agent == nil || !app.hasHookEvent("Notification") {
		return func() {}
	}
	kind, message := "elicitation_dialog", "An MCP server is waiting for your input"
	if mode == "url" {
		kind, message = "elicitation_url_dialog", "An MCP server is waiting for you to open a URL"
	}
	parent := app.owner
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	app.calls.Add(1)
	go func() {
		defer app.calls.Done()
		timer := time.NewTimer(permissionNotifyDelay)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		app.noteElicitation(agent, kind, message, "Elicitation")
	}()
	return cancel
}

func (app *HookApp) noteAgentCompleted(info harness.SubagentLifecycle) {
	if app == nil || info.Parent == nil || !info.Background || !app.hasHookEvent("Notification") {
		return
	}
	status := "completed"
	if info.StopReason != "" && info.StopReason != harness.SubagentCompleted {
		status = string(info.StopReason)
	}
	_, _ = app.event(context.Background(), info.Parent, claudehooks.Input{
		Event: "Notification", NotificationType: "agent_completed",
		Message: "Background agent " + string(info.ID) + " " + status, Title: "Agent completed",
	})
}

func (app *HookApp) noteIdle(agent *harness.Agent, status harness.AgentStatus) {
	if app == nil || agent == nil || agent.Parent() != nil || !app.hasHookEvent("Notification") {
		return
	}
	app.mu.Lock()
	if cancel := app.idleCancels[agent]; cancel != nil {
		cancel()
		delete(app.idleCancels, agent)
	}
	if app.closed || status != harness.AgentIdle {
		app.mu.Unlock()
		return
	}
	parent := app.owner
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	if app.idleCancels == nil {
		app.idleCancels = map[*harness.Agent]context.CancelFunc{}
	}
	app.idleCancels[agent] = cancel
	app.calls.Add(1)
	app.mu.Unlock()
	go func() {
		defer app.calls.Done()
		timer := time.NewTimer(idleNotifyDelay)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		if agent.Status() != harness.AgentIdle || app.backgroundBusy(agent) {
			return
		}
		_, _ = app.event(context.WithoutCancel(ctx), agent, claudehooks.Input{
			Event: "Notification", NotificationType: "idle_prompt",
			Message: "Claude is waiting for your input", Title: "Idle",
		})
	}()
}

func (app *HookApp) backgroundBusy(agent *harness.Agent) bool {
	registry := app.h.Subagents()
	if registry == nil || agent == nil {
		return false
	}
	for _, child := range registry.ListChildren(agent, true) {
		if child.Status == harness.SubagentRunning {
			return true
		}
	}
	return false
}

func approvalDecided(session *harness.Session, id string) bool {
	if session == nil || id == "" {
		return true
	}
	for _, event := range session.Events() {
		if event.Type != "approval/decided" {
			continue
		}
		var body struct {
			ID string `json:"id"`
		}
		if json.Unmarshal(event.Data, &body) == nil && body.ID == id {
			return true
		}
	}
	return false
}
