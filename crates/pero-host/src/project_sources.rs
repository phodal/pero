//! Workbench transport for the current profile's saved Project sources.
use pero_contracts::{
    HostEvent,
    project_source::{ProjectSourceId, ReviewedWebSource},
};
use pero_runtime::{project_sources::ProjectSources, settings::load_research_projects};
use serde::Deserialize;
use serde_json::{Value, json};
use std::path::Path;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    #[serde(rename = "method")]
    _method: String,
    request_id: String,
    request: Operation,
}

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Operation {
    Projects {},
    List {
        project_id: String,
    },
    Read {
        project_id: String,
        id: ProjectSourceId,
    },
    Save {
        project_id: String,
        source: ReviewedWebSource,
    },
}

pub fn dispatch(settings: Option<&Path>, value: Value, now: u64) -> HostEvent {
    let id = value["request_id"].as_str().map(str::to_owned);
    let result = (|| -> Result<Value, Box<dyn std::error::Error>> {
        let Request {
            request_id,
            request,
            ..
        } = serde_json::from_value(value)?;
        if request_id.is_empty() {
            return Err("Missing Project source request ID".into());
        }
        let settings = settings.ok_or("Project sources require a persistent Host profile")?;
        let preferences = load_research_projects(settings)?;
        let project = |id: &str| {
            preferences
                .research_projects
                .iter()
                .find(|project| project.id == id)
                .ok_or("The selected Project is unavailable")
        };
        let store = ProjectSources::new(settings);
        Ok(match request {
            Operation::Projects {} => {
                json!({"projects": preferences.research_projects.iter().map(|project|
                json!({"id":project.id,"title":project.title})).collect::<Vec<_>>() })
            }
            Operation::List { project_id } => {
                json!({"sources": store.list(project(&project_id)?)?})
            }
            Operation::Read { project_id, id } => {
                json!({"source": store.read(project(&project_id)?, &id)?})
            }
            Operation::Save { project_id, source } => {
                json!({"projectId": project_id, "sourceReceipt": store.save(project(&project_id)?, source, now)?})
            }
        })
    })();
    let mut event = HostEvent::new("project_sources_result", id, String::new());
    event.data = match result {
        Ok(value) => json!({"ok": true, "value": value}),
        Err(error) => json!({"ok": false, "error": error.to_string()}),
    };
    event
}
