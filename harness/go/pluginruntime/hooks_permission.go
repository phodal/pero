package pluginruntime

import (
	"context"
	"encoding/json"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
)

// permissionRequest runs only when an approval prompt is about to be shown, or
// when a non-interactive ask cannot prompt. Exit 2 leaves that flow unchanged.
// allow can replace the tool arguments. interrupt rejects the call and stops
// the turn. Settings permission rules are not written from updatedPermissions.
func (app *HookApp) permissionRequest(ctx context.Context, request harness.ApprovalRequest) (harness.ApprovalOutcome, error) {
	decision, err := app.event(ctx, request.Agent, claudehooks.Input{
		Event: "PermissionRequest", ToolName: request.ToolName, ToolInput: request.ToolInput,
	})
	if err != nil {
		return harness.ApprovalUnavailable, err
	}
	if request.HookResult != nil {
		if decision.Permission == "allow" {
			request.HookResult.UpdatedInput = append(json.RawMessage(nil), decision.UpdatedInput...)
		}
		request.HookResult.Reason = decision.Reason
		request.HookResult.Interrupt = decision.Stop
	}
	switch {
	case decision.Stop:
		return harness.ApprovalRejected, nil
	case decision.Permission == "deny" || decision.Block:
		return harness.ApprovalRejected, nil
	case decision.Permission == "allow":
		return harness.ApprovalAllowedOnce, nil
	default:
		if !request.NonInteractive {
			app.schedulePermissionNotification(request)
		}
		return harness.ApprovalUnavailable, nil
	}
}
