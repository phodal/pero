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
    }
}
