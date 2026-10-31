use chrono::DateTime;
use oauth2::{CsrfToken, PkceCodeChallenge};
use reqwest::{header, Client as HttpClient, Response, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    collections::BTreeSet,
    time::{SystemTime, UNIX_EPOCH},
};
use url::Url;

type Result<T> = std::result::Result<T, &'static str>;
// The MCP reply carries both text and structured JSON, so leave room for duplication.
const BODY_LIMIT: usize = 786_432;
const TOKEN_LIMIT: usize = 131_072;
const KNOWN_SCOPES: [&str; 6] = [
    "offline_access",
    "User.Read",
    "Mail.ReadBasic",
    "Mail.Read",
    "Calendars.Read",
    "Files.Read",
];
const KNOWN_TOOLS: [&str; 6] = [
    "m365_account_get",
    "m365_mail_list",
    "m365_mail_get",
    "m365_calendar_list",
    "m365_drive_list",
    "m365_drive_item_get",
];

fn now() -> Result<u64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|v| v.as_secs())
        .map_err(|_| "MCP_AUTH_STORE")
}

async fn bounded(response: &mut Response, limit: usize, code: &'static str) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| code)? {
        if bytes.len() + chunk.len() > limit {
            return Err(code);
        }
        bytes.extend(chunk);
    }
    Ok(bytes)
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Credentials {
    version: u8,
    token_type: String,
    access_token: String,
    refresh_token: Option<String>,
    expires_at: u64,
    granted_scopes: Vec<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
    token_type: String,
    access_token: String,
    refresh_token: Option<String>,
    expires_in: u64,
    scope: Option<String>,
}

struct PendingAuthorization {
    state: String,
    verifier: String,
}

pub struct Microsoft365Client {
    graph: Url,
    issuer: Url,
    client_id: String,
    redirect_uri: String,
    scopes: Vec<String>,
    tools: Vec<String>,
    http: HttpClient,
    credentials: Option<Credentials>,
    pending: Option<PendingAuthorization>,
}

fn uuid(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && [8, 13, 18, 23].iter().all(|i| bytes[*i] == b'-')
        && bytes
            .iter()
            .enumerate()
            .all(|(i, b)| [8, 13, 18, 23].contains(&i) || b.is_ascii_hexdigit())
        && matches!(bytes[14], b'1'..=b'5')
        && matches!(bytes[19].to_ascii_lowercase(), b'8' | b'9' | b'a' | b'b')
}

fn scope_allows(scopes: &[String], tool: &str) -> bool {
    match tool {
        "m365_account_get" => scopes.iter().any(|s| s == "User.Read"),
        "m365_mail_list" => scopes
            .iter()
            .any(|s| s == "Mail.ReadBasic" || s == "Mail.Read"),
        "m365_mail_get" => scopes.iter().any(|s| s == "Mail.Read"),
        "m365_calendar_list" => scopes.iter().any(|s| s == "Calendars.Read"),
        "m365_drive_list" | "m365_drive_item_get" => scopes.iter().any(|s| s == "Files.Read"),
        _ => false,
    }
}

fn validate_issuer(url: &Url) -> Result<()> {
    let parts: Vec<_> = url
        .path_segments()
        .ok_or("MCP_CONFIG")?
        .filter(|p| !p.is_empty())
        .collect();
    if url.scheme() != "https"
        || url.host_str() != Some("login.microsoftonline.com")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || parts.len() != 2
        || parts[1] != "v2.0"
        || !(parts[0] == "organizations" || uuid(parts[0]))
    {
        return Err("MCP_CONFIG");
    }
    Ok(())
}

