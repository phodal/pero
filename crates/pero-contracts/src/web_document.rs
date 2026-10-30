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

/// Engine locations include the isolated inline document; URL entry stays HTTP-only.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct WebLocation(String);
impl TryFrom<String> for WebLocation {
    type Error = String;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value == "about:blank" {
            return Ok(Self(value));
        }
        if let Ok(url) = url::Url::parse(&value) {
            if url.scheme() == "pero-html" && url.host_str().is_some() {
                return Ok(Self(url.into()));
            }
        }
        WebAddress::try_from(value).map(Into::into)
    }
}
impl From<WebAddress> for WebLocation {
    fn from(value: WebAddress) -> Self {
        Self(value.into())
    }
}
impl From<WebLocation> for String {
    fn from(value: WebLocation) -> Self {
        value.0
    }
}
impl WebLocation {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InlineHtml {
    pub id: String,
    pub title: String,
    pub html: String,
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
    pub url: WebLocation,
    pub title: String,
    pub load: WebLoad,
    pub can_back: bool,
    pub can_forward: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notice: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WebDocument {
    /// Opening the same initial URL activates the existing view, even after it navigates.
    pub id: String,
    pub observation: WebObservation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub html: Option<InlineHtml>,
}
impl WebDocument {
    pub fn open(url: WebAddress) -> Self {
        Self {
            id: url.as_str().into(),
            observation: WebObservation {
                title: url.0.host_str().unwrap_or_default().into(),
                url: url.into(),
                load: WebLoad::Loading,
                can_back: false,
                can_forward: false,
                notice: None,
            },
            html: None,
        }
    }
    pub fn inline(html: InlineHtml) -> Self {
        Self {
            id: format!("html:{}", html.id),
            observation: WebObservation {
                url: WebLocation("about:blank".into()),
                title: html.title.clone(),
                load: WebLoad::Loading,
                can_back: false,
                can_forward: false,
                notice: None,
            },
            html: Some(html),
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
                url: next.clone().into(),
                title: "Next page".into(),
                load: WebLoad::Ready,
                can_back: true,
                can_forward: false,
                notice: None,
            });
            assert_eq!(page.id, expected);
            assert!(page.observation.can_back);
            page.observe(WebObservation {
                url: next.into(),
                title: "Next page".into(),
                load: WebLoad::Failed("Connection closed".into()),
                can_back: true,
                can_forward: false,
                notice: None,
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
