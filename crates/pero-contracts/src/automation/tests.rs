use super::*;

fn initial() -> State {
    let state = State::new("host".into(), Limits { max_events: 30, max_requests: 30,
        max_snapshots: 30, max_definitions: 20, max_fanout: 4, max_event_bytes: 4096,
        max_active: 2, max_dispatches: 20 }).unwrap();
    step(&state, Command::PutBinding { binding: SourceBinding { id: "local".into(), owner: "host".into(),
        authority: "project".into(), event_kinds: vec!["changed".into()] } })
}
fn definition(id: &str, input: InputContract) -> Definition {
    Definition { id: id.into(), revision: 1, owner: "host".into(),
        trigger: Trigger::Event { binding_id: "local".into(), event_kind: "changed".into() },
        input, input_binding_id: "local".into(), method: Method::Agent {
            agent_id: "fixture".into(), workspace: "/trusted".into(), prompt: "Inspect frozen input".into() },
        target: Target::LocalHost { owner: "host".into() } }
}
fn configured(input: InputContract) -> State {
    step(&initial(), Command::PutDefinition { definition: definition("a", input) })
}
fn exact(revision: &str) -> ExactRef { ExactRef { revision: revision.into(), digest: "a".repeat(64) } }
fn candidate(subject: &str, revision: &str) -> CandidateRef {
    CandidateRef { binding_id: "local".into(), subject: subject.into(), revision: revision.into(),
        digest: "a".repeat(64), content_ref: format!("blob-{subject}-{revision}") }
}
fn event(id: &str, subject: &str, revision: Option<&str>) -> EventInput {
    EventInput { binding_id: "local".into(), producer_id: id.into(), event_kind: "changed".into(),
        subject: subject.into(), exact: revision.map(exact), digest: "b".repeat(64) }
}
fn ids(event: &str, requests: &[&str]) -> Ids {
    Ids { acceptance_id: event.into(), request_ids: requests.iter().map(|v| (*v).into()).collect() }
}
fn step(state: &State, command: Command) -> State {
    let next = apply(state, command, 100, Ids::default()).unwrap().state;
    next.validate_restored().unwrap();
    next
}
fn accept(state: &State, input: EventInput, requests: &[&str]) -> State {
    let id = input.producer_id.clone();
    let next = apply(state, Command::Accept { event: input }, 100, ids(&id, requests)).unwrap().state;
    next.validate_restored().unwrap();
    next
}
fn publish(state: &State, subject: &str, revision: &str) -> State {
    step(state, Command::PublishSnapshot { candidate: candidate(subject, revision), latest: true })
}
fn reserve(state: &State, request: &str) -> Transition {
    let transition = apply(state, Command::Reserve { request_id: request.into(), execution_id: format!("exec-{request}") }, 100, Ids::default()).unwrap();
    transition.state.validate_restored().unwrap();
    transition
}
fn observe(state: &State, request: &str, outcome: Outcome) -> State {
    step(state, Command::Observe { request_id: request.into(), execution_id: format!("exec-{request}"), outcome })
}

#[test]
fn acceptance_identity_and_all_consumer_responsibility_are_atomic() {
    let mut state = configured(InputContract::RecheckLatest);
    state = step(&state, Command::PutDefinition { definition: definition("b", InputContract::RecheckLatest) });
    let input = event("event", "pr-1", None);
    let original = state.clone();
    state.limits.max_requests = 1;
    assert_eq!(apply(&state, Command::Accept { event: input.clone() }, 100, ids("e", &["r1", "r2"])), Err(Error::Capacity));
    assert!(state.events.is_empty());
    state = accept(&original, input.clone(), &["r1", "r2"]);
    assert_eq!(state.decisions.len(), 2);
    assert_eq!(state.requests.len(), 2);
    let duplicate = apply(&state, Command::Accept { event: input.clone() }, 999, Ids::default()).unwrap();
    assert_eq!(duplicate.state, state);
    assert_eq!(duplicate.receipt, Receipt::Acceptance { id: "event".into(), duplicate: true, matched: 2 });
    for changed in [EventInput { subject: "other".into(), ..input.clone() },
        EventInput { digest: "c".repeat(64), ..input.clone() }] {
        assert_eq!(apply(&state, Command::Accept { event: changed }, 100, Ids::default()), Err(Error::Conflict));
    }
    let unmatched = accept(&initial(), input, &[]);
    assert_eq!(unmatched.events.len(), 1);
    assert!(unmatched.requests.is_empty());
}

