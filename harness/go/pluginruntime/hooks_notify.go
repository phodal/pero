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
// Tests shorten it; production stays at six seconds.
var permissionNotifyDelay = 6 * time.Second

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
