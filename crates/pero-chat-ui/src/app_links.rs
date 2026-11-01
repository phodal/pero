//! Saved App results expose reading actions independently of the model's summary.
use serde::{Deserialize, Serialize};
#[derive(Clone, Deserialize, Serialize)]
pub struct AppResultLink {
    pub label: String,
    pub url: String,
    #[cfg(any(target_family = "wasm", feature = "native"))]
    #[serde(skip)]
    pub(crate) bounds: crate::view_bounds::ViewBounds,
}
impl AppResultLink {
    pub fn from_content(content: &str) -> Vec<Self> {
        #[derive(Deserialize)]
        struct ResultLinks {
            #[serde(rename = "appLinks")]
            links: Vec<AppResultLink>,
        }
        let content = content
            .strip_prefix("```json\n")
            .and_then(|value| value.strip_suffix("\n```"))
            .unwrap_or(content);
        let direct = serde_json::from_str::<ResultLinks>(content);
        // Some ACP adapters retain the complete MCP reply as rawOutput.
        #[derive(Deserialize)]
        struct McpReply {
            content: Vec<McpText>,
        }
        #[derive(Deserialize)]
        struct McpText {
            #[serde(default)]
            text: String,
        }
        let value = direct.ok().or_else(|| {
            serde_json::from_str::<McpReply>(content)
                .ok()?
                .content
                .into_iter()
                .find_map(|block| serde_json::from_str::<ResultLinks>(&block.text).ok())
        });
        let Some(value) = value else {
            return vec![];
        };
        if value.links.len() > 64
            || value.links.iter().any(|link| {
                link.label.is_empty()
                    || link.label.len() > 200
                    || pero_contracts::app_chat::AppLocation::parse(&link.url).is_none()
            })
        {
            return vec![];
        }
        value.links
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn result_links_require_app_reading_addresses() {
        for (url, count) in [
            (
                "pero-app-location://paper-agent/main/report/abc/citation/0",
                1,
            ),
            ("https://example.org", 0),
            ("pero-app-location://paper-agent/main/../secret", 0),
        ] {
            let value = serde_json::json!({"appLinks":[{"label":"Page 1","url":url}]});
            for content in [
                value.to_string(),
                format!("```json\n{value}\n```"),
                serde_json::json!({"content":[{"type":"text","text":value.to_string()}]})
                    .to_string(),
            ] {
                assert_eq!(AppResultLink::from_content(&content).len(), count);
            }
        }
        assert!(AppResultLink::from_content("not JSON").is_empty());
    }
}