#[test]
fn latest_is_subject_scoped_and_running_snapshots_do_not_absorb_later_wakeups() {
    let mut state = configured(InputContract::RecheckLatest);
    state = publish(&state, "pr-1", "v1");
    state = publish(&state, "pr-2", "v1");
    state = accept(&state, event("e1", "pr-1", None), &["r1"]);
    state = accept(&state, event("e2", "pr-2", None), &["r2"]);
    state = accept(&state, event("e3", "pr-1", None), &[]);
    assert_eq!(state.requests.len(), 2);
    assert_eq!(state.requests[0].through_position, 3);
    let dispatch = reserve(&state, "r1");
    assert_eq!(dispatch.effects.len(), 1);
    state = accept(&dispatch.state, event("e4", "pr-1", None), &["r3"]);
    assert_eq!(state.requests[0].through_position, 3);
    assert_eq!(state.requests[2].through_position, 4);
    assert_eq!(state.requests[0].snapshot, Some(candidate("pr-1", "v1")));
    assert_eq!(apply(&state, Command::Reserve { request_id: "r3".into(), execution_id: "x".into() }, 100, Ids::default()), Err(Error::Busy));
    state = publish(&state, "pr-1", "v2");
    state = observe(&state, "r1", Outcome::Completed);
    let second = reserve(&state, "r3");
    assert_eq!(second.state.requests[2].snapshot, Some(candidate("pr-1", "v2")));
    assert_eq!(second.effects.len(), 1);
    assert_eq!(second.state.decisions.len(), 4);
}

#[test]
fn exact_versions_are_independent_of_latest_and_missing_input_stays_visible() {
    let mut state = configured(InputContract::ProcessExact);
    state = publish(&state, "meeting", "v2");
    state = accept(&state, event("e1", "meeting", Some("v1")), &["r1"]);
    let unresolved = reserve(&state, "r1");
    assert_eq!(unresolved.state.requests[0].status, RequestStatus::InputUnavailable);
    assert!(unresolved.effects.is_empty());
    state = step(&unresolved.state, Command::PublishSnapshot { candidate: candidate("meeting", "v1"), latest: false });
    assert_eq!(state.latest, vec![candidate("meeting", "v2")]);
    let dispatch = reserve(&state, "r1");
    assert_eq!(dispatch.state.requests[0].snapshot, Some(candidate("meeting", "v1")));
    let changed = CandidateRef { digest: "d".repeat(64), ..candidate("meeting", "v1") };
    assert_eq!(apply(&state, Command::PublishSnapshot { candidate: changed, latest: true }, 100, Ids::default()), Err(Error::Conflict));
}

#[test]
fn candidate_coverage_is_verified_and_scoped_to_consumer() {
    let mut state = configured(InputContract::ProcessExact);
    state = publish(&state, "s", "v1");
    state = accept(&state, event("e1", "s", Some("v1")), &["r1"]);
    state = reserve(&state, "r1").state;
    state = observe(&state, "r1", Outcome::Completed);
    state = accept(&state, event("e2", "s", Some("v1")), &["r2"]);
    let covered = reserve(&state, "r2");
    assert!(covered.effects.is_empty());
    assert_eq!(covered.state.requests[1].status, RequestStatus::Covered { request_id: "r1".into() });
    state = step(&covered.state, Command::PutDefinition { definition: definition("b", InputContract::ProcessExact) });
    state = accept(&state, event("e3", "s", Some("v1")), &["r3", "r4"]);
    assert_eq!(reserve(&state, "r4").effects.len(), 1);
}

