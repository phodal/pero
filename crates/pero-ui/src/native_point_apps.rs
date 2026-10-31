//! Point wire protocol for the native shell. No installation or session state.
use hmac::{Hmac, Mac};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::path::Path;

#[derive(Deserialize)]
pub(super) struct PointApp {
    pub name: String,
    #[serde(default)] pub permissions: Permissions,
    pub backend: Option<Backend>,
}
#[derive(Default, Deserialize)]
pub(super) struct Permissions {
    #[serde(default)] pub api: Vec<String>,
    #[serde(default)] pub storage: bool,
}
#[derive(Deserialize)]
pub(super) struct Backend { #[serde(rename="maxBodyBytes")] pub max_body_bytes: Option<usize> }
impl PointApp {
    pub fn read(root: &Path) -> anyhow::Result<Option<Self>> {
        let marker = root.join("point-build.json");
        if !marker.is_file() { return Ok(None); }
        let receipt: serde_json::Value = serde_json::from_slice(&std::fs::read(marker)?)?;
        if receipt["schema"] != "pero.point-app-build.v2" { return Ok(None); }
        Ok(Some(serde_json::from_slice(&std::fs::read(root.join("point-source/app.json"))?)?))
    }
    pub fn target(&self, target: &str) -> anyhow::Result<String> {
        let prefix = format!("/apps/{}", self.name);
        let path = target.split('?').next().unwrap_or(target);
        let decoded = percent_encoding::percent_decode_str(path).decode_utf8()?;
        anyhow::ensure!(path.starts_with(&format!("{prefix}/api/")) && !decoded.contains('\\')
            && !decoded.split('/').any(|part| matches!(part, "." | ".."))
            && self.permissions.api.iter().any(|allowed| decoded == *allowed || decoded.starts_with(&format!("{allowed}/"))), "Point App API permission denied");
        Ok(target[prefix.len()..].to_string())
    }
    pub fn limit(&self) -> usize { self.backend.as_ref().and_then(|backend| backend.max_body_bytes).unwrap_or(1048576) }
}
pub(super) fn signature(secret: &str, method: &str, target: &str, body: &[u8], seconds: u64) -> String {
    let digest = format!("{:x}", Sha256::digest(body));
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("HMAC accepts any key");
    mac.update(format!("{seconds}:{method}:{target}:{digest}").as_bytes());
    format!("{seconds}:{:x}", mac.finalize().into_bytes())
}
pub(super) fn forward_header(name: &str, response: bool) -> bool {
    let name = name.to_ascii_lowercase();
    !matches!(name.as_str(), "connection"|"keep-alive"|"proxy-authenticate"|"proxy-authorization"|"te"|"trailer"|"transfer-encoding"|"upgrade")
        && if response { !matches!(name.as_str(), "content-length"|"content-encoding") }
        else { !matches!(name.as_str(), "host"|"authorization"|"cookie"|"x-point-app-proxy"|"x-pero-app-token"|"x-point-app-agent"|"x-point-app-execution"|"x-point-app-execution-proof"|"x-point-app-react-host") }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn point_wire_protocol() {
        assert!(serde_json::from_value::<PointApp>(serde_json::json!({"name":"minimal"})).is_ok());
        let app: PointApp = serde_json::from_value(serde_json::json!({"name":"map","permissions":{"api":["/apps/map/api"]}})).unwrap();
        assert_eq!(app.target("/apps/map/api/document?part=a%2Fb").unwrap(), "/api/document?part=a%2Fb");
        for path in ["/apps/other/api/document", "/api/projects", "/apps/map/api/a%5Cprivate", "/apps/map/api/../private"] { assert!(app.target(path).is_err(), "{path}"); }
        assert_eq!(signature("secret", "PUT", "/api/document?part=a%2Fb", &[0,255,13,10], 1793440000), "1793440000:3cfc301fee91e4c97ec16599e83e912a9a0a32d86d3891f1aed7008363ba6476");
    }
}