impl Microsoft365Client {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        graph: &str,
        issuer: &str,
        client_id: &str,
        redirect_uri: &str,
        scopes: Vec<String>,
        tools: Vec<String>,
        stored: Option<Value>,
        http: HttpClient,
    ) -> Result<Self> {
        if graph != "https://graph.microsoft.com/v1.0/" {
            return Err("MCP_CONFIG");
        }
        let graph = Url::parse(graph).map_err(|_| "MCP_CONFIG")?;
        let issuer = Url::parse(issuer).map_err(|_| "MCP_CONFIG")?;
        let redirect = Url::parse(redirect_uri).map_err(|_| "MCP_CONFIG")?;
        validate_issuer(&issuer)?;
        if graph.as_str() != "https://graph.microsoft.com/v1.0/"
            || !uuid(client_id)
            || redirect.scheme() != "http"
            || redirect.host_str() != Some("127.0.0.1")
            || redirect.port().is_none()
            || !redirect.username().is_empty()
            || redirect.password().is_some()
            || redirect.query().is_some()
            || redirect.fragment().is_some()
            || scopes.len() < 2
            || scopes.len() > KNOWN_SCOPES.len()
            || !scopes.iter().any(|s| s == "offline_access")
            || scopes.iter().any(|s| !KNOWN_SCOPES.contains(&s.as_str()))
            || scopes.iter().collect::<BTreeSet<_>>().len() != scopes.len()
            || tools.is_empty()
            || tools
                .iter()
                .any(|t| !KNOWN_TOOLS.contains(&t.as_str()) || !scope_allows(&scopes, t))
        {
            return Err("MCP_CONFIG");
        }
        let credentials = match stored {
            None | Some(Value::Null) => None,
            Some(value) => {
                let value: Credentials =
                    serde_json::from_value(value).map_err(|_| "MCP_AUTH_STORE")?;
                if value.version != 1
                    || !value.token_type.eq_ignore_ascii_case("bearer")
                    || value.access_token.is_empty()
                    || value.access_token.len() > 131072
                    || value
                        .refresh_token
                        .as_ref()
                        .is_some_and(|v| v.is_empty() || v.len() > 131072)
                {
                    return Err("MCP_AUTH_STORE");
                }
                Some(value)
            }
        };
        Ok(Self {
            graph,
            issuer,
            client_id: client_id.to_owned(),
            redirect_uri: redirect_uri.to_owned(),
            scopes,
            tools,
            http,
            credentials,
            pending: None,
        })
    }

    pub fn snapshot(&self) -> Result<Value> {
        serde_json::to_value(&self.credentials).map_err(|_| "MCP_AUTH_STORE")
    }

    fn identity_endpoint(&self, operation: &str) -> Result<Url> {
        let tenant = self
            .issuer
            .path_segments()
            .and_then(|mut parts| parts.next())
            .ok_or("MCP_CONFIG")?;
        Url::parse(&format!(
            "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/{operation}"
        ))
        .map_err(|_| "MCP_CONFIG")
    }

    pub fn begin_authorization(&mut self) -> Result<Value> {
        let state = CsrfToken::new_random();
        let (challenge, verifier) = PkceCodeChallenge::new_random_sha256();
        let mut url = self.identity_endpoint("authorize")?;
        url.query_pairs_mut()
            .append_pair("client_id", &self.client_id)
            .append_pair("response_type", "code")
            .append_pair("redirect_uri", &self.redirect_uri)
            .append_pair("response_mode", "query")
            .append_pair("scope", &self.scopes.join(" "))
            .append_pair("state", state.secret())
            .append_pair("code_challenge", challenge.as_str())
            .append_pair("code_challenge_method", "S256");
        self.credentials = None;
        self.pending = Some(PendingAuthorization {
            state: state.secret().to_owned(),
            verifier: verifier.secret().to_owned(),
        });
        Ok(json!({"authorizationUrl": url, "redirectUri": self.redirect_uri}))
    }

    pub async fn complete_authorization(
        &mut self,
        code: &str,
        state: &str,
        callback_issuer: Option<&str>,
    ) -> Result<Value> {
        let pending = self.pending.take().ok_or("MCP_AUTH_REQUIRED")?;
        if code.is_empty()
            || code.len() > 16384
            || state.len() > 1024
            || callback_issuer.is_some_and(|value| !self.callback_issuer_allowed(value))
            || pending.state != state
        {
            return Err("MCP_AUTH_CALLBACK");
        }
        let fields = [
            ("client_id", self.client_id.as_str()),
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", self.redirect_uri.as_str()),
            ("code_verifier", pending.verifier.as_str()),
        ];
        let token = self.exchange(&fields, None, "MCP_AUTH_CALLBACK").await?;
        self.credentials = Some(token);
        Ok(json!({"authorized": true}))
    }

    fn callback_issuer_allowed(&self, value: &str) -> bool {
        let Ok(url) = Url::parse(value) else {
            return false;
        };
        if validate_issuer(&url).is_err() {
            return false;
        }
        let configured = self
            .issuer
            .path_segments()
            .and_then(|mut p| p.next())
            .unwrap_or("");
        let callback = url.path_segments().and_then(|mut p| p.next()).unwrap_or("");
        configured == "organizations" || configured.eq_ignore_ascii_case(callback)
    }

    async fn exchange(
        &self,
        fields: &[(&str, &str)],
        previous_refresh: Option<&str>,
        failure: &'static str,
    ) -> Result<Credentials> {
        let mut body = url::form_urlencoded::Serializer::new(String::new());
        for (key, value) in fields {
            body.append_pair(key, value);
        }
        let token_url = self.identity_endpoint("token")?;
        let mut response = self
            .http
            .post(token_url)
            .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
            .body(body.finish())
            .send()
            .await
            .map_err(|_| failure)?;
        if !response.status().is_success() {
            return Err(failure);
        }
        let value: TokenResponse =
            serde_json::from_slice(&bounded(&mut response, TOKEN_LIMIT, failure).await?)
                .map_err(|_| failure)?;
        credentials_from_token(value, previous_refresh, &self.scopes).map_err(|_| failure)
    }

    async fn access_token(&mut self) -> Result<String> {
        if let Some(value) = &self.credentials {
            if value.expires_at > now()?.saturating_add(60) {
                return Ok(value.access_token.clone());
            }
        }
        let refresh = self
            .credentials
            .as_ref()
            .and_then(|v| v.refresh_token.clone())
            .ok_or("MCP_AUTH_REQUIRED")?;
        let scope = self.scopes.join(" ");
        let fields = [
            ("client_id", self.client_id.as_str()),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh.as_str()),
            ("scope", scope.as_str()),
        ];
        match self
            .exchange(&fields, Some(&refresh), "MCP_AUTH_REQUIRED")
            .await
        {
            Ok(value) => {
                let token = value.access_token.clone();
                self.credentials = Some(value);
                Ok(token)
            }
            Err(code) => {
                self.credentials = None;
                Err(code)
            }
        }
    }

    pub async fn ensure_authorized(&mut self) -> Result<()> {
        self.access_token().await.map(|_| ())
    }

    pub fn list_tools(&self) -> Value {
        let tools = self
            .tools
            .iter()
            .filter_map(|name| tool(name))
            .collect::<Vec<_>>();
        json!({"tools": tools})
    }

    pub async fn call(&mut self, name: &str, arguments: &Value) -> Result<Value> {
        if !self.tools.iter().any(|tool| tool == name) {
            return Err("MCP_TOOL_DENIED");
        }
        let url = self.request_url(name, arguments)?;
        self.graph_get(url).await
    }

    fn request_url(&self, name: &str, arguments: &Value) -> Result<Url> {
        let mut url = self.graph.clone();
        url.path_segments_mut()
            .map_err(|_| "MCP_CONFIG")?
            .pop_if_empty();
        match name {
            "m365_account_get" => {
                exact_object(arguments, &[], &[])?;
                url.path_segments_mut()
                    .map_err(|_| "MCP_CONFIG")?
                    .push("me");
                url.query_pairs_mut()
                    .append_pair("$select", "id,displayName,userPrincipalName,mail");
            }
            "m365_mail_list" => {
                let args = exact_object(arguments, &["limit", "cursor"], &[])?;
                url.path_segments_mut()
                    .map_err(|_| "MCP_CONFIG")?
                    .extend(["me", "messages"]);
                url.query_pairs_mut()
                    // Mail.ReadBasic excludes body, bodyPreview and attachments.
                    .append_pair(
                        "$select",
                        "id,subject,sender,receivedDateTime,sentDateTime,isRead,hasAttachments,internetMessageId",
                    )
                    .append_pair("$orderby", "receivedDateTime desc")
                    .append_pair("$top", &limit(args)?.to_string());
                append_cursor(&mut url, args)?;
            }
            "m365_mail_get" => {
                let args = exact_object(arguments, &["messageId"], &["messageId"])?;
                let id = identifier(args, "messageId")?;
                url.path_segments_mut()
                    .map_err(|_| "MCP_CONFIG")?
                    .extend(["me", "messages", id]);
                url.query_pairs_mut().append_pair(
                    "$select",
                    "id,subject,sender,toRecipients,ccRecipients,receivedDateTime,isRead,body",
                );
            }
            "m365_calendar_list" => {
                let args = exact_object(
                    arguments,
                    &["start", "end", "limit", "cursor"],
                    &["start", "end"],
                )?;
                let start = timestamp(args, "start")?;
                let end = timestamp(args, "end")?;
                if DateTime::parse_from_rfc3339(start).unwrap()
                    >= DateTime::parse_from_rfc3339(end).unwrap()
                {
                    return Err("MCP_ARGUMENT");
                }
                url.path_segments_mut()
                    .map_err(|_| "MCP_CONFIG")?
                    .extend(["me", "calendarView"]);
                url.query_pairs_mut()
                    .append_pair("startDateTime", start)
                    .append_pair("endDateTime", end)
                    .append_pair(
                        "$select",
                        "id,subject,start,end,location,organizer,isAllDay",
                    )
                    .append_pair("$orderby", "start/dateTime")
                    .append_pair("$top", &limit(args)?.to_string());
                append_cursor(&mut url, args)?;
            }
            "m365_drive_list" => {
                let args = exact_object(arguments, &["itemId", "limit", "cursor"], &[])?;
                let mut segments = url.path_segments_mut().map_err(|_| "MCP_CONFIG")?;
                segments.extend(["me", "drive"]);
                if let Some(id) = args.get("itemId") {
                    segments.push("items");
                    segments.push(identifier_value(id)?);
                } else {
                    segments.push("root");
                }
                segments.push("children");
                drop(segments);
                url.query_pairs_mut()
                    .append_pair(
                        "$select",
                        "id,name,size,lastModifiedDateTime,webUrl,file,folder,parentReference",
                    )
                    .append_pair("$top", &limit(args)?.to_string());
                append_cursor(&mut url, args)?;
            }
            "m365_drive_item_get" => {
                let args = exact_object(arguments, &["itemId"], &["itemId"])?;
                let id = identifier(args, "itemId")?;
                url.path_segments_mut()
                    .map_err(|_| "MCP_CONFIG")?
                    .extend(["me", "drive", "items", id]);
                url.query_pairs_mut().append_pair(
                    "$select",
                    "id,name,size,lastModifiedDateTime,webUrl,file,folder,parentReference",
                );
            }
            _ => return Err("MCP_TOOL_DENIED"),
        }
        Ok(url)
    }

    async fn graph_get(&mut self, url: Url) -> Result<Value> {
        if url.scheme() != "https"
            || url.host_str() != Some("graph.microsoft.com")
            || !url.path().starts_with("/v1.0/")
        {
            return Err("MCP_CONFIG");
        }
        let token = self.access_token().await?;
        let mut response = self
            .http
            .get(url)
            .bearer_auth(token)
            .header(header::ACCEPT, "application/json")
            .send()
            .await
            .map_err(|_| "MCP_CALL_FAILED_NO_REPLAY")?;
        if let Some(code) = graph_error(response.status()) {
            if code == "MCP_AUTH_REQUIRED" {
                self.credentials = None;
            }
            return Err(code);
        }
        let data: Value =
            serde_json::from_slice(&bounded(&mut response, BODY_LIMIT, "M365_GRAPH_FAILED").await?)
                .map_err(|_| "M365_GRAPH_FAILED")?;
        graph_result(data)
    }
}

