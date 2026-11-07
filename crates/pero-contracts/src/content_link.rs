//! A rendered link is resolved against its actual source, independent of views.
use crate::{
    app_chat::AppLocation, content_origin::ContentOrigin, pull_request::PullRequestRef,
    web_document::WebAddress,
};

/// A source-independent address chooses a content owner before a renderer opens it.
#[derive(Debug, PartialEq, Eq)]
pub enum WorkspaceLink {
    PullRequest(PullRequestRef),
    App(AppLocation),
    Web(WebAddress),
    External(String),
}
impl WorkspaceLink {
    pub fn parse(href: &str) -> Option<Self> {
        if let Some(address) = AppLocation::parse(href) {
            return Some(Self::App(address));
        }
        if let Ok(reference) = PullRequestRef::try_from(href.to_owned()) {
            return Some(Self::PullRequest(reference));
        }
        if let Ok(address) = WebAddress::try_from(href.to_owned()) {
            return Some(Self::Web(address));
        }
        let url = url::Url::parse(href).ok()?;
        (url.scheme() == "mailto").then(|| Self::External(url.into()))
    }
    /// Standalone readers have no workspace; their known addresses open externally.
    pub fn external_url(&self) -> Option<&str> {
        match self {
            Self::PullRequest(reference) => Some(reference.url()),
            Self::Web(address) => Some(address.as_str()),
            Self::External(url) => Some(url),
            Self::App(_) => None,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum ContentLink {
    File(String),
    Anchor(String),
    Address(WorkspaceLink),
    Unsupported,
}
impl ContentLink {
    /// Resolve a file link lexically for a workspace read. Host remains the
    /// authority for canonical filesystem containment and symlinks.
    pub fn workspace_file(&self, origin: &ContentOrigin, workspace: &str) -> Option<String> {
        let (Self::File(href), ContentOrigin::File { path }) = (self, origin) else {
            return None;
        };
        // File URL path conversion is not available on wasm32; encode path
        // segments without interpreting the Host's paths as client-local files.
        let [base, root] = [path.as_str(), workspace].map(|path| {
            let mut url = url::Url::parse("file:///").expect("file URL");
            url.path_segments_mut().expect("file path").clear().extend(
                path.replace('\\', "/")
                    .split('/')
                    .filter(|part| !part.is_empty()),
            );
            url
        });
        let target = base.join(href).ok()?;
        if target.scheme() != "file" || target.host_str() != root.host_str() {
            return None;
        }
        let prefix = format!("{}/", root.path().trim_end_matches('/'));
        let relative = target.path().strip_prefix(&prefix)?;
        percent_encoding::percent_decode_str(relative)
            .decode_utf8()
            .ok()
            .map(|path| path.into_owned())
    }

    pub fn resolve(origin: &ContentOrigin, href: &str) -> Self {
        if let Some(fragment) = href.strip_prefix('#') {
            return Self::Anchor(fragment.into());
        }
        if let Some(address) = WorkspaceLink::parse(href) {
            return Self::Address(address);
        }
        let absolute = url::Url::parse(href).ok();
        match absolute {
            Some(url) if url.scheme() == "file" && matches!(origin, ContentOrigin::File { .. }) => {
                Self::File(href.into())
            }
            None if matches!(origin, ContentOrigin::File { .. }) => Self::File(href.into()),
            _ => Self::Unsupported,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn addresses_choose_their_content_owner() {
        for (href, kind) in [
            ("https://github.com/Phodal/Pero/pull/164/files#diff", "pr"),
            ("https://github.com/phodal/pero/issues/164", "web"),
            ("http://127.0.0.1:1234/report", "web"),
            ("pero-app-location://paper-agent/main/report/abc", "app"),
            ("mailto:research@example.org", "external"),
            ("pero-app-location://paper-agent/main/../secret", "none"),
            ("javascript:alert(1)", "none"),
            ("file:///tmp/result", "none"),
            ("./result.csv", "none"),
        ] {
            let actual = match WorkspaceLink::parse(href) {
                Some(WorkspaceLink::PullRequest(_)) => "pr",
                Some(WorkspaceLink::App(_)) => "app",
                Some(WorkspaceLink::Web(_)) => "web",
                Some(WorkspaceLink::External(_)) => "external",
                None => "none",
            };
            assert_eq!(actual, kind, "{href}");
        }
    }
    #[test]
    fn links_follow_source_authority() {
        let file = ContentOrigin::File {
            path: "/work/guide/README.md".into(),
        };
        let chat = ContentOrigin::Conversation {
            thread_id: "thread".into(),
        };
        for (origin, href, expected) in [
            (
                &file,
                "../data%20set.json",
                ContentLink::File("../data%20set.json".into()),
            ),
            (&file, "#usage", ContentLink::Anchor("usage".into())),
            (
                &chat,
                "https://example.org/data",
                ContentLink::Address(WorkspaceLink::Web(
                    WebAddress::try_from("https://example.org/data".to_owned()).unwrap(),
                )),
            ),
            (&chat, "../secrets", ContentLink::Unsupported),
            (&chat, "file:///work/data.json", ContentLink::Unsupported),
            (&file, "javascript:alert(1)", ContentLink::Unsupported),
        ] {
            assert_eq!(ContentLink::resolve(origin, href), expected);
        }
        for (href, expected) in [
            ("../data%20set.json", Some("data set.json")),
            ("./result.json#field", Some("guide/result.json")),
            ("../../outside.txt", None),
            ("file:///work/result.json", Some("result.json")),
            ("https://example.org", None),
        ] {
            assert_eq!(
                ContentLink::resolve(&file, href)
                    .workspace_file(&file, "/work")
                    .as_deref(),
                expected
            );
        }
    }
}
