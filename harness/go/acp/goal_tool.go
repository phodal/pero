package acp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

const (
	goalStopTool                = "pero_goal_stop"
	defaultGoalBlockAfterRounds = 3
	goalBlockReasonMax          = 1024
)

type goalDecision string

const (
	goalCompleted goalDecision = "completed"
	goalBlocked   goalDecision = "blocked"
	goalPaused    goalDecision = "paused"
)

type goalDecisionArgs struct {
	Outcome       goalDecision `json:"outcome"`
	BlockedReason string       `json:"blocked_reason,omitempty"`
}

// goalRoundControl stages a proposal until that exact tool result and turn
// settle. It has no authority to start work or change a goal's round limit.
type goalRoundControl struct {
	owner   *harness.OwnedFollowupOwner
	mu      sync.Mutex
	call    harness.ToolCallID
	receipt json.RawMessage
	number  int
	value   goalDecisionArgs
}

func (r *goalRoundControl) reset(number int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.number, r.call, r.receipt, r.value = number, "", nil, goalDecisionArgs{}
}

func (r *goalRoundControl) propose(call harness.ToolCallID, receipt json.RawMessage, value goalDecisionArgs, blockAfter int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if call == "" || r.call != "" {
		return errors.New("Goal round already has a decision or the call has no identity")
	}
	value.BlockedReason = strings.TrimSpace(value.BlockedReason)
	switch value.Outcome {
	case goalBlocked:
		if value.BlockedReason == "" || len(value.BlockedReason) > goalBlockReasonMax {
			return fmt.Errorf("blocked requires a nonempty blocked_reason of at most %d bytes", goalBlockReasonMax)
		}
		if r.number < blockAfter {
			return fmt.Errorf("blocked requires at least %d admitted Goal rounds; current round is %d", blockAfter, r.number)
		}
	case goalCompleted, goalPaused:
		if value.BlockedReason != "" {
			return errors.New("blocked_reason is only allowed for blocked")
		}
	default:
		return errors.New("unknown Goal decision")
	}
	r.call, r.receipt, r.value = call, receipt, value
	return nil
}

func (r *goalRoundControl) settledDecision(events []harness.Event) goalDecisionArgs {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.call == "" {
		return goalDecisionArgs{}
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
	return goalDecisionArgs{}
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
				"Use completed when the objective is met or paused when an operator decision is needed. " +
				fmt.Sprintf("Use blocked only from round %d if the same blocker persists, and include a concrete blocked_reason.", s.goalBlockAfterRounds),
			InputSchema: json.RawMessage(`{"type":"object","properties":{"outcome":{"enum":["completed","blocked","paused"]},"blocked_reason":{"type":"string","maxLength":1024}},"required":["outcome"],"additionalProperties":false}`),
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
			if err := round.propose(request.CallID, receipt, args, s.goalBlockAfterRounds); err != nil {
				return harness.ToolResult{}, err
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