fn graph_result(mut data: Value) -> Result<Value> {
    let next_cursor = data
        .as_object_mut()
        .and_then(|object| object.remove("@odata.nextLink"))
        .and_then(|v| v.as_str().and_then(extract_cursor));
    let mut wrapper = Map::new();
    wrapper.insert("source".into(), json!("microsoft-graph"));
    wrapper.insert("trusted".into(), json!(false));
    wrapper.insert("data".into(), data);
    if let Some(cursor) = next_cursor {
        wrapper.insert("nextCursor".into(), json!(cursor));
    }
    let structured = Value::Object(wrapper);
    let result = json!({"content":[{"type":"text","text":structured.to_string()}],"structuredContent":structured});
    if serde_json::to_vec(&result)
        .map_err(|_| "M365_GRAPH_FAILED")?
        .len()
        > 1_800_000
    {
        return Err("M365_GRAPH_FAILED");
    }
    Ok(result)
}

fn credentials_from_token(
    value: TokenResponse,
    previous_refresh: Option<&str>,
    requested_scopes: &[String],
) -> Result<Credentials> {
    if !value.token_type.eq_ignore_ascii_case("bearer")
        || value.access_token.is_empty()
        || value.access_token.len() > 131072
        || value.expires_in == 0
    {
        return Err("MCP_AUTH_STORE");
    }
    let refresh_token = value
        .refresh_token
        .or_else(|| previous_refresh.map(str::to_owned));
    if refresh_token
        .as_ref()
        .is_some_and(|v| v.is_empty() || v.len() > 131072)
    {
        return Err("MCP_AUTH_STORE");
    }
    let granted_scopes: Vec<String> = value
        .scope
        .map(|s| s.split_whitespace().map(str::to_owned).collect())
        .unwrap_or_else(|| requested_scopes.to_vec());
    if granted_scopes.len() > 128
        || granted_scopes
            .iter()
            .any(|scope| scope.is_empty() || scope.len() > 1024)
    {
        return Err("MCP_AUTH_STORE");
    }
    Ok(Credentials {
        version: 1,
        token_type: "Bearer".to_owned(),
        access_token: value.access_token,
        refresh_token,
        expires_at: now()?.saturating_add(value.expires_in),
        granted_scopes,
    })
}

