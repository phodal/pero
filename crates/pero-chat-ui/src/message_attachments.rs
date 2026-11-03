//! Which context labels still need a chip under a sent user message.

/// Labels for contexts that are not already visible as `@label` chips in the
/// sent prompt. App objects become inline mentions in the composer; repeating
/// them under the bubble looks like an extra agent line.
pub(crate) fn attachment_labels(text: &str, contexts: &[serde_json::Value]) -> Vec<String> {
    contexts
        .iter()
        .filter_map(|reference| {
            let label = reference["label"].as_str()?.trim();
            if label.is_empty() {
                return None;
            }
            let mention = format!("@{}", label.replace(['\n', '\r', '\t'], " "));
            (!text.contains(&mention)).then(|| label.to_string())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::attachment_labels;
    use serde_json::json;

    #[test]
    fn skips_context_labels_already_mentioned_inline() {
        let contexts = [
            json!({"label": "Paper Agent"}),
            json!({"label": "notes.md"}),
            json!({"label": "  "}),
        ];
        assert_eq!(
            attachment_labels("@Paper Agent 这篇论文在介绍什么？", &contexts),
            vec!["notes.md".to_string()]
        );
        assert_eq!(
            attachment_labels("summarize this", &contexts),
            vec!["Paper Agent".to_string(), "notes.md".to_string()]
        );
    }
}
