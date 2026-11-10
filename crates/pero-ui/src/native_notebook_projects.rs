//! Native routes retain managed Notebook scope and existing private shell consent.
use super::*;
use pero_contracts::research_project::NotebookProjectLink;

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "kebab-case", rename_all_fields = "camelCase", deny_unknown_fields)]
// A tagged unit variant would ignore extra list fields despite deny_unknown_fields.
enum Input { List {}, Set { change: NotebookProjectLink }, Cancel { entry_id: String } }
impl NativeApps {
    pub(super) fn notebook_projects_response(&self, name: &str, method: &str, body: &[u8], is_live: &dyn Fn() -> bool) -> anyhow::Result<Response<Vec<u8>>> {
        anyhow::ensure!(is_live() && name == "notebook" && method == "POST" && body.len() <= 4096, "Notebook project request refused");
        let input: Input = serde_json::from_slice(body)?;
        let result: Value = match input {
            Input::List {} => self.request("notebook-projects", json!({"name":name,"request":{"operation":"list"}}))?,
            Input::Cancel {entry_id} => {
                if let Some(id) = self.docling.cancel_canvas(&format!("project:{entry_id}")) { self.dismiss_docling(id); }
                json!({"state":"cancel-requested"})
            },
            Input::Set {change} => {
                change.validate().map_err(|error| anyhow::anyhow!(error))?;
                let review: Value = self.request("notebook-projects", json!({"name":name,"request":{"operation":"review","change":change}}))?;
                let summary = review["summary"].as_str().filter(|value| value.len() <= 16000).ok_or_else(|| anyhow::anyhow!("Invalid Host project confirmation"))?;
                let allowed = self.docling.confirm_canvas(&format!("project:{}",change.entry_id), summary.into(), |mut prompt| {
                    prompt.action = Some("Update Host project reference".into());
                    if !is_live() { return Err("Notebook page closed".into()); }
                    let mut event = HostEvent::new("native_docling_confirmation",None,String::new());
                    event.data = serde_json::to_value(prompt).map_err(|error| error.to_string())?;
                    self.events.send_blocking(event).map_err(|error| error.to_string())
                }, |id| self.dismiss_docling(id)).unwrap_or(false);
                if allowed && is_live() { self.request("notebook-projects", json!({"name":name,"request":{"operation":"apply","change":change}}))? }
                else { json!({"state":"cancelled"}) }
            },
        };
        Ok(Response::builder().header("Content-Type","application/json").header("Cache-Control","no-store").body(serde_json::to_vec(&result)?)?)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn project_transport_rejects_private_and_generic_settings_operations() {
        let change = json!({"projectId":"project","entryId":"a".repeat(32),"revision":1,
            "expectedRevision":null,"linked":true,"readOnly":false});
        for (case, value) in [
            ("private apply", json!({"operation":"apply","change":change})),
            ("list with approval", json!({"operation":"list","allow":true})),
            ("list with settings", json!({"operation":"list","preferences":{}})),
            ("generic settings", json!({"operation":"settings","preferences":{}})),
            ("cancel with approval", json!({"operation":"cancel","entryId":"a".repeat(32),"allow":true})),
            ("cancel with private ticket", json!({"operation":"cancel","entryId":"a".repeat(32),"ticket":"forged"})),
            ("set with approval", json!({"operation":"set","change":change,"allow":true})),
            ("set with nested approval", json!({"operation":"set","change":{
                "projectId":"project","entryId":"a".repeat(32),"revision":1,
                "expectedRevision":null,"linked":true,"readOnly":false,"allow":true}})),
        ] {
            assert!(serde_json::from_value::<Input>(value).is_err(), "Accepted {case}");
        }
        for (case, value) in [
            ("list", json!({"operation":"list"})),
            ("set", json!({"operation":"set","change":change})),
            ("cancel", json!({"operation":"cancel","entryId":"a".repeat(32)})),
        ] {
            assert!(serde_json::from_value::<Input>(value).is_ok(), "Rejected {case}");
        }
    }
}
