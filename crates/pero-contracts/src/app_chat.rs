//! App identity associates a conversation with its originating panel. It grants no tools.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AppChatScope {
    pub app: String,
    pub panel: String,
}

impl AppChatScope {
    pub fn valid(&self) -> bool {
        [&self.app, &self.panel].into_iter().all(|value| {
            !value.is_empty()
                && value.len() <= 128
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        })
    }
}

/// An opaque address interpreted by the owning App; it grants no tool access.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppLocation {
    pub scope: AppChatScope,
    pub location: String,
}
impl AppLocation {
    pub fn parse(href: &str) -> Option<Self> {
        let mut parts = href.strip_prefix("pero-app-location://")?.splitn(3, '/');
        let scope = AppChatScope {
            app: parts.next()?.into(),
            panel: parts.next()?.into(),
        };
        let location = parts.next()?;
        (scope.valid()
            && !location.is_empty()
            && location.len() <= 512
            && location
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'/' | b'-' | b'_')))
        .then(|| Self {
            scope,
            location: location.into(),
        })
    }

    /// Notebook may reopen saved citations and run receipts in their owner.
    pub fn notebook_source(href: &str) -> Option<Self> {
        let address = Self::parse(href)?;
        if address.scope.panel != "main" {
            return None;
        }
        let parts: Vec<_> = address.location.split('/').collect();
        let hex = |value: &str, length| {
            value.len() == length && value.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        };
        let valid = match (address.scope.app.as_str(), parts.as_slice()) {
            ("paper-agent", ["report", report, "citation", index]) => {
                hex(report, 64) && !index.is_empty() && index.len() <= 9 && index.bytes().all(|byte| byte.is_ascii_digit())
            }
            ("paper-agent", ["report", report, "passage", passage]) => hex(report, 64) && hex(passage, 64),
            ("control-lab", ["experiment", experiment]) => hex(experiment, 32),
            ("control-lab", ["experiment", experiment, "trial", trial]) => hex(experiment, 32) && hex(trial, 32),
            _ => false,
        };
        valid.then_some(address)
    }
}
#[cfg(test)]
mod location_tests {
    use super::*;
    #[test]
    fn app_locations_are_scoped_opaque_addresses() {
        for (url, valid) in [
            (
                "pero-app-location://paper-agent/main/report/abc/citation/0",
                true,
            ),
            ("https://example.org", false),
            ("pero-app-location://paper-agent/main/", false),
            ("pero-app-location://paper-agent/main/../secret", false),
            ("pero-app-location://paper-agent/main/%2fsecret", false),
            ("pero-app-location://Paper/main/report", false),
        ] {
            assert_eq!(AppLocation::parse(url).is_some(), valid, "{url}");
        }
    }

    #[test]
    fn notebook_reopens_only_its_supported_research_locations() {
        let digest = "a".repeat(64);
        let id = "a".repeat(32);
        for (href, allowed) in [
            (format!("pero-app-location://paper-agent/main/report/{digest}/citation/0"), true),
            (format!("pero-app-location://paper-agent/main/report/{digest}/passage/{digest}"), true),
            (format!("pero-app-location://control-lab/main/experiment/{id}/trial/{id}"), true),
            (format!("pero-app-location://control-lab/main/experiment/{id}"), true),
            (format!("pero-app-location://paper-agent/main/report/{digest}/citation/0?extra=1"), false),
            (format!("pero-app-location://data/main/report/{digest}/citation/0"), false),
        ] {
            assert_eq!(AppLocation::notebook_source(&href).is_some(), allowed, "{href}");
        }
    }
}
