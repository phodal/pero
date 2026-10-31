use reqwest::{
    header::{self, HeaderMap},
    Client as HttpClient, Response, StatusCode,
};
use serde_json::{json, Map, Value};
use std::collections::BTreeSet;
use url::Url;

type Result<T> = std::result::Result<T, &'static str>;

const BODY_LIMIT: usize = 786_432;
const KNOWN_TOOLS: [&str; 13] = [
    "gitlab_user_get",
    "gitlab_project_list",
    "gitlab_project_get",
    "gitlab_repository_tree_list",
    "gitlab_repository_file_get",
    "gitlab_issue_list",
    "gitlab_issue_get",
    "gitlab_merge_request_list",
    "gitlab_merge_request_get",
    "gitlab_pipeline_list",
    "gitlab_pipeline_get",
    "gitlab_pipeline_job_list",
    "gitlab_job_trace_get",
];

async fn bounded(response: &mut Response) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "GITLAB_API_FAILED")? {
        if bytes.len() + chunk.len() > BODY_LIMIT {
            return Err("GITLAB_API_FAILED");
        }
        bytes.extend(chunk);
    }
    Ok(bytes)
}

/// A first-party, read-only GitLab REST adapter. The instance URL is operator
/// configured so GitLab.com and Self-Managed use the same transport. The
/// credential is resolved by the native supervisor into one execution-side
/// header and is never serialized by this type.
pub struct GitLabClient {
    api: Url,
    tools: Vec<String>,
    http: HttpClient,
}

impl GitLabClient {
    pub fn known_tools() -> Vec<String> {
        KNOWN_TOOLS.iter().map(|name| (*name).to_owned()).collect()
    }

    pub fn new(api: &str, tools: Vec<String>, http: HttpClient) -> Result<Self> {
        let parsed = Url::parse(api).map_err(|_| "MCP_CONFIG")?;
        let unique: BTreeSet<&str> = tools.iter().map(String::as_str).collect();
        if parsed.as_str() != api
            || parsed.scheme() != "https"
            || parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.query().is_some()
            || parsed.fragment().is_some()
            || !parsed.path().ends_with("/api/v4/")
            || unique.len() != tools.len()
            || tools
                .iter()
                .any(|tool| !KNOWN_TOOLS.contains(&tool.as_str()))
        {
            return Err("MCP_CONFIG");
        }
        Ok(Self {
            api: parsed,
            tools,
            http,
        })
    }

    /// A static catalog is not an authorization check. GET /user proves that
    /// this exact instance and credential can currently act as an identity.
    pub async fn ensure_authorized(&self) -> Result<()> {
        let url = self.api.join("user").map_err(|_| "MCP_CONFIG")?;
        self.get(url, false).await.map(|_| ())
    }

    pub fn list_tools(&self) -> Value {
        json!({
            "tools": self.tools.iter().filter_map(|name| tool(name)).collect::<Vec<_>>(),
            "available": KNOWN_TOOLS,
        })
    }

    pub async fn call(&self, name: &str, arguments: &Value) -> Result<Value> {
        if !self.tools.iter().any(|tool| tool == name) {
            return Err("MCP_TOOL_DENIED");
        }
        let (url, text) = self.request_url(name, arguments)?;
        self.get(url, text).await
    }

