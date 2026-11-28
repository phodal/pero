package acp

import (
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
	goalReadTool                = "get_goal"
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
	if goalToolReceiptSettled(events, r.call, r.receipt) {
		return r.value
	}
	return goalDecisionArgs{}
}

type goalBlockView struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type goalReadView struct {
	ID            string         `json:"id"`
	Revision      int            `json:"revision"`
	Objective     string         `json:"objective"`
	Phase         string         `json:"phase"`
	RoundsStarted int            `json:"roundsStarted"`
	MaxGoalRounds int            `json:"maxGoalRounds"`
	BlockedReason *goalBlockView `json:"blockedReason,omitempty"`
}

type goalReadResult struct {
	Goal       *goalReadView `json:"goal"`
	Activation string        `json:"activation,omitempty"`
}

func (g goalState) toolView(armed bool) goalReadResult {
	if g.ID == "" {
		return goalReadResult{}
	}
	view := &goalReadView{
		ID: g.ID, Revision: g.ref().Revision, Objective: g.Objective,
		Phase: "active", RoundsStarted: g.Rounds, MaxGoalRounds: g.Limit,
	}
	result := goalReadResult{Goal: view, Activation: "disarmed"}
	if armed {
		result.Activation = "armed"
	}
	switch g.Stop {
	case string(goalCompleted):
		view.Phase = "complete"
	case string(goalBlocked):
		view.Phase = "blocked"
		view.BlockedReason = &goalBlockView{Code: "model-reported", Message: g.StopDetail}
	case "":
		if !armed && g.Rounds >= g.Limit {
			view.Phase = "paused"
		}
	default:
		// Pero checkpoints exhaustion, cancellation and provider failures
		// without reporting that the operator's objective was complete.
		view.Phase = "paused"
	}
	return result
}

