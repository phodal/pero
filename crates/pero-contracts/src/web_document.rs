//! Web engines own their navigation history; the workspace retains identity and observations.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct WebAddress(url::Url);
impl TryFrom<String> for WebAddress {
    type Error = String;
    fn try_from(text: String) -> Result<Self, Self::Error> {
        let url = url::Url::parse(text.trim())
            .map_err(|_| "Enter a complete HTTP or HTTPS URL".to_owned())?;
        if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
            return Err("Only HTTP and HTTPS pages can be embedded".into());
        }
        Ok(Self(url))
    }
}
impl From<WebAddress> for String {
    fn from(address: WebAddress) -> Self {
        address.0.into()
    }
}
impl WebAddress {
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "message", rename_all = "snake_case")]
pub enum WebLoad {
    Loading,
    Ready,
    Failed(String),
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WebObservation {
    pub url: WebAddress,
    pub title: String,
    pub load: WebLoad,
    pub can_back: bool,
    pub can_forward: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WebDocument {
    /// Opening the same initial URL activates the existing view, even after it navigates.
    pub id: String,
    pub observation: WebObservation,
}
impl WebDocument {
    pub fn open(url: WebAddress) -> Self {
        Self {
            id: url.as_str().into(),
            observation: WebObservation {
                title: url.0.host_str().unwrap_or_default().into(),
                url,
                load: WebLoad::Loading,
                can_back: false,
                can_forward: false,
            },
        }
    }
    pub fn observe(&mut self, observation: WebObservation) {
        self.observation = observation;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pages_keep_workspace_identity_through_engine_navigation_and_failure() {
        for (address, expected) in [
            ("https://EXAMPLE.org", "https://example.org/"),
            ("http://127.0.0.1:1234/page", "http://127.0.0.1:1234/page"),
        ] {
            let mut page = WebDocument::open(WebAddress::try_from(address.to_owned()).unwrap());
            assert_eq!(page.id, expected);
            let next = WebAddress::try_from("https://example.org/next".to_owned()).unwrap();
            page.observe(WebObservation {
                url: next.clone(),
                title: "Next page".into(),
                load: WebLoad::Ready,
                can_back: true,
                can_forward: false,
            });
            assert_eq!(page.id, expected);
            assert!(page.observation.can_back);
            page.observe(WebObservation {
                url: next,
                title: "Next page".into(),
                load: WebLoad::Failed("Connection closed".into()),
                can_back: true,
                can_forward: false,
            });
            assert!(matches!(page.observation.load, WebLoad::Failed(_)));
            assert_eq!(page.id, expected);
        }
        for address in [
            "file:///tmp/page.html",
            "javascript:alert(1)",
            "data:text/html,page",
            "example.org",
            "",
        ] {
            assert!(WebAddress::try_from(address.to_owned()).is_err());
        }
    }
}
