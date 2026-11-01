//! App REST boundary. Pero's store/ACP owner remains authoritative;
//! the local calendar interpreter only proposes wall-clock slots.
use super::*;
use chrono::{DateTime, Utc};
use domain::{CalendarSchedule, catalog::CatalogEntry};
use serde::{Deserialize, Serialize};
#[path = "automation_calendar.rs"]
mod calendar_rules;
use calendar_rules::Calendar;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AppRequest {
    method: String,
    path: String,
    #[serde(default)]
    body: Option<Value>,
}
#[derive(Serialize)]
pub(crate) struct AppResponse { status: u16, body: Value }
fn reply(status: u16, body: Value) -> AppResponse { AppResponse { status, body } }
fn iso(seconds: u64) -> String {
    DateTime::<Utc>::from_timestamp(seconds.min(i64::MAX as u64) as i64,0).map(|date|date.to_rfc3339_opts(chrono::SecondsFormat::Secs,true)).unwrap_or_default()
}
#[derive(Clone, Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct Edit {
    name: Option<String>, prompt: Option<String>, rule: Option<String>, timezone: Option<String>,
    enabled: Option<bool>, target: Option<TargetInput>, event: Option<EventInput>,
    #[serde(default)] clear_event: bool,
    #[serde(default)] event_only: bool,
    program: Option<Value>,
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct TargetInput { kind: String }
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct EventInput { event: String, #[serde(default)] source: String }
fn calendar(rule: &str, zone: &str, anchor: u64) -> Result<Calendar,String> {
    let resolved=if zone=="Local" {iana_time_zone::get_timezone().map_err(|error|format!("Local time zone unavailable: {error}"))?}else{zone.into()};
    Calendar::parse(rule,&resolved,anchor)
}
fn stored_calendar(schedule:&CalendarSchedule)->Result<Calendar,String> {
    if schedule.timezone=="Local" {return Err("Re-save this schedule to freeze its IANA time zone before scheduled runs".into());}
    Calendar::parse(&schedule.rule,&schedule.timezone,schedule.first_slot)
}
fn edited_calendar(rule:&str,zone:&str,at:u64,previous:Option<&CalendarSchedule>)->Result<CalendarSchedule,String> {
    let value=calendar(rule,zone,at)?;let rule=value.rule();let timezone=value.timezone();
    if let Some(previous)=previous {
        if let Ok(old)=stored_calendar(previous) {
            if old.rule()==rule&&old.timezone()==timezone {return Ok(previous.clone());}
        }
    }
    Ok(CalendarSchedule{rule,timezone,first_slot:value.next(at)?,max_lateness_seconds:3600})
}

impl Automation {
    pub(crate) fn app_request(&mut self, request: AppRequest, agents: &mut Manager) -> AppResponse {
        let result=self.app_operation(request,agents);
        match result {Ok(value)=>value,Err(error)=>reply(400,json!({"error":error}))}
    }
    fn app_operation(&mut self, request: AppRequest, agents: &mut Manager) -> Result<AppResponse,String> {
        let path=request.path.split('?').next().unwrap_or("");
        if path=="/api/webhooks" && request.method=="GET" {return Ok(reply(200,json!({"sources":[]})));}
        if path=="/api/projects" && request.method=="GET" {return Ok(reply(200,json!({"items":[]})));}
        let parts=path.trim_matches('/').split('/').collect::<Vec<_>>();
        if parts.len()<2 || parts[..2]!=["api","automations"] {return Ok(reply(501,json!({"error":"This Automation integration is not available on this Host"})));}
        let state=self.store.state()?;
        let catalog=self.store.catalog()?;
        if parts.len()==2 && request.method=="GET" {
            let mut items=Vec::new();
            for definition in &state.definitions {
                if state.latest_definition(&definition.id).is_none_or(|latest|latest.revision!=definition.revision){continue;}
                let entry=catalog.iter().find(|entry|entry.id==definition.id);
                if entry.is_some_and(|entry|entry.deleted){continue;}
                items.push(self.app_record(definition,entry,&state)?);
            }
            return Ok(reply(200,json!({"items":items})));
        }
        let id=parts.get(2).map(|id|percent_encoding::percent_decode_str(id).decode_utf8().map(|id|id.into_owned()).map_err(|e|e.to_string())).transpose()?.unwrap_or_else(execution_id);
        let old=state.latest_definition(&id).cloned();
        let previous=catalog.iter().find(|entry|entry.id==id).cloned();
        if parts.len()>2 && (old.is_none() || previous.as_ref().is_some_and(|entry|entry.deleted)){return Ok(reply(404,json!({"error":"Automation not found"})));}
        if request.method=="GET" && parts.len()==3 {return Ok(reply(200,self.app_record(old.as_ref().unwrap(),previous.as_ref(),&state)?));}
        if request.method=="DELETE" && parts.len()==3 {
            let mut entry=previous.unwrap_or(CatalogEntry{id:id.clone(),name:id.clone(),deleted:false,created_at:now()});entry.deleted=true;
            let committed=self.store.apply_catalog(vec![Command::Control{definition_id:id,paused:true,revoked:true}],now(),None,None,None,Some(&entry))?;
            self.deliver_cancels(&committed.effects,agents);
            return Ok(reply(204,Value::Null));
        }
        if request.method=="POST" && parts.get(3)==Some(&"run") {
            let definition=old.unwrap();
            let receipt=self.app_run(&definition)?;
            return Ok(reply(200,json!({"request_id":receipt})));
        }
        if parts.len()>3 {return Ok(reply(501,json!({"error":"Information-source history is not connected on this Host"})));}
        if !((parts.len()==2&&request.method=="POST")||(parts.len()==3&&request.method=="PUT")){return Ok(reply(405,json!({"error":"Method not allowed"})));}
        let edit:Edit=serde_json::from_value(request.body.unwrap_or_else(||json!({}))).map_err(|e|e.to_string())?;
        if edit.program.is_some(){return Ok(reply(501,json!({"error":"Information-source collection is not connected on this Host"})));}
        if edit.target.as_ref().is_some_and(|target|target.kind!="local"){return Ok(reply(501,json!({"error":"Cloud Automation execution is not connected on this Host"})));}
        if edit.event_only{return Ok(reply(501,json!({"error":"Feishu event Automation requires a connected event source"})));}
        if old.is_some() && edit.enabled.is_some() && edit.name.is_none() && edit.prompt.is_none() && edit.rule.is_none() && edit.timezone.is_none() && edit.target.is_none() && edit.event.is_none() && !edit.clear_event {
            let definition=old.unwrap();
            let committed=self.store.apply(vec![Command::Control{definition_id:id,paused:!edit.enabled.unwrap(),revoked:false}],now(),None,None,None)?;
            self.deliver_cancels(&committed.effects,agents);
            return Ok(reply(200,self.app_record(&definition,previous.as_ref(),&self.store.state()?)?));
        }

        let Method::Agent{agent_id,workspace,prompt:old_prompt}=old.as_ref().map(|d|d.method.clone()).unwrap_or_else(|| {
            let context=agents.automation_context();
            Method::Agent{agent_id:context["agents"].as_array().and_then(|agents|agents.iter().find(|agent|agent["available"]==true)).and_then(|agent|agent["id"].as_str()).unwrap_or("").into(),workspace:context["workspace"].as_str().unwrap_or("").into(),prompt:String::new()}
        });
        let prompt=edit.prompt.unwrap_or(old_prompt);
        agents.automation_admit(&agent_id,Path::new(&workspace))?;
        let old_rule=old.as_ref().and_then(|d|match &d.trigger{domain::Trigger::Calendar{schedule,..}=>Some(schedule.rule.clone()),_=>None}).unwrap_or_default();
        let old_zone=old.as_ref().and_then(|d|match &d.trigger{domain::Trigger::Calendar{schedule,..}=>Some(schedule.timezone.clone()),_=>None}).unwrap_or_else(||"Local".into());
        let rule=edit.rule.unwrap_or(old_rule);let zone=edit.timezone.filter(|zone|!zone.is_empty()).unwrap_or(old_zone);

        let binding_id=format!("app-{id}");
        let event=if edit.clear_event{None}else{edit.event.or_else(||old.as_ref().and_then(|definition|match &definition.trigger{domain::Trigger::Event{event_kind,..}=>Some(EventInput{event:event_kind.clone(),source:String::new()}),_=>None}))};
        if event.is_some()&&!rule.is_empty(){return Ok(reply(501,json!({"error":"Combined calendar and webhook triggers are not connected on this Host"})));}
        let trigger=if let Some(event)=&event {
            if !event.source.is_empty(){return Ok(reply(501,json!({"error":"The selected webhook source is not connected on this Host"})));}
            domain::Trigger::Event{binding_id:binding_id.clone(),event_kind:event.event.clone()}
        }else{domain::Trigger::Manual};
        let mut definition=Definition{id:id.clone(),revision:old.as_ref().map_or(1,|d|d.revision+1),owner:state.owner.clone(),trigger,input:InputContract::RecheckLatest,input_binding_id:binding_id.clone(),method:Method::Agent{agent_id,workspace,prompt},target:Target::LocalHost{owner:state.owner.clone()}};
        let mut entry=previous.unwrap_or(CatalogEntry{id:id.clone(),name:id.clone(),deleted:false,created_at:now()});
        if let Some(name)=edit.name {entry.rename(name).map_err(str::to_string)?;}
        if !rule.is_empty(){
            let previous=old.as_ref().and_then(|definition|match &definition.trigger {domain::Trigger::Calendar{schedule,..}=>Some(schedule),_=>None});
            let schedule=edited_calendar(&rule,&zone,now(),previous)?;
            definition.trigger=domain::Trigger::Calendar{schedule,subject:id.clone(),exact:None};
        }
        let mut commands=vec![];
        if !state.bindings.iter().any(|b|b.id==binding_id){commands.push(Command::PutBinding{binding:SourceBinding{id:binding_id,owner:state.owner.clone(),authority:"trusted-local-host".into(),event_kinds:vec![event.map(|event|event.event).unwrap_or_else(||"changed".into())]}});}
        commands.push(Command::PutDefinition{definition:definition.clone()});
        let enabled=edit.enabled.unwrap_or_else(||!state.controls.get(&id).is_some_and(|control|control.paused||control.revoked));
        commands.push(Command::Control{definition_id:id,paused:!enabled,revoked:false});
        let committed=self.store.apply_catalog(commands,now(),None,None,None,Some(&entry))?;
        self.deliver_cancels(&committed.effects,agents);
        Ok(reply(if old.is_some(){200}else{201},self.app_record(&definition,Some(&entry),&self.store.state()?)?))
    }
    fn app_record(&self, definition:&Definition, entry:Option<&CatalogEntry>, state:&domain::State)->Result<Value,String>{
        let Method::Agent{prompt,..}=&definition.method;
        let control=state.controls.get(&definition.id);
        let enabled=!control.is_some_and(|value|value.paused||value.revoked);
        let (rule,zone,next,event)=match &definition.trigger{
            domain::Trigger::Calendar{schedule,..}=>(schedule.rule.clone(),schedule.timezone.clone(),state.calendar_slots.get(&definition.id).map(|slot|iso(*slot)),None),
            domain::Trigger::Time{anchor,interval_seconds,..}=>(format!("FREQ=SECONDLY;INTERVAL={interval_seconds}"),"UTC".into(),Some(iso(*anchor)),None),
            domain::Trigger::Event{event_kind,..}=>(String::new(),"Local".into(),None,Some(json!({"event":event_kind}))),
            _=>(String::new(),"Local".into(),None,None),
        };
        let calendar_error=match &definition.trigger {domain::Trigger::Calendar{schedule,..}=>stored_calendar(schedule).err(),_=>None};
        let runs=state.requests.iter().filter(|r|r.definition.id==definition.id).map(|request|{
            let (status,skip)=match request.status{RequestStatus::Completed=>("succeeded",None),RequestStatus::Failed|RequestStatus::NotStarted=>("failed",None),RequestStatus::Expired=>("skipped",Some("missed")),RequestStatus::Cancelled=>("canceled",None),RequestStatus::Reconcile=>("unknown",None),RequestStatus::Reconciled=>("interrupted",None),RequestStatus::Running|RequestStatus::Reserved=>("running",None),_=>("queued",None)};
            let scheduled=match request.intent{domain::Intent::Time{slot}=>slot,_=>request.created_at};
            json!({"key":{"automation":definition.id,"slot":iso(scheduled),"trigger":if matches!(request.intent,domain::Intent::Manual{..}){"manual"}else{"schedule"},"request_id":request.id},"scheduled_for":iso(scheduled),"state":status,"skip_reason":skip,"session_id":request.execution_id,"error":self.attention.get(&request.id)})
        }).collect::<Vec<_>>();
        let in_flight=state.requests.iter().rev().find(|r|r.definition.id==definition.id&&r.status.active()).and_then(|r|r.execution_id.clone());
        Ok(json!({"id":definition.id,"name":entry.map(|e|e.name.as_str()).unwrap_or(&definition.id),"prompt":prompt,"enabled":enabled,"rule":rule,"timezone":zone,"next":if enabled&&calendar_error.is_none(){next}else{None},"event":event,"runs":runs,"in_flight":in_flight,"scheduled":self.fault.is_none()&&calendar_error.is_none(),"error":calendar_error.as_ref().or(self.fault.as_ref()),"target":{"kind":"local"}}))
    }
    fn app_run(&mut self,definition:&Definition)->Result<String,String>{
        let content=format!("Automation {} manual run at {}",definition.id,iso(now()));
        let hash=digest(content.as_bytes());
        let candidate=CandidateRef{binding_id:definition.input_binding_id.clone(),subject:definition.id.clone(),revision:hash.clone(),digest:hash.clone(),content_ref:hash.clone()};
        let committed=self.store.apply(vec![Command::ManualInput{definition_id:definition.id.clone(),intent_id:execution_id(),candidate}],now(),Some((&hash,&content)),None,None)?;
        match committed.receipt{domain::Receipt::Request{id,..}=>Ok(id),_=>Err("Missing execution receipt".into())}
    }
    pub(super) fn advance_app_calendars(&mut self,at:u64)->Result<(),String>{
        let state=self.store.state()?;
        for definition in state.definitions.iter().filter(|d|state.latest_definition(&d.id).is_some_and(|latest|latest.revision==d.revision)){
            let domain::Trigger::Calendar{schedule,subject,..}=&definition.trigger else{continue;};
            let Some(slot)=state.calendar_slots.get(&definition.id).copied().filter(|slot|*slot<=at)else{continue;};
            // Refuse unavailable legacy rules without blocking independent definitions.
            // app_record exposes the same validation error; no cursor is advanced.
            let Ok(calendar)=stored_calendar(schedule) else {continue;};
            let mut next=Some(calendar.next(slot)?);
            if at.saturating_sub(slot)>schedule.max_lateness_seconds {
                next=Some(match calendar.recent(at,schedule.max_lateness_seconds)?.filter(|recent|*recent>slot) {
                    Some(recent)=>recent,None=>calendar.next(at)?,
                });
            }
            let content=format!("Automation {} scheduled for {}",definition.id,iso(slot));let hash=digest(content.as_bytes());
            let candidate=CandidateRef{binding_id:definition.input_binding_id.clone(),subject:subject.clone(),revision:hash.clone(),digest:hash.clone(),content_ref:hash.clone()};
            let commands=vec![Command::PublishSnapshot{candidate,latest:true},
                Command::CalendarTime{definition_id:definition.id.clone(),revision:definition.revision,slot,next_slot:next}];
            self.store.apply(commands,at,Some((&hash,&content)),None,None)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn persisted_local_requires_explicit_resave() {
        let mut schedule=CalendarSchedule{rule:"FREQ=DAILY;BYHOUR=9;BYMINUTE=0".into(),timezone:"Local".into(),first_slot:1,max_lateness_seconds:3600};
        assert!(stored_calendar(&schedule).unwrap_err().contains("Re-save"));
        schedule.timezone="Asia/Shanghai".into();assert_eq!(stored_calendar(&schedule).unwrap().timezone(),"Asia/Shanghai");
    }
    #[test]
    fn unchanged_edits_preserve_interval_anchor() {
        let old=CalendarSchedule{rule:"FREQ=DAILY;BYHOUR=9;BYMINUTE=0;INTERVAL=3".into(),timezone:"UTC".into(),first_slot:32400,max_lateness_seconds:3600};
        assert_eq!(edited_calendar("rrule:interval=3;byminute=00;byhour=09;freq=daily","UTC",90000,Some(&old)).unwrap(),old);
        let changed=edited_calendar("FREQ=DAILY;BYHOUR=10;BYMINUTE=0;INTERVAL=3","UTC",90000,Some(&old)).unwrap();
        assert!(changed.first_slot>90000);assert_ne!(changed.first_slot,old.first_slot);
        let zone=edited_calendar(&old.rule,"Asia/Shanghai",90000,Some(&old)).unwrap();assert_eq!(zone.timezone,"Asia/Shanghai");assert_ne!(zone.first_slot,old.first_slot);
    }
}