#[test]
fn restart_never_replays_reserved_or_unknown_effects_even_after_definition_edit() {
    let mut state = configured(InputContract::ProcessExact);
    state = publish(&state, "s", "v1");
    state = accept(&state, event("e1", "s", Some("v1")), &["r1"]);
    state = reserve(&state, "r1").state;
    let recovered = apply(&state, Command::Recover, 100, Ids::default()).unwrap();
    assert!(recovered.effects.is_empty());
    assert_eq!(recovered.state.requests[0].status, RequestStatus::Reconcile);
    assert_eq!(apply(&recovered.state, Command::Reserve { request_id: "r1".into(), execution_id: "new".into() }, 100, Ids::default()), Err(Error::InvalidTransition));
    let mut edited = definition("a", InputContract::ProcessExact);
    edited.revision = 2;
    edited.method = Method::Agent { agent_id: "other".into(), workspace: "/trusted".into(), prompt: "Different method".into() };
    state = step(&recovered.state, Command::PutDefinition { definition: edited });
    state = accept(&state, event("e2", "s", Some("v1")), &["r2"]);
    assert_eq!(apply(&state, Command::Reserve { request_id: "r2".into(), execution_id: "new".into() }, 100, Ids::default()), Err(Error::Busy));
    assert!(apply(&state, Command::Pump { execution_id: "new".into(), skip_request_ids: vec![] }, 100, Ids::default()).unwrap().effects.is_empty());
    assert_eq!(apply(&state, Command::Observe { request_id: "r1".into(), execution_id: "wrong".into(), outcome: Outcome::Completed }, 100, Ids::default()), Err(Error::Conflict));
}

#[test]
fn revisions_hold_pending_work_until_explicit_continuation() {
    let mut state = configured(InputContract::ProcessExact);
    state = publish(&state, "s", "v1");
    state = accept(&state, event("e1", "s", Some("v1")), &["r1"]);
    let mut edited = definition("a", InputContract::ProcessExact);
    edited.revision = 2;
    state = step(&state, Command::PutDefinition { definition: edited });
    assert_eq!(state.requests[0].definition.revision, 1);
    assert_eq!(state.requests[0].status, RequestStatus::DefinitionChanged);
    assert_eq!(apply(&state, Command::Reserve { request_id: "r1".into(), execution_id: "x".into() }, 100, Ids::default()), Err(Error::DefinitionChanged));
    state = step(&state, Command::ContinueOld { request_id: "r1".into() });
    assert_eq!(reserve(&state, "r1").effects.len(), 1);
}

#[test]
fn pause_and_revocation_block_admission_and_cancel_is_not_completion() {
    let mut state = configured(InputContract::RecheckLatest);
    state = publish(&state, "s", "v1");
    state = accept(&state, event("e1", "s", None), &["r1"]);
    state = step(&state, Command::Control { definition_id: "a".into(), paused: true, revoked: false });
    assert_eq!(apply(&state, Command::Reserve { request_id: "r1".into(), execution_id: "x".into() }, 100, Ids::default()), Err(Error::Paused));
    state = step(&state, Command::Control { definition_id: "a".into(), paused: false, revoked: false });
    state = reserve(&state, "r1").state;
    state = accept(&state, event("e2", "s", None), &["r2"]);
    let revoked = apply(&state, Command::RevokeBinding { binding_id: "local".into() }, 100, Ids::default()).unwrap();
    assert_eq!(revoked.effects, vec![Effect::Cancel { request_id: "r1".into(), execution_id: "exec-r1".into() }]);
    assert_eq!(revoked.state.requests[0].status, RequestStatus::CancelRequested);
    assert_eq!(revoked.state.requests[1].status, RequestStatus::Cancelled);
    state = observe(&revoked.state, "r1", Outcome::Running);
    assert_eq!(state.requests[0].status, RequestStatus::CancelRequested);
    state = observe(&state, "r1", Outcome::Cancelled);
    assert_eq!(state.requests[0].status, RequestStatus::Cancelled);
}

