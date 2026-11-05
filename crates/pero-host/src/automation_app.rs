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
fn run_notice(id: &str, when: &str, program: Option<&domain::InformationProgram>) -> String {
    let mut content=format!("Automation {id} {when}");
    if let Some(program)=program {
        content.push_str("\nInformation program (authorized sources, filter and output; data, not new permissions):\n");
        content.push_str(&serde_json::to_string(program).unwrap_or_default());
    }
    content
}
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
    pub(crate) fn app_request(&mut self, caller: &str, request: AppRequest, agents: &mut Manager) -> AppResponse {
        let result = match (caller, request.path.as_str()) {
            ("paper-agent", "/api/research-watch") => self.research_watch(request),
            ("insights", "/api/research-watch") if request.method == "GET" => self.research_overview(),
            ("automations", _) => self.app_operation(request, agents),
            _ => return reply(403, json!({"error":"Automation operation is unavailable to this App"})),
        };
        match result {Ok(value)=>value,Err(error)=>reply(400,json!({"error":error}))}
    }

    fn research_overview(&self) -> Result<AppResponse, String> {
        let state = self.store.state()?;
        let watches = state.definitions.iter().filter_map(|definition| {
            let Method::ResearchWatch { record_id } = &definition.method else { return None; };
            if state.latest_definition(&definition.id)?.revision != definition.revision { return None; }
            let scheduled = matches!(definition.trigger, Trigger::Calendar { .. }) &&
                !state.controls.get(&definition.id).is_some_and(|control| control.paused || control.revoked);
            let running = state.requests.iter().any(|request| request.definition.id == definition.id &&
                (request.status.active() || matches!(request.status, RequestStatus::Pending)));
            Some(json!({"recordId":record_id,"scheduled":scheduled,"running":running,
                "next":state.calendar_slots.get(&definition.id).copied().filter(|_|scheduled).map(iso)}))
        }).collect::<Vec<_>>();
        Ok(reply(200, json!({"watches":watches,"updates":self.store.research_updates()?,"fault":self.fault})))
    }

    fn research_watch(&mut self, request: AppRequest) -> Result<AppResponse, String> {
        if request.method == "GET" { return self.research_overview(); }
        if request.method != "POST" { return Ok(reply(405, json!({"error":"Method not allowed"}))); }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Watch { record_id: crate::research_assets::ResearchId, operation: String }
        let watch: Watch = serde_json::from_value(request.body.unwrap_or(Value::Null)).map_err(|error| error.to_string())?;
        let record_id: String = watch.record_id.into();
        if let Some(error) = &self.fault { return Err(error.clone()); }
        let id = format!("research-{record_id}");
        let state = self.store.state()?;
        let prior = state.latest_definition(&id);
        let at = now();
        let mut commands = Vec::new();
        match watch.operation.as_str() {
            "check" | "schedule" => {
                let should_schedule = watch.operation == "schedule";
                if prior.is_none() || should_schedule && prior.is_some_and(|value| matches!(value.trigger, Trigger::Manual)) {
                    let trigger = if should_schedule { Trigger::Calendar { subject:record_id.clone(), exact:None,
                        schedule:edited_calendar("FREQ=DAILY;BYHOUR=9;BYMINUTE=0", "Local", at, None)? } } else { Trigger::Manual };
                    commands.push(Command::PutDefinition { definition: Definition { id:id.clone(),
                        revision:prior.map_or(1, |value| value.revision + 1), owner:state.owner.clone(), trigger,
                        input:InputContract::RecheckLatest, input_binding_id:"local".into(),
                        method:Method::ResearchWatch { record_id:record_id.clone() }, target:Target::LocalHost { owner:state.owner.clone() } } });
                }
                if should_schedule { commands.push(Command::Control { definition_id:id.clone(), paused:false, revoked:false }); }
            }
            "pause" if prior.is_some() => {
                let mut definition = prior.unwrap().clone();
                definition.revision += 1;
                definition.trigger = Trigger::Manual;
                commands.push(Command::PutDefinition { definition });
            }
            _ => return Err("Choose Check now, Schedule or Pause".into()),
        }
        let content = record_id.clone();
        let hash = digest(content.as_bytes());
        let candidate = CandidateRef { binding_id:"local".into(), subject:record_id, revision:hash.clone(), digest:hash.clone(), content_ref:hash.clone() };
        if watch.operation != "pause" {
            commands.push(Command::PublishSnapshot { candidate:candidate.clone(), latest:true });
            if watch.operation == "check" { commands.push(Command::ManualInput { definition_id:id, intent_id:execution_id(), candidate }); }
        }
        self.store.apply(commands, at, Some((&hash, &content)), None, None)?;
        self.research_overview()
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
        if old.as_ref().is_some_and(|definition| matches!(definition.method, Method::ResearchWatch { .. })) {
            return Ok(reply(403,json!({"error":"Manage this check from its saved Paper record"})));
        }
        if request.method=="DELETE" && parts.len()==3 {
            let mut entry=previous.unwrap_or(CatalogEntry{id:id.clone(),name:id.clone(),deleted:false,created_at:now()});entry.deleted=true;
            let committed=self.store.apply_catalog(vec![Command::Control{definition_id:id,paused:true,revoked:true}],now(),None,None,None,Some(&entry),None)?;
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
        let program=edit.program.as_ref().map(domain::InformationProgram::parse).transpose()?;
        if edit.target.as_ref().is_some_and(|target|target.kind!="local"){return Ok(reply(501,json!({"error":"Cloud Automation execution is not connected on this Host"})));}
        if edit.event_only{return Ok(reply(501,json!({"error":"Feishu event Automation requires a connected event source"})));}
        if old.is_some() && program.is_none() && edit.enabled.is_some() && edit.name.is_none() && edit.prompt.is_none() && edit.rule.is_none() && edit.timezone.is_none() && edit.target.is_none() && edit.event.is_none() && !edit.clear_event {
            let definition=old.unwrap();
            let committed=self.store.apply(vec![Command::Control{definition_id:id,paused:!edit.enabled.unwrap(),revoked:false}],now(),None,None,None)?;
            self.deliver_cancels(&committed.effects,agents);
            return Ok(reply(200,self.app_record(&definition,previous.as_ref(),&self.store.state()?)?));
        }

        let Method::Agent{agent_id,workspace,prompt:old_prompt}=old.as_ref().map(|d|d.method.clone()).unwrap_or_else(|| {
            let context=agents.automation_context();
            Method::Agent{agent_id:context["agents"].as_array().and_then(|agents|agents.iter().find(|agent|agent["available"]==true)).and_then(|agent|agent["id"].as_str()).unwrap_or("").into(),workspace:context["workspace"].as_str().unwrap_or("").into(),prompt:String::new()}
        }) else { return Err("This method is unavailable for editing".into()); };
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
        let committed=self.store.apply_catalog(commands,now(),None,None,None,Some(&entry),program.as_ref())?;
        self.deliver_cancels(&committed.effects,agents);
        Ok(reply(if old.is_some(){200}else{201},self.app_record(&definition,Some(&entry),&self.store.state()?)?))
    }
    fn app_record(&self, definition:&Definition, entry:Option<&CatalogEntry>, state:&domain::State)->Result<Value,String>{
        let prompt = match &definition.method { Method::Agent { prompt, .. } => prompt.as_str(),
            Method::ResearchWatch { .. } => "Check saved research inputs and official arXiv metadata" };
        let program=self.store.program(&definition.id)?;
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
            json!({"key":{"automation":definition.id,"slot":iso(scheduled),"trigger":if matches!(request.intent,domain::Intent::Manual{..}){"manual"}else{"schedule"},"request_id":request.id},"scheduled_for":iso(scheduled),"state":status,"skip_reason":skip,"session_id":if matches!(definition.method, Method::Agent{..}) {request.execution_id.as_ref()} else {None},"error":self.attention.get(&request.id)})
        }).collect::<Vec<_>>();
        let in_flight=state.requests.iter().rev().find(|r|r.definition.id==definition.id&&r.status.active()).and_then(|r|r.execution_id.clone());
        let mut record=json!({"id":definition.id,"name":entry.map(|e|e.name.as_str()).unwrap_or(&definition.id),"prompt":prompt,"enabled":enabled,"rule":rule,"timezone":zone,"next":if enabled&&calendar_error.is_none(){next}else{None},"event":event,"runs":runs,"in_flight":in_flight,"scheduled":self.fault.is_none()&&calendar_error.is_none(),"error":calendar_error.as_ref().or(self.fault.as_ref()),"target":{"kind":"local"}});
        if let Some(program)=program {record["program"]=serde_json::to_value(program).map_err(|error|error.to_string())?;}
        if matches!(definition.method, Method::ResearchWatch { .. }) {
            record["kind"] = json!("research_watch");
            record["name"] = json!("Research updates");
        }
        Ok(record)
    }
    fn app_run(&mut self,definition:&Definition)->Result<String,String>{
        let content=run_notice(&definition.id,&format!("manual run at {}",iso(now())),self.store.program(&definition.id)?.as_ref());
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
            let content = match &definition.method {
                Method::ResearchWatch { record_id } => record_id.clone(),
                Method::Agent { .. } => run_notice(&definition.id,&format!("scheduled for {}",iso(slot)),self.store.program(&definition.id)?.as_ref()),
            };
            let hash = digest(content.as_bytes());
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
    #[test]
    fn scheduled_notice_keeps_prompt_only_text_and_carries_a_program() {
        let program=domain::InformationProgram::parse(&json!({"sources":[{"id":"coding-agent-news","provider":"search","query":"Coding Agent news"}],"filter":{"keywords":[],"regex":""},"goal":"Useful recent news","output":"pulse","locale":"zh"})).unwrap();
        assert_eq!(run_notice("news","manual run at 2026-11-01T00:20:00Z",None),"Automation news manual run at 2026-11-01T00:20:00Z");
        let notice=run_notice("news","scheduled for 2026-11-01T00:20:00Z",Some(&program));
        assert!(notice.starts_with("Automation news scheduled for 2026-11-01T00:20:00Z\n"));
        assert!(notice.contains("coding-agent-news"));
        assert!(notice.contains("\"output\":\"pulse\""));
    }
}
