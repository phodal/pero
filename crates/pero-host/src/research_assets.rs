//! The narrow Paper → Data handoff. Only server-owned approved assets cross Apps.
use pero_runtime::apps::{AppName, AppPreparation, AppStore, BackendAccess};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;
use std::{io::Read, time::Duration};

const MAX_RESPONSE_BYTES: u64 = 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(try_from = "String", into = "String")]
pub(crate) struct ResearchId(String);

impl TryFrom<String> for ResearchId {
    type Error = String;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.len() != 64 || !value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
            return Err("Research IDs must be 64 lowercase hexadecimal characters".into());
        }
        Ok(Self(value))
    }
}
impl From<ResearchId> for String {
    fn from(value: ResearchId) -> Self { value.0 }
}

/// Browser input is an operation and opaque IDs, never a URL or asset descriptor.
#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "lowercase", rename_all_fields = "camelCase", deny_unknown_fields)]
pub(crate) enum ResearchAssetsRequest {
    Start { bundle_id: ResearchId, asset_id: ResearchId },
    Status { bundle_id: ResearchId, asset_id: Option<ResearchId> },
    Cancel { bundle_id: ResearchId, asset_id: Option<ResearchId> },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetScope<'a> {
    bundle_id: &'a ResearchId,
    #[serde(skip_serializing_if = "Option::is_none")]
    asset_id: Option<&'a ResearchId>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ApprovedAsset {
    id: ResearchId,
    name: String,
    kind: String,
    filename: String,
    size: u64,
    license: String,
    revision: String,
    source_url: String,
    url: String,
    sha256: String,
    bundle_id: ResearchId,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ApprovedBundle { bundle_id: ResearchId }

#[derive(Serialize)]
struct DownloadRequest {
    #[serde(flatten)]
    asset: ApprovedAsset,
    confirmed: bool,
}

/// Private backend capabilities resolved while the App catalog is locked.
pub(crate) struct ResearchAssetHandoff {
    paper: BackendAccess,
    data: BackendAccess,
}

impl ResearchAssetHandoff {
    pub(crate) fn resolve(
        store: &mut AppStore,
        caller: &AppName,
        progress: &mut impl FnMut(AppPreparation),
    ) -> Result<Self, String> {
        if caller.as_str() != "paper-agent" {
            return Err("Research asset handoff is reserved for Paper".into());
        }
        store.require_grant(caller, "research-assets")?;
        // No target, path or backend capability comes from the caller.
        let target = AppName::try_from("data".to_owned())?;
        let data = store.resolve_with_progress(&target, progress)
            .map_err(|error| format!("Data App is unavailable: {error}"))?.backend
            .ok_or("Data has no backend")?;
        let paper = store.resolve_with_progress(caller, progress)?.backend
            .ok_or("Paper has no backend")?;
        Ok(Self { paper, data })
    }

    pub(crate) fn execute(self, request: ResearchAssetsRequest) -> Result<Value, String> {
        let scope = match &request {
            ResearchAssetsRequest::Start { bundle_id, asset_id } => AssetScope { bundle_id, asset_id: Some(asset_id) },
            ResearchAssetsRequest::Status { bundle_id, asset_id }
            | ResearchAssetsRequest::Cancel { bundle_id, asset_id } => AssetScope { bundle_id, asset_id: asset_id.as_ref() },
        };
        let client = reqwest::blocking::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(6))
            .build().map_err(|error| error.to_string())?;
        // Paper alone owns approvals. Status/cancel must prove the same scope too.
        let asset = if let Some(asset_id) = scope.asset_id {
            let asset: ApprovedAsset = post(&client, &self.paper, "/api/research/handoff", &scope)?;
            if asset.bundle_id != *scope.bundle_id || asset.id != *asset_id {
                return Err("Paper returned a different approved research asset".into());
            }
            Some(asset)
        } else {
            let bundle: ApprovedBundle = post(&client, &self.paper, "/api/research/handoff", &scope)?;
            if bundle.bundle_id != *scope.bundle_id {
                return Err("Paper returned a different research bundle".into());
            }
            None
        };
        match request {
            ResearchAssetsRequest::Start { .. } => post(&client, &self.data, "/api/research-download",
                &DownloadRequest { asset: asset.expect("Start has an approved asset"), confirmed: true }),
            ResearchAssetsRequest::Status { .. } => post(&client, &self.data, "/api/research-status", &scope),
            ResearchAssetsRequest::Cancel { .. } => post(&client, &self.data, "/api/research-cancel", &scope),
        }
    }
}

