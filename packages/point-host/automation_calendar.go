package main

import (
	"time"

	"github.com/phodal/point/go/managed/automation"
)

const automationCalendarPath = "/api/automation-calendar"

// The Rust Host supplies and persists all values. This operation only evaluates
// Point's calendar rules; it never opens its Store or Scheduler.
type calendarOperation string

const (
	calendarValidate calendarOperation = "validate"
	calendarDecide   calendarOperation = "decide"
	calendarNext     calendarOperation = "next"
	calendarSlot     calendarOperation = "slot"
)

type calendarRequest struct {
	Operation  calendarOperation     `json:"operation"`
	Definition automation.Automation `json:"definition"`
	State      automation.State      `json:"state"`
	Now        time.Time             `json:"now"`
}

// One transport projection; the original domain State and Run pass through.
type calendarDecision struct {
	Kind       automation.DecisionKind `json:"kind"`
	Run        *automation.Run         `json:"run,omitempty"`
	Superseded *automation.Run         `json:"superseded,omitempty"`
	State      automation.State        `json:"state"`
	Next       *time.Time              `json:"next,omitempty"`
}

type calendarResult struct {
	Rule     string            `json:"rule"`
	Next     *time.Time        `json:"next,omitempty"`
	Slot     automation.Slot   `json:"slot,omitempty"`
	Decision *calendarDecision `json:"decision,omitempty"`
}

type calendarError struct {
	Code  string `json:"code"`
	Error string `json:"error"`
}

func automationCalendar(r Request) Response {
	if r.Method != "POST" {
		return reply(405, calendarError{"automation-calendar/method", "use POST"})
	}
	var input calendarRequest
	if err := decode(r.Body, &input); err != nil {
		return reply(400, calendarError{"automation-calendar/invalid", err.Error()})
	}
	if input.Operation != calendarValidate && input.Operation != calendarDecide && input.Operation != calendarNext && input.Operation != calendarSlot {
		return reply(400, calendarError{"automation-calendar/invalid", "operation must be validate, decide, next or slot"})
	}
	if err := input.Definition.Validate(); err != nil {
		return reply(400, calendarError{"automation-calendar/invalid", err.Error()})
	}
	result := calendarResult{}
	var rule automation.Rule
	if input.Definition.Trigger.Rule != "" {
		// Definition.Validate already admitted the rule; ParseRule here obtains
		// its canonical string rather than repeating validation in a caller.
		rule, _ = automation.ParseRule(input.Definition.Trigger.Rule)
		result.Rule = rule.String()
	}
	if input.Operation == calendarValidate {
		return reply(200, result)
	}
	if input.Now.IsZero() {
		return reply(400, calendarError{"automation-calendar/invalid", "now must be an explicit RFC3339 instant"})
	}
	if input.Operation == calendarSlot {
		location, _ := input.Definition.Trigger.Location()
		result.Slot = automation.SlotAt(input.Now, location)
		return reply(200, result)
	}
	if input.Operation == calendarNext {
		if result.Rule == "" {
			return reply(400, calendarError{"automation-calendar/invalid", "next requires a recurrence rule"})
		}
		location, _ := input.Definition.Trigger.Location()
		next, ok := rule.Next(input.Now, location)
		if ok {
			result.Next = &next
		}
		return reply(200, result)
	}
	decision := automation.Decide(&input.Definition, input.State, input.Now)
	view := &calendarDecision{Kind: decision.Kind, Superseded: decision.Superseded, State: decision.State}
	if decision.Kind != automation.Wait {
		view.Run = &decision.Run
	}
	if !decision.Next.IsZero() {
		view.Next = &decision.Next
	}
	result.Decision = view
	return reply(200, result)
}
