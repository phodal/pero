package acp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/phodal/pero/harness/go/harness"
	harnesssession "github.com/phodal/pero/harness/go/session"
)

const (
	goalDefined   = "pero/goal/defined"
	goalAdmitted  = "pero/goal/admitted"
	goalStopped   = "pero/goal/stopped"
	goalMaxRounds = 10
)

type goalDefinition struct {
	ID        string `json:"id"`
	Objective string `json:"objective"`
	Limit     int    `json:"limit"`
}

type goalRound struct {
	GoalID    string `json:"goalId"`
	Number    int    `json:"number"`
	MessageID string `json:"messageId"`
}

type goalStop struct {
	GoalID string         `json:"goalId"`
	Reason string         `json:"reason"`
	By     goalStopSource `json:"by,omitempty"`
}

type goalStopSource string

const (
	goalStopDriver   goalStopSource = "driver"
	goalStopOperator goalStopSource = "operator"
	goalStopModel    goalStopSource = "model"
)

type goalState struct {
	goalDefinition
	Rounds int
	Stop   string
	StopBy goalStopSource
}

// foldGoal is session intent and consumed rounds only. There is no persisted
// permission to start work; only the current explicit command owns that.
func foldGoal(events []harness.Event) goalState {
	var state goalState
	for i, event := range events {
		switch event.Type {
		case goalDefined:
			var goal goalDefinition
			if json.Unmarshal(event.Data, &goal) == nil && goal.ID != "" &&
				goal.Limit > 0 && goal.Limit <= goalMaxRounds && goal.Objective != "" && len(goal.Objective) <= 4096 {
				state = goalState{goalDefinition: goal}
			}
		case goalAdmitted:
			var round goalRound
			if state.ID == "" || json.Unmarshal(event.Data, &round) != nil || round.GoalID != state.ID ||
				round.Number != state.Rounds+1 || round.Number > state.Limit || round.MessageID == "" {
				continue
			}
			// An anchored fork can cut between the admission fact and its
			// matching message. A fact without that message is not a round.
			for _, next := range events[i+1:] {
				if next.Type != "user/message" {
					break
				}
				var message harness.Message
				if json.Unmarshal(next.Data, &message) == nil && message.ID == round.MessageID {
					state.Rounds++
					state.Stop, state.StopBy = "", ""
					break
				}
			}
		case goalStopped:
			var stop goalStop
			if state.ID != "" && json.Unmarshal(event.Data, &stop) == nil && stop.GoalID == state.ID {
				state.Stop, state.StopBy = stop.Reason, stop.By
			}
		}
	}
	return state
}

func (g goalState) canRun() bool {
	return g.ID != "" && g.Rounds < g.Limit && g.Stop != string(goalCompleted)
}

func (s *Server) runGoalCommand(ctx context.Context, record *activeSession, input string) (harness.FinishKind, error) {
	agent := record.agent
	session := agent.Session()
	if agent.IsExternal() || s.preparePrompt != nil || !session.DurabilityAttached() {
		return "", invalidError("/goal requires a durable native ACP session without specialized prompt preparation")
	}
	input = strings.TrimSpace(input)
	action, args, _ := strings.Cut(input, " ")
	state := foldGoal(session.Events())
	switch action {
	case "start":
		limitText, objective, _ := strings.Cut(strings.TrimSpace(args), " ")
		limit, err := strconv.Atoi(limitText)
		objective = strings.TrimSpace(objective)
		if err != nil || limit < 1 || limit > goalMaxRounds || objective == "" || len(objective) > 4096 {
			return "", invalidError("usage: /goal start <1-10 rounds> <objective up to 4096 bytes>")
		}
		id, err := randomSessionID()
		if err != nil {
			return "", err
		}
		state = goalState{goalDefinition: goalDefinition{string(id), objective, limit}}
		if _, err := session.Append(goalDefined, state.goalDefinition); err != nil {
			return "", err
		}
		if err := session.Flush(ctx); err != nil {
			return "", err
		}
	case "resume", "status", "complete":
		if args != "" {
			return "", invalidError("/goal " + action + " does not take arguments")
		}
		if state.ID == "" {
			return "", invalidError("no goal in this session")
		}
		if action == "status" || action == "resume" && !state.canRun() {
			return harness.FinishStop, s.showGoalStatus(record, state)
		}
		if action == "complete" {
			return harness.FinishStop, s.stopGoal(ctx, record, string(goalCompleted), goalStopOperator)
		}
	default:
		return "", invalidError("usage: /goal start <rounds> <objective> | /goal resume | /goal status | /goal complete")
	}
	return s.runGoalRounds(ctx, record, state)
}