#[test]
fn manual_retry_keeps_first_revision_and_time_slots_have_bounded_explicit_catchup() {
    let mut manual = definition("manual", InputContract::RecheckLatest);
    manual.trigger = Trigger::Manual;
    let mut state = step(&initial(), Command::PutDefinition { definition: manual.clone() });
    let command = Command::Manual { definition_id: "manual".into(), intent_id: "intent".into(), subject: "s".into(), exact: None };
    state = apply(&state, command.clone(), 100, ids("", &["r1"])).unwrap().state;
    manual.revision = 2;
    state = step(&state, Command::PutDefinition { definition: manual });
    let duplicate = apply(&state, command, 100, Ids::default()).unwrap();
    assert_eq!(duplicate.receipt, Receipt::Request { id: "r1".into(), duplicate: true });
    assert_eq!(duplicate.state.requests.len(), 1);
    let mut timed = definition("timer", InputContract::RecheckLatest);
    timed.trigger = Trigger::Time { subject: "s".into(), exact: None, anchor: 0, interval_seconds: 10, max_lateness_seconds: 20 };
    state = step(&state, Command::PutDefinition { definition: timed });
    let due = due_slots(&state, 105);
    assert_eq!(due, vec![Command::Time { definition_id: "timer".into(), revision: 1, slot: 90, subject: "s".into(), exact: None },
        Command::Time { definition_id: "timer".into(), revision: 1, slot: 100, subject: "s".into(), exact: None }]);
    state = apply(&state, due[0].clone(), 105, ids("", &["t1"])).unwrap().state;
    assert_eq!(due_slots(&state, 105).len(), 1);
    let expired = apply(&state, Command::Time { definition_id: "timer".into(), revision: 1, slot: 20, subject: "s".into(), exact: None }, 105, ids("", &["old"])).unwrap();
    assert_eq!(expired.state.requests.last().unwrap().status, RequestStatus::Expired);
}

#[test]
fn target_authority_budget_and_invalid_inputs_fail_closed() {
    for target in [Target::Shared, Target::Worker, Target::LocalHost { owner: "elsewhere".into() }] {
        let mut definition = definition("a", InputContract::RecheckLatest);
        let expected = if matches!(target, Target::LocalHost { .. }) { Error::Unauthorized } else { Error::UnsupportedTarget };
        definition.target = target;
        assert_eq!(apply(&initial(), Command::PutDefinition { definition }, 0, Ids::default()), Err(expected));
    }
    let mut state = configured(InputContract::RecheckLatest);
    state = publish(&state, "s", "v1");
    state = accept(&state, event("e", "s", None), &["r"]);
    state.dispatch_count = state.limits.max_dispatches;
    assert_eq!(apply(&state, Command::Reserve { request_id: "r".into(), execution_id: "x".into() }, 100, Ids::default()), Err(Error::Budget));
    let mut invalid = event("bad", "s", None);
    invalid.digest = "not-a-digest".into();
    assert_eq!(apply(&state, Command::Accept { event: invalid }, 100, ids("bad", &["new"])), Err(Error::Invalid));
    let encoded = serde_json::to_string(&state).unwrap();
    assert_eq!(serde_json::from_str::<State>(&encoded).unwrap(), state);
    assert!(serde_json::from_value::<Command>(serde_json::json!({"action":"accept", "event": {
        "binding_id":"local", "producer_id":"evil", "event_kind":"changed", "subject":"s", "exact":null,
        "digest":"a".repeat(64), "workspace":"/escape" }})).is_err());
}

