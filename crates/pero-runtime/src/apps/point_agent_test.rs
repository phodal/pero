use super::*;
fn event(kind:&str,text:&str,data:serde_json::Value)->HostEvent {
    let mut event=HostEvent::new(kind,None,text.into());event.thread_id=Some("run".into());event.data=data;event
}
#[test]
fn transcript_keeps_complete_messages_cursors_attempts_and_interruption() {
    let binding=Binding{scope:Scope{workspace_id:"ws_checked".into()},request_id:"start-1".into(),harness_id:"point".into(),panel:"viewer".into(),runtime_digest:"fixture".into(),created_at:"2026-10-31T00:00:00Z".into(),context:None};
    let history=vec![event("session_created","",serde_json::json!({})),event("session_update","",serde_json::json!({"sessionUpdate":"agent_message_chunk","content":{"text":"{\"title\":"}})),event("session_update","",serde_json::json!({"sessionUpdate":"agent_message_chunk","content":{"text":"\"Checked\"}"}})),event("turn_finished","end_turn",serde_json::json!({"stopReason":"end_turn","pointTime":"2026-10-31T00:00:01Z"}))];
    let view=Transcript::project("run",&binding,&history,true,0);
    assert_eq!(view.run.status,"completed");assert_eq!(view.run.updated_at,"2026-10-31T00:00:01Z");
    assert_eq!(view.events.iter().find(|event|event.kind=="assistant/message").unwrap().data["content"][0]["text"],"{\"title\":\"Checked\"}");
    let empty=Transcript::project("run",&binding,&history,true,view.cursor);assert!(empty.events.is_empty());
    let mut resumed=history.clone();resumed.push(event("app_agent_attempt","",serde_json::json!({"attempt":{"requestId":"retry-1","text":"Continue","attempt":2,"updatedAt":"2026-10-31T00:00:02Z"}})));
    let next=Transcript::project("run",&binding,&resumed,true,view.cursor);assert_eq!(next.run.attempt,2);assert_eq!(next.run.request_id,"retry-1");assert_eq!(next.run.status,"running");
    assert_eq!(Transcript::project("run",&binding,&resumed,false,0).run.status,"interrupted");
    let paged:Vec<_>=(0..100).map(|_|event("turn_started","",serde_json::json!({}))).collect();
    let first=Transcript::project("run",&binding,&paged,true,0);assert_eq!(first.events.len(),64);
    let second=Transcript::project("run",&binding,&paged,true,first.cursor);assert_eq!(second.events.len(),36);
    assert!(second.events[0].seq>first.cursor);
}
#[test]
fn scope_and_request_identity_are_bounded_and_app_specific() {
    for key in ["a", "request:1.part-2_3"] {request_key(key).unwrap();}
    for key in ["", ".bad", "path/request", "space here", &"a".repeat(129)] {assert!(request_key(key).is_err());}
    let a=AppName::try_from("science".to_owned()).unwrap();let b=AppName::try_from("paper".to_owned()).unwrap();let scope=Scope{workspace_id:"ws_source".into()};
    assert_ne!(internal_key(&a,&scope,"request"),internal_key(&b,&scope,"request"));
    assert!(serde_json::from_value::<Request>(serde_json::json!({"operation":"start","scope":{"workspaceId":"a","projectId":"b"},"requestId":"r","text":"x"})).is_err());
}
