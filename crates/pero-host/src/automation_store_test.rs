use super::*;
use pero_contracts::automation::{CandidateRef, EventInput};
use std::sync::atomic::{AtomicUsize, Ordering};
static IDS: AtomicUsize = AtomicUsize::new(0);
fn path() -> std::path::PathBuf {
    std::env::temp_dir().join(format!("pero-automation-sqlite-{}-{}.db",std::process::id(),IDS.fetch_add(1,Ordering::Relaxed)))
}
fn acceptance() -> Command {
    Command::Accept { event: EventInput { binding_id:"local".into(), producer_id:"delivery-1".into(),
        event_kind:"changed".into(), subject:"subject".into(), exact:None, digest:digest(b"event") } }
}
#[test]
fn durable_acceptance_duplicate_conflict_and_single_profile_owner() {
    let path=path();
    let mut store=Store::open(&path).unwrap();
    let owner=store.state().unwrap().owner;
    let accepted=store.apply(vec![acceptance()],10,None,None,None).unwrap();
    assert!(matches!(accepted.receipt,Receipt::Acceptance{duplicate:false,..}));
    assert!(Store::open(&path).is_err(),"second Host must not recover live work");
    drop(store);
    let mut store=Store::open(&path).unwrap();
    assert_eq!(store.state().unwrap().owner,owner);
    assert_eq!(store.state().unwrap().events.len(),1);
    let duplicate=store.apply(vec![acceptance()],20,None,None,None).unwrap();
    assert!(matches!(duplicate.receipt,Receipt::Acceptance{duplicate:true,..}));
    let mut conflict=acceptance();
    if let Command::Accept{event}=&mut conflict {event.digest=digest(b"different");}
    assert!(store.apply(vec![conflict],30,None,None,None).is_err());
    assert_eq!(store.state().unwrap().events.len(),1);
    drop(store);std::fs::remove_file(path).unwrap();
}
#[test]
fn failed_transaction_never_acknowledges_input_or_event() {
    let path=path();let mut store=Store::open(&path).unwrap();
    store.db.execute_batch("CREATE TRIGGER fail_write BEFORE UPDATE ON state BEGIN SELECT RAISE(ABORT,'disk fixture'); END;").unwrap();
    let hash=digest(b"frozen");
    assert!(store.apply(vec![acceptance()],10,Some((&hash,"frozen")),None,None).is_err());
    assert!(store.content(&hash).is_err());
    assert!(store.state().unwrap().events.is_empty());
    drop(store);let store=Store::open(&path).unwrap();assert!(store.state().unwrap().events.is_empty());
    drop(store);std::fs::remove_file(path).unwrap();
}
#[test]
fn frozen_snapshot_requires_matching_content_in_same_commit() {
    let path=path();let mut store=Store::open(&path).unwrap();let hash=digest(b"payload");
    let command=Command::PublishSnapshot{candidate:CandidateRef{binding_id:"local".into(),subject:"subject".into(),revision:"v1".into(),digest:hash.clone(),content_ref:hash.clone()},latest:true};
    assert!(store.apply(vec![command.clone()],1,None,None,None).is_err());
    assert!(store.apply(vec![command.clone()],1,Some((&hash,"changed")),None,None).is_err());
    store.apply(vec![command],1,Some((&hash,"payload")),None,None).unwrap();
    drop(store);let store=Store::open(&path).unwrap();assert_eq!(store.content(&hash).unwrap(),"payload");
    assert_eq!(store.state().unwrap().snapshots.len(),1);
    drop(store);std::fs::remove_file(path).unwrap();
}
#[test]
fn corruption_fails_closed_without_replacing_store() {
    let path=path();std::fs::write(&path,b"not sqlite").unwrap();
    assert!(Store::open(&path).is_err());assert_eq!(std::fs::read(&path).unwrap(),b"not sqlite");
    std::fs::remove_file(path).unwrap();
}

#[test]
fn valid_json_with_corrupt_schedule_fails_closed_on_reopen() {
    let path=path();let store=Store::open(&path).unwrap();
    let state=store.state().unwrap();
    let mut body=serde_json::to_value(&state).unwrap();
    body["definitions"]=serde_json::json!([{"id":"bad","revision":1,"owner":state.owner,
        "trigger":{"kind":"time","subject":"sample","exact":null,"anchor":0,"interval_seconds":0,"max_lateness_seconds":60},
        "input":"recheck_latest","input_binding_id":"local","method":{"kind":"agent","agent_id":"fixture","workspace":"/tmp","prompt":"read"},
        "target":{"kind":"local_host","owner":state.owner}}]);
    store.db.execute("UPDATE state SET body=?1",[body.to_string()]).unwrap();
    drop(store);assert!(Store::open(&path).is_err());std::fs::remove_file(path).unwrap();
}

#[test]
fn manual_input_identity_and_latest_publication_commit_atomically() {
    let path = path();
    let mut store = Store::open(&path).unwrap();
    let owner = store.state().unwrap().owner;
    store.apply(vec![Command::PutDefinition { definition: domain::Definition {
        id: "manual".into(), revision: 1, owner: owner.clone(), trigger: domain::Trigger::Manual,
        input: domain::InputContract::RecheckLatest, input_binding_id: "local".into(),
        method: domain::Method::Agent { agent_id: "fixture".into(), workspace: "/tmp".into(), prompt: "Inspect".into() },
        target: domain::Target::LocalHost { owner },
    } }], 1, None, None, None).unwrap();
    let command = |intent: &str, content: &str| {
        let hash = digest(content.as_bytes());
        Command::ManualInput { definition_id: "manual".into(), intent_id: intent.into(),
            candidate: CandidateRef { binding_id: "local".into(), subject: "s".into(),
                revision: format!("sha256-{hash}"), digest: hash.clone(), content_ref: hash } }
    };
    let hash_a = digest(b"A"); let hash_b = digest(b"B"); let hash_c = digest(b"C");
    let accepted = store.apply(vec![command("A", "A")], 2, Some((&hash_a, "A")), None, None).unwrap();
    let Receipt::Request { id, duplicate: false } = accepted.receipt else { panic!("manual receipt required") };
    store.apply(vec![command("B", "B")], 3, Some((&hash_b, "B")), None, None).unwrap();
    let before = store.state().unwrap();
    drop(store);
    let mut store = Store::open(&path).unwrap();
    let retry = store.apply(vec![command("A", "A")], 4, Some((&hash_a, "A")), None, None).unwrap();
    assert_eq!(retry.receipt, Receipt::Request { id, duplicate: true });
    assert_eq!(store.state().unwrap(), before);
    assert_eq!(before.latest[0].digest, hash_b);
    assert!(store.apply(vec![command("A", "C")], 5, Some((&hash_c, "C")), None, None).is_err());
    assert!(store.content(&hash_c).is_err(), "conflicting retry must roll back its input bytes too");
    assert_eq!(store.state().unwrap(), before);
    store.db.execute_batch("CREATE TRIGGER fail_write BEFORE UPDATE ON state BEGIN SELECT RAISE(ABORT,'disk fixture'); END;").unwrap();
    assert!(store.apply(vec![command("C", "C")], 6, Some((&hash_c, "C")), None, None).is_err());
    assert!(store.content(&hash_c).is_err());
    assert_eq!(store.state().unwrap(), before);
    drop(store); std::fs::remove_file(path).unwrap();
}