func (s *Server) runGoalRounds(ctx context.Context, record *activeSession, state goalState) (harness.FinishKind, error) {
	agent := record.agent
	session := agent.Session()
	owner := harness.NewOwnedFollowupOwner("pero-goal")
	control := &goalRoundControl{owner: owner}
	record.mu.Lock()
	record.goalRound = control
	record.mu.Unlock()
	defer func() {
		record.mu.Lock()
		record.goalRound = nil
		record.mu.Unlock()
	}()
	defer func() { _ = owner.BeginRetire(ctx).Drain(context.WithoutCancel(ctx)) }()
	source, _ := json.Marshal(struct {
		Kind   string `json:"kind"`
		GoalID string `json:"goalId"`
	}{"pero-goal", state.ID})
	for expected := state.Rounds; expected < state.Limit; expected++ {
		if err := agent.WhenIdle(ctx); err != nil {
			return harness.FinishAborted, err
		}
		if err := ctx.Err(); err != nil {
			return harness.FinishAborted, err
		}
		matches := func(current goalState) bool {
			return current.ID == state.ID && current.Rounds == expected && current.canRun()
		}
		control.reset()
		message := harness.Message{
			Role: harness.RoleUser, Source: source,
			Content: []harness.ContentBlock{{Type: harness.BlockText, Text: fmt.Sprintf(
				"Goal round %d/%d. The operator's objective is %q. Continue from the retained conversation and current workspace; verify actual progress. If the objective is complete, further work is blocked, or an operator decision is needed, report the evidence or blocker, then call pero_goal_stop to end automatic rounds.",
				expected+1, state.Limit, state.Objective)}},
		}
		receipt, queued, err := agent.TryFollowupOwnedContext(ctx, message, harness.FollowupAdmission{
			Producer: "pero-goal", Lifetime: ctx,
			Check: func(_ context.Context, _ harness.Message) (bool, error) {
				return matches(foldGoal(session.Events())), nil
			},
			Commit: func(commitCtx context.Context, admitted harness.Message, commit func(uint64, []harnesssession.AdmissionFact) error) (bool, error) {
				events := session.Events()
				if !matches(foldGoal(events)) {
					return false, nil
				}
				fact := harnesssession.AdmissionFact{Type: goalAdmitted, Value: goalRound{state.ID, expected + 1, admitted.ID}}
				if err := commit(uint64(len(events)), []harnesssession.AdmissionFact{fact}); err != nil {
					return false, err
				}
				return true, session.Flush(commitCtx)
			},
		}, owner)
		if err != nil {
			return "", err
		}
		if !queued {
			return harness.FinishStop, s.stopGoal(ctx, record, "busy", goalStopDriver)
		}
		outcome, err := receipt.Wait(ctx)
		if err != nil {
			// The exact work context is already cancelled. The owner retirement
			// above joins it before ACP releases this session's prompt slot.
			return harness.FinishAborted, err
		}
		if outcome.Err != nil {
			if ctx.Err() != nil {
				return harness.FinishAborted, ctx.Err()
			}
			stop := "error"
			if harness.ProviderFailureFromError(outcome.Err).Code == harness.RequestBudgetExhaustedCode {
				stop = "request-budget"
			}
			return outcome.Turn.Reason, errors.Join(outcome.Err, s.stopGoal(ctx, record, stop, goalStopDriver))
		}
		if s.scientificReviewer != nil {
			if err := s.scientificReviewer.AfterTurn(ctx, agent, outcome.Turn); err != nil {
				return outcome.Turn.Reason, errors.Join(err, s.stopGoal(ctx, record, "error", goalStopDriver))
			}
		}
		switch outcome.Turn.Reason {
		case harness.FinishStop:
			// Only a normally settled round can stop by model decision or
			// lead to another automatic round.
			if decision := control.settledDecision(session.Events()); decision != "" {
				return harness.FinishStop, s.stopGoal(ctx, record, string(decision), goalStopModel)
			}
		case harness.FinishRefusal:
			return harness.FinishRefusal, s.stopGoal(ctx, record, "refusal", goalStopDriver)
		case harness.FinishMaxTokens:
			return harness.FinishMaxTokens, s.stopGoal(ctx, record, "max-tokens", goalStopDriver)
		default:
			return outcome.Turn.Reason, s.stopGoal(ctx, record, "interrupted", goalStopDriver)
		}
	}
	return harness.FinishStop, s.stopGoal(ctx, record, "round-limit", goalStopDriver)
}

func (s *Server) stopGoal(ctx context.Context, record *activeSession, reason string, by goalStopSource) error {
	session := record.agent.Session()
	state := foldGoal(session.Events())
	if _, err := session.Append(goalStopped, goalStop{state.ID, reason, by}); err != nil {
		return err
	}
	if err := session.Flush(ctx); err != nil {
		return err
	}
	state.Stop, state.StopBy = reason, by
	return s.showGoalStatus(record, state)
}

func (s *Server) showGoalStatus(record *activeSession, state goalState) error {
	reason := state.Stop
	if reason == "" {
		reason = "awaiting explicit resume"
		if state.Rounds == state.Limit {
			reason = "round-limit"
		}
	}
	if state.StopBy == goalStopModel {
		reason += " by model"
	}
	text := fmt.Sprintf("Goal: %s\nRounds: %d/%d (%s)", state.Objective, state.Rounds, state.Limit, reason)
	return s.writer.write(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{
		"sessionId": record.agent.ID(), "update": map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]any{"type": "text", "text": text}},
	}})
}