fn post<T: Serialize, R: DeserializeOwned>(
    client: &reqwest::blocking::Client,
    backend: &BackendAccess,
    path: &str,
    body: &T,
) -> Result<R, String> {
    let response = client.post(format!("{}{path}", backend.url))
        .header("X-Pero-App-Token", &backend.token)
        .json(body).send().map_err(|_| "Research App backend is unavailable or timed out".to_string())?;
    if !response.status().is_success() {
        return Err(format!("Research App request was refused (HTTP {})", response.status().as_u16()));
    }
    let mut bytes = Vec::new();
    response.take(MAX_RESPONSE_BYTES + 1).read_to_end(&mut bytes)
        .map_err(|_| "Research App response could not be read".to_string())?;
    if bytes.len() as u64 > MAX_RESPONSE_BYTES {
        return Err("Research App response exceeds 1 MiB".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "Research App returned an invalid response".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::{fs, path::PathBuf, sync::atomic::{AtomicU64, Ordering}};

    fn bundle() -> String { "a".repeat(64) }
    fn asset() -> String { "b".repeat(64) }
    fn descriptor() -> Value {
        json!({"id":asset(),"bundleId":bundle(),"name":"Fixture weights","kind":"model",
            "filename":"weights.bin","size":12,"license":"MIT","revision":"c".repeat(40),
            "sourceUrl":"https://huggingface.co/test/model","url":format!("https://huggingface.co/test/model/resolve/{}/weights.bin", "c".repeat(40)),
            "sha256":"d".repeat(64)})
    }
    fn request(operation: &str, with_asset: bool) -> ResearchAssetsRequest {
        let mut value = json!({"operation":operation,"bundleId":bundle()});
        if with_asset { value["assetId"] = json!(asset()); }
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn browser_input_is_only_an_operation_and_research_scope() {
        for (value, accepted) in [
            (json!({"operation":"start","bundleId":bundle(),"assetId":asset()}), true),
            (json!({"operation":"status","bundleId":bundle()}), true),
            (json!({"operation":"cancel","bundleId":bundle(),"assetId":asset()}), true),
            (json!({"operation":"start","bundleId":bundle()}), false),
            (json!({"operation":"status"}), false),
            (json!({"operation":"status","bundleId":"../data"}), false),
            (json!({"operation":"start","bundleId":bundle(),"assetId":"b".repeat(63)}), false),
            (json!({"operation":"start","bundleId":bundle(),"assetId":asset(),"url":"https://other.test/file"}), false),
            (json!({"operation":"start","bundleId":bundle(),"assetId":asset(),"descriptor":descriptor()}), false),
            (json!({"operation":"status","bundleId":bundle(),"target":"other"}), false),
            (json!({"operation":"delete","bundleId":bundle()}), false),
        ] {
            assert_eq!(serde_json::from_value::<ResearchAssetsRequest>(value.clone()).is_ok(), accepted, "{value}");
        }
    }

    struct Fixture { root: PathBuf, store: Option<AppStore> }
    impl Fixture {
        fn new(paper_enabled: bool, data_enabled: bool, grant: bool) -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let root = std::env::temp_dir().join(format!("pero-research-host-{}-{}-{}", std::process::id(),
                std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos(), NEXT.fetch_add(1, Ordering::Relaxed)));
            for (name, enabled) in [("paper-agent", paper_enabled), ("data", data_enabled), ("other-app", true)] {
                let package = root.join("apps").join(name);
                fs::create_dir_all(&package).unwrap();
                fs::write(package.join("index.html"), "fixture").unwrap();
                fs::write(package.join("server.py"), SERVER).unwrap();
                fs::write(package.join("app.json"), json!({"schemaVersion":1,"name":name,"version":"1","displayName":name,
                    "contributes":{"panels":[{"id":"main","title":"Fixture","entry":"index.html"}]},
                    "permissions":{"host":if grant {vec!["research-assets"]} else {vec![]}},
                    "backend":{"type":"python","entry":"server.py"}}).to_string()).unwrap();
                fs::write(package.join(".installation.json"), json!({"enabled":enabled}).to_string()).unwrap();
                fs::write(package.join("response.json"), json!({"value":if name == "paper-agent" { descriptor() } else { json!({"state":"queued","id":asset()}) }}).to_string()).unwrap();
            }
            let store = AppStore::open(root.join("apps"), Default::default()).unwrap();
            Self { root, store: Some(store) }
        }
        fn resolve(&mut self, caller: &str) -> Result<ResearchAssetHandoff, String> {
            ResearchAssetHandoff::resolve(self.store.as_mut().unwrap(), &AppName::try_from(caller.to_owned()).unwrap(), &mut |_| {})
        }
        fn reply(&self, app: &str, value: Value) {
            fs::write(self.root.join("apps").join(app).join("response.json"), value.to_string()).unwrap();
        }
        fn calls(&self, app: &str) -> Vec<Value> {
            fs::read_to_string(self.root.join("app-data").join(app).join("requests.jsonl"))
                .unwrap_or_default().lines().map(|line| serde_json::from_str(line).unwrap()).collect()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) { drop(self.store.take()); let _ = fs::remove_dir_all(&self.root); }
    }

    const SERVER: &str = r#"import json, os
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_POST(self):
        authenticated = self.headers.get('X-Pero-App-Token') == os.environ['PERO_APP_TOKEN']
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', '0'))))
        with (Path(os.environ['PERO_APP_DATA']) / 'requests.jsonl').open('a') as log:
            log.write(json.dumps({'path': self.path, 'body': body, 'authenticated': authenticated}) + '\n')
        config = json.loads(Path('response.json').read_text())
        payload = (b'x' * (1024 * 1024 + 1)) if config.get('oversized') else json.dumps(config.get('value')).encode()
        self.send_response(config.get('status', 200) if authenticated else 403)
        if config.get('location'): self.send_header('Location', config['location'])
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
server = HTTPServer(('127.0.0.1', 0), Handler)
print(json.dumps({'port': server.server_port}), flush=True)
server.serve_forever()
"#;

    #[test]
    fn only_enabled_paper_with_the_explicit_grant_can_reach_enabled_data() {
        for (caller, paper_enabled, data_enabled, grant, accepted) in [
            ("paper-agent", true, true, true, true),
            ("other-app", true, true, true, false),
            ("paper-agent", false, true, true, false),
            ("paper-agent", true, false, true, false),
            ("paper-agent", true, true, false, false),
        ] {
            let mut fixture = Fixture::new(paper_enabled, data_enabled, grant);
            assert_eq!(fixture.resolve(caller).is_ok(), accepted, "{caller}/{paper_enabled}/{data_enabled}/{grant}");
            assert!(fixture.calls("data").is_empty());
        }
    }

    #[test]
    fn approved_handoff_and_scoped_receipts_use_authenticated_fixed_backends() {
        let mut fixture = Fixture::new(true, true, true);
        for (operation, with_asset) in [("start", true), ("status", true), ("cancel", true), ("status", false), ("cancel", false)] {
            fixture.reply("paper-agent", json!({"value":if with_asset {descriptor()} else {json!({"bundleId":bundle()})}}));
            let receipt = fixture.resolve("paper-agent").unwrap().execute(request(operation, with_asset)).unwrap();
            assert_eq!(receipt, json!({"state":"queued","id":asset()}));
            let paper = fixture.calls("paper-agent").pop().unwrap();
            let data = fixture.calls("data").pop().unwrap();
            assert_eq!(paper["path"], "/api/research/handoff");
            assert_eq!(paper["authenticated"], true);
            assert_eq!(data["authenticated"], true);
            let mut scope = json!({"bundleId":bundle()});
            if with_asset { scope["assetId"] = json!(asset()); }
            assert_eq!(paper["body"], scope);
            if operation == "start" {
                let mut expected = descriptor(); expected["confirmed"] = json!(true);
                assert_eq!(data["body"], expected);
                assert_eq!(data["path"], "/api/research-download");
            } else {
                assert_eq!(data["body"], scope);
                assert_eq!(data["path"], format!("/api/research-{operation}"));
            }
        }
    }

    #[test]
    fn unapproved_mismatched_redirected_and_oversized_replies_do_not_reach_data() {
        let mut fixture = Fixture::new(true, true, true);
        let mut mismatched = descriptor(); mismatched["id"] = json!("e".repeat(64));
        let mut wrong_bundle = descriptor(); wrong_bundle["bundleId"] = json!("e".repeat(64));
        for reply in [
            json!({"status":403,"value":{"error":"not approved"}}),
            json!({"value":mismatched}), json!({"value":wrong_bundle}),
            json!({"value":{"bundleId":bundle()}}), json!({"oversized":true}),
            json!({"status":302,"location":"http://127.0.0.1:1/not-followed","value":descriptor()}),
        ] {
            fixture.reply("paper-agent", reply);
            assert!(fixture.resolve("paper-agent").unwrap().execute(request("start", true)).is_err());
            assert!(fixture.calls("data").is_empty());
        }
        fixture.reply("paper-agent", json!({"value":{"bundleId":"f".repeat(64)}}));
        assert!(fixture.resolve("paper-agent").unwrap().execute(request("cancel", false)).is_err());
        assert!(fixture.calls("data").is_empty());
        fixture.reply("paper-agent", json!({"value":descriptor()}));
        fixture.reply("data", json!({"oversized":true}));
        assert!(fixture.resolve("paper-agent").unwrap().execute(request("start", true)).unwrap_err().contains("1 MiB"));
    }
}
