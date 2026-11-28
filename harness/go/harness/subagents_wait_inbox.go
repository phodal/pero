package harness

import (
	"context"
	"encoding/json"
	"sync"
	"time"
)

// nextStepReport lives only in the trusted root tool execution context. Nested
// tools share it; a new execution never inherits an old model's call ID.
type nextStepReport struct {
	mu   sync.Mutex
	seen map[nextStepIdentity]struct{}
}

// Legacy plugin injections can lack a message ID. Their admission barrier
// distinguishes pending entries without modifying the transcript.
type nextStepIdentity struct {
	id        string
	anonymous <-chan struct{}
}

func (r *SubagentRegistry) WaitAgentTool(lifetime context.Context) Tool {
	return Tool{
		Schema: ToolSchema{
			Name:        "wait_agent",
			Description: "Wait for input at your next step, such as agent messages, completion notices, or user steering. Returns whether it timed out. It does not claim input or wait for other agents to finish.",
			InputSchema: json.RawMessage(`{"type":"object","properties":{"timeout_ms":{"type":"integer","minimum":10000,"maximum":3600000}},"additionalProperties":false}`),
		},
		IsConcurrencySafe: func(context.Context, ToolRequest) bool { return true },
		ExecuteRequest: func(ctx context.Context, request ToolRequest) (ToolResult, error) {
			var arguments struct {
				TimeoutMS *int64 `json:"timeout_ms"`
			}
			if err := json.Unmarshal(request.Arguments, &arguments); err != nil {
				return ToolResult{}, err
			}
			timeout := int64(30000)
			if arguments.TimeoutMS != nil {
				timeout = *arguments.TimeoutMS
			}
			if timeout < 10000 || timeout > 3600000 {
				return ToolResult{}, &subagentActivationError{"timeout_ms must be an integer from 10000 through 3600000", "WAIT_INVALID_TIMEOUT"}
			}
			lineage, _ := ctx.Value(toolCallLineageKey{}).(toolCallLineage)
			if lineage.owner != request.Agent || lineage.nextStep == nil || r.requireLiveParent(request.Agent) != nil {
				return ToolResult{}, &subagentActivationError{"wait_agent requires the exact live calling agent", "WAIT_UNAVAILABLE"}
			}
			timedOut, err := request.Agent.waitNextStep(ctx, lifetime, time.Duration(timeout)*time.Millisecond, lineage.nextStep)
			if err != nil {
				return ToolResult{}, err
			}
			raw, _ := json.Marshal(struct {
				TimedOut bool `json:"timedOut"`
			}{timedOut})
			return ToolResult{Content: []ContentBlock{{Type: BlockText, Text: string(raw)}}}, nil
		},
	}
}

func (a *Agent) waitNextStep(ctx, lifetime context.Context, timeout time.Duration, report *nextStepReport) (bool, error) {
	operation, err := a.beginOperation(ctx)
	if err != nil {
		return false, err
	}
	defer operation.release()
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	ctx = operation.context
	for {
		if ctx.Err() != nil {
			return false, context.Cause(ctx)
		}
		if lifetime.Err() != nil {
			return false, &subagentActivationError{"wait_agent contribution was unloaded", "WAIT_UNAVAILABLE"}
		}
		report.mu.Lock()
		a.injectMu.Lock()
		if a.nextStepWake == nil {
			a.nextStepWake = make(chan struct{})
		}
		wake := a.nextStepWake
		pending := make(map[nextStepIdentity]struct{}, len(a.injected))
		for _, item := range a.injected {
			identity := nextStepIdentity{id: item.message.ID}
			if identity.id == "" {
				identity.anonymous = item.admitted
			}
			pending[identity] = struct{}{}
		}
		a.injectMu.Unlock()
		// Subscribe before inspecting durable state. A concurrent insert either
		// appears in this snapshot or closes wake; no pending item is consumed.
		for _, item := range a.PendingDurableInbox(InboxNextStep) {
			pending[nextStepIdentity{id: item.ID}] = struct{}{}
		}
		fresh := false
		for id := range pending {
			if _, seen := report.seen[id]; !seen {
				fresh = true
				break
			}
		}
		if fresh {
			report.seen = pending
		}
		report.mu.Unlock()
		if fresh {
			return false, nil
		}
		select {
		case <-ctx.Done():
			return false, context.Cause(ctx)
		case <-lifetime.Done():
			return false, &subagentActivationError{"wait_agent contribution was unloaded", "WAIT_UNAVAILABLE"}
		case <-timer.C:
			return true, nil
		case <-wake:
		}
	}
}