#[test]
fn cancellation_intent_survives_unknown_observations_and_restart() {
    let mut state = configured(InputContract::RecheckLatest);
    state = publish(&state, "s", "v1");
    state = accept(&state, event("e", "s", None), &["r"]);
    state = reserve(&state, "r").state;
    state = step(&state, Command::Cancel { request_id: "r".into() });
    state = observe(&state, "r", Outcome::Unknown);
    let recovery = apply(&state, Command::Recover, 100, Ids::default()).unwrap();
    assert!(recovery.state.requests[0].cancel_requested);
    assert_eq!(recovery.effects, vec![Effect::Cancel { request_id: "r".into(), execution_id: "exec-r".into() }]);
    state = observe(&recovery.state, "r", Outcome::Running);
    assert_eq!(state.requests[0].status, RequestStatus::CancelRequested);
}

#[test]
fn scheduler_never_rematches_old_slots_into_a_new_revision() {
    let mut timed = definition("timer", InputContract::ProcessExact);
    timed.trigger = Trigger::Time { subject: "s".into(), exact: Some(exact("v1")), anchor: 0, interval_seconds: 10, max_lateness_seconds: 20 };
    let mut state = step(&initial(), Command::PutDefinition { definition: timed.clone() });
    let due = due_slots(&state, 100);
    timed.revision = 2;
    state = step(&state, Command::PutDefinition { definition: timed });
    state = apply(&state, due[0].clone(), 100, ids("", &["old"])).unwrap().state;
    assert_eq!(state.requests[0].definition.revision, 1);
    assert_eq!(state.requests[0].status, RequestStatus::DefinitionChanged);
    let duplicate = apply(&state, due[0].clone(), 100, Ids::default()).unwrap();
    assert_eq!(duplicate.receipt, Receipt::Request { id: "old".into(), duplicate: true });
}

#[test]
fn invalid_numeric_bounds_and_declared_capacity_are_explicit() {
    for field in ["revision", "anchor", "interval", "lateness"] {
        let mut timed = definition("timer", InputContract::RecheckLatest);
        if field == "revision" { timed.revision = MAX_SAFE_INTEGER + 1; }
        timed.trigger = Trigger::Time { subject: "s".into(), exact: None,
            anchor: if field == "anchor" { MAX_SAFE_INTEGER + 1 } else { 0 },
            interval_seconds: if field == "interval" { MAX_SAFE_INTEGER + 1 } else { 10 },
            max_lateness_seconds: if field == "lateness" { MAX_SAFE_INTEGER + 1 } else { 20 } };
        assert_eq!(apply(&initial(), Command::PutDefinition { definition: timed }, 100, Ids::default()), Err(Error::Invalid));
    }
    let mut state = configured(InputContract::ProcessExact);
    state.limits.max_events = 1;
    state = accept(&state, event("e1", "s", Some("v1")), &["r1"]);
    assert_eq!(apply(&state, Command::Accept { event: event("e2", "s", Some("v2")) }, 100, ids("e2", &["r2"])), Err(Error::Capacity));
    assert_eq!(state.requests[0].exact, Some(exact("v1")));
    // Identity lookup precedes quota rejection: lost ACKs remain queryable at capacity.
    assert!(matches!(apply(&state, Command::Accept { event: event("e1", "s", Some("v1")) }, 100, Ids::default()).unwrap().receipt,
        Receipt::Acceptance { duplicate: true, .. }));
    assert_eq!(apply(&state, Command::Recover, MAX_SAFE_INTEGER + 1, Ids::default()), Err(Error::Invalid));
}

