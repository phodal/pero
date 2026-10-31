use super::*;

fn configured() -> State {
    let state = State::new("host".into(), Limits {
        max_events: 30, max_requests: 30, max_snapshots: 30, max_definitions: 20,
        max_fanout: 4, max_event_bytes: 4096, max_active: 2, max_dispatches: 20,
    }).unwrap();
    let state = apply(&state, Command::PutBinding { binding: SourceBinding {
        id: "local".into(), owner: "host".into(), authority: "project".into(),
        event_kinds: vec!["changed".into()],
    } }, 0, Ids::default()).unwrap().state;
    apply(&state, Command::PutDefinition { definition: Definition {
        id: "a".into(), revision: 1, owner: "host".into(),
        trigger: Trigger::Calendar { schedule: CalendarSchedule {
            rule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0".into(), timezone: "Asia/Shanghai".into(),
            first_slot: 100, max_lateness_seconds: 10,
        }, subject: "automation:a".into(), exact: None },
        input: InputContract::RecheckLatest, input_binding_id: "local".into(),
        method: Method::Agent { agent_id: "fixture".into(), workspace: "/trusted".into(), prompt: "Inspect".into() },
        target: Target::LocalHost { owner: "host".into() },
    } }, 0, Ids::default()).unwrap().state
}

fn tick(revision: u64, slot: u64, next_slot: Option<u64>) -> Command {
    Command::CalendarTime { definition_id: "a".into(), revision, slot, next_slot }
}

fn advance(state: &State, command: Command, now: u64, request_id: &str) -> Transition {
    let transition = apply(state, command, now, Ids {
        acceptance_id: String::new(), request_ids: vec![request_id.into()],
    }).unwrap();
    transition.state.validate_restored().unwrap();
    assert!(transition.effects.is_empty(), "calendar decisions cannot dispatch");
    transition
}

#[test]
fn calendar_cursor_and_time_intent_advance_atomically() {
    struct Case { name: &'static str, revision: u64, slot: u64, next: Option<u64>, now: u64,
        control: Option<Control>, error: Option<Error>, status: Option<RequestStatus>, cursor: Option<u64> }
    let cases = [
        Case { name: "due", revision: 1, slot: 100, next: Some(200), now: 100, control: None,
            error: None, status: Some(RequestStatus::Pending), cursor: Some(200) },
        Case { name: "lateness boundary", revision: 1, slot: 100, next: Some(200), now: 110, control: None,
            error: None, status: Some(RequestStatus::Pending), cursor: Some(200) },
        Case { name: "missed", revision: 1, slot: 100, next: Some(200), now: 111, control: None,
            error: None, status: Some(RequestStatus::Expired), cursor: Some(200) },
        Case { name: "finite schedule exhausted", revision: 1, slot: 100, next: None, now: 100, control: None,
            error: None, status: Some(RequestStatus::Pending), cursor: None },
        Case { name: "not due", revision: 1, slot: 100, next: Some(200), now: 99, control: None,
            error: Some(Error::Invalid), status: None, cursor: Some(100) },
        Case { name: "out of order", revision: 1, slot: 200, next: Some(300), now: 200, control: None,
            error: Some(Error::Invalid), status: None, cursor: Some(100) },
        Case { name: "next must progress", revision: 1, slot: 100, next: Some(100), now: 100, control: None,
            error: Some(Error::Invalid), status: None, cursor: Some(100) },
        Case { name: "obsolete revision", revision: 0, slot: 100, next: Some(200), now: 100, control: None,
            error: None, status: None, cursor: Some(100) },
        Case { name: "pause advances without execution", revision: 1, slot: 100, next: Some(200), now: 100,
            control: Some(Control { paused: true, revoked: false }), error: None, status: None, cursor: Some(200) },
        Case { name: "revocation advances without execution", revision: 1, slot: 100, next: Some(200), now: 100,
            control: Some(Control { paused: false, revoked: true }), error: None, status: None, cursor: Some(200) },
    ];
    for case in cases {
        let mut state = configured();
        if let Some(control) = case.control { state.controls.insert("a".into(), control); }
        let original = state.clone();
        let result = apply(&state, tick(case.revision, case.slot, case.next), case.now, Ids {
            acceptance_id: String::new(), request_ids: vec!["r1".into()],
        });
        assert_eq!(state, original, "{}: pure fold", case.name);
        if let Some(error) = case.error { assert_eq!(result, Err(error), "{}", case.name); continue; }
        let result = result.unwrap();
        result.state.validate_restored().unwrap();
        assert!(result.effects.is_empty(), "{}", case.name);
        assert_eq!(result.state.calendar_slots.get("a").copied(), case.cursor, "{}", case.name);
        assert_eq!(result.state.requests.first().map(|r| r.status.clone()), case.status, "{}", case.name);
        let duplicate = advance(&result.state, tick(case.revision, case.slot, case.next), case.now, "r2");
        assert_eq!(duplicate.state, result.state, "{}: duplicate decision", case.name);
    }
}

