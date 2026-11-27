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
	goalEdited    = "pero/goal/edited"
	goalAdmitted  = "pero/goal/admitted"
	goalStopped   = "pero/goal/stopped"
	goalMaxRounds = 10
)

type goalDefinition struct {
	ID        string `json:"id"`
	Revision  int    `json:"revision,omitempty"`
	Objective string `json:"objective"`
	Limit     int    `json:"limit"`
}

type goalRef struct {
	GoalID   string `json:"goalId"`
	Revision int    `json:"revision,omitempty"`
}

func (r goalRef) normalized() goalRef {
	if r.Revision == 0 {
		r.Revision = 1 // journals written before revisions
	}
	return r
}

func (r goalRef) String() string { return fmt.Sprintf("%s@%d", r.GoalID, r.Revision) }

func (g goalDefinition) ref() goalRef {
	return (goalRef{g.ID, g.Revision}).normalized()
}

func (g goalDefinition) valid() bool {
	return g.ID != "" && g.Limit > 0 && g.Limit <= goalMaxRounds && g.Objective != "" && len(g.Objective) <= 4096
}

type goalRound struct {
	goalRef
	Number    int    `json:"number"`
	MessageID string `json:"messageId"`
}

type goalStop struct {
	goalRef
	Reason string         `json:"reason"`
	By     goalStopSource `json:"by,omitempty"`
	Detail string         `json:"detail,omitempty"`
}

type goalStopSource string

const (
	goalStopDriver   goalStopSource = "driver"
	goalStopOperator goalStopSource = "operator"
	goalStopModel    goalStopSource = "model"
)

type goalState struct {
	goalDefinition
	Rounds     int
	Stop       string
	StopBy     goalStopSource
	StopDetail string
}

// edit changes the definition in place without refunding rounds, reopening a
// completed goal or activating the driver. A raised cap can undo only exhaustion.
func (g *goalState) edit(next goalDefinition) bool {
	if g.ID == "" || next.ID != g.ID || next.Revision != g.ref().Revision+1 || !next.valid() ||
		next.Limit < g.Rounds || (next.Limit == g.Limit && next.Objective == g.Objective) {
		return false
	}
	g.goalDefinition = next
	if g.Stop == "round-limit" && g.Rounds < g.Limit {
		g.Stop, g.StopBy, g.StopDetail = "", "", ""
	}
	return true
}

// foldGoal is session intent and consumed rounds only. There is no persisted
// permission to start work; only the current explicit command owns that.
func foldGoal(events []harness.Event) goalState {
	var state goalState
	for i, event := range events {
		switch event.Type {
		case goalDefined:
			var goal goalDefinition
			if json.Unmarshal(event.Data, &goal) == nil && goal.valid() && goal.ref().Revision == 1 {
				state = goalState{goalDefinition: goal}
			}
		case goalEdited:
			var next goalDefinition
			if json.Unmarshal(event.Data, &next) == nil {
				state.edit(next)
			}
		case goalAdmitted:
			var round goalRound
			if state.ID == "" || json.Unmarshal(event.Data, &round) != nil || round.goalRef.normalized() != state.ref() ||
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
					state.Stop, state.StopBy, state.StopDetail = "", "", ""
					break
				}
			}
		case goalStopped:
			var stop goalStop
			if state.ID != "" && json.Unmarshal(event.Data, &stop) == nil && stop.goalRef.normalized() == state.ref() {
				state.Stop, state.StopBy, state.StopDetail = stop.Reason, stop.By, stop.Detail
			}
		}
	}
	return state
}

func (g goalState) canRun() bool {
	return g.ID != "" && g.Rounds < g.Limit && g.Stop != string(goalCompleted)
}

func (s *Server) goalAvailable(agent *harness.Agent) bool {
	return s.goal && !agent.IsExternal() && s.preparePrompt == nil && agent.Session().DurabilityAttached()
}

