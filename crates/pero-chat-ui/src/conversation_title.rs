//! An immediate prompt title is replaced only by explicitly reported session metadata.
use serde::{Serialize, Serializer};

#[derive(Clone)]
pub struct ConversationTitle {
    provisional: String,
    reported: Option<String>,
}
impl ConversationTitle {
    pub fn new(placeholder: String) -> Self {
        Self {
            provisional: placeholder,
            reported: None,
        }
    }
    pub fn prompt(&mut self, text: &str) {
        self.provisional = text
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty())
            .and_then(single_line)
            .unwrap_or_default()
            .chars()
            .take(24)
            .collect();
    }
    pub fn report(&mut self, title: Option<&str>) {
        self.reported = title.and_then(single_line);
    }
    pub fn display(&self) -> &str {
        self.reported.as_deref().unwrap_or(&self.provisional)
    }
}
/// A session title is one line. Newlines and repeated spaces come from the
/// prompt or from agent metadata, and both the sidebar and the open tab paint
/// that string directly.
fn single_line(title: &str) -> Option<String> {
    let line = title.split_whitespace().collect::<Vec<_>>().join(" ");
    if line.is_empty() {
        None
    } else {
        Some(line)
    }
}

impl Serialize for ConversationTitle {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.display())
    }
}
impl std::ops::Deref for ConversationTitle {
    type Target = str;
    fn deref(&self) -> &str {
        self.display()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn agent_metadata_replaces_provisional_titles_and_can_clear_itself() {
        let mut title = ConversationTitle::new("New chat".into());
        title.prompt("\n hi\nother line");
        assert_eq!(title.display(), "hi");
        for (reported, expected) in [
            (Some(" 杭州天气查询 "), "杭州天气查询"),
            (Some("当前有什么\napp?"), "当前有什么 app?"),
            (None, "hi"),
            (Some(""), "hi"),
        ] {
            title.report(reported);
            assert_eq!(title.display(), expected);
        }
        title.report(Some("Agent title"));
        title.prompt("later provisional input");
        assert_eq!(title.display(), "Agent title");
    }
}
