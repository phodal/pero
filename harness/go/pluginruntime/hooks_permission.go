package pluginruntime

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/skills"
)

type sessionPermissionRule struct {
	behavior, rule string
}

func sessionHookPermissionMode(agent *harness.Agent, event string) string {
	if agent == nil || agent.Session() == nil || !hookCarriesPermissionMode(event) {
		return ""
	}
	return harness.HookPermissionMode(agent.Session().Events())
}

func hookCarriesPermissionMode(event string) bool {
	switch event {
	case "PreToolUse", "UserPromptSubmit", "UserPromptExpansion", "PermissionRequest", "PostToolUse", "PostToolUseFailure", "PostToolBatch", "PermissionDenied", "SubagentStop", "TaskCompleted", "Stop", "TeammateIdle":
		return true
	default:
		return false
	}
}

// permissionRequest runs only when an approval prompt is about to be shown, or
// when a non-interactive ask cannot prompt. Exit 2 leaves that flow unchanged.
// allow can replace the tool arguments. interrupt rejects the call and stops
// the turn. Session permission rules from updatedPermissions apply to later
// calls. Settings files are not written.
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
		if err := app.rememberSessionPermissions(request.Agent, decision.SessionPermissions); err != nil {
			return harness.ApprovalUnavailable, err
		}
		return harness.ApprovalAllowedOnce, nil
	default:
		if !request.NonInteractive {
			app.schedulePermissionNotification(request)
		}
		return harness.ApprovalUnavailable, nil
	}
}

func (app *HookApp) rememberSessionPermissions(agent *harness.Agent, updates []claudehooks.PermissionUpdate) error {
	if app == nil || agent == nil || len(updates) == 0 {
		return nil
	}
	for _, update := range updates {
		switch update.Op {
		case "addDir":
			for _, directory := range update.Directories {
				if _, err := app.bindAddedDirectory(agent, directory); err != nil && !errors.Is(err, errDirectoryAlreadyAdded) {
					return err
				}
			}
		case "removeDir":
			for _, directory := range update.Directories {
				if err := app.releaseAddedDirectory(agent, directory); err != nil {
					return err
				}
			}
		case "setMode":
			if _, err := harness.SetClaudePermissionMode(agent.Session(), update.Mode); err != nil {
				return err
			}
		}
	}
	app.mu.Lock()
	defer app.mu.Unlock()
	if app.sessionRules == nil {
		app.sessionRules = map[harness.SessionID][]sessionPermissionRule{}
	}
	rules := app.sessionRules[agent.ID()]
	for _, update := range updates {
		switch update.Op {
		case "add":
			for _, rule := range update.Rules {
				rules = append(rules, sessionPermissionRule{behavior: update.Behavior, rule: rule})
			}
		case "remove":
			rules = dropSessionRules(rules, update.Behavior, update.Rules)
		case "replace":
			var kept []sessionPermissionRule
			for _, rule := range rules {
				if rule.behavior != update.Behavior {
					kept = append(kept, rule)
				}
			}
			for _, rule := range update.Rules {
				kept = append(kept, sessionPermissionRule{behavior: update.Behavior, rule: rule})
			}
			rules = kept
		}
	}
	app.sessionRules[agent.ID()] = rules
	return nil
}

func dropSessionRules(rules []sessionPermissionRule, behavior string, names []string) []sessionPermissionRule {
	var kept []sessionPermissionRule
	for _, rule := range rules {
		drop := rule.behavior == behavior
		if drop {
			drop = false
			for _, name := range names {
				if name == rule.rule {
					drop = true
					break
				}
			}
		}
		if !drop {
			kept = append(kept, rule)
		}
	}
	return kept
}

func (app *HookApp) sessionDenies(request *harness.ToolRequest) bool {
	if app.sessionBehavior(request) != "deny" {
		return false
	}
	request.DenyReason = "Session permission rule denied this tool call."
	return true
}

func (app *HookApp) applySessionPermission(request *harness.ToolRequest, decision claudehooks.Decision) {
	if decision.Block || decision.Stop || decision.EndTurn || decision.Permission != "" {
		return
	}
	switch app.sessionBehavior(request) {
	case "ask":
		request.RequestApproval, request.Preapproved = true, false
	case "allow":
		if !request.RequestApproval {
			request.Preapproved = true
		}
	}
}

func (app *HookApp) sessionBehavior(request *harness.ToolRequest) string {
	if app == nil || request == nil || request.Agent == nil {
		return ""
	}
	app.mu.Lock()
	rules := append([]sessionPermissionRule(nil), app.sessionRules[request.Agent.ID()]...)
	app.mu.Unlock()
	var deny, ask, allow []string
	for _, rule := range rules {
		switch rule.behavior {
		case "deny":
			deny = append(deny, rule.rule)
		case "ask":
			ask = append(ask, rule.rule)
		case "allow":
			allow = append(allow, rule.rule)
		}
	}
	if skills.AllowsTool(deny, request.Name, request.Arguments) {
		return "deny"
	}
	if skills.AllowsTool(ask, request.Name, request.Arguments) {
		return "ask"
	}
	if skills.AllowsTool(allow, request.Name, request.Arguments) {
		return "allow"
	}
	return ""
}
