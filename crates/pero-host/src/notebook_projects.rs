//! Narrow Notebook-to-Host project association. The shell confirms; settings owns persistence.
use crate::project_resources::ProjectResources;
use pero_contracts::{research_project::NotebookProjectLink, workbench::WorkbenchPreferences, HostEvent};
use pero_runtime::apps::{AppName, AppStore};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path;

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "kebab-case", deny_unknown_fields)]
pub(crate) enum Request {
    // A struct variant makes deny_unknown_fields apply even to this empty payload.
    List {},
    Review { change: NotebookProjectLink },
    Apply { change: NotebookProjectLink },
}
fn projects(preferences: &WorkbenchPreferences) -> Value {
    json!(preferences.research_projects.iter().map(|project| json!({
        "id":project.id,"title":project.title,"entries":project.resources.iter()
            .filter(|item| item.app == "notebook" && item.kind == "entry")
            .map(|item| json!({"id":item.id,"revision":item.revision})).collect::<Vec<_>>()
    })).collect::<Vec<_>>())
}
pub(crate) fn execute(store: &mut AppStore, settings: Option<&Path>, caller: &AppName, input: Request) -> Result<Value, String> {
    if caller.as_str() != "notebook" { return Err("Notebook origin required".into()); }
    store.sdk_context(caller)?;
    let path = settings.ok_or("Host project settings are unavailable")?;
    let preferences = pero_runtime::settings::load_notebook_projects(path).map_err(|error| error.to_string())?;
    let catalog = ProjectResources::resolve(store, caller, &mut |_| {})?.read()?;
    let entries = json!(catalog.resources.iter().map(|item| json!({
        "id":item.reference.id,"revision":item.reference.revision,"title":item.title
    })).collect::<Vec<_>>());
    let (change, apply) = match input {
        Request::List {} => return Ok(json!({"projects":projects(&preferences),"entries":entries})),
        Request::Review {change} => (change, false),
        Request::Apply {change} => (change, true),
    };
    change.validate()?;
    let entry = catalog.resources.iter().find(|item| item.reference.id == change.entry_id)
        .ok_or("Saved Notebook entry is unavailable")?;
    if entry.reference.revision != change.revision.to_string() {
        return Err("Notebook changed. Load its current saved revision before changing a project association.".into());
    }
    let mut project = preferences.research_projects.iter().find(|project| project.id == change.project_id)
        .cloned().ok_or("Host project is unavailable")?;
    change.apply(&mut project)?;
    if !apply {
        return Ok(json!({"summary":format!("{} Notebook entry '{}' ({} · v{}) {} Host project '{}' ({}). Only the project reference changes; Notebook content and other project resources remain with their owners.",
            if change.linked {"Link"} else {"Unlink"}, entry.title, change.entry_id, change.revision,
            if change.linked {"to"} else {"from"},project.title,project.id)}));
    }
    let next = pero_runtime::settings::save_notebook_project_link(path, &change).map_err(|error| error.to_string())?;
    let mut event = HostEvent::new("workbench_settings", None, String::new());
    event.data = serde_json::to_value(&next).map_err(|error| error.to_string())?;
    // Workbench receives the same authoritative preferences as its own project editor.
    let _ = crate::emit(event);
    Ok(json!({"state":"completed","projects":projects(&next),"entries":entries}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_requests_accept_only_the_declared_owner_payload() {
        let change = json!({"projectId":"project","entryId":"a".repeat(32),"revision":1,
            "expectedRevision":null,"linked":true,"readOnly":false});
        for (case, value) in [
            ("list with approval", json!({"operation":"list","allow":true})),
            ("list with settings", json!({"operation":"list","preferences":{}})),
            ("renderer set", json!({"operation":"set","change":change})),
            ("generic settings", json!({"operation":"settings","preferences":{}})),
            ("review with approval", json!({"operation":"review","change":change,"allow":true})),
            ("apply with private ticket", json!({"operation":"apply","change":change,"ticket":"forged"})),
            ("apply with nested preferences", json!({"operation":"apply","change":{
                "projectId":"project","entryId":"a".repeat(32),"revision":1,
                "expectedRevision":null,"linked":true,"readOnly":false,"preferences":{}}})),
        ] {
            assert!(serde_json::from_value::<Request>(value).is_err(), "Accepted {case}");
        }
        for (case, value) in [
            ("list", json!({"operation":"list"})),
            ("review", json!({"operation":"review","change":change})),
            ("apply", json!({"operation":"apply","change":change})),
        ] {
            assert!(serde_json::from_value::<Request>(value).is_ok(), "Rejected {case}");
        }
    }
}
