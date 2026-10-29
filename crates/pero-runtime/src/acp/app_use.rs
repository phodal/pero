//! Trusted Desktop transport configuration, never an App-supplied grant.
use super::sdk::schema::v1::{HttpHeader, McpServer, McpServerHttp};

#[derive(Clone)]
pub struct AppUseEndpoint {
    url: String,
    token: String,
}
impl AppUseEndpoint {
    pub fn from_environment() -> Option<Self> {
        let url = std::env::var("PERO_APP_USE_URL").ok()?;
        let token = std::env::var("PERO_APP_USE_TOKEN").ok()?;
        let parsed = reqwest::Url::parse(&url).ok()?;
        if parsed.scheme() != "http" || parsed.host_str() != Some("127.0.0.1")
            || parsed.port().is_none() || parsed.path() != "/mcp"
            || !parsed.username().is_empty() || parsed.password().is_some()
            || parsed.query().is_some() || parsed.fragment().is_some()
            || token.len() != 64 || !token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return None;
        }
        Some(Self { url, token })
    }

    pub(super) fn server(&self, thread: &str) -> McpServer {
        McpServer::Http(McpServerHttp::new("pero-app-use", self.url.clone()).headers(vec![
            HttpHeader::new("Authorization", format!("Bearer {}", self.token)),
            HttpHeader::new("X-Pero-Thread", thread),
        ]))
    }
}

/// Bundled in the Host, including App Product distributions.
pub const APP_USE_SKILL: &str = include_str!("../app-use-skill.md");