func (s *Server) runGoalCommand(ctx context.Context, record *activeSession, input string) (harness.FinishKind, error) {
	agent := record.agent
	session := agent.Session()
	if !s.goalAvailable(agent) {
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
		state = goalState{goalDefinition: goalDefinition{ID: string(id), Revision: 1, Objective: objective, Limit: limit}}
		if _, err := session.Append(goalDefined, state.goalDefinition); err != nil {
			return "", err
		}
		if err := session.Flush(ctx); err != nil {
			return "", err
		}
	case "edit":
		ref, replacement, _ := strings.Cut(strings.TrimSpace(args), " ")
		limitText, objective, _ := strings.Cut(strings.TrimSpace(replacement), " ")
		if state.ID == "" || ref != state.ref().String() {
			return "", invalidError("stale or missing Goal reference; use /goal status for the current reference")
		}
		next := state.goalDefinition
		next.Revision = state.ref().Revision + 1
		if limitText != "-" {
			limit, err := strconv.Atoi(limitText)
			if err != nil {
				return "", invalidError("usage: /goal edit <id@revision> <1-10 rounds or -> [objective]")
			}
			next.Limit = limit
		}
		if objective = strings.TrimSpace(objective); objective != "" {
			next.Objective = objective
		}
		if !state.edit(next) {
			return "", invalidError("Goal edit must change the objective or cap; cap must be 1-10 and not below consumed rounds, and the objective must fit in 4096 bytes")
		}
		if _, err := session.Append(goalEdited, next); err != nil {
			return "", err
		}
		if err := session.Flush(ctx); err != nil {
			return "", err
		}
		return harness.FinishStop, s.showGoalStatus(record, state)
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
			return harness.FinishStop, s.stopGoal(ctx, record, state.ref(), goalStop{Reason: string(goalCompleted), By: goalStopOperator})
		}
	default:
		return "", invalidError("usage: /goal start <rounds> <objective> | /goal edit <id@revision> <rounds or -> [objective] | /goal resume | /goal status | /goal complete")
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
		Kind string `json:"kind"`
		goalRef
	}{"pero-goal", state.ref()})
	for expected := state.Rounds; expected < state.Limit; expected++ {
		if err := agent.WhenIdle(ctx); err != nil {
			return harness.FinishAborted, err
		}
		// Join only this Agent's progressing delegation tree before reserving
		// another round. Owned admission below still checks root idleness and
		// the exact Goal revision and round; cancellation disarms this driver.
		if descendants := s.h.Subagents(); descendants != nil {
			if _, err := descendants.WaitForChildren(ctx, agent); err != nil {
				return harness.FinishAborted, err
			}
		}
		if err := ctx.Err(); err != nil {
			return harness.FinishAborted, err
		}
		matches := func(current goalState) bool {
			return current.ref() == state.ref() && current.Rounds == expected && current.canRun()
		}
		control.reset(expected + 1)
		message := harness.Message{
			Role: harness.RoleUser, Source: source,
			Content: []harness.ContentBlock{{Type: harness.BlockText, Text: fmt.Sprintf(
				"Goal round %d/%d. The operator's objective is %q. Continue from the retained conversation and current workspace; verify actual progress. Report the evidence or blocker. Use pero_goal_stop to end automatic rounds when the objective is complete, operator input is needed, or a blocker persists after the first two rounds. Include blocked_reason when reporting a blocker.",
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
				fact := harnesssession.AdmissionFact{Type: goalAdmitted, Value: goalRound{state.ref(), expected + 1, admitted.ID}}
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
			return harness.FinishStop, s.stopGoal(ctx, record, state.ref(), goalStop{Reason: "busy", By: goalStopDriver})
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
			return outcome.Turn.Reason, errors.Join(outcome.Err, s.stopGoal(ctx, record, state.ref(), goalStop{Reason: stop, By: goalStopDriver}))
		}
		if s.scientificReviewer != nil {
			if err := s.scientificReviewer.AfterTurn(ctx, agent, outcome.Turn); err != nil {
				return outcome.Turn.Reason, errors.Join(err, s.stopGoal(ctx, record, state.ref(), goalStop{Reason: "error", By: goalStopDriver}))
			}
		}
		switch outcome.Turn.Reason {
		case harness.FinishStop:
			// Only a normally settled round can stop by model decision or
			// lead to another automatic round.
			if decision := control.settledDecision(session.Events()); decision.Outcome != "" {
				return harness.FinishStop, s.stopGoal(ctx, record, state.ref(), goalStop{Reason: string(decision.Outcome), By: goalStopModel, Detail: decision.BlockedReason})
			}
		case harness.FinishRefusal:
			return harness.FinishRefusal, s.stopGoal(ctx, record, state.ref(), goalStop{Reason: "refusal", By: goalStopDriver})
		case harness.FinishMaxTokens:
			return harness.FinishMaxTokens, s.stopGoal(ctx, record, state.ref(), goalStop{Reason: "max-tokens", By: goalStopDriver})
		default:
			return outcome.Turn.Reason, s.stopGoal(ctx, record, state.ref(), goalStop{Reason: "interrupted", By: goalStopDriver})
		}
	}
	return harness.FinishStop, s.stopGoal(ctx, record, state.ref(), goalStop{Reason: "round-limit", By: goalStopDriver})
}

func (s *Server) stopGoal(ctx context.Context, record *activeSession, ref goalRef, stop goalStop) error {
	session := record.agent.Session()
	state := foldGoal(session.Events())
	if state.ref() != ref {
		return invalidError("Goal revision changed before settlement")
	}
	stop.goalRef = ref
	if _, err := session.Append(goalStopped, stop); err != nil {
		return err
	}
	if err := session.Flush(ctx); err != nil {
		return err
	}
	state.Stop, state.StopBy, state.StopDetail = stop.Reason, stop.By, stop.Detail
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
	text += "\nRef: " + state.ref().String()
	if state.StopDetail != "" {
		text += "\nBlocker: " + state.StopDetail
	}
	return s.writer.write(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{
		"sessionId": record.agent.ID(), "update": map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]any{"type": "text", "text": text}},
	}})
}