fn graph_error(status: StatusCode) -> Option<&'static str> {
    match status {
        StatusCode::UNAUTHORIZED => Some("MCP_AUTH_REQUIRED"),
        StatusCode::FORBIDDEN => Some("M365_PERMISSION_DENIED"),
        StatusCode::TOO_MANY_REQUESTS => Some("M365_RATE_LIMITED"),
        status if !status.is_success() => Some("M365_GRAPH_FAILED"),
        _ => None,
    }
}

fn exact_object<'a>(
    value: &'a Value,
    allowed: &[&str],
    required: &[&str],
) -> Result<&'a Map<String, Value>> {
    let object = value.as_object().ok_or("MCP_ARGUMENT")?;
    if object.keys().any(|key| !allowed.contains(&key.as_str()))
        || required.iter().any(|key| !object.contains_key(*key))
    {
        return Err("MCP_ARGUMENT");
    }
    Ok(object)
}

fn identifier<'a>(object: &'a Map<String, Value>, key: &str) -> Result<&'a str> {
    identifier_value(object.get(key).ok_or("MCP_ARGUMENT")?)
}
fn identifier_value(value: &Value) -> Result<&str> {
    value
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= 1024 && !s.chars().any(char::is_control))
        .ok_or("MCP_ARGUMENT")
}
fn timestamp<'a>(object: &'a Map<String, Value>, key: &str) -> Result<&'a str> {
    let value = object
        .get(key)
        .and_then(Value::as_str)
        .ok_or("MCP_ARGUMENT")?;
    if value.len() > 40 || DateTime::parse_from_rfc3339(value).is_err() {
        return Err("MCP_ARGUMENT");
    }
    Ok(value)
}
fn limit(object: &Map<String, Value>) -> Result<u64> {
    match object.get("limit") {
        None => Ok(10),
        Some(value) => value
            .as_u64()
            .filter(|v| (1..=25).contains(v))
            .ok_or("MCP_ARGUMENT"),
    }
}
fn append_cursor(url: &mut Url, object: &Map<String, Value>) -> Result<()> {
    if let Some(value) = object.get("cursor") {
        let cursor = value
            .as_str()
            .filter(|v| !v.is_empty() && v.len() <= 4096 && !v.chars().any(char::is_control))
            .ok_or("MCP_ARGUMENT")?;
        let (kind, value) = cursor.split_once(':').ok_or("MCP_ARGUMENT")?;
        match kind {
            "skiptoken" if !value.is_empty() => {
                url.query_pairs_mut().append_pair("$skiptoken", value);
            }
            "skip" if value.parse::<u64>().is_ok() => {
                url.query_pairs_mut().append_pair("$skip", value);
            }
            _ => return Err("MCP_ARGUMENT"),
        }
    }
    Ok(())
}
fn extract_cursor(value: &str) -> Option<String> {
    let url = Url::parse(value).ok()?;
    if url.scheme() != "https"
        || url.host_str() != Some("graph.microsoft.com")
        || !url.path().starts_with("/v1.0/")
    {
        return None;
    }
    url.query_pairs().find_map(|(key, value)| {
        if value.is_empty() || value.len() > 4080 {
            return None;
        }
        match key.as_ref() {
            "$skiptoken" => Some(format!("skiptoken:{value}")),
            "$skip" if value.parse::<u64>().is_ok() => Some(format!("skip:{value}")),
            _ => None,
        }
    })
}

