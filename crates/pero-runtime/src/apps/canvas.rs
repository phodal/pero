//! Opt-in, data-only embedded views. No App script, origin or backend credential is delegated.
use super::{AppDefinition, AppName, AppStore, definition::AppWriteRoute};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CanvasDefinition {
    pub id: AppName,
    pub title: String,
    pub read: String,
    pub status: String,
    pub inputs: Value,
    pub actions: Vec<AppName>,
}
pub(super) fn validate_definitions(app: &AppDefinition) -> Result<(), String> {
    if app.contributes.canvases.len() > 8 || (!app.contributes.canvases.is_empty() && app.backend.is_none()) {
        return Err("Embedded views require an App backend and at most eight declarations".into());
    }
    let mut names = BTreeSet::new();
    for view in &app.contributes.canvases {
        if !names.insert(view.id.as_str()) || view.title.trim().is_empty() || view.title.len() > 200 ||
            !view.read.starts_with("/internal/canvas/") || !super::definition::relative_entry(&view.read[1..]) ||
            !view.status.starts_with("/internal/canvas/") || !super::definition::relative_entry(&view.status[1..]) ||
            !view.inputs.is_object() || serde_json::to_vec(&view.inputs).map_err(|e| e.to_string())?.len() > 16384 || view.actions.len() > 8 {
            return Err("Invalid embedded view declaration".into());
        }
        jsonschema::validator_for(&view.inputs).map_err(|e| e.to_string())?;
        let mut actions = BTreeSet::new();
        for action in &view.actions {
            if !actions.insert(action.as_str()) || !app.contributes.writes.iter().any(|route| &route.name == action && route.path.starts_with("/api/canvas/")) {
                return Err("Embedded actions must name unique declared /api/canvas/ writes".into());
            }
        }
    }
    Ok(())
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct CanvasBinding {
    pub id: String,
    pub app: AppName,
    pub panel: AppName,
    pub view: AppName,
    pub declaration: String,
    pub inputs: Value,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct CanvasSource {
    pub entry_id: String,
    pub revision: u64,
    pub block_id: String,
    pub binding: CanvasBinding,
    pub read_only: bool,
}
impl CanvasSource {
    pub fn validate(&self) -> Result<(), String> {
        let identity = |value: &str| !value.is_empty() && value.len() <= 128 && value.bytes().all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b));
        if self.entry_id.len() != 32 || !self.entry_id.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()) ||
            self.revision == 0 || !identity(&self.block_id) || !identity(&self.binding.id) ||
            self.binding.declaration.len() != 64 || !self.binding.declaration.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()) {
            return Err("Use a saved Notebook revision and Canvas binding".into());
        }
        Ok(())
    }
}
#[derive(Clone)]
pub struct CanvasInstance { pub source: CanvasSource, pub expires_at: u64 }
#[derive(Clone)]
pub struct CanvasAction {
    pub name: AppName,
    pub document: Value,
    pub ticket: String,
    pub state: ActionState,
}
#[derive(Clone, PartialEq)]
pub enum ActionState { Awaiting, Denied, Dispatched, Completed(Value) }
#[derive(Default)]
pub struct CanvasInstances {
    instances: BTreeMap<String, CanvasInstance>,
    actions: BTreeMap<(String, String), CanvasAction>,
}
impl CanvasInstances {
    pub fn mount(&mut self, source: CanvasSource, now: u64) -> Result<String, String> {
        source.validate()?;
        let expired: Vec<_> = self.instances.iter().filter(|(_, value)| value.expires_at <= now).map(|(id, _)| id.clone()).collect();
        for id in expired { self.release(&id); }
        if self.instances.len() >= 128 { return Err("Close an embedded view before opening another".into()); }
        let id = uuid::Uuid::new_v4().to_string();
        self.instances.insert(id.clone(), CanvasInstance { source, expires_at: now + 30 * 60_000 });
        Ok(id)
    }
    pub fn get(&mut self, id: &str, now: u64) -> Result<CanvasInstance, String> {
        let instance = self.instances.get_mut(id).filter(|value| value.expires_at > now).ok_or("Embedded view expired or was closed")?;
        instance.expires_at = now + 30 * 60_000;
        Ok(instance.clone())
    }
    pub fn release(&mut self, id: &str) {
        self.instances.remove(id);
        self.actions.retain(|(instance, _), _| instance != id);
    }
    pub fn prepare(&mut self, instance: &str, operation: &str, name: AppName, document: Value) -> Result<CanvasAction, String> {
        if !self.instances.contains_key(instance) { return Err("Embedded view was closed".into()); }
        if operation.is_empty() || operation.len() > 128 || !operation.bytes().all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b)) { return Err("Invalid operation identity".into()); }
        let key = (instance.to_owned(), operation.to_owned());
        if let Some(action) = self.actions.get(&key) {
            if action.name != name || action.document != document { return Err("Operation identity belongs to different inputs".into()); }
            return Ok(action.clone());
        }
        if self.actions.len() >= 1024 { return Err("Close an embedded view before preparing more actions".into()); }
        let action = CanvasAction { name, document, ticket: uuid::Uuid::new_v4().to_string(), state: ActionState::Awaiting };
        self.actions.insert(key, action.clone());
        Ok(action)
    }
    pub fn decide(&mut self, instance: &str, operation: &str, ticket: &str, allow: bool) -> Result<CanvasAction, String> {
        let action = self.actions.get_mut(&(instance.into(), operation.into())).ok_or("Prepare this exact operation first")?;
        if action.ticket != ticket { return Err("Private confirmation does not match this operation".into()); }
        if action.state == ActionState::Awaiting { action.state = if allow { ActionState::Dispatched } else { ActionState::Denied }; }
        else { return Err("Operation already decided; read its status rather than execute again".into()); }
        Ok(action.clone())
    }
    pub fn cancel(&mut self, instance: &str, operation: &str) -> Value {
        if let Some(action) = self.actions.get_mut(&(instance.into(), operation.into())) {
            if action.state == ActionState::Awaiting { action.state = ActionState::Denied; }
        }
        self.status(instance, operation)
    }
    pub fn complete(&mut self, instance: &str, operation: &str, result: Value) {
        if let Some(action) = self.actions.get_mut(&(instance.into(), operation.into())) { action.state = ActionState::Completed(result); }
    }
    pub fn action(&self, instance: &str, operation: &str) -> Option<CanvasAction> { self.actions.get(&(instance.into(), operation.into())).cloned() }
    pub fn status(&self, instance: &str, operation: &str) -> Value {
        match self.actions.get(&(instance.into(), operation.into())).map(|value| &value.state) {
            Some(ActionState::Awaiting) => json!({"state":"awaiting-confirmation"}),
            Some(ActionState::Denied) => json!({"state":"cancelled"}),
            Some(ActionState::Dispatched) => json!({"state":"outcome-unknown","message":"Dispatch began. Read the Data owner's receipt before repeating."}),
            Some(ActionState::Completed(value)) => json!({"state":"completed","receipt":value}),
            None => json!({"state":"not-started"}),
        }
    }
}
impl AppStore {
    pub fn canvas_view(&self, binding: &CanvasBinding) -> Result<CanvasDefinition, String> {
        let app = self.installed.get(&binding.app).filter(|app| app.enabled).ok_or("Embedded App is not installed or enabled")?;
        let definition = &app.definition;
        if definition.revision() != binding.declaration { return Err("App declaration changed; explicitly rebind this view".into()); }
        if !definition.contributes.panels.iter().any(|panel| panel.id == binding.panel) { return Err("The declared panel is unavailable".into()); }
        let view = definition.contributes.canvases.iter().find(|view| view.id == binding.view).ok_or("This App does not declare the embedded view")?;
        if serde_json::to_vec(&binding.inputs).map_err(|e|e.to_string())?.len() > 16384 || !jsonschema::validator_for(&view.inputs).map_err(|e|e.to_string())?.is_valid(&binding.inputs) {
            return Err("View inputs do not match its declaration".into());
        }
        Ok(view.clone())
    }
    pub fn canvas_action(&self, binding: &CanvasBinding, name: &AppName, document: &Value) -> Result<AppWriteRoute, String> {
        let view = self.canvas_view(binding)?;
        if !view.actions.contains(name) { return Err("This action is not declared for the embedded view".into()); }
        let route = self.installed[&binding.app].definition.contributes.writes.iter().find(|route| &route.name == name).ok_or("Declared action unavailable")?;
        if serde_json::to_vec(document).map_err(|e|e.to_string())?.len() > 65536 || !jsonschema::validator_for(&route.schema).map_err(|e|e.to_string())?.is_valid(document) { return Err("Action inputs do not match its declaration".into()); }
        Ok(route.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn source() -> CanvasSource {
        serde_json::from_value(json!({"entryId":"a".repeat(32),"revision":1,"blockId":"canvas","readOnly":false,
            "binding":{"id":"binding","app":"data","panel":"main","view":"dataset-inspector","declaration":"b".repeat(64),"inputs":{"datasetId":"ds-1"}}})).unwrap()
    }
    #[test]
    fn each_instance_owns_its_consent_and_terminal_operations_never_reexecute() {
        let mut owner=CanvasInstances::default();
        let first=owner.mount(source(),0).unwrap(); let second=owner.mount(source(),0).unwrap();
        assert_ne!(first,second);
        let action=AppName::try_from("canvas-archive".to_owned()).unwrap();
        let prepared=owner.prepare(&first,"op",action.clone(),json!({"archived":true})).unwrap();
        assert!(owner.prepare(&first,"op",action.clone(),json!({"archived":false})).is_err());
        assert!(owner.decide(&second,"op",&prepared.ticket,true).is_err());
        assert!(owner.decide(&first,"op","forged",true).is_err());
        owner.decide(&first,"op",&prepared.ticket,true).unwrap();
        assert_eq!(owner.cancel(&first,"op")["state"],"outcome-unknown");
        assert!(owner.decide(&first,"op",&prepared.ticket,true).is_err());
        owner.complete(&first,"op",json!({"actual":"owner receipt"}));
        assert_eq!(owner.status(&first,"op")["receipt"]["actual"],"owner receipt");
        let denied=owner.prepare(&second,"denied",action,json!({})).unwrap();
        assert_eq!(owner.cancel(&second,"denied")["state"],"cancelled");
        assert!(owner.decide(&second,"denied",&denied.ticket,true).is_err());
        owner.release(&first); assert!(owner.get(&first,1).is_err());
        assert!(owner.get(&second,30*60_000).is_err());
    }
    #[test]
    fn declarations_opt_in_without_changing_existing_panel_permissions() {
        let actual: Value=serde_json::from_str(include_str!("../../../../apps/data/app.json")).unwrap();
        assert!(AppDefinition::parse(&serde_json::to_vec(&actual).unwrap()).is_ok());
        for change in ["remote-read","unscoped-action","missing-backend","duplicate-view"] {
            let mut value=actual.clone();
            match change {
                "remote-read" => value["contributes"]["canvases"][0]["read"]=json!("https://example.org"),
                "unscoped-action" => value["contributes"]["canvases"][0]["actions"]=json!(["anything"]),
                "missing-backend" => {value.as_object_mut().unwrap().remove("backend");},
                _ => {let view=value["contributes"]["canvases"][0].clone();value["contributes"]["canvases"].as_array_mut().unwrap().push(view);},
            }
            assert!(AppDefinition::parse(&serde_json::to_vec(&value).unwrap()).is_err(),"{change}");
        }
    }
}