#[test]
fn pump_can_skip_a_host_admission_failure_without_dropping_its_obligation() {
    let mut state = configured(InputContract::ProcessExact);
    state = publish(&state, "first", "v1");
    state = publish(&state, "second", "v1");
    state = accept(&state, event("e1", "first", Some("v1")), &["r1"]);
    state = accept(&state, event("e2", "second", Some("v1")), &["r2"]);
    let transition = apply(&state, Command::Pump { execution_id: "exec-r2".into(), skip_request_ids: vec!["r1".into()] }, 100, Ids::default()).unwrap();
    assert_eq!(transition.state.requests[0].status, RequestStatus::Pending);
    assert_eq!(transition.state.requests[1].status, RequestStatus::Reserved);
    assert!(matches!(&transition.effects[0], Effect::Dispatch { request_id, .. } if request_id == "r2"));
}

#[test]
fn restoring_valid_json_rechecks_domain_integrity_before_scheduling() {
    let mut state = configured(InputContract::ProcessExact);
    state = publish(&state, "s", "v1");
    state = accept(&state, event("e", "s", Some("v1")), &["r"]);
    state = reserve(&state, "r").state;
    assert!(state.validate_restored().is_ok());
    for defect in ["interval", "owner", "missing_snapshot", "forged_latest", "position", "dispatch_count", "duplicate", "decision"] {
        let mut corrupted = state.clone();
        match defect {
            "interval" => corrupted.definitions[0].trigger = Trigger::Time { subject: "s".into(), exact: None, anchor: 0, interval_seconds: 0, max_lateness_seconds: 10 },
            "owner" => corrupted.bindings[0].owner = "other".into(),
            "missing_snapshot" => corrupted.snapshots.clear(),
            "forged_latest" => corrupted.latest[0].content_ref = "missing-blob".into(),
            "position" => corrupted.events[0].position = 999,
            "dispatch_count" => corrupted.dispatch_count = 0,
            "duplicate" => corrupted.requests.push(corrupted.requests[0].clone()),
            "decision" => corrupted.decisions.clear(),
            _ => unreachable!(),
        }
        let parsed: State = serde_json::from_str(&serde_json::to_string(&corrupted).unwrap()).unwrap();
        assert!(parsed.validate_restored().is_err(), "{defect}");
    }
}

#[test]
fn full_schedule_capacity_does_not_poison_already_accepted_work() {
    let mut state = configured(InputContract::RecheckLatest);
    state.limits.max_requests = 1;
    state = publish(&state, "s", "v1");
    state = accept(&state, event("e", "s", None), &["r"]);
    let mut timed = definition("timer", InputContract::RecheckLatest);
    timed.trigger = Trigger::Time { subject: "s".into(), exact: None, anchor: 0, interval_seconds: 10, max_lateness_seconds: 20 };
    state = step(&state, Command::PutDefinition { definition: timed });
    assert!(due_slots(&state, 100).is_empty());
    let transition = apply(&state, Command::Pump { execution_id: "exec-r".into(), skip_request_ids: vec![] }, 100, Ids::default()).unwrap();
    assert_eq!(transition.effects.len(), 1);
    assert_eq!(transition.state.requests.len(), 1);
}

fn manual_state() -> State {
    let mut manual = definition("a", InputContract::RecheckLatest);
    manual.trigger = Trigger::Manual;
    publish(&step(&initial(), Command::PutDefinition { definition: manual }), "s", "v1")
}
fn manual_request(state: &State, intent_id: &str, request_id: &str) -> Transition {
    apply(state, Command::Manual { definition_id: "a".into(), intent_id: intent_id.into(), subject: "s".into(), exact: None },
        100, ids("", &[request_id])).unwrap()
}

#[test]
fn retrying_the_same_manual_intent_does_not_dispatch_twice() {
    let mut state = manual_request(&manual_state(), "intent-1", "r1").state;
    state = reserve(&state, "r1").state;
    state = observe(&state, "r1", Outcome::Completed);
    let retry = manual_request(&state, "intent-1", "unused");
    assert_eq!(retry.receipt, Receipt::Request { id: "r1".into(), duplicate: true });
    assert_eq!(retry.state, state);
    assert_eq!(retry.state.dispatch_count, 1);
    assert!(retry.effects.is_empty());
}

