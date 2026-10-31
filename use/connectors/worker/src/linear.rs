use reqwest::{header::HeaderMap, Client as HttpClient, Response, StatusCode};
use serde_json::{json, Map, Value};
use std::collections::BTreeSet;
use url::Url;

type Result<T> = std::result::Result<T, &'static str>;
const API: &str = "https://api.linear.app/graphql";
const BODY_LIMIT: usize = 786_432;
const KNOWN_TOOLS: [&str; 4] = [
    "linear_viewer_get",
    "linear_team_list",
    "linear_issue_list",
    "linear_issue_get",
];
const VIEWER: &str = "query PointViewer { viewer { id name displayName email } }";
const TEAMS: &str = "query PointTeams($first: Int!, $after: String) { teams(first: $first, after: $after) { nodes { id name key description } pageInfo { hasNextPage endCursor } } }";
const ISSUES: &str = "query PointIssues($first: Int!, $after: String) { viewer { assignedIssues(first: $first, after: $after, orderBy: updatedAt) { nodes { id identifier title priority dueDate createdAt updatedAt url state { id name type } team { id key name } project { id name } } pageInfo { hasNextPage endCursor } } } }";
const ISSUE: &str = "query PointIssue($id: String!) { issue(id: $id) { id identifier title description priority dueDate createdAt updatedAt url state { id name type } team { id key name } project { id name } assignee { id name displayName } } }";

async fn bounded(response: &mut Response) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "LINEAR_API_FAILED")? {
        if bytes.len() + chunk.len() > BODY_LIMIT {
            return Err("LINEAR_API_FAILED");
        }
        bytes.extend(chunk);
    }
    Ok(bytes)
}

pub struct LinearClient {
    tools: Vec<String>,
    http: HttpClient,
}

impl LinearClient {
    pub fn known_tools() -> Vec<String> {
        KNOWN_TOOLS.iter().map(|v| (*v).to_owned()).collect()
    }

    pub fn new(api: &str, tools: Vec<String>, http: HttpClient) -> Result<Self> {
        let parsed = Url::parse(api).map_err(|_| "MCP_CONFIG")?;
        let unique: BTreeSet<&str> = tools.iter().map(String::as_str).collect();
        if api != API
            || parsed.as_str() != API
            || unique.len() != tools.len()
            || tools
                .iter()
                .any(|tool| !KNOWN_TOOLS.contains(&tool.as_str()))
        {
            return Err("MCP_CONFIG");
        }
        Ok(Self { tools, http })
    }

    pub async fn ensure_authorized(&self) -> Result<()> {
        self.query(VIEWER, json!({})).await.map(|_| ())
    }

    pub fn list_tools(&self) -> Value {
        json!({"tools": self.tools.iter().filter_map(|name| tool(name)).collect::<Vec<_>>(), "available": KNOWN_TOOLS})
    }

    pub async fn call(&self, name: &str, arguments: &Value) -> Result<Value> {
        if !self.tools.iter().any(|tool| tool == name) {
            return Err("MCP_TOOL_DENIED");
        }
        let args = exact_object(
            arguments,
            match name {
                "linear_viewer_get" => &[],
                "linear_team_list" | "linear_issue_list" => &["limit", "cursor"],
                "linear_issue_get" => &["issueId"],
                _ => return Err("MCP_TOOL_DENIED"),
            },
        )?;
        match name {
            "linear_viewer_get" => self.query(VIEWER, json!({})).await,
            "linear_team_list" => self.query(TEAMS, page_variables(args)?).await,
            "linear_issue_list" => self.query(ISSUES, page_variables(args)?).await,
            "linear_issue_get" => {
                self.query(ISSUE, json!({"id": identifier(args, "issueId")?}))
                    .await
            }
            _ => Err("MCP_TOOL_DENIED"),
        }
    }