    fn request_url(&self, name: &str, arguments: &Value) -> Result<(Url, bool)> {
        let mut url = self.api.clone();
        let mut text = false;
        match name {
            "gitlab_user_get" => {
                exact_object(arguments, &[], &[])?;
                push(&mut url, &["user"])?;
            }
            "gitlab_project_list" => {
                let args = exact_object(arguments, &["limit", "cursor"], &[])?;
                push(&mut url, &["projects"])?;
                append_page(&mut url, args)?;
                url.query_pairs_mut()
                    .append_pair("per_page", &limit(args)?.to_string())
                    .append_pair("membership", "true")
                    .append_pair("simple", "true")
                    .append_pair("order_by", "last_activity_at")
                    .append_pair("sort", "desc");
            }
            "gitlab_project_get" => {
                let args = exact_object(arguments, &["projectId"], &["projectId"])?;
                push(&mut url, &["projects", identifier(args, "projectId", 512)?])?;
            }
            "gitlab_repository_tree_list" => {
                let args = exact_object(
                    arguments,
                    &["projectId", "path", "ref", "recursive", "limit", "cursor"],
                    &["projectId"],
                )?;
                push(
                    &mut url,
                    &[
                        "projects",
                        identifier(args, "projectId", 512)?,
                        "repository",
                        "tree",
                    ],
                )?;
                append_page(&mut url, args)?;
                url.query_pairs_mut()
                    .append_pair("per_page", &limit(args)?.to_string());
                append_optional(&mut url, args, "path", 1024)?;
                append_optional(&mut url, args, "ref", 512)?;
                if let Some(value) = args.get("recursive") {
                    url.query_pairs_mut()
                        .append_pair("recursive", if boolean(value)? { "true" } else { "false" });
                }
            }
            "gitlab_repository_file_get" => {
                let args = exact_object(
                    arguments,
                    &["projectId", "filePath", "ref"],
                    &["projectId", "filePath"],
                )?;
                push(
                    &mut url,
                    &[
                        "projects",
                        identifier(args, "projectId", 512)?,
                        "repository",
                        "files",
                        identifier(args, "filePath", 2048)?,
                    ],
                )?;
                url.query_pairs_mut().append_pair(
                    "ref",
                    optional_identifier(args, "ref", 512)?.unwrap_or("HEAD"),
                );
            }
            "gitlab_issue_list" | "gitlab_merge_request_list" => {
                let args = exact_object(
                    arguments,
                    &["projectId", "state", "limit", "cursor"],
                    &["projectId"],
                )?;
                let (collection, states, default_state): (&str, &[&str], &str) =
                    if name == "gitlab_issue_list" {
                        ("issues", &["opened", "closed", "all"], "opened")
                    } else {
                        (
                            "merge_requests",
                            &["opened", "closed", "locked", "merged", "all"],
                            "opened",
                        )
                    };
                push(
                    &mut url,
                    &["projects", identifier(args, "projectId", 512)?, collection],
                )?;
                append_page(&mut url, args)?;
                url.query_pairs_mut()
                    .append_pair("per_page", &limit(args)?.to_string())
                    .append_pair("state", enum_value(args, "state", states, default_state)?)
                    .append_pair("order_by", "updated_at")
                    .append_pair("sort", "desc");
            }
            "gitlab_issue_get" | "gitlab_merge_request_get" => {
                let key = if name == "gitlab_issue_get" {
                    "issueIid"
                } else {
                    "mergeRequestIid"
                };
                let args = exact_object(arguments, &["projectId", key], &["projectId", key])?;
                let collection = if name == "gitlab_issue_get" {
                    "issues"
                } else {
                    "merge_requests"
                };
                let number = positive_integer(args, key)?;
                push(
                    &mut url,
                    &[
                        "projects",
                        identifier(args, "projectId", 512)?,
                        collection,
                        &number.to_string(),
                    ],
                )?;
            }
            "gitlab_pipeline_list" => {
                let args = exact_object(
                    arguments,
                    &["projectId", "ref", "status", "limit", "cursor"],
                    &["projectId"],
                )?;
                push(
                    &mut url,
                    &["projects", identifier(args, "projectId", 512)?, "pipelines"],
                )?;
                append_page(&mut url, args)?;
                url.query_pairs_mut()
                    .append_pair("per_page", &limit(args)?.to_string())
                    .append_pair("order_by", "updated_at")
                    .append_pair("sort", "desc");
                append_optional(&mut url, args, "ref", 512)?;
                if args.contains_key("status") {
                    let statuses = [
                        "created",
                        "waiting_for_resource",
                        "preparing",
                        "pending",
                        "running",
                        "success",
                        "failed",
                        "canceled",
                        "skipped",
                        "manual",
                        "scheduled",
                    ];
                    url.query_pairs_mut()
                        .append_pair("status", enum_value(args, "status", &statuses, "running")?);
                }
            }
            "gitlab_pipeline_get" | "gitlab_pipeline_job_list" => {
                let args = exact_object(
                    arguments,
                    if name == "gitlab_pipeline_job_list" {
                        &["projectId", "pipelineId", "limit", "cursor"]
                    } else {
                        &["projectId", "pipelineId"]
                    },
                    &["projectId", "pipelineId"],
                )?;
                let pipeline = positive_integer(args, "pipelineId")?;
                push(
                    &mut url,
                    &[
                        "projects",
                        identifier(args, "projectId", 512)?,
                        "pipelines",
                        &pipeline.to_string(),
                    ],
                )?;
                if name == "gitlab_pipeline_job_list" {
                    push(&mut url, &["jobs"])?;
                    append_page(&mut url, args)?;
                    url.query_pairs_mut()
                        .append_pair("per_page", &limit(args)?.to_string());
                }
            }
            "gitlab_job_trace_get" => {
                let args =
                    exact_object(arguments, &["projectId", "jobId"], &["projectId", "jobId"])?;
                let job = positive_integer(args, "jobId")?;
                push(
                    &mut url,
                    &[
                        "projects",
                        identifier(args, "projectId", 512)?,
                        "jobs",
                        &job.to_string(),
                        "trace",
                    ],
                )?;
                text = true;
            }
            _ => return Err("MCP_TOOL_DENIED"),
        }
        Ok((url, text))
    }

