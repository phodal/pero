//! Saved App results expose reading actions independently of the model's summary.
use serde::{Deserialize, Serialize};
#[derive(Clone, Deserialize, Serialize)]
pub struct AppResultLink {
    pub label: String,
    pub url: String,
    #[cfg(any(target_family="wasm",feature="native"))]
    #[serde(skip)]
    pub(crate) bounds: crate::view_bounds::ViewBounds,
}
impl AppResultLink {
    pub fn from_content(content: &str) -> Vec<Self> {
        #[derive(Deserialize)]
        struct ResultLinks { #[serde(rename="appLinks")] links: Vec<AppResultLink> }
        let Ok(value) = serde_json::from_str::<ResultLinks>(content) else { return vec![]; };
        if value.links.len()>64 || value.links.iter().any(|link|link.label.is_empty() || link.label.len()>200 || pero_contracts::app_chat::AppLocation::parse(&link.url).is_none()) { return vec![]; }
        value.links
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn result_links_require_app_reading_addresses() {
        for (url,count) in [("pero-app-location://paper-agent/main/report/abc/citation/0",1),("https://example.org",0),("pero-app-location://paper-agent/main/../secret",0)] {
            let value=serde_json::json!({"appLinks":[{"label":"Page 1","url":url}]});
            assert_eq!(AppResultLink::from_content(&value.to_string()).len(),count);
        }
        assert!(AppResultLink::from_content("not JSON").is_empty());
    }
}