    async fn query(&self, query: &'static str, variables: Value) -> Result<Value> {
        let mut response = self
            .http
            .post(API)
            .json(&json!({"query": query, "variables": variables}))
            .send()
            .await
            .map_err(|_| "MCP_CALL_FAILED_NO_REPLAY")?;
        let status = response.status();
        let headers = response.headers().clone();
        let bytes = bounded(&mut response).await?;
        if let Some(code) = http_error(status, &headers) {
            return Err(code);
        }
        let value: Value = serde_json::from_slice(&bytes).map_err(|_| "LINEAR_API_FAILED")?;
        if let Some(code) = graphql_error(&value) {
            return Err(code);
        }
        let data = value.get("data").cloned().ok_or("LINEAR_API_FAILED")?;
        let structured = json!({"source":"linear-graphql","trusted":false,"data":data,"rateLimit":rate_limit(&headers)});
        let result = json!({"content":[{"type":"text","text":structured.to_string()}],"structuredContent":structured});
        if serde_json::to_vec(&result)
            .map_err(|_| "LINEAR_API_FAILED")?
            .len()
            > 1_800_000
        {
            return Err("LINEAR_API_FAILED");
        }
        Ok(result)
    }
}

fn exact_object<'a>(value: &'a Value, allowed: &[&str]) -> Result<&'a Map<String, Value>> {
    let object = value.as_object().ok_or("MCP_ARGUMENT")?;
    if object.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err("MCP_ARGUMENT");
    }
    Ok(object)
}

fn identifier<'a>(object: &'a Map<String, Value>, key: &str) -> Result<&'a str> {
    object
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| {
            !value.is_empty() && value.len() <= 128 && !value.chars().any(char::is_control)
        })
        .ok_or("MCP_ARGUMENT")
}

fn page_variables(object: &Map<String, Value>) -> Result<Value> {
    let first = match object.get("limit") {
        None => 25,
        Some(v) => v
            .as_u64()
            .filter(|v| (1..=50).contains(v))
            .ok_or("MCP_ARGUMENT")?,
    };
    let after = match object.get("cursor") {
        None => Value::Null,
        Some(v) => Value::String(
            v.as_str()
                .filter(|v| !v.is_empty() && v.len() <= 1024 && !v.chars().any(char::is_control))
                .ok_or("MCP_ARGUMENT")?
                .to_owned(),
        ),
    };
    Ok(json!({"first": first, "after": after}))
}

fn http_error(status: StatusCode, headers: &HeaderMap) -> Option<&'static str> {
    if status.is_success() {
        return None;
    }
    match status {
        StatusCode::UNAUTHORIZED => Some("LINEAR_AUTH_REQUIRED"),
        StatusCode::FORBIDDEN => Some("LINEAR_PERMISSION_DENIED"),
        StatusCode::TOO_MANY_REQUESTS => Some("LINEAR_RATE_LIMITED"),
        status if status.is_server_error() => Some("LINEAR_TEMPORARY"),
        StatusCode::BAD_REQUEST
            if header_number(headers, "x-ratelimit-requests-remaining") == Some(0) =>
        {
            Some("LINEAR_RATE_LIMITED")
        }
        status if status.is_client_error() => Some("LINEAR_INVALID_ARGUMENT"),
        _ => Some("LINEAR_API_FAILED"),
    }
}

fn graphql_error(value: &Value) -> Option<&'static str> {
    let errors = value.get("errors")?.as_array()?;
    if errors.is_empty() {
        return None;
    }
    let codes = errors
        .iter()
        .filter_map(|error| error.pointer("/extensions/code")?.as_str())
        .collect::<Vec<_>>();
    if codes.iter().any(|code| *code == "RATELIMITED") {
        Some("LINEAR_RATE_LIMITED")
    } else if codes
        .iter()
        .any(|code| matches!(*code, "AUTHENTICATION_ERROR" | "UNAUTHENTICATED"))
    {
        Some("LINEAR_AUTH_REQUIRED")
    } else if codes
        .iter()
        .any(|code| matches!(*code, "FORBIDDEN" | "INSUFFICIENT_PERMISSIONS"))
    {
        Some("LINEAR_PERMISSION_DENIED")
    } else {
        Some("LINEAR_API_FAILED")
    }
}