    async fn get(&self, url: Url, text: bool) -> Result<Value> {
        if url.scheme() != self.api.scheme()
            || url.host_str() != self.api.host_str()
            || url.port_or_known_default() != self.api.port_or_known_default()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.fragment().is_some()
            || !url.path().starts_with(self.api.path())
        {
            return Err("MCP_CONFIG");
        }
        let expected = url.clone();
        let mut response = self
            .http
            .get(url)
            .header(
                header::ACCEPT,
                if text {
                    "text/plain"
                } else {
                    "application/json"
                },
            )
            .header(header::USER_AGENT, "Point/0.1")
            .send()
            .await
            .map_err(|_| "MCP_CALL_FAILED_NO_REPLAY")?;
        let status = response.status();
        let headers = response.headers().clone();
        let bytes = bounded(&mut response).await?;
        if let Some(code) = gitlab_error(status, &headers) {
            return Err(code);
        }
        let data = if text {
            Value::String(String::from_utf8(bytes).map_err(|_| "GITLAB_API_FAILED")?)
        } else {
            serde_json::from_slice(&bytes).map_err(|_| "GITLAB_API_FAILED")?
        };
        gitlab_result(data, &headers, &expected)
    }
}

fn push(url: &mut Url, segments: &[&str]) -> Result<()> {
    let mut path = url.path_segments_mut().map_err(|_| "MCP_CONFIG")?;
    path.pop_if_empty().extend(segments);
    Ok(())
}

fn gitlab_result(data: Value, headers: &HeaderMap, expected: &Url) -> Result<Value> {
    let mut wrapper = Map::new();
    wrapper.insert("source".into(), json!("gitlab-rest"));
    wrapper.insert("trusted".into(), json!(false));
    wrapper.insert("data".into(), data);
    if let Some(cursor) = next_cursor(headers, expected) {
        wrapper.insert("nextCursor".into(), json!(cursor));
    }
    let pagination = pagination(headers);
    if !pagination.is_empty() {
        wrapper.insert("pagination".into(), Value::Object(pagination));
    }
    let rate_limit = rate_limit(headers);
    if !rate_limit.is_empty() {
        wrapper.insert("rateLimit".into(), Value::Object(rate_limit));
    }
    if let Some(request_id) = header_text(headers, "x-request-id").filter(|value| {
        value.len() <= 128
            && value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    }) {
        wrapper.insert("requestId".into(), json!(request_id));
    }
    let structured = Value::Object(wrapper);
    let result = json!({
        "content": [{"type": "text", "text": structured.to_string()}],
        "structuredContent": structured,
    });
    if serde_json::to_vec(&result)
        .map_err(|_| "GITLAB_API_FAILED")?
        .len()
        > 1_800_000
    {
        return Err("GITLAB_API_FAILED");
    }
    Ok(result)
}

