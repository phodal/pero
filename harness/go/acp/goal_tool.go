package acp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"sync"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

const goalStopTool = "pero_goal_stop"

type goalDecision string

const (
	goalCompleted goalDecision = "completed"
	goalBlocked   goalDecision = "blocked"
	goalPaused    goalDecision = "paused"
)

type goalDecisionArgs struct {
	Outcome goalDecision `json:"outcome"`
}

// goalRoundControl stages a proposal until that exact tool result and turn
// settle. It has no authority to start work or change a goal's round limit.
type goalRoundControl struct {
	owner   *harness.OwnedFollowupOwner
	mu      sync.Mutex
	call    harness.ToolCallID
	receipt json.RawMessage
	value   goalDecision
}

func (r *goalRoundControl) reset() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.call, r.receipt, r.value = "", nil, ""
}

func (r *goalRoundControl) propose(call harness.ToolCallID, receipt json.RawMessage, value goalDecision) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if call == "" || r.call != "" {
		return false
	}
	r.call, r.receipt, r.value = call, receipt, value
	return true
}

func (r *goalRoundControl) settledDecision(events []harness.Event) goalDecision {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.call == "" {
		return ""
	}
	// Match the exact successful persisted tool result, not model text or a
	// reused provider call ID. A finalization error loses this receipt.
	for i := len(events) - 1; i >= 0; i-- {
		event := events[i]
		if event.Type == "tool/result" {
			var result harness.ContentBlock
			if json.Unmarshal(event.Data, &result) == nil && result.ToolCallID == r.call &&
				!result.IsError && bytes.Equal(result.Meta, r.receipt) {
				return r.value
			}
		}
	}
	return ""
}

func (s *Server) registerGoalTool(run *point.Run, agent *harness.Agent) error {
	active := func(ctx context.Context, candidate *harness.Agent) *goalRoundControl {
		if candidate != agent {
			return nil
		}
		record, err := s.currentRecord(agent.ID())
		if err != nil || record.agent != agent {
			return nil
		}
		record.mu.Lock()
		round := record.goalRound
		record.mu.Unlock()
		if round == nil || !round.owner.OwnsExecution(ctx, agent) {
			return nil
		}
		return round
	}
	tool := harness.Tool{
		Schema: harness.ToolSchema{
			Name: goalStopTool,
			Description: "End automatic Goal rounds. First report evidence or the blocker in your answer. " +
				"Use completed only if the objective is met, blocked if further progress is impossible, or paused if an operator decision is needed.",
			InputSchema: json.RawMessage(`{"type":"object","properties":{"outcome":{"enum":["completed","blocked","paused"]}},"required":["outcome"],"additionalProperties":false}`),
		},
		ExecutionMode: harness.ExecutionSerial,
		ExecuteRequest: func(ctx context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
			round := active(ctx, request.Agent)
			_, nested := request.ParentExecutionToken()
			if round == nil || nested {
				return harness.ToolResult{}, errors.New("Goal decision requires the exact active Goal round")
			}
			var args goalDecisionArgs
			if err := json.Unmarshal(request.Arguments, &args); err != nil {
				return harness.ToolResult{}, err
			}
			id, err := randomSessionID()
			if err != nil {
				return harness.ToolResult{}, err
			}
			receipt, _ := json.Marshal(struct {
				GoalReceipt harness.SessionID `json:"peroGoalReceipt"`
			}{id})
			if !round.propose(request.CallID, receipt, args.Outcome) {
				return harness.ToolResult{}, errors.New("Goal round already has a decision or the call has no identity")
			}
			return harness.ToolResult{
				ConcludesTurn: true,
				Meta:          receipt,
				Content:       []harness.ContentBlock{{Type: harness.BlockText, Text: "Goal stop proposed: " + string(args.Outcome)}},
			}, nil
		},
	}
	_, err := s.h.Tools().RegisterCatalogProvider(run, "pero-goal", harness.ToolCatalogProvider{
		Schemas: func(ctx context.Context, candidate *harness.Agent) ([]harness.ToolSchema, error) {
			if active(ctx, candidate) == nil {
				return nil, nil
			}
			return []harness.ToolSchema{tool.Schema}, nil
		},
		Resolve: func(ctx context.Context, candidate *harness.Agent, name string) (harness.Tool, bool, error) {
			if name != goalStopTool || active(ctx, candidate) == nil {
				return harness.Tool{}, false, nil
			}
			return tool, true, nil
		},
	})
	return err
}