fn tool(name: &str) -> Option<Value> {
    let common = |properties: Value| json!({"type":"object","properties":properties,"additionalProperties":false});
    Some(match name {
        "m365_account_get" => {
            json!({"name":name,"description":"Read the signed-in Microsoft 365 account profile.","inputSchema":common(json!({}))})
        }
        "m365_mail_list" => {
            json!({"name":name,"description":"List recent Outlook messages without attachments.","inputSchema":common(json!({"limit":{"type":"integer","minimum":1,"maximum":25},"cursor":{"type":"string","maxLength":4096}}))})
        }
        "m365_mail_get" => {
            json!({"name":name,"description":"Read one Outlook message by ID.","inputSchema":{"type":"object","properties":{"messageId":{"type":"string","minLength":1,"maxLength":1024}},"required":["messageId"],"additionalProperties":false}})
        }
        "m365_calendar_list" => {
            json!({"name":name,"description":"List calendar events in an explicit RFC 3339 time window.","inputSchema":{"type":"object","properties":{"start":{"type":"string"},"end":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":25},"cursor":{"type":"string","maxLength":4096}},"required":["start","end"],"additionalProperties":false}})
        }
        "m365_drive_list" => {
            json!({"name":name,"description":"List OneDrive root items or the children of one folder.","inputSchema":common(json!({"itemId":{"type":"string","minLength":1,"maxLength":1024},"limit":{"type":"integer","minimum":1,"maximum":25},"cursor":{"type":"string","maxLength":4096}}))})
        }
        "m365_drive_item_get" => {
            json!({"name":name,"description":"Read metadata for one OneDrive item by ID.","inputSchema":{"type":"object","properties":{"itemId":{"type":"string","minLength":1,"maxLength":1024}},"required":["itemId"],"additionalProperties":false}})
        }
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn client(scopes: &[&str], tools: &[&str]) -> Result<Microsoft365Client> {
        Microsoft365Client::new(
            "https://graph.microsoft.com/v1.0/",
            "https://login.microsoftonline.com/organizations/v2.0",
            "11111111-2222-4333-8444-555555555555",
            "http://127.0.0.1:53682/oauth/callback",
            scopes.iter().map(|v| (*v).to_owned()).collect(),
            tools.iter().map(|v| (*v).to_owned()).collect(),
            None,
            HttpClient::new(),
        )
    }

    #[test]
    fn config_rejects_unknown_tools_and_missing_scope() {
        assert!(client(&["offline_access", "User.Read"], &["m365_account_get"]).is_ok());
        assert!(client(&["offline_access", "User.Read"], &["m365_mail_get"]).is_err());
        assert!(client(&["offline_access", "User.Read"], &["graph_get"]).is_err());
    }

    #[test]
    fn authorization_is_pkce_and_pinned_to_the_configured_tenant() {
        let mut client = client(&["offline_access", "User.Read"], &["m365_account_get"]).unwrap();
        let value = client.begin_authorization().unwrap();
        let url = Url::parse(value["authorizationUrl"].as_str().unwrap()).unwrap();
        assert_eq!(url.path(), "/organizations/oauth2/v2.0/authorize");
        assert_eq!(
            url.query_pairs()
                .find(|(k, _)| k == "code_challenge_method")
                .unwrap()
                .1,
            "S256"
        );
        assert!(
            url.query_pairs()
                .find(|(k, _)| k == "state")
                .unwrap()
                .1
                .len()
                >= 16
        );
        assert!(client.snapshot().unwrap().is_null());
    }

    #[test]
    fn graph_cursor_is_accepted_only_from_the_pinned_origin_and_api() {
        assert_eq!(
            extract_cursor("https://graph.microsoft.com/v1.0/me/messages?$skiptoken=abc%2B123")
                .as_deref(),
            Some("skiptoken:abc+123")
        );
        assert_eq!(
            extract_cursor("https://graph.microsoft.com/v1.0/me/messages?$skip=20").as_deref(),
            Some("skip:20")
        );
        assert!(extract_cursor("https://evil.example/v1.0/me/messages?$skiptoken=abc").is_none());
        assert!(
            extract_cursor("https://graph.microsoft.com/beta/me/messages?$skiptoken=abc").is_none()
        );
    }

    #[test]
    fn catalog_exposes_only_selected_read_tools() {
        let client = client(&["offline_access", "Files.Read"], &["m365_drive_list"]).unwrap();
        let tools = client.list_tools();
        assert_eq!(tools["tools"].as_array().unwrap().len(), 1);
        assert_eq!(tools["tools"][0]["name"], "m365_drive_list");
        assert_eq!(
            tools["tools"][0]["inputSchema"]["additionalProperties"],
            false
        );
    }

    #[test]
    fn request_builder_keeps_ids_and_queries_inside_fixed_graph_gets() {
        let m365 = client(
            &["offline_access", "Mail.Read", "Calendars.Read"],
            &["m365_mail_list", "m365_mail_get", "m365_calendar_list"],
        )
        .unwrap();
        let message = m365
            .request_url("m365_mail_get", &json!({"messageId":"a/b?c"}))
            .unwrap();
        assert_eq!(message.path(), "/v1.0/me/messages/a%2Fb%3Fc");
        let messages = m365
            .request_url("m365_mail_list", &json!({"limit":10}))
            .unwrap();
        assert!(!messages.query().unwrap().contains("bodyPreview"));
        let calendar = m365
            .request_url(
                "m365_calendar_list",
                &json!({"start":"2026-09-12T08:00:00+08:00","end":"2026-09-13T08:00:00+08:00","limit":25,"cursor":"skip:25"}),
            )
            .unwrap();
        assert_eq!(calendar.path(), "/v1.0/me/calendarView");
        assert!(calendar
            .query_pairs()
            .any(|(key, value)| key == "$skip" && value == "25"));
        assert!(m365
            .request_url(
                "m365_calendar_list",
                &json!({"start":"not-a-date","end":"2026-09-13T08:00:00Z"}),
            )
            .is_err());

        let drive = client(&["offline_access", "Files.Read"], &["m365_drive_list"])
            .unwrap()
            .request_url("m365_drive_list", &json!({}))
            .unwrap();
        assert_eq!(drive.path(), "/v1.0/me/drive/root/children");
        assert!(m365
            .request_url(
                "m365_calendar_list",
                &json!({"start":"2026-09-13T08:00:00Z","end":"2026-09-12T08:00:00Z"}),
            )
            .is_err());
    }

    #[test]
    fn token_records_and_graph_statuses_are_normalized_and_bounded() {
        let scopes = vec!["offline_access".to_owned(), "User.Read".to_owned()];
        let credentials = credentials_from_token(
            TokenResponse {
                token_type: "bearer".to_owned(),
                access_token: "access".to_owned(),
                refresh_token: None,
                expires_in: 3600,
                scope: Some("User.Read offline_access".to_owned()),
            },
            Some("old-refresh"),
            &scopes,
        )
        .unwrap();
        assert_eq!(credentials.token_type, "Bearer");
        assert_eq!(credentials.refresh_token.as_deref(), Some("old-refresh"));
        assert!(credentials_from_token(
            TokenResponse {
                token_type: "mac".to_owned(),
                access_token: "access".to_owned(),
                refresh_token: None,
                expires_in: 3600,
                scope: None,
            },
            None,
            &scopes,
        )
        .is_err());
        assert_eq!(
            graph_error(StatusCode::UNAUTHORIZED),
            Some("MCP_AUTH_REQUIRED")
        );
        assert_eq!(
            graph_error(StatusCode::FORBIDDEN),
            Some("M365_PERMISSION_DENIED")
        );
        assert_eq!(
            graph_error(StatusCode::TOO_MANY_REQUESTS),
            Some("M365_RATE_LIMITED")
        );
        assert_eq!(
            graph_error(StatusCode::BAD_GATEWAY),
            Some("M365_GRAPH_FAILED")
        );
        assert_eq!(graph_error(StatusCode::OK), None);
        let value = graph_result(json!({"value":[],"@odata.nextLink":"https://graph.microsoft.com/v1.0/me/messages?$skip=20"})).unwrap();
        assert_eq!(value["structuredContent"]["nextCursor"], "skip:20");
        assert!(graph_result(json!({"value":"x".repeat(1_000_000)})).is_err());
    }

    #[tokio::test]
    async fn pkce_state_is_single_use_even_when_callback_validation_fails() {
        let mut client = client(&["offline_access", "User.Read"], &["m365_account_get"]).unwrap();
        let authorization = client.begin_authorization().unwrap();
        let state = Url::parse(authorization["authorizationUrl"].as_str().unwrap())
            .unwrap()
            .query_pairs()
            .find(|(key, _)| key == "state")
            .unwrap()
            .1
            .into_owned();
        assert_eq!(
            client
                .complete_authorization("code", "wrong-state", None)
                .await
                .unwrap_err(),
            "MCP_AUTH_CALLBACK"
        );
        assert_eq!(
            client
                .complete_authorization("code", &state, None)
                .await
                .unwrap_err(),
            "MCP_AUTH_REQUIRED"
        );
    }
}
