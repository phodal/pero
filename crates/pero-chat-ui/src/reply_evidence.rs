//! Reading projection for exact JSON tool receipts echoed in assistant prose.
//! Stored messages and tool evidence remain unchanged.
use std::ops::Range;

pub(crate) fn echoed_receipt(text: &str, receipt: &str) -> Option<Range<usize>> {
    let receipt = receipt.trim();
    let receipt = receipt
        .strip_prefix("```json\n")
        .and_then(|value| value.strip_suffix("```"))
        .map(str::trim)
        .unwrap_or(receipt);
    if !receipt.starts_with(['{', '['])
        || serde_json::from_str::<serde_json::Value>(receipt).is_err()
    {
        return None;
    }
    // Matching a known prefix also prevents a streaming echo growing into a
    // screenful of JSON before its final chunk arrives. UTF-8 boundaries stay exact.
    let prefix_end = receipt
        .char_indices()
        .nth(32)
        .map(|(index, _)| index)
        .unwrap_or(receipt.len());
    let start = text.find(&receipt[..prefix_end])?;
    let tail = &text[start..];
    let end = if tail.starts_with(receipt) {
        start + receipt.len()
    } else if receipt.starts_with(tail) {
        text.len()
    } else {
        return None;
    };
    let fenced_start = text[..start]
        .strip_suffix("```json\n")
        .map(|prefix| prefix.len())
        .or_else(|| {
            text[..start]
                .strip_suffix("```\n")
                .map(|prefix| prefix.len())
        });
    let fenced_end = text[end..].strip_prefix("\n```").map(|_| end + 4);
    Some(
        fenced_start.unwrap_or(start)..if fenced_start.is_some() {
            fenced_end.unwrap_or(end)
        } else {
            end
        },
    )
}

#[cfg(any(target_family = "wasm", feature = "native"))]
mod view {
    use super::echoed_receipt;
    use crate::{
        conversation::{Conversation, StreamItem},
        stream::StreamText,
    };
    use gpui_kit::{prelude::*, *};

    pub(crate) struct ReplyPresentation {
        pub summary: String,
    }
    impl Conversation {
        pub(crate) fn reply_presentation(&self, index: usize) -> Option<ReplyPresentation> {
            let message = self
                .messages
                .get(index)
                .filter(|message| message.role == "assistant")?;
            let mut receipts = Vec::new();
            for entry in &self.timeline {
                match *entry {
                    StreamItem::Message(i) if i == index => break,
                    StreamItem::Message(i) if self.messages[i].role == "user" => receipts.clear(),
                    StreamItem::Tool(i) => receipts.push(&self.tools[i].content),
                    _ => {}
                }
            }
            let mut summary = message.text.clone();
            let mut changed = false;
            for receipt in receipts {
                if let Some(range) = echoed_receipt(&summary, receipt) {
                    summary.replace_range(range, "");
                    changed = true;
                }
            }
            changed.then(|| ReplyPresentation {
                summary: summary.trim().to_owned(),
            })
        }
    }

    #[derive(gpui_kit::IntoElement)]
    pub(crate) struct ReadableReply {
        pub original: Entity<StreamText>,
        pub summary: String,
    }
    struct RetainedSummary {
        source: String,
        view: Entity<StreamText>,
        _links: Subscription,
    }
    impl RenderOnce for ReadableReply {
        fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
            let images = self.original.read(cx).images.clone();
            let summary = self.summary;
            let retained = window.use_keyed_state(
                ("readable-reply", self.original.entity_id()),
                cx,
                |_, cx| {
                    let view = cx.new(|cx| {
                        let mut view = StreamText::new(&summary, cx);
                        view.images = images;
                        view.capture_links = true;
                        view
                    });
                    let original = self.original.clone();
                    let links = cx.subscribe(&view, move |_, _, link: &crate::stream::MarkdownLink, cx| {
                        original.update(cx, |_, cx| cx.emit(link.clone()));
                    });
                    RetainedSummary {
                        source: summary.clone(),
                        view,
                        _links: links,
                    }
                },
            );
            retained.update(cx, |state, cx| {
                if state.source != summary {
                    state.view.update(cx, |view, cx| view.replace(&summary, cx));
                    state.source = summary;
                }
            });
            div().min_w_0().child(retained.read(cx).view.clone())
        }
    }
}
#[cfg(any(target_family = "wasm", feature = "native"))]
pub(crate) use view::ReadableReply;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_exact_same_turn_receipt_echoes_are_disclosed() {
        let receipt =
            r#"{"exitCode":0,"stdout":{"text":"observed evidence"},"stderr":{"text":""}}"#;
        for (text, expected) in [
            (
                format!("Evidence was written. {receipt}"),
                Some("Evidence was written. "),
            ),
            (
                format!("Before.\n```json\n{receipt}\n```\nAfter."),
                Some("Before.\n\nAfter."),
            ),
            (
                format!("证据已生成。{}", &receipt[..40]),
                Some("证据已生成。"),
            ),
            (
                receipt.replace("observed evidence", "different evidence"),
                None,
            ),
            ("Explain JSON: {\"example\":1}".into(), None),
        ] {
            let range = echoed_receipt(&text, receipt);
            let actual = range.map(|range| {
                let mut value = text.clone();
                value.replace_range(range, "");
                value
            });
            assert_eq!(actual.as_deref(), expected);
        }
        assert_eq!(echoed_receipt("hello", "hello"), None);
        assert_eq!(
            echoed_receipt(
                "{not JSON data but a long enough string}",
                "{not JSON data but a long enough string}"
            ),
            None
        );
    }
}