#[test]
fn calendar_pause_and_definition_revisions_do_not_replay_old_slots() {
    for exhausted in [false, true] {
        let state = configured();
        let paused = advance(&state, Command::Control { definition_id: "a".into(), paused: true, revoked: false }, 100, "unused").state;
        let paused = advance(&paused, tick(1, 100, if exhausted { None } else { Some(200) }), 100, "unused").state;
        let resumed = advance(&paused, Command::Control { definition_id: "a".into(), paused: false, revoked: false }, 101, "unused").state;
        let old = advance(&resumed, tick(1, 100, Some(200)), 101, "unused").state;
        assert_eq!(old, resumed);
        if !exhausted {
            let due = advance(&resumed, tick(1, 200, Some(300)), 200, "r1").state;
            assert_eq!(due.requests[0].intent, Intent::Time { slot: 200 });
        }
    }
    let state = advance(&configured(), tick(1, 100, Some(200)), 100, "r1").state;
    for calendar in [true, false] {
        let mut definition = state.definitions[0].clone();
        definition.revision = 2;
        definition.trigger = if calendar { Trigger::Calendar { schedule: CalendarSchedule {
            first_slot: 300, ..match &definition.trigger { Trigger::Calendar { schedule, .. } => schedule.clone(), _ => unreachable!() }
        }, subject: "automation:a".into(), exact: None } } else { Trigger::Manual };
        let updated = advance(&state, Command::PutDefinition { definition }, 101, "unused").state;
        assert_eq!(updated.calendar_slots.get("a").copied(), if calendar { Some(300) } else { None });
        assert_eq!(updated.requests[0].status, RequestStatus::DefinitionChanged);
        assert_eq!(advance(&updated, tick(1, 200, Some(300)), 200, "unused").state, updated);
    }
    let mut full = configured();
    full.limits.max_requests = 1;
    let full = advance(&full, tick(1, 100, Some(200)), 100, "r1").state;
    assert_eq!(apply(&full, tick(1, 200, Some(300)), 200, Ids {
        acceptance_id: String::new(), request_ids: vec!["r2".into()],
    }), Err(Error::Capacity));
    assert_eq!(full.calendar_slots.get("a"), Some(&200));
}

#[test]
fn calendar_recovery_validates_cursor_and_frozen_intent() {
    let state = advance(&configured(), tick(1, 100, Some(200)), 100, "r1").state;
    for name in ["foreign cursor", "cursor before anchor", "cursor replays accepted slot", "subject", "slot before anchor", "slot after acceptance", "event position", "metadata"] {
        let mut invalid = state.clone();
        match name {
            "foreign cursor" => { invalid.calendar_slots.insert("foreign".into(), 200); },
            "cursor before anchor" => { invalid.calendar_slots.insert("a".into(), 99); },
            "cursor replays accepted slot" => { invalid.calendar_slots.insert("a".into(), 100); },
            "subject" => invalid.requests[0].subject = "other".into(),
            "slot before anchor" => invalid.requests[0].intent = Intent::Time { slot: 99 },
            "slot after acceptance" => invalid.requests[0].intent = Intent::Time { slot: 101 },
            "event position" => invalid.requests[0].through_position = 1,
            "metadata" => { if let Trigger::Calendar { schedule, .. } = &mut invalid.definitions[0].trigger { schedule.rule = String::new(); } },
            _ => unreachable!(),
        }
        assert_eq!(invalid.validate_restored(), Err(Error::Invalid), "{name}");
    }
    // Older snapshots have no calendar cursor field; they remain readable.
    let mut legacy = configured();
    legacy.definitions.clear();
    legacy.calendar_slots.clear();
    let mut json = serde_json::to_value(&legacy).unwrap();
    json.as_object_mut().unwrap().remove("calendar_slots");
    let restored: State = serde_json::from_value(json).unwrap();
    restored.validate_restored().unwrap();
}

#[test]
fn calendar_and_event_run_now_keep_trigger_responsibility() {
    for kind in ["calendar", "event"] {
        for publish in [false, true] {
            for frozen in [false, true] {
                let mut state = configured();
                let exact = ExactRef { revision: "v1".into(), digest: "a".repeat(64) };
                if kind == "event" {
                    state.definitions[0].trigger = Trigger::Event { binding_id: "local".into(), event_kind: "changed".into() };
                    state.calendar_slots.clear();
                } else if frozen {
                    if let Trigger::Calendar { exact: fixed, .. } = &mut state.definitions[0].trigger { *fixed = Some(exact.clone()); }
                }
                state.validate_restored().unwrap();
                let command = if publish { Command::ManualInput { definition_id: "a".into(), intent_id: "run-now".into(),
                    candidate: CandidateRef { binding_id: "local".into(), subject: "automation:a".into(),
                        revision: "v1".into(), digest: "a".repeat(64), content_ref: "input:v1".into() } }
                } else { Command::Manual { definition_id: "a".into(), intent_id: "run-now".into(),
                    subject: "automation:a".into(), exact: if frozen { Some(exact) } else { None } } };
                let transition = advance(&state, command.clone(), 100, "r1");
                assert_eq!(transition.state.calendar_slots, state.calendar_slots);
                assert!(transition.state.events.is_empty());
                assert_eq!(transition.state.requests[0].intent, Intent::Manual { id: "run-now".into() });
                assert_eq!(advance(&transition.state, command, 101, "unused").state, transition.state);
                if kind == "calendar" {
                    let due = advance(&transition.state, tick(1, 100, Some(200)), 100, "timer");
                    assert_eq!(due.state.requests.len(), 2);
                    assert_eq!(due.state.requests[1].intent, Intent::Time { slot: 100 });
                    let mut wrong = transition.state.clone();
                    wrong.requests[0].subject = "other".into();
                    assert_eq!(wrong.validate_restored(), Err(Error::Invalid));
                    assert_eq!(apply(&state, Command::Manual { definition_id: "a".into(), intent_id: "bad".into(),
                        subject: "other".into(), exact: None }, 100, Ids::default()), Err(Error::Invalid));
                    if frozen {
                        assert_eq!(apply(&state, Command::Manual { definition_id: "a".into(), intent_id: "bad".into(),
                            subject: "automation:a".into(), exact: None }, 100, Ids::default()), Err(Error::Invalid));
                    }
                }
            }
        }
    }
}