fn header_number(headers: &HeaderMap, name: &str) -> Option<u64> {
    headers.get(name)?.to_str().ok()?.parse().ok()
}
fn rate_limit(headers: &HeaderMap) -> Value {
    let mut value = Map::new();
    for (header, key) in [
        ("x-ratelimit-requests-limit", "limit"),
        ("x-ratelimit-requests-remaining", "remaining"),
        ("x-ratelimit-requests-reset", "resetAtEpochMs"),
    ] {
        if let Some(number) = header_number(headers, header) {
            value.insert(key.into(), json!(number));
        }
    }
    Value::Object(value)
}

fn tool(name: &str) -> Option<Value> {
    let page = json!({"limit":{"type":"integer","minimum":1,"maximum":50},"cursor":{"type":"string","maxLength":1024}});
    let empty = json!({"type":"object","properties":{},"additionalProperties":false});
    Some(match name {
        "linear_viewer_get" => {
            json!({"name":name,"description":"Read the authenticated Linear user.","inputSchema":empty})
        }
        "linear_team_list" => {
            json!({"name":name,"description":"List Linear teams visible to the authenticated user.","inputSchema":{"type":"object","properties":page,"additionalProperties":false}})
        }
        "linear_issue_list" => {
            json!({"name":name,"description":"List issues assigned to the authenticated Linear user, newest updates first.","inputSchema":{"type":"object","properties":page,"additionalProperties":false}})
        }
        "linear_issue_get" => {
            json!({"name":name,"description":"Read one Linear issue by UUID or identifier.","inputSchema":{"type":"object","properties":{"issueId":{"type":"string","minLength":1,"maxLength":128}},"required":["issueId"],"additionalProperties":false}})
        }
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn client(tools: &[&str]) -> Result<LinearClient> {
        LinearClient::new(
            API,
            tools.iter().map(|v| (*v).to_owned()).collect(),
            HttpClient::new(),
        )
    }

    #[test]
    fn fixed_endpoint_and_read_only_catalog() {
        assert!(client(&["linear_viewer_get", "linear_issue_list"]).is_ok());
        assert!(
            LinearClient::new("https://evil.example/graphql", vec![], HttpClient::new()).is_err()
        );
        assert!(client(&["linear_issue_create"]).is_err());
        let tools = client(&["linear_issue_list"]).unwrap().list_tools();
        assert_eq!(tools["tools"][0]["name"], "linear_issue_list");
        assert_eq!(tools["available"].as_array().unwrap().len(), 4);
    }

    #[test]
    fn arguments_and_cursors_are_bounded() {
        assert_eq!(
            page_variables(
                exact_object(&json!({"limit": 10, "cursor":"abc"}), &["limit", "cursor"]).unwrap()
            )
            .unwrap(),
            json!({"first":10,"after":"abc"})
        );
        assert!(page_variables(exact_object(&json!({"limit": 51}), &["limit"]).unwrap()).is_err());
        assert!(identifier(
            exact_object(&json!({"issueId":"LIN-123"}), &["issueId"]).unwrap(),
            "issueId"
        )
        .is_ok());
        assert!(exact_object(&json!({"query":"mutation"}), &[]).is_err());
    }

    #[test]
    fn errors_distinguish_auth_permissions_and_limits() {
        assert_eq!(
            http_error(StatusCode::UNAUTHORIZED, &HeaderMap::new()),
            Some("LINEAR_AUTH_REQUIRED")
        );
        assert_eq!(
            graphql_error(&json!({"errors":[{"extensions":{"code":"RATELIMITED"}}]})),
            Some("LINEAR_RATE_LIMITED")
        );
        assert_eq!(
            graphql_error(&json!({"errors":[{"extensions":{"code":"FORBIDDEN"}}]})),
            Some("LINEAR_PERMISSION_DENIED")
        );
    }
}
