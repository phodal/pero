//! Connection-owned, managed MCP sessions. No executable or URL comes from a tool call.
use reqwest::header;
use rmcp::{
    model::CallToolRequestParams,
    service::RunningService,
    transport::{
        auth::{
            AuthClient, AuthorizationManager, AuthorizationMetadata, OAuthClientConfig,
            StoredCredentials,
        },
        streamable_http_client::StreamableHttpClientTransportConfig,
        StreamableHttpClientTransport,
    },
    RoleClient, ServiceExt,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use url::Url;

type Result<T> = std::result::Result<T, &'static str>;
const LIMIT: usize = 131072;
fn default_oauth_registration() -> String {
    "preregistered".to_owned()
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct FilePin {
    path: PathBuf,
    sha256: String,
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct OAuth {
    issuer: String,
    #[serde(default)]
    client_id: String,
    redirect_uri: String,
    #[serde(default = "default_oauth_registration")]
    registration: String,
    #[serde(default)]
    scopes: Vec<String>,
    #[serde(default)]
    persist: bool,
}
#[derive(Clone, Deserialize)]
#[serde(untagged)]
enum Binding {
    Text(String),
    Secret(SecretRef),
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SecretRef {
    secret_ref: String,
}
fn default_timeout() -> u64 {
    5000
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Connector {
    transport: String,
    tools: Vec<String>,
    command: Option<PathBuf>,
    sha256: Option<String>,
    cwd: Option<PathBuf>,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    files: Vec<FilePin>,
    url: Option<String>,
    oauth: Option<OAuth>,
    app_secret: Option<SecretRef>,
    #[serde(default)]
    allow_loopback_http: bool,
    #[serde(default)]
    env: BTreeMap<String, Binding>,
    #[serde(default)]
    headers: BTreeMap<String, Binding>,
    #[serde(default = "default_timeout")]
    call_timeout_ms: u64,
    #[serde(default = "default_timeout")]
    initialize_timeout_ms: u64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Request {
    request_id: String,
    connector_id: String,
    session_id: String,
    method: String,
    name: Option<String>,
    arguments: Option<Value>,
    callback: Option<Callback>,
    #[serde(default)]
    apps: bool,
    timeout_ms: Option<u64>,
    lease_ms: Option<u64>,
    // Inserted only by the trusted native supervisor; never accepted from its client.
    definition: Option<Connector>,
    #[serde(default)]
    secrets: BTreeMap<String, String>,
    credentials: Option<Value>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Callback {
    code: String,
    state: String,
    iss: Option<String>,
}

fn verify_file(path: &Path, digest: &str) -> Result<()> {
    if !crate::platform::is_canonical_absolute(path).map_err(|_| "MCP_CONFIG")? {
        return Err("MCP_CONFIG");
    }
    let bytes = std::fs::read(path).map_err(|_| "MCP_CONFIG")?;
    if format!("{:x}", Sha256::digest(bytes)) != digest {
        return Err("MCP_INTEGRITY");
    }
    Ok(())
}
fn endpoint(value: &str, allow_loopback: bool) -> Result<Url> {
    let u = Url::parse(value).map_err(|_| "MCP_CONFIG")?;
    if !u.username().is_empty()
        || u.password().is_some()
        || u.fragment().is_some()
        || u.host_str().is_none()
        || !(u.scheme() == "https"
            || allow_loopback && u.scheme() == "http" && u.host_str() == Some("127.0.0.1"))
    {
        return Err("MCP_CONFIG");
    }
    Ok(u)
}
async fn line(reader: &mut (impl AsyncBufRead + Unpin), limit: usize) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader
        .take((limit + 1) as u64)
        .read_until(b'\n', &mut bytes)
        .await
        .map_err(|_| "MCP_IO")?;
    if bytes.len() > limit || bytes.last() != Some(&b'\n') {
        return Err("MCP_FRAME");
    }
    Ok(bytes)
}
struct State {
    spec: Connector,
    connector: String,
    id: String,
    peer: Option<RunningService<RoleClient, rmcp::model::ClientInfo>>,
    apps: bool,
    child: Option<tokio::process::Child>,
    bounded_reader: Option<tokio::task::JoinHandle<()>>,
    http: reqwest::Client,
    auth: Option<AuthClient<reqwest::Client>>,
    gitlab: Option<crate::gitlab::GitLabClient>,
    github: Option<crate::github::GitHubClient>,
    linear: Option<crate::linear::LinearClient>,
    m365: Option<crate::m365::Microsoft365Client>,
    gmail: Option<crate::gmail::GmailClient>,
    tools: Vec<Value>,
    // Every tool name the server offered, before the allowlist narrowed it.
    // A settings surface cannot ask which tools to admit if it can only see
    // the ones already admitted, so discovery and admission are kept apart.
    // Names only: descriptions are the field most likely to carry text aimed
    // at a reader, and choosing a tool does not require reading its prose.
    catalog: Vec<String>,
    credentials: crate::credentials::Mirror,
    environment: BTreeMap<String, String>,
}
fn bindings(
    values: &BTreeMap<String, Binding>,
    secrets: &BTreeMap<String, String>,
    headers: bool,
) -> Result<BTreeMap<String, String>> {
    if values.len() > 64 {
        return Err("MCP_CONFIG");
    }
    let mut result = BTreeMap::new();
    for (key, binding) in values {
        let upper = key.to_ascii_uppercase();
        if key.is_empty()
            || key.len() > 128
            || !key
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || (headers && b == b'-'))
        {
            return Err("MCP_CONFIG");
        }
        if headers {
            if [
                "HOST",
                "COOKIE",
                "CONTENT-LENGTH",
                "CONTENT-TYPE",
                "TRANSFER-ENCODING",
                "CONNECTION",
                "ACCEPT",
                "ORIGIN",
                "MCP-SESSION-ID",
                "MCP-PROTOCOL-VERSION",
            ]
            .contains(&upper.as_str())
            {
                return Err("MCP_CONFIG");
            }
            if upper == "AUTHORIZATION" && matches!(binding, Binding::Text(_)) {
                return Err("MCP_SECRET_REQUIRED");
            }
        } else if upper.starts_with("DYLD_")
            || upper.starts_with("LD_")
            || [
                "NODE_OPTIONS",
                "NODE_PATH",
                "PYTHONPATH",
                "PYTHONHOME",
                "RUBYOPT",
                "PERL5OPT",
                "BASH_ENV",
                "ENV",
            ]
            .contains(&upper.as_str())
        {
            return Err("MCP_CONFIG");
        }
        let value = match binding {
            Binding::Text(value) => value,
            Binding::Secret(reference) => secrets
                .get(&reference.secret_ref)
                .ok_or("MCP_SECRET_REQUIRED")?,
        };
        if value.len() > 16384
            || value.contains('\0')
            || (headers && (value.contains('\r') || value.contains('\n')))
        {
            return Err("MCP_CONFIG");
        }
        if result
            .insert(
                if headers {
                    key.to_ascii_lowercase()
                } else {
                    key.clone()
                },
                value.clone(),
            )
            .is_some()
        {
            return Err("MCP_CONFIG");
        }
    }
    Ok(result)
}
include!("session_state.rs");

fn visible(tool: &Value, audience: &str) -> bool {
    match tool.pointer("/_meta/ui/visibility") {
        None => true,
        Some(Value::Array(values)) => {
            !values.is_empty()
                && values.iter().all(|v| v == "model" || v == "app")
                && values.iter().any(|v| v == audience)
        }
        _ => false,
    }
}
impl Drop for State {
    fn drop(&mut self) {
        if let Some(child) = &mut self.child {
            if let Some(pid) = child.id() {
                crate::platform::kill_owned_group(pid);
            }
        }
    }
}
async fn worker(registry: BTreeMap<String, Connector>) {
    let owner_identity = crate::platform::Owner::capture();
    let mut input = BufReader::new(tokio::io::stdin());
    let mut output = tokio::io::stdout();
    let mut state: Option<State> = None;
    let Ok(mut terminate) = crate::platform::Termination::new() else {
        return;
    };
    let owner = async {
        loop {
            tokio::time::sleep(Duration::from_millis(100)).await;
            if owner_identity.disconnected() {
                break;
            }
        }
    };
    tokio::pin!(owner);
    let lease = tokio::time::sleep(Duration::from_secs(300));
    tokio::pin!(lease);
    loop {
        // Lease bounds idle admission. In-flight work has a separate call budget.
        let data = tokio::select! {
            result = line(&mut input, LIMIT) => match result { Ok(data) => data, Err(_) => break },
            _ = terminate.recv() => break,
            _ = &mut owner => break,
            _ = &mut lease => break,
        };
        let operation = async {
            let r: Request = serde_json::from_slice(&data).map_err(|_| "MCP_ARGUMENT")?;
            if r.request_id.is_empty()
                || r.request_id.len() > 128
                || r.session_id.len() < 16
                || r.session_id.len() > 128
            {
                return Err("MCP_IDENTITY");
            }
            if state.is_none() {
                if r.method != "mcp.session.open" {
                    return Err("MCP_NOT_OPEN");
                }
                let opened = r
                    .definition
                    .clone()
                    .or_else(|| registry.get(&r.connector_id).cloned())
                    .ok_or("MCP_CONNECTOR_DENIED")
                    .and_then(|definition| State::new(definition, &r));
                match opened {
                    Ok(opened) => state = Some(opened),
                    Err(code) => {
                        // Reply with the real code; a silent exit surfaces as MCP_WORKER_EXIT.
                        let reply = json!({"ok":false,"error":{"code":code,"message":code}});
                        let bytes = serde_json::to_vec(&reply).map_err(|_| "MCP_REPLY")?;
                        output.write_all(&bytes).await.map_err(|_| "MCP_IO")?;
                        output.write_all(b"\n").await.map_err(|_| "MCP_IO")?;
                        output.flush().await.map_err(|_| "MCP_IO")?;
                        return Err(code);
                    }
                }
            }
            let s = state.as_mut().unwrap();
            if s.id != r.session_id || s.connector != r.connector_id {
                return Err("MCP_IDENTITY");
            }
            let budget = if matches!(
                r.method.as_str(),
                "mcp.tools.call" | "mcp.apps.call" | "mcp.resources.read"
            ) {
                s.spec.call_timeout_ms
            } else {
                s.spec.initialize_timeout_ms
            };
            let timeout = r.timeout_ms.unwrap_or(budget);
            if timeout == 0 || timeout > budget || r.lease_ms.is_some_and(|n| n == 0 || n > 300000)
            {
                return Err("MCP_ARGUMENT");
            }
            let result = tokio::time::timeout(Duration::from_millis(timeout), s.dispatch(&r))
                .await
                .unwrap_or(Err("MCP_TIMEOUT"));
            let terminal = result.is_err()
                && !matches!(
                    result,
                    Err("MCP_AUTH_REQUIRED"
                        | "MCP_AUTH_CALLBACK"
                        | "MCP_TOOL_DENIED"
                        | "MCP_ARGUMENT"
                        | "GITHUB_AUTH_REQUIRED"
                        | "GITHUB_PERMISSION_DENIED"
                        | "GITHUB_RATE_LIMITED"
                        | "GITHUB_NOT_FOUND"
                        | "GITHUB_CONFLICT"
                        | "GITHUB_INVALID_ARGUMENT"
                        | "GITHUB_TEMPORARY"
                        | "GITHUB_API_FAILED"
                        | "GITLAB_AUTH_REQUIRED"
                        | "GITLAB_PERMISSION_DENIED"
                        | "GITLAB_RATE_LIMITED"
                        | "GITLAB_NOT_FOUND"
                        | "GITLAB_CONFLICT"
                        | "GITLAB_INVALID_ARGUMENT"
                        | "GITLAB_TEMPORARY"
                        | "GITLAB_API_FAILED"
                        | "LINEAR_AUTH_REQUIRED"
                        | "LINEAR_PERMISSION_DENIED"
                        | "LINEAR_RATE_LIMITED"
                        | "LINEAR_INVALID_ARGUMENT"
                        | "LINEAR_TEMPORARY"
                        | "LINEAR_API_FAILED"
                        | "GMAIL_PERMISSION_DENIED"
                        | "GMAIL_RATE_LIMITED"
                        | "GMAIL_API_FAILED"
                        | "M365_PERMISSION_DENIED"
                        | "M365_RATE_LIMITED"
                        | "M365_GRAPH_FAILED")
                );
            let mut reply = match result {
                Ok(result) => {
                    json!({"ok":true,"value":{"requestId":r.request_id,"sessionId":s.id,"connectorId":s.connector,"result":result,"workerPid":std::process::id(),"serverPid":s.child.as_ref().and_then(|c|c.id()),"protocolVersion":s.peer.as_ref().and_then(|p|p.peer_info()).map(|p|p.protocol_version.to_string()).or_else(|| s.gitlab.as_ref().map(|_| "point-gitlab-v1".to_owned())).or_else(|| s.github.as_ref().map(|_| "point-github-v1".to_owned())).or_else(|| s.linear.as_ref().map(|_| "point-linear-v1".to_owned())).or_else(|| s.m365.as_ref().map(|_| "point-m365-v1".to_owned())).or_else(|| s.gmail.as_ref().map(|_| "point-gmail-v1".to_owned()))}})
                }
                Err(code) => json!({"ok":false,"error":{"code":code,"message":code}}),
            };
            if s.spec.oauth.as_ref().is_some_and(|o| o.persist) {
                reply["credentialsSnapshot"] = if let Some(client) = &s.gmail {
                    client.snapshot()?
                } else if let Some(client) = &s.m365 {
                    client.snapshot()?
                } else {
                    serde_json::to_value(s.credentials.0.lock().unwrap().clone())
                        .map_err(|_| "MCP_AUTH_STORE")?
                };
            }
            let bytes = serde_json::to_vec(&reply).map_err(|_| "MCP_REPLY")?;
            if bytes.len() > 2097152 {
                return Err("MCP_REPLY_LIMIT");
            }
            output.write_all(&bytes).await.map_err(|_| "MCP_IO")?;
            output.write_all(b"\n").await.map_err(|_| "MCP_IO")?;
            output.flush().await.map_err(|_| "MCP_IO")?;
            if terminal {
                return Err("MCP_RETIRED");
            }
            Ok(r.lease_ms.unwrap_or(300000))
        };
        tokio::select! {
            result = tokio::time::timeout(Duration::from_secs(300), operation) => {
                if let Ok(Ok(ms)) = result { lease.as_mut().reset(tokio::time::Instant::now() + Duration::from_millis(ms)); }
                else { break }
            },
            _ = terminate.recv() => break,
            _ = &mut owner => break,
        }
    }
    if let Some(s) = &mut state {
        s.close().await;
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PortableCatalogEntry {
    definition: Connector,
    enabled: bool,
    generation: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PortableCatalog {
    format: String,
    entries: BTreeMap<String, PortableCatalogEntry>,
}
fn decode_registry(bytes: &[u8]) -> Result<BTreeMap<String, Connector>> {
    let value: Value = serde_json::from_slice(bytes).map_err(|_| "MCP_CONFIG")?;
    if value.get("format").and_then(Value::as_str) == Some("point.mcp.catalog.v1") {
        let catalog: PortableCatalog = serde_json::from_value(value).map_err(|_| "MCP_CONFIG")?;
        if catalog.format != "point.mcp.catalog.v1" || catalog.entries.len() > 128 {
            return Err("MCP_CONFIG");
        }
        let mut registry = BTreeMap::new();
        for (id, entry) in catalog.entries {
            if entry.generation != "static"
                && (entry.generation.len() != 36
                    || !entry
                        .generation
                        .bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b) || b == b'-'))
            {
                return Err("MCP_CONFIG");
            }
            if entry.enabled {
                registry.insert(id, entry.definition);
            }
        }
        Ok(registry)
    } else {
        serde_json::from_value(value).map_err(|_| "MCP_CONFIG")
    }
}

pub fn run() {
    let Some(path) = std::env::args().nth(2) else {
        return;
    };
    let Ok(bytes) = std::fs::read(path) else {
        return;
    };
    if bytes.len() > LIMIT {
        return;
    }
    let Ok(registry) = decode_registry(&bytes) else {
        return;
    };
    if let Ok(runtime) = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
    {
        runtime.block_on(worker(registry));
        // stdin uses a blocking Tokio read. After domain cleanup has completed,
        // do not let an idle read keep a retired worker alive with its pipe open.
        runtime.shutdown_timeout(Duration::from_millis(250));
    }
}

#[cfg(test)]
mod registry_tests {
    use super::*;
    #[test]
    fn portable_catalog_excludes_disabled_and_preserves_raw_format() {
        let definition = json!({"transport":"builtin","tools":["table_summary"]});
        let raw = serde_json::to_vec(&json!({"point.table":definition})).unwrap();
        assert_eq!(decode_registry(&raw).unwrap().len(), 1);
        let bytes = serde_json::to_vec(&json!({"format":"point.mcp.catalog.v1","entries":{
            "active":{"definition":definition,"enabled":true,"generation":"00000000-0000-0000-0000-000000000000"},
            "disabled":{"definition":definition,"enabled":false,"generation":"00000000-0000-0000-0000-000000000001"}
        }})).unwrap();
        let registry = decode_registry(&bytes).unwrap();
        assert!(registry.contains_key("active"));
        assert!(!registry.contains_key("disabled"));
    }
    #[test]
    fn malformed_portable_catalog_fails_closed() {
        assert!(
            decode_registry(br#"{"format":"point.mcp.catalog.v1","entries":{},"secrets":{}}"#)
                .is_err()
        );
        assert!(decode_registry(br#"{"format":"point.mcp.catalog.v1","entries":{"bad":{"definition":{"transport":"builtin","tools":[]},"enabled":true,"generation":"bad"}}}"#).is_err());
    }
    #[test]
    fn migrated_static_entry_remains_readable_without_changing_its_identity() {
        let bytes = br#"{"format":"point.mcp.catalog.v1","entries":{"point.table":{"definition":{"transport":"builtin","tools":["table_summary"]},"enabled":true,"generation":"static"}}}"#;
        assert!(decode_registry(bytes).unwrap().contains_key("point.table"));
    }
}