fn gitlab_error(status: StatusCode, headers: &HeaderMap) -> Option<&'static str> {
    if status.is_success() {
        return None;
    }
    match status {
        StatusCode::UNAUTHORIZED => Some("GITLAB_AUTH_REQUIRED"),
        StatusCode::TOO_MANY_REQUESTS => Some("GITLAB_RATE_LIMITED"),
        StatusCode::FORBIDDEN if rate_limited(headers) => Some("GITLAB_RATE_LIMITED"),
        StatusCode::FORBIDDEN => Some("GITLAB_PERMISSION_DENIED"),
        StatusCode::NOT_FOUND => Some("GITLAB_NOT_FOUND"),
        StatusCode::CONFLICT | StatusCode::METHOD_NOT_ALLOWED => Some("GITLAB_CONFLICT"),
        StatusCode::BAD_REQUEST | StatusCode::UNPROCESSABLE_ENTITY => {
            Some("GITLAB_INVALID_ARGUMENT")
        }
        status if status.is_server_error() => Some("GITLAB_TEMPORARY"),
        status if status.is_client_error() => Some("GITLAB_INVALID_ARGUMENT"),
        _ => Some("GITLAB_API_FAILED"),
    }
}

fn rate_limited(headers: &HeaderMap) -> bool {
    headers.contains_key(header::RETRY_AFTER)
        || header_number(headers, "ratelimit-remaining") == Some(0)
        || header_number(headers, "x-ratelimit-remaining") == Some(0)
}

fn rate_limit(headers: &HeaderMap) -> Map<String, Value> {
    let mut value = Map::new();
    for (header, key) in [
        ("ratelimit-limit", "limit"),
        ("ratelimit-remaining", "remaining"),
        ("ratelimit-reset", "resetAtEpochSeconds"),
        ("retry-after", "retryAfterSeconds"),
    ] {
        if let Some(number) = header_number(headers, header) {
            value.insert(key.into(), json!(number));
        }
    }
    value
}

fn pagination(headers: &HeaderMap) -> Map<String, Value> {
    let mut value = Map::new();
    for (header, key) in [
        ("x-page", "page"),
        ("x-per-page", "perPage"),
        ("x-total", "total"),
        ("x-total-pages", "totalPages"),
    ] {
        if let Some(number) = header_number(headers, header) {
            value.insert(key.into(), json!(number));
        }
    }
    value
}

fn next_cursor(headers: &HeaderMap, expected: &Url) -> Option<String> {
    if let Some(cursor) = header_number(headers, "x-next-page")
        .filter(|page| (2..=1_000_000).contains(page))
        .map(|page| format!("page:{page}"))
    {
        return Some(cursor);
    }
    let link = header_text(headers, header::LINK.as_str())?;
    for part in link.split(',') {
        let mut sections = part.trim().split(';');
        let target = sections.next()?.trim();
        if !sections.any(|value| value.trim() == "rel=\"next\"")
            || !target.starts_with('<')
            || !target.ends_with('>')
        {
            continue;
        }
        let Ok(url) = Url::parse(&target[1..target.len() - 1]) else {
            continue;
        };
        if url.scheme() != expected.scheme()
            || url.host_str() != expected.host_str()
            || url.port_or_known_default() != expected.port_or_known_default()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.fragment().is_some()
            || url.path() != expected.path()
        {
            continue;
        }
        if let Some(page) = url.query_pairs().find_map(|(key, value)| {
            (key == "page")
                .then(|| value.parse::<u64>().ok())
                .flatten()
                .filter(|page| (2..=1_000_000).contains(page))
        }) {
            return Some(format!("page:{page}"));
        }
    }
    None
}

fn header_text<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name)?.to_str().ok()
}

fn header_number(headers: &HeaderMap, name: &str) -> Option<u64> {
    header_text(headers, name)?.parse().ok()
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

fn identifier<'a>(object: &'a Map<String, Value>, key: &str, max: usize) -> Result<&'a str> {
    object
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| {
            !value.is_empty()
                && value.len() <= max
                && *value != "."
                && *value != ".."
                && !value.chars().any(char::is_control)
        })
        .ok_or("MCP_ARGUMENT")
}

fn optional_identifier<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    max: usize,
) -> Result<Option<&'a str>> {
    match object.get(key) {
        None => Ok(None),
        Some(_) => identifier(object, key, max).map(Some),
    }
}

