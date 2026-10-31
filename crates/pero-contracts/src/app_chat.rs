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
        let scope = AppChatScope { app: parts.next()?.into(), panel: parts.next()?.into() };
        let location = parts.next()?;
        (scope.valid() && !location.is_empty() && location.len() <= 512
            && location.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'/' | b'-' | b'_')))
            .then(|| Self { scope, location: location.into() })
    }
}
#[cfg(test)]
mod location_tests {
    use super::*;
    #[test]
    fn app_locations_are_scoped_opaque_addresses() {
        for (url, valid) in [
            ("pero-app-location://paper-agent/main/report/abc/citation/0", true),
            ("https://example.org", false),
            ("pero-app-location://paper-agent/main/", false),
            ("pero-app-location://paper-agent/main/../secret", false),
            ("pero-app-location://paper-agent/main/%2fsecret", false),
            ("pero-app-location://Paper/main/report", false),
        ] { assert_eq!(AppLocation::parse(url).is_some(), valid, "{url}"); }
    }
}
