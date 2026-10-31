package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/phodal/point/go/managed/automation"
)

func TestAutomationCalendar(t *testing.T) {
	instant := func(value string) time.Time {
		t.Helper()
		parsed, err := time.Parse(time.RFC3339, value)
		if err != nil {
			t.Fatal(err)
		}
		return parsed
	}
	for _, tc := range []struct {
		name      string
		change    func(*calendarRequest)
		status    int
		kind      automation.DecisionKind
		skip      automation.SkipReason
		next      string
		slot      automation.Slot
		errorText string
	}{
		{name: "validates and normalizes RRULE without a clock", change: func(r *calendarRequest) {
			r.Operation = calendarValidate
			r.Definition.Trigger.Rule = "freq=daily;BYMINUTE=0;BYHOUR=9"
			r.Now = time.Time{}
		}, status: 200},
		{name: "unknown zone is rejected", change: func(r *calendarRequest) { r.Definition.Trigger.TimeZone = "Not/AZone" }, status: 400, errorText: "unknown timezone"},
		{name: "absolute start is refused", change: func(r *calendarRequest) { r.Definition.Trigger.Rule = "FREQ=DAILY;DTSTART=20261031" }, status: 400, errorText: "DTSTART"},
		{name: "minute recurrence preserves Point minimum", change: func(r *calendarRequest) { r.Definition.Trigger.Rule = "FREQ=HOURLY;BYMINUTE=0,1" }, status: 400, errorText: "minimum"},
		{name: "decision requires supplied now", change: func(r *calendarRequest) { r.Now = time.Time{} }, status: 400, errorText: "explicit"},
		{name: "before next slot waits", change: func(r *calendarRequest) { r.Now = instant("2026-10-31T00:30:00Z") }, status: 200, kind: automation.Wait, next: "2026-10-31T01:00:00Z"},
		{name: "due slot fires", status: 200, kind: automation.Fire, next: "2026-11-01T01:00:00Z"},
		{name: "first autumn hourly instant has a wall clock identity", change: func(r *calendarRequest) {
			r.Operation = calendarSlot
			r.Definition.Trigger = automation.Trigger{Rule: "FREQ=HOURLY;BYMINUTE=30", TimeZone: "America/New_York"}
			r.Now = instant("2026-11-01T05:30:00Z")
		}, status: 200, slot: "20261101T0130"},
		{name: "repeated autumn hourly instant shares its wall clock identity", change: func(r *calendarRequest) {
			r.Operation = calendarSlot
			r.Definition.Trigger = automation.Trigger{Rule: "FREQ=HOURLY;BYMINUTE=30", TimeZone: "America/New_York"}
			r.Now = instant("2026-11-01T06:30:00Z")
		}, status: 200, slot: "20261101T0130"},
		{name: "next is strictly after supplied instant without reading state", change: func(r *calendarRequest) {
			r.Operation = calendarNext
			r.State = automation.State{}
		}, status: 200, next: "2026-11-01T01:00:00Z"},
		{name: "next preserves spring gap calendar semantics", change: func(r *calendarRequest) {
			r.Operation = calendarNext
			r.Definition.Trigger = automation.Trigger{Rule: "FREQ=DAILY;BYHOUR=2;BYMINUTE=30", TimeZone: "America/New_York"}
			r.Now = instant("2026-03-08T06:00:00Z")
			r.State = automation.State{}
		}, status: 200, next: "2026-03-09T06:30:00Z"},
		{name: "settled slot is not fired twice", change: func(r *calendarRequest) { r.State.LastSlot = "20261031T0900"; r.State.LastSlotAt = r.Now }, status: 200, kind: automation.Wait, next: "2026-11-01T01:00:00Z"},
		{name: "late slot is visibly skipped", change: func(r *calendarRequest) { r.Now = instant("2026-10-31T03:00:00Z") }, status: 200, kind: automation.Skip, skip: automation.SkipMissed, next: "2026-11-01T01:00:00Z"},
		{name: "prior active work skips overlap", change: func(r *calendarRequest) { r.State.InFlight = "prior" }, status: 200, kind: automation.Skip, skip: automation.SkipOverlap, next: "2026-11-01T01:00:00Z"},
		{name: "buffer policy holds newest due slot", change: func(r *calendarRequest) {
			r.State.InFlight = "prior"
			r.Definition.Policy.Overlap = automation.OverlapBufferOne
		}, status: 200, kind: automation.Buffer, next: "2026-11-01T01:00:00Z"},
		{name: "paused definition waits without dispatch", change: func(r *calendarRequest) { r.Definition.Enabled = false }, status: 200, kind: automation.Wait, next: "2026-11-01T01:00:00Z"},
		{name: "new revision retains active responsibility", change: func(r *calendarRequest) { r.State.Revision = 0; r.State.InFlight = "prior" }, status: 200, kind: automation.Skip, skip: automation.SkipOverlap, next: "2026-11-01T01:00:00Z"},
		{name: "spring gap skips absent wall clock", change: func(r *calendarRequest) {
			r.Definition.Trigger = automation.Trigger{Rule: "FREQ=DAILY;BYHOUR=2;BYMINUTE=30", TimeZone: "America/New_York"}
			r.Now = instant("2026-03-08T06:00:00Z")
			r.State.LastSlot = "20260307T0230"
			r.State.LastSlotAt = instant("2026-03-07T07:30:00Z")
		}, status: 200, kind: automation.Wait, next: "2026-03-09T06:30:00Z"},
		{name: "fall repeated hourly slot is not replayed", change: func(r *calendarRequest) {
			r.Definition.Trigger = automation.Trigger{Rule: "FREQ=HOURLY;BYMINUTE=30", TimeZone: "America/New_York"}
			r.Now = instant("2026-11-01T06:30:00Z")
			r.State.LastSlot = "20261101T0130"
			r.State.LastSlotAt = instant("2026-11-01T05:30:00Z")
		}, status: 200, kind: automation.Skip, skip: automation.SkipDuplicateWallClock, next: "2026-11-01T07:30:00Z"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			input := calendarRequest{Operation: calendarDecide, Definition: automation.Automation{Version: automation.Version, ID: "daily", Name: "Daily", Revision: 1, Enabled: true, Trigger: automation.Trigger{Rule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0", TimeZone: "Asia/Shanghai"}, Action: automation.Action{Kind: automation.AgentAction, Prompt: "Inspect inputs"}, Target: automation.Target{Kind: automation.TargetLocal}, Policy: automation.Policy{Overlap: automation.OverlapSkip}}, State: automation.State{Automation: "daily", Revision: 1, LastSlot: "20261030T0900", LastSlotAt: instant("2026-10-30T01:00:00Z")}, Now: instant("2026-10-31T01:00:00Z")}
			if tc.change != nil {
				tc.change(&input)
			}
			body, err := json.Marshal(input)
			if err != nil {
				t.Fatal(err)
			}
			// Empty roots prove this route does not initialize a Project store.
			response, err := execute("", "", Request{Method: "POST", Path: automationCalendarPath, Body: body})
			if err != nil {
				t.Fatal(err)
			}
			if response.Status != tc.status {
				t.Fatalf("status=%d body=%+v", response.Status, response.Body)
			}
			if tc.status != 200 {
				if !strings.Contains(response.Body.(calendarError).Error, tc.errorText) {
					t.Fatalf("error=%+v", response.Body)
				}
				return
			}
			result := response.Body.(calendarResult)
			if input.Operation == calendarValidate {
				if result.Rule != "FREQ=DAILY;BYHOUR=9;BYMINUTE=0" || result.Decision != nil {
					t.Fatalf("validation=%+v", result)
				}
				return
			}
			if input.Operation == calendarNext {
				if result.Next == nil || !result.Next.Equal(instant(tc.next)) || result.Decision != nil {
					t.Fatalf("next=%+v", result)
				}
				return
			}
			if input.Operation == calendarSlot {
				if result.Slot != tc.slot || result.Decision != nil {
					t.Fatalf("slot=%+v", result)
				}
				return
			}
			decision := result.Decision
			if decision == nil || decision.Kind != tc.kind || decision.Next == nil || !decision.Next.Equal(instant(tc.next)) {
				t.Fatalf("decision=%+v", decision)
			}
			if tc.kind == automation.Wait {
				if decision.Run != nil {
					t.Fatal("wait returned a run")
				}
				return
			}
			if decision.Run == nil || decision.Run.SkipReason != tc.skip {
				t.Fatalf("run=%+v", decision.Run)
			}
			if decision.State.LastSlot != decision.Run.Key.Slot || decision.State.Revision != input.Definition.Revision {
				t.Fatalf("next state=%+v", decision.State)
			}
			if tc.kind == automation.Buffer && decision.State.Pending == nil {
				t.Fatal("buffer lost its pending run")
			}
		})
	}
}