fn append_optional(
    url: &mut Url,
    object: &Map<String, Value>,
    key: &str,
    max: usize,
) -> Result<()> {
    if let Some(value) = optional_identifier(object, key, max)? {
        url.query_pairs_mut().append_pair(key, value);
    }
    Ok(())
}

fn enum_value<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    allowed: &[&str],
    default: &'a str,
) -> Result<&'a str> {
    match object.get(key) {
        None => Ok(default),
        Some(Value::String(value)) if allowed.contains(&value.as_str()) => Ok(value),
        _ => Err("MCP_ARGUMENT"),
    }
}

fn boolean(value: &Value) -> Result<bool> {
    value.as_bool().ok_or("MCP_ARGUMENT")
}

fn positive_integer(object: &Map<String, Value>, key: &str) -> Result<u64> {
    object
        .get(key)
        .and_then(Value::as_u64)
        .filter(|value| *value > 0 && *value <= i64::MAX as u64)
        .ok_or("MCP_ARGUMENT")
}

fn limit(object: &Map<String, Value>) -> Result<u64> {
    match object.get("limit") {
        None => Ok(20),
        Some(value) => value
            .as_u64()
            .filter(|value| (1..=100).contains(value))
            .ok_or("MCP_ARGUMENT"),
    }
}

fn append_page(url: &mut Url, object: &Map<String, Value>) -> Result<()> {
    let Some(value) = object.get("cursor") else {
        return Ok(());
    };
    let page = value
        .as_str()
        .filter(|value| !value.is_empty() && value.len() <= 32)
        .and_then(|value| value.strip_prefix("page:"))
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| (2..=1_000_000).contains(value))
        .ok_or("MCP_ARGUMENT")?;
    url.query_pairs_mut().append_pair("page", &page.to_string());
    Ok(())
}

