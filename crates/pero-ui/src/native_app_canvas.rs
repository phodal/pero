//! The native App transport uses the existing trusted consent queue, not WebView approval.
use super::*;

#[derive(Deserialize, serde::Serialize)]
#[serde(tag="operation",rename_all="kebab-case",rename_all_fields="camelCase",deny_unknown_fields)]
enum Input {
    Mount { source: Value },
    Read { instance: String },
    Release { instance: String },
    Act { instance: String, operation_id: String, action: String, params: Value },
    Status { instance: String, operation_id: String },
    Cancel { instance: String, operation_id: String },
}
impl NativeApps {
    pub(super) fn canvas_response(&self, name: &str, method: &str, body: &[u8], is_live: &dyn Fn() -> bool) -> anyhow::Result<Response<Vec<u8>>> {
        anyhow::ensure!(is_live() && name == "notebook" && method == "POST" && body.len() <= 65536, "Canvas request refused");
        let input: Input = serde_json::from_slice(body)?;
        let wire = serde_json::to_value(&input)?;
        let mounting = matches!(&input, Input::Mount {..});
        let result = match input {
            Input::Act {instance, operation_id, ..} => {
                let mut prepare = wire; prepare["operation"] = json!("prepare");
                let prepared: Value = self.request("canvas",json!({"name":name,"request":prepare}))?;
                if prepared["state"] != "requires-approval" { prepared }
                else {
                    let ticket = prepared["ticket"].as_str().filter(|value| !value.is_empty() && value.len() <= 128).ok_or_else(||anyhow::anyhow!("Invalid Host action ticket"))?;
                    let summary = prepared["summary"].as_str().filter(|value| value.len() <= 16000).ok_or_else(||anyhow::anyhow!("Invalid Host action summary"))?;
                    let allowed = self.docling.confirm_canvas(&instance,summary.into(), |prompt| {
                        if !is_live() { return Err("Notebook page closed".into()); }
                        let mut event=HostEvent::new("native_docling_confirmation",None,String::new());
                        event.data=serde_json::to_value(prompt).map_err(|e|e.to_string())?;
                        self.events.send_blocking(event).map_err(|e|e.to_string())
                    }, |id| self.dismiss_docling(id)).unwrap_or(false);
                    if allowed && is_live() { self.request("canvas",json!({"name":name,"request":{"operation":"decide","instance":instance,
                        "operationId":operation_id,"ticket":ticket,"allow":true}}))? }
                    else { self.request("canvas",json!({"name":name,"request":{"operation":"cancel","instance":instance,"operationId":operation_id}}))? }
                }
            }
            Input::Cancel {instance,..} | Input::Release {instance} => {
                if let Some(id)=self.docling.cancel_canvas(&instance) { self.dismiss_docling(id); }
                self.request("canvas",json!({"name":name,"request":wire}))?
            }
            _ => self.request("canvas",json!({"name":name,"request":wire}))?,
        };
        if mounting && !is_live() {
            if let Some(instance)=result["instance"].as_str() {
                let _: Value = self.request("canvas",json!({"name":name,"request":{"operation":"release","instance":instance}}))?;
            }
            anyhow::bail!("Notebook page closed");
        }
        Ok(Response::builder().header("Content-Type","application/json").header("Cache-Control","no-store")
            .body(serde_json::to_vec(&result)?)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn renderer_never_supplies_private_consent() {
        for value in [json!({"operation":"decide","instance":"a","allow":true,"ticket":"forged"}),
            json!({"operation":"act","instance":"a","operationId":"b","action":"archive","params":{},"allow":true})] {
            assert!(serde_json::from_value::<Input>(value).is_err());
        }
    }
}
