//! Trusted Host endpoint; each real conversation receives an individual token.
use super::{
    sdk::schema::v1::{HttpHeader, McpServer, McpServerHttp},
    AgentConfig,
};
use hmac::{Hmac, Mac};
use sha2::Sha256;

#[derive(Clone)]
pub struct ConnectorsEndpoint {
    url: String,
    token: String,
}

impl ConnectorsEndpoint {
    pub fn from_environment() -> Option<Self> {
        let url = std::env::var("PERO_CONNECTORS_URL").ok()?;
        let token = std::env::var("PERO_CONNECTORS_TOKEN").ok()?;
        let parsed = reqwest::Url::parse(&url).ok()?;
        if parsed.scheme() != "http"
            || parsed.host_str() != Some("127.0.0.1")
            || parsed.port().is_none()
            || parsed.path() != "/mcp"
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.query().is_some()
            || parsed.fragment().is_some()
            || token.len() != 64
            || !token.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return None;
        }
        Some(Self { url, token })
    }

    pub fn bind(&self, agent: &mut AgentConfig, thread: &str) -> Result<(), String> {
        if agent
            .mcp_server_names()
            .iter()
            .any(|name| name == "pero-connectors")
        {
            return Err("The pero-connectors MCP name is reserved by the Host".into());
        }
        let mut mac = Hmac::<Sha256>::new_from_slice(self.token.as_bytes())
            .map_err(|_| "Invalid connector endpoint")?;
        mac.update(thread.as_bytes());
        let token: String = mac
            .finalize()
            .into_bytes()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        agent.mcp_servers.push(McpServer::Http(
            McpServerHttp::new("pero-connectors", self.url.clone()).headers(vec![
                HttpHeader::new("Authorization", format!("Bearer {token}")),
                HttpHeader::new("X-Pero-Thread", thread),
            ]),
        ));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn conversation_tokens_are_scoped_and_never_expose_the_master_key() {
        let endpoint = ConnectorsEndpoint {
            url: "http://127.0.0.1:12345/mcp".into(),
            token: "ab".repeat(32),
        };
        let original: AgentConfig = serde_json::from_value(
            serde_json::json!({"id":"fixture","name":"Fixture","command":"agent"}),
        )
        .unwrap();
        let mut a = original.clone();
        let mut b = original.clone();
        endpoint.bind(&mut a, "a").unwrap();
        endpoint.bind(&mut b, "b").unwrap();
        let first = serde_json::to_value(&a.mcp_servers[0]).unwrap();
        let second = serde_json::to_value(&b.mcp_servers[0]).unwrap();
        assert_ne!(first["headers"][0]["value"], second["headers"][0]["value"]);
        assert_eq!(first["headers"][1]["value"], "a");
        assert!(!first.to_string().contains(&endpoint.token));
        assert!(original.mcp_servers.is_empty());
        assert!(endpoint.bind(&mut a, "a").is_err());
    }
}
