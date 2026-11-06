//! App declarations compile schemas once; preparation returns bounded frozen context.
use super::{AppName, AppStore, definition::AppWriteRoute};
use serde_json::Value;
use std::io::Read;

pub(crate) struct AgentContextPreparation {
    route: AppWriteRoute,
    input: jsonschema::Validator,
    context: jsonschema::Validator,
}
impl std::fmt::Debug for AgentContextPreparation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AgentContextPreparation")
            .field("route", &self.route)
            .finish_non_exhaustive()
    }
}
impl AgentContextPreparation {
    pub fn compile(route: AppWriteRoute, context: &Value) -> Result<Self, String> {
        if !context.is_object()
            || serde_json::to_vec(context)
                .map_err(|e| e.to_string())?
                .len()
                > 16384
        {
            return Err("App contextSchema must be a bounded JSON schema".into());
        }
        Ok(Self {
            input: jsonschema::validator_for(&route.schema).map_err(|e| e.to_string())?,
            context: jsonschema::validator_for(context).map_err(|e| e.to_string())?,
            route,
        })
    }
    fn admit(
        value: &Value,
        schema: &jsonschema::Validator,
        limit: usize,
        label: &str,
    ) -> Result<(), String> {
        if !value.is_object()
            || serde_json::to_vec(value).map_err(|e| e.to_string())?.len() > limit
            || !schema.is_valid(value)
        {
            return Err(format!("App {label} does not match its bounded schema"));
        }
        Ok(())
    }
}
impl AppStore {
    pub fn validate_agent_context(
        &self,
        name: &AppName,
        context: Option<&Value>,
    ) -> Result<(), String> {
        let app = self.installed.get(name).ok_or("App is not installed")?;
        if let Some(preparation) = app
            .definition
            .contributes
            .agent_plugin
            .as_ref()
            .and_then(|plugin| plugin.preparation.as_ref())
        {
            AgentContextPreparation::admit(
                context.ok_or("Prepare App context before starting this Run")?,
                &preparation.context,
                16384,
                "context",
            )?;
        }
        Ok(())
    }
    pub fn prepare_agent_context(&mut self, name: &AppName, input: Value) -> Result<Value, String> {
        self.require_agent(name)?;
        let preparation = self
            .installed
            .get(name)
            .and_then(|app| app.definition.contributes.agent_plugin.as_ref())
            .and_then(|plugin| plugin.preparation.clone())
            .ok_or("This App declares no preparation method")?;
        AgentContextPreparation::admit(&input, &preparation.input, 65536, "preparation input")?;
        let backend = self
            .resolve(name)?
            .backend
            .ok_or("App backend is unavailable")?;
        let response = reqwest::blocking::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(|e| e.to_string())?
            .post(format!("{}{}", backend.url, preparation.route.path))
            .header("X-Pero-App-Token", backend.token)
            .header("Content-Type", "application/json")
            .body(serde_json::to_vec(&input).map_err(|e| e.to_string())?)
            .send()
            .map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err(format!("App preparation failed ({})", response.status()));
        }
        let mut bytes = Vec::new();
        response
            .take(16385)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > 16384 {
            return Err("App preparation context exceeds 16 KiB".into());
        }
        let context: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        AgentContextPreparation::admit(&context, &preparation.context, 16384, "prepared context")?;
        Ok(context)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn preparation_admission() {
        let schema = json!({"type":"object","properties":{"source":{"type":"string","minLength":1}},"required":["source"],"additionalProperties":false});
        let route = AppWriteRoute {
            name: AppName::try_from("prepare".to_owned()).unwrap(),
            description: "Freeze source".into(),
            path: "/api/prepare".into(),
            schema: schema.clone(),
        };
        let preparation = AgentContextPreparation::compile(route, &schema).unwrap();
        for (value, limit, accepted) in [
            (json!({"source":"PAYMENT"}), 16384, true),
            (json!({"source":""}), 16384, false),
            (json!({"source":"PAYMENT","extra":true}), 16384, false),
            (json!({}), 16384, false),
            (json!([]), 16384, false),
            (json!({"source":"字".repeat(6000)}), 16384, false),
        ] {
            assert_eq!(
                AgentContextPreparation::admit(&value, &preparation.context, limit, "context")
                    .is_ok(),
                accepted
            );
        }
    }
}