func (s *Server) registerGoalTool(run *point.Run, agent *harness.Agent) error {
	root := func(candidate *harness.Agent) *activeSession {
		if candidate != agent || agent.Parent() != nil || !s.goalAvailable(agent) {
			return nil
		}
		record, err := s.currentRecord(agent.ID())
		if err != nil || record.agent != agent {
			return nil
		}
		return record
	}
	active := func(ctx context.Context, candidate *harness.Agent) *goalRoundControl {
		record := root(candidate)
		if record == nil {
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
	read := harness.Tool{
		Schema: harness.ToolSchema{
			Name:        goalReadTool,
			Description: "Read the current session Goal and its activation state. This does not start or modify work.",
			InputSchema: json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`),
		},
		ExecuteRequest: func(ctx context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
			_, nested := request.ParentExecutionToken()
			if nested || request.RootCallID() == "" || root(request.Agent) == nil || agent.Status() != harness.AgentRunning {
				return harness.ToolResult{}, errors.New("Goal read requires the exact active root model turn")
			}
			state := foldGoal(agent.Session().Events())
			payload, err := json.Marshal(state.toolView(active(ctx, request.Agent) != nil))
			if err != nil {
				return harness.ToolResult{}, err
			}
			return harness.ToolResult{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: string(payload)}}}, nil
		},
	}
	delegation := func(candidate *harness.Agent) *goalDelegation {
		record := root(candidate)
		if record == nil {
			return nil
		}
		record.mu.Lock()
		grant := record.goalDelegation
		record.mu.Unlock()
		if grant == nil || !agent.OwnsUserPrompt(grant.promptID) {
			return nil
		}
		return grant
	}
	create := harness.Tool{
		Schema: harness.ToolSchema{
			Name: goalCreateTool, Description: "Create and start a bounded Goal only when the operator explicitly delegated that action.",
			InputSchema: json.RawMessage(`{"type":"object","properties":{"objective":{"type":"string"},"max_goal_rounds":{"type":"integer","minimum":1,"maximum":10}},"required":["objective"],"additionalProperties":false}`),
		},
		ExecutionMode: harness.ExecutionSerial,
		ExecuteRequest: func(ctx context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
			grant := delegation(request.Agent)
			_, nested := request.ParentExecutionToken()
			if grant == nil || nested || request.RootCallID() == "" || agent.Status() != harness.AgentRunning {
				return harness.ToolResult{}, errors.New("create_goal requires the exact operator-delegated root turn")
			}
			var args struct {
				Objective *string `json:"objective"`
				Limit     *int    `json:"max_goal_rounds"`
			}
			if err := json.Unmarshal(request.Arguments, &args); err != nil {
				return harness.ToolResult{}, err
			}
			id, err := randomSessionID()
			if err != nil {
				return harness.ToolResult{}, err
			}
			change, err := planGoalMutation(foldGoal(agent.Session().Events()), goalMutationArgs{Action: "create", Objective: args.Objective, Limit: args.Limit}, string(id))
			if err != nil {
				return harness.ToolResult{}, err
			}
			return grant.propose(request.CallID, change, id)
		},
	}
	update := harness.Tool{
		Schema: harness.ToolSchema{
			Name: goalUpdateTool, Description: "Update the exact Goal revision. Within a Goal round only complete or blocked are permitted. A paused or blocked Goal requires the operator to run /goal resume.",
			InputSchema: json.RawMessage(`{"type":"object","properties":{"goal_id":{"type":"string"},"revision":{"type":"integer","minimum":1},"action":{"enum":["edit","pause","resume","complete","blocked"]},"objective":{"type":"string"},"max_goal_rounds":{"type":"integer","minimum":1,"maximum":10},"blocked_reason":{"type":"string","maxLength":1024}},"required":["goal_id","revision","action"],"additionalProperties":false}`),
		},
		ExecutionMode: harness.ExecutionSerial,
		ExecuteRequest: func(ctx context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
			grant, round := delegation(request.Agent), active(ctx, request.Agent)
			_, nested := request.ParentExecutionToken()
			if (grant == nil && round == nil) || nested || request.RootCallID() == "" || agent.Status() != harness.AgentRunning {
				return harness.ToolResult{}, errors.New("update_goal requires the exact operator-delegated root turn or owned Goal round")
			}
			var args goalMutationArgs
			if err := json.Unmarshal(request.Arguments, &args); err != nil {
				return harness.ToolResult{}, err
			}
			if args.Action == "create" {
				return harness.ToolResult{}, errors.New("update_goal cannot create a Goal")
			}
			state := foldGoal(agent.Session().Events())
			if grant != nil {
				mutation, err := planGoalMutation(state, args, "")
				if err != nil {
					return harness.ToolResult{}, err
				}
				nonce, err := randomSessionID()
				if err != nil {
					return harness.ToolResult{}, err
				}
				return grant.propose(request.CallID, mutation, nonce)
			}
			if args.ref() != state.ref() || (args.Action != "complete" && args.Action != "blocked") {
				return harness.ToolResult{}, errors.New("this Goal round can only complete or block its exact current revision")
			}
			decision, err := args.stop()
			if err != nil {
				return harness.ToolResult{}, err
			}
			request.Arguments, err = json.Marshal(decision)
			if err != nil {
				return harness.ToolResult{}, err
			}
			return tool.ExecuteRequest(ctx, request)
		},
	}
	_, err := s.h.Tools().RegisterCatalogProvider(run, "pero-goal", harness.ToolCatalogProvider{
		Schemas: func(ctx context.Context, candidate *harness.Agent) ([]harness.ToolSchema, error) {
			if root(candidate) == nil {
				return nil, nil
			}
			if delegation(candidate) != nil {
				return []harness.ToolSchema{read.Schema, create.Schema, update.Schema}, nil
			}
			if active(ctx, candidate) != nil {
				return []harness.ToolSchema{read.Schema, tool.Schema, update.Schema}, nil
			}
			return []harness.ToolSchema{read.Schema}, nil
		},
		Resolve: func(ctx context.Context, candidate *harness.Agent, name string) (harness.Tool, bool, error) {
			switch {
			case name == goalReadTool && root(candidate) != nil:
				return read, true, nil
			case name == goalCreateTool && delegation(candidate) != nil:
				return create, true, nil
			case name == goalUpdateTool && (delegation(candidate) != nil || active(ctx, candidate) != nil):
				return update, true, nil
			case name == goalStopTool && active(ctx, candidate) != nil:
				return tool, true, nil
			default:
				return harness.Tool{}, false, nil
			}
		},
	})
	return err
}