#[test]
fn new_manual_intent_reprocesses_known_candidate_with_an_explicit_link() {
    for outcome in [Outcome::Completed, Outcome::Failed, Outcome::Cancelled] {
    let mut state = manual_request(&manual_state(), "intent-1", "r1").state;
    state = reserve(&state, "r1").state;
    state = observe(&state, "r1", outcome);
    state = manual_request(&state, "intent-2", "r2").state;
    let second = reserve(&state, "r2");
    assert_eq!(second.effects.len(), 1);
    assert_eq!(second.state.dispatch_count, 2);
    assert_eq!(second.state.requests[1].snapshot, second.state.requests[0].snapshot);
    assert_eq!(second.state.requests[1].reprocess_of.as_deref(), Some("r1"));
    let mut corrupt = second.state.clone();
    corrupt.requests[1].reprocess_of = Some("r2".into());
    assert!(corrupt.validate_restored().is_err());
    // Existing persisted rows did not have this optional relationship.
    let mut legacy = serde_json::to_value(&state).unwrap();
    for request in legacy["requests"].as_array_mut().unwrap() { request.as_object_mut().unwrap().remove("reprocess_of"); }
    let restored: State = serde_json::from_value(legacy).unwrap();
    assert!(restored.validate_restored().is_ok());
    }
    // Admission can skip an earlier obligation; lineage follows execution, not queue order.
    let mut state = manual_request(&manual_state(), "early", "r1").state;
    state = manual_request(&state, "later", "r2").state;
    state = reserve(&state, "r2").state;
    state = observe(&state, "r2", Outcome::Completed);
    let earlier = reserve(&state, "r1");
    assert_eq!(earlier.state.requests[0].reprocess_of.as_deref(), Some("r2"));
}

#[test]
fn new_time_slot_runs_again_but_retrying_that_slot_is_a_duplicate() {
    let mut timed = definition("a", InputContract::RecheckLatest);
    timed.trigger = Trigger::Time { subject: "s".into(), exact: None, anchor: 0, interval_seconds: 10, max_lateness_seconds: 30 };
    let mut state = publish(&step(&initial(), Command::PutDefinition { definition: timed }), "s", "v1");
    for (slot, request_id) in [(90, "r1"), (100, "r2")] {
        let command = Command::Time { definition_id: "a".into(), revision: 1, slot, subject: "s".into(), exact: None };
        state = apply(&state, command.clone(), 100, ids("", &[request_id])).unwrap().state;
        let dispatch = reserve(&state, request_id);
        assert_eq!(dispatch.effects.len(), 1);
        state = observe(&dispatch.state, request_id, Outcome::Completed);
        assert!(matches!(apply(&state, command, 100, Ids::default()).unwrap().receipt, Receipt::Request { duplicate: true, .. }));
    }
    assert_eq!(state.dispatch_count, 2);
    assert_eq!(state.requests[1].reprocess_of.as_deref(), Some("r1"));
}

#[test]
fn distinct_event_delivery_still_uses_completed_candidate_coverage() {
    for contract in [InputContract::ProcessExact, InputContract::RecheckLatest] {
        let mut state = publish(&configured(contract), "s", "v1");
        state = accept(&state, event("e1", "s", Some("v1")), &["r1"]);
        state = reserve(&state, "r1").state;
        state = observe(&state, "r1", Outcome::Completed);
        state = accept(&state, event("e2", "s", Some("v1")), &["r2"]);
        let covered = reserve(&state, "r2");
        assert!(covered.effects.is_empty());
        assert_eq!(covered.state.dispatch_count, 1);
        assert_eq!(covered.state.requests[1].status, RequestStatus::Covered { request_id: "r1".into() });
        assert_eq!(covered.state.requests[1].reprocess_of, None);
    }
}