fn tool(name: &str) -> Option<Value> {
    let object = |properties: Value, required: &[&str]| {
        let mut schema = json!({
            "type": "object",
            "properties": properties,
            "additionalProperties": false,
        });
        if !required.is_empty() {
            schema["required"] = json!(required);
        }
        schema
    };
    let project = || json!({"projectId":{"type":"string","minLength":1,"maxLength":512}});
    let page = || {
        json!({
            "limit":{"type":"integer","minimum":1,"maximum":100},
            "cursor":{"type":"string","pattern":"^page:[0-9]+$","maxLength":32}
        })
    };
    Some(match name {
        "gitlab_user_get" => json!({
            "name":name,"description":"Read the authenticated GitLab identity.",
            "inputSchema":object(json!({}), &[])
        }),
        "gitlab_project_list" => json!({
            "name":name,"description":"List GitLab projects visible to the authenticated identity.",
            "inputSchema":object(page(), &[])
        }),
        "gitlab_project_get" => json!({
            "name":name,"description":"Read one GitLab project by numeric ID or namespace/path.",
            "inputSchema":object(project(), &["projectId"])
        }),
        "gitlab_repository_tree_list" => {
            let mut props = project().as_object().unwrap().clone();
            props.extend(page().as_object().unwrap().clone());
            props.insert(
                "path".into(),
                json!({"type":"string","minLength":1,"maxLength":1024}),
            );
            props.insert(
                "ref".into(),
                json!({"type":"string","minLength":1,"maxLength":512}),
            );
            props.insert("recursive".into(), json!({"type":"boolean"}));
            json!({"name":name,"description":"List a bounded GitLab repository tree.","inputSchema":object(Value::Object(props), &["projectId"])})
        }
        "gitlab_repository_file_get" => {
            let mut props = project().as_object().unwrap().clone();
            props.insert(
                "filePath".into(),
                json!({"type":"string","minLength":1,"maxLength":2048}),
            );
            props.insert(
                "ref".into(),
                json!({"type":"string","minLength":1,"maxLength":512,"default":"HEAD"}),
            );
            json!({"name":name,"description":"Read one GitLab repository file as bounded metadata and Base64 content.","inputSchema":object(Value::Object(props), &["projectId","filePath"])})
        }
        "gitlab_issue_list" | "gitlab_merge_request_list" => {
            let mut props = project().as_object().unwrap().clone();
            props.extend(page().as_object().unwrap().clone());
            props.insert(
                "state".into(),
                if name == "gitlab_issue_list" {
                    json!({"type":"string","enum":["opened","closed","all"]})
                } else {
                    json!({"type":"string","enum":["opened","closed","locked","merged","all"]})
                },
            );
            let description = if name == "gitlab_issue_list" {
                "List issues in one GitLab project."
            } else {
                "List merge requests in one GitLab project."
            };
            json!({"name":name,"description":description,"inputSchema":object(Value::Object(props), &["projectId"])})
        }
        "gitlab_issue_get" | "gitlab_merge_request_get" => {
            let mut props = project().as_object().unwrap().clone();
            let (key, description) = if name == "gitlab_issue_get" {
                ("issueIid", "Read one GitLab issue by project-local IID.")
            } else {
                (
                    "mergeRequestIid",
                    "Read one GitLab merge request by project-local IID.",
                )
            };
            props.insert(key.into(), json!({"type":"integer","minimum":1}));
            json!({"name":name,"description":description,"inputSchema":object(Value::Object(props), &["projectId",key])})
        }
        "gitlab_pipeline_list" => {
            let mut props = project().as_object().unwrap().clone();
            props.extend(page().as_object().unwrap().clone());
            props.insert(
                "ref".into(),
                json!({"type":"string","minLength":1,"maxLength":512}),
            );
            props.insert("status".into(), json!({"type":"string","enum":["created","waiting_for_resource","preparing","pending","running","success","failed","canceled","skipped","manual","scheduled"]}));
            json!({"name":name,"description":"List CI/CD pipelines for one GitLab project.","inputSchema":object(Value::Object(props), &["projectId"])})
        }
        "gitlab_pipeline_get" | "gitlab_pipeline_job_list" => {
            let mut props = project().as_object().unwrap().clone();
            props.insert("pipelineId".into(), json!({"type":"integer","minimum":1}));
            if name == "gitlab_pipeline_job_list" {
                props.extend(page().as_object().unwrap().clone());
            }
            let description = if name == "gitlab_pipeline_get" {
                "Read one GitLab pipeline."
            } else {
                "List jobs in one GitLab pipeline."
            };
            json!({"name":name,"description":description,"inputSchema":object(Value::Object(props), &["projectId","pipelineId"])})
        }
        "gitlab_job_trace_get" => {
            let mut props = project().as_object().unwrap().clone();
            props.insert("jobId".into(), json!({"type":"integer","minimum":1}));
            json!({"name":name,"description":"Read a bounded GitLab CI job trace.","inputSchema":object(Value::Object(props), &["projectId","jobId"])})
        }
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn client(api: &str, tools: &[&str]) -> Result<GitLabClient> {
        GitLabClient::new(
            api,
            tools.iter().map(|value| (*value).to_owned()).collect(),
            HttpClient::new(),
        )
    }

    #[test]
    fn accepts_gitlab_com_and_self_managed_https_api_roots() {
        assert!(client("https://gitlab.com/api/v4/", &["gitlab_user_get"]).is_ok());
        assert!(client(
            "https://gitlab.example:8443/company/api/v4/",
            &["gitlab_project_list"]
        )
        .is_ok());
        assert!(client("http://gitlab.example/api/v4/", &[]).is_err());
        assert!(client("https://gitlab.example/api/v3/", &[]).is_err());
        assert!(client("https://gitlab.example/api/v4/?token=x", &[]).is_err());
        assert!(client("https://gitlab.com/api/v4/", &["gitlab_issue_create"]).is_err());
    }

    #[test]
    fn paths_encode_project_and_file_as_single_segments() {
        let client = client(
            "https://gitlab.example/api/v4/",
            &["gitlab_repository_file_get", "gitlab_merge_request_get"],
        )
        .unwrap();
        let (file, _) = client
            .request_url(
                "gitlab_repository_file_get",
                &json!({"projectId":"team/sub/project","filePath":"src/lib.rs","ref":"feature/a"}),
            )
            .unwrap();
        assert_eq!(
            file.path(),
            "/api/v4/projects/team%2Fsub%2Fproject/repository/files/src%2Flib.rs"
        );
        assert!(file.query().unwrap().contains("ref=feature%2Fa"));
        let (mr, _) = client
            .request_url(
                "gitlab_merge_request_get",
                &json!({"projectId":"team/project","mergeRequestIid":7}),
            )
            .unwrap();
        assert_eq!(
            mr.path(),
            "/api/v4/projects/team%2Fproject/merge_requests/7"
        );
    }

    #[test]
    fn pagination_and_arguments_are_bounded() {
        let client = client(
            "https://gitlab.com/api/v4/",
            &["gitlab_project_list", "gitlab_pipeline_list"],
        )
        .unwrap();
        let (projects, _) = client
            .request_url(
                "gitlab_project_list",
                &json!({"limit":100,"cursor":"page:2"}),
            )
            .unwrap();
        assert!(projects.query().unwrap().contains("page=2"));
        assert!(projects.query().unwrap().contains("per_page=100"));
        assert!(client
            .request_url("gitlab_project_list", &json!({"limit":101}))
            .is_err());
        assert!(client
            .request_url(
                "gitlab_pipeline_list",
                &json!({"projectId":"p","status":"unknown"}),
            )
            .is_err());
    }

    #[test]
    fn response_metadata_is_bounded_and_untrusted() {
        let mut headers = HeaderMap::new();
        headers.insert("x-next-page", "3".parse().unwrap());
        headers.insert("x-total", "42".parse().unwrap());
        headers.insert("ratelimit-remaining", "99".parse().unwrap());
        headers.insert("x-request-id", "req-123".parse().unwrap());
        let expected = Url::parse("https://gitlab.example/api/v4/projects?per_page=20").unwrap();
        let result = gitlab_result(json!([{"id":1}]), &headers, &expected).unwrap();
        assert_eq!(result["structuredContent"]["source"], "gitlab-rest");
        assert_eq!(result["structuredContent"]["trusted"], false);
        assert_eq!(result["structuredContent"]["nextCursor"], "page:3");
        assert_eq!(result["structuredContent"]["pagination"]["total"], 42);
        assert_eq!(result["structuredContent"]["rateLimit"]["remaining"], 99);
    }

    #[test]
    fn link_pagination_never_changes_instance_or_request_path() {
        let expected = Url::parse("https://gitlab.example/api/v4/projects?per_page=20").unwrap();
        let mut headers = HeaderMap::new();
        headers.insert(
            header::LINK,
            "<https://gitlab.example/api/v4/projects?page=2&per_page=20>; rel=\"next\""
                .parse()
                .unwrap(),
        );
        assert_eq!(next_cursor(&headers, &expected).as_deref(), Some("page:2"));
        headers.insert(
            header::LINK,
            "<https://evil.example/api/v4/projects?page=2>; rel=\"next\""
                .parse()
                .unwrap(),
        );
        assert_eq!(next_cursor(&headers, &expected), None);
        headers.insert(
            header::LINK,
            "<https://gitlab.example/api/v4/users?page=2>; rel=\"next\""
                .parse()
                .unwrap(),
        );
        assert_eq!(next_cursor(&headers, &expected), None);
    }

    #[test]
    fn errors_keep_auth_permission_rate_limit_and_not_found_distinct() {
        let mut headers = HeaderMap::new();
        assert_eq!(
            gitlab_error(StatusCode::UNAUTHORIZED, &headers),
            Some("GITLAB_AUTH_REQUIRED")
        );
        assert_eq!(
            gitlab_error(StatusCode::FORBIDDEN, &headers),
            Some("GITLAB_PERMISSION_DENIED")
        );
        headers.insert("ratelimit-remaining", "0".parse().unwrap());
        assert_eq!(
            gitlab_error(StatusCode::FORBIDDEN, &headers),
            Some("GITLAB_RATE_LIMITED")
        );
        assert_eq!(
            gitlab_error(StatusCode::NOT_FOUND, &HeaderMap::new()),
            Some("GITLAB_NOT_FOUND")
        );
        assert_eq!(
            gitlab_error(StatusCode::BAD_GATEWAY, &HeaderMap::new()),
            Some("GITLAB_TEMPORARY")
        );
    }
}
