package acp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"

	"github.com/phodal/pero/harness/go/harness"
)

const (
	goalCreateTool             = "create_goal"
	goalUpdateTool             = "update_goal"
	goalDefaultDelegatedRounds = 3
)

// A non-persistent grant for one explicitly delegated ACP operator turn. It
// is not inherited by max-token recovery, another prompt, or an owned round.
type goalDelegation struct {
	promptID string
	mu       sync.Mutex
	call     harness.ToolCallID
	receipt  json.RawMessage
	change   goalMutation
}

type goalMutation struct {
	before goalRef
	state  goalState
	kind   string
	arm    bool
}

type goalMutationArgs struct {
	ID            string  `json:"goal_id"`
	Revision      int     `json:"revision"`
	Action        string  `json:"action"`
	Objective     *string `json:"objective"`
	Limit         *int    `json:"max_goal_rounds"`
	BlockedReason *string `json:"blocked_reason"`
}

func (a goalMutationArgs) ref() goalRef { return goalRef{GoalID: a.ID, Revision: a.Revision} }

func (a goalMutationArgs) stop() (goalDecisionArgs, error) {
	if a.Objective != nil || a.Limit != nil {
		return goalDecisionArgs{}, errors.New("only edit can replace objective or round cap")
	}
	result := goalDecisionArgs{Outcome: goalDecision(a.Action)}
	if a.Action == "complete" {
		result.Outcome = goalCompleted
	}
	if a.BlockedReason != nil {
		if result.Outcome != goalBlocked {
			return goalDecisionArgs{}, errors.New("blocked_reason is only allowed for blocked")
		}
		result.BlockedReason = strings.TrimSpace(*a.BlockedReason)
	}
	if result.Outcome == goalBlocked && (result.BlockedReason == "" || len(result.BlockedReason) > goalBlockReasonMax) {
		return goalDecisionArgs{}, errors.New("blocked requires a nonempty blocked_reason of at most 1024 bytes")
	}
	return result, nil
}

func planGoalMutation(state goalState, args goalMutationArgs, newID string) (goalMutation, error) {
	m := goalMutation{before: state.ref(), state: state}
	switch args.Action {
	case "create":
		if state.ID != "" && state.Stop != string(goalCompleted) {
			return m, errors.New("complete the existing Goal before creating another")
		}
		next := goalDefinition{ID: newID, Revision: 1, Limit: goalDefaultDelegatedRounds}
		if args.Objective != nil {
			next.Objective = strings.TrimSpace(*args.Objective)
		}
		if args.Limit != nil {
			next.Limit = *args.Limit
		}
		if !next.valid() {
			return m, errors.New("create_goal requires an objective up to 4096 bytes and a cap of 1-10 rounds")
		}
		m.state, m.kind, m.arm = goalState{goalDefinition: next}, goalDefined, true
		return m, nil
	}
	if state.ID == "" || args.ref() != state.ref() {
		return m, errors.New("stale or missing Goal reference; use get_goal")
	}
	switch args.Action {
	case "edit":
		if args.BlockedReason != nil {
			return m, errors.New("blocked_reason is only allowed for blocked")
		}
		next := state.goalDefinition
		next.Revision = state.ref().Revision + 1
		if args.Objective != nil {
			next.Objective = strings.TrimSpace(*args.Objective)
		}
		if args.Limit != nil {
			next.Limit = *args.Limit
		}
		if !m.state.edit(next) {
			return m, errors.New("Goal edit must change objective or cap without refunding rounds")
		}
		m.kind = goalEdited
	case "resume":
		if args.Objective != nil || args.Limit != nil || args.BlockedReason != nil {
			return m, errors.New("resume takes only the Goal reference")
		}
		if !state.canRun() || state.Stop != "" {
			return m, errors.New("only the operator can resume a paused or blocked Goal with /goal resume")
		}
		m.arm = true
	case "pause", "complete", "blocked":
		if state.Stop == string(goalCompleted) {
			return m, errors.New("Goal is already complete")
		}
		decision, err := args.stop()
		if err != nil {
			return m, err
		}
		if args.Action == "pause" {
			decision.Outcome = goalPaused
		}
		m.state.Stop, m.state.StopBy, m.state.StopDetail = string(decision.Outcome), goalStopModel, decision.BlockedReason
		m.kind = goalStopped
	default:
		return m, errors.New("unknown Goal action")
	}
	return m, nil
}

func (g *goalDelegation) propose(call harness.ToolCallID, mutation goalMutation, nonce harness.SessionID) (harness.ToolResult, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if call == "" || g.call != "" {
		return harness.ToolResult{}, errors.New("this delegated turn already proposed a Goal change")
	}
	receipt, _ := json.Marshal(struct {
		Receipt harness.SessionID `json:"peroGoalMutationReceipt"`
	}{nonce})
	payload, err := json.Marshal(mutation.state.toolView(false))
	if err != nil {
		return harness.ToolResult{}, err
	}
	g.call, g.receipt, g.change = call, receipt, mutation
	return harness.ToolResult{ConcludesTurn: true, Meta: receipt, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: string(payload)}}}, nil
}

func (s *Server) settleDelegatedGoal(ctx context.Context, record *activeSession, grant *goalDelegation, result harness.TurnResult) (harness.TurnResult, error) {
	if result.Reason != harness.FinishStop || ctx.Err() != nil {
		return result, ctx.Err()
	}
	session := record.agent.Session()
	events := session.Events()
	grant.mu.Lock()
	m, matched := grant.change, goalToolReceiptSettled(events, grant.call, grant.receipt)
	grant.mu.Unlock()
	if !matched {
		return result, nil
	}
	if current := foldGoal(events); current.ref() != m.before {
		return result, errors.New("Goal revision changed before settlement")
	}
	switch m.kind {
	case goalDefined, goalEdited:
		if _, err := session.Append(m.kind, m.state.goalDefinition); err != nil {
			return result, err
		}
		if err := session.Flush(ctx); err != nil {
			return result, err
		}
	case goalStopped:
		return result, s.stopGoal(ctx, record, m.before, goalStop{Reason: m.state.Stop, By: m.state.StopBy, Detail: m.state.StopDetail})
	}
	if m.arm {
		var err error
		result.Reason, err = s.runGoalRounds(ctx, record, m.state)
		return result, err
	}
	return result, s.showGoalStatus(record, m.state)
}

func goalToolReceiptSettled(events []harness.Event, call harness.ToolCallID, receipt json.RawMessage) bool {
	if call == "" {
		return false
	}
	for i := len(events) - 1; i >= 0; i-- {
		if events[i].Type != "tool/result" {
			continue
		}
		var result harness.ContentBlock
		if json.Unmarshal(events[i].Data, &result) == nil && result.ToolCallID == call &&
			!result.IsError && bytes.Equal(result.Meta, receipt) {
			return true
		}
	}
	return false
}
