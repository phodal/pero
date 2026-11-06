//! A rendered link is resolved against its actual source, independent of views.
use crate::content_origin::ContentOrigin;

#[derive(Debug, PartialEq, Eq)]
pub enum ContentLink {
    File(String),
    Anchor(String),
    External(String),
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
        let absolute = url::Url::parse(href).ok();
        match absolute {
            Some(url) if matches!(url.scheme(), "http" | "https" | "mailto") => {
                Self::External(url.into())
            }
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
                ContentLink::External("https://example.org/data".into()),
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
