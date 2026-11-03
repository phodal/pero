package pluginruntime

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/phodal/pero/harness/go/claudehooks"
)

// failureBlocks reports whether a failed hook should stop the triggering action.
// Stop-style events and async hooks ignore onFailure. The default is to continue.
func failureBlocks(hook claudehooks.Hook, event string) bool {
	switch event {
	case "Stop", "SubagentStop", "TaskCompleted", "TeammateIdle":
		return false
	}
	if hook.Async {
		return false
	}
	return hook.OnFailure == "block"
}

func blockedHookFailure(hook claudehooks.Hook, input claudehooks.Input, err error) claudehooks.Decision {
	kind := "failed"
	if errors.Is(err, context.DeadlineExceeded) {
		kind = "timed out"
	}
	target := input.Event
	if input.ToolName != "" {
		target += ":" + input.ToolName
	}
	reason := fmt.Sprintf("%s hook error: [%s]: %s; blocking because onFailure is \"block\": %s", target, strings.TrimSpace(hook.Command), kind, err.Error())
	decision := claudehooks.Decision{Block: true, Reason: reason}
	if input.Event == "PreToolUse" || input.Event == "PermissionRequest" {
		decision.Permission = "deny"
	}
	return decision
}