#[test]
fn an_older_terminal_request_never_hides_later_active_or_unknown_work() {
    for outcome in [Outcome::Running, Outcome::Unknown] {
        for intent in ["event", "manual", "time"] {
            let mut state = manual_request(&manual_state(), "intent-1", "r1").state;
            state = reserve(&state, "r1").state;
            state = observe(&state, "r1", Outcome::Completed);
            state = manual_request(&state, "intent-2", "r2").state;
            state = reserve(&state, "r2").state;
            state = observe(&state, "r2", outcome.clone());
            let mut edited = definition("a", InputContract::RecheckLatest);
            edited.revision = 2;
            edited.method = Method::Agent { agent_id: "different-agent".into(), workspace: "/trusted".into(), prompt: "Explicit new method".into() };
            edited.trigger = match intent {
                "event" => Trigger::Event { binding_id: "local".into(), event_kind: "changed".into() },
                "manual" => Trigger::Manual,
                _ => Trigger::Time { subject: "s".into(), exact: None, anchor: 0, interval_seconds: 10, max_lateness_seconds: 30 },
            };
            state = step(&state, Command::PutDefinition { definition: edited });
            state = match intent {
                "event" => accept(&state, event("e3", "s", None), &["r3"]),
                "manual" => manual_request(&state, "intent-3", "r3").state,
                _ => apply(&state, Command::Time { definition_id: "a".into(), revision: 2, slot: 100, subject: "s".into(), exact: None }, 100, ids("", &["r3"])).unwrap().state,
            };
            assert_eq!(apply(&state, Command::Reserve { request_id: "r3".into(), execution_id: "exec-r3".into() }, 100, Ids::default()), Err(Error::Busy), "{intent}: {outcome:?}");
            assert_eq!(state.dispatch_count, 2);
        }
    }
}

#[test]
fn manual_input_retry_cannot_rewind_latest_or_publish_conflicting_input() {
    let state = manual_state();
    let command = |intent: &str, revision: &str| Command::ManualInput {
        definition_id: "a".into(), intent_id: intent.into(), candidate: candidate("s", revision),
    };
    let a = apply(&state, command("A", "A"), 100, ids("", &["a"])).unwrap();
    assert_eq!(a.receipt, Receipt::Request { id: "a".into(), duplicate: false });
    let b = apply(&a.state, command("B", "B"), 100, ids("", &["b"])).unwrap();
    let retry = apply(&b.state, command("A", "A"), 100, Ids::default()).unwrap();
    assert_eq!(retry.receipt, Receipt::Request { id: "a".into(), duplicate: true });
    assert_eq!(retry.state, b.state);
    assert_eq!(retry.state.latest, vec![candidate("s", "B")]);
    assert_eq!(apply(&b.state, command("A", "C"), 100, ids("", &["c"])), Err(Error::Conflict));
    let wrong_subject = Command::ManualInput { definition_id: "a".into(), intent_id: "A".into(), candidate: candidate("other", "A") };
    assert_eq!(apply(&b.state, wrong_subject, 100, ids("", &["c"])), Err(Error::Conflict));
    let invalid_publication = Command::ManualInput { definition_id: "a".into(), intent_id: "C".into(), candidate: CandidateRef { content_ref: "".into(), ..candidate("s", "C") } };
    assert_eq!(apply(&b.state, invalid_publication, 100, ids("", &["c"])), Err(Error::Invalid));
    let conflicting_ref = Command::ManualInput { definition_id: "a".into(), intent_id: "A".into(),
        candidate: CandidateRef { content_ref: "different-reference".into(), ..candidate("s", "A") } };
    assert_eq!(apply(&b.state, conflicting_ref, 100, Ids::default()), Err(Error::Conflict));
    let wrong_binding = Command::ManualInput { definition_id: "a".into(), intent_id: "A".into(),
        candidate: CandidateRef { binding_id: "another-source".into(), ..candidate("s", "A") } };
    assert_eq!(apply(&b.state, wrong_binding, 100, Ids::default()), Err(Error::Unauthorized));
    b.state.validate_restored().unwrap();
}
