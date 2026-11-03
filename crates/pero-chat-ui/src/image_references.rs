//! Source links for actual tool images, including older unlinked answers.
use markdown::{ParseOptions, mdast::Node, to_mdast};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Default)]
pub struct ImageReferences(HashMap<String, Option<String>>);
impl ImageReferences {
    pub fn observe(&mut self, output: &[Value], delivered: &[String]) {
        if delivered.is_empty() {
            return;
        }
        for item in output {
            let Some(text) = item["content"]["text"].as_str() else {
                continue;
            };
            let Ok(envelope) = serde_json::from_str::<Value>(text) else {
                continue;
            };
            let result = envelope.get("result").unwrap_or(&envelope);
            if result["type"] != "source_image" {
                continue;
            }
            let provenance = &result["provenance"];
            let hashes = ["archiveDigest", "memberId", "previewSha256"]
                .map(|key| provenance[key].as_str().unwrap_or(""));
            if hashes.iter().any(|hash| {
                hash.len() != 64
                    || !hash
                        .bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            }) {
                continue;
            }
            let uri = format!("pero-image://{}", hashes[2]);
            if !delivered.contains(&uri) {
                continue;
            }
            let href = format!(
                "pero-app-location://paper-agent/main/figure/{}/{}",
                hashes[0], hashes[1]
            );
            self.0
                .entry(uri)
                .and_modify(|existing| {
                    if existing.as_ref() != Some(&href) {
                        *existing = None;
                    }
                })
                .or_insert(Some(href));
        }
    }

    pub fn link_markdown(&self, source: &str) -> String {
        if self.0.is_empty() || !source.contains("pero-image://") {
            return source.into();
        }
        let Ok(tree) = to_mdast(source, &ParseOptions::gfm()) else {
            return source.into();
        };
        let mut edits = Vec::new();
        self.collect(&tree, false, &mut edits);
        let mut result = source.to_string();
        for (start, end, replacement) in edits.into_iter().rev() {
            result.replace_range(start..end, &replacement);
        }
        result
    }

    fn collect(&self, node: &Node, linked: bool, edits: &mut Vec<(usize, usize, String)>) {
        // A research figure gets its own paragraph. Mixed text/image paragraphs
        // intentionally use Kit's line-height image layout for icons and avatars.
        if let Node::Link(link) = node {
            if let [Node::Image(image)] = link.children.as_slice() {
                if let (Some(Some(_)), Some(position)) =
                    (self.0.get(&image.url), link.position.as_ref())
                {
                    let markdown =
                        format!("\n\n[![{}]({})]({})\n\n", image.alt, image.url, link.url);
                    edits.push((position.start.offset, position.end.offset, markdown));
                    return;
                }
            }
        }
        if let Node::Image(image) = node {
            if !linked {
                if let (Some(Some(href)), Some(position)) =
                    (self.0.get(&image.url), image.position.as_ref())
                {
                    let markdown = format!("\n\n[![{}]({})]({href})\n\n", image.alt, image.url);
                    edits.push((position.start.offset, position.end.offset, markdown));
                }
            }
        }
        if let Some(children) = node.children() {
            for child in children {
                self.collect(
                    child,
                    linked || matches!(node, Node::Link(_) | Node::LinkReference(_)),
                    edits,
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn image_links_bind_delivered_bytes_and_preserve_markdown() {
        let uri = format!("pero-image://{}", "c".repeat(64));
        let href = format!(
            "pero-app-location://paper-agent/main/figure/{}/{}",
            "a".repeat(64),
            "b".repeat(64)
        );
        let output = [
            json!({"type":"content","content":{"type":"text","text":json!({"result":{"type":"source_image","provenance":{"archiveDigest":"a".repeat(64),"memberId":"b".repeat(64),"previewSha256":"c".repeat(64)}}}).to_string()}}),
        ];
        let mut refs = ImageReferences::default();
        refs.observe(&output, &[]);
        let image = format!("![图表]({uri})");
        assert_eq!(refs.link_markdown(&image), image);
        refs.observe(&output, std::slice::from_ref(&uri));
        let block = format!("\n\n[{image}]({href})\n\n");
        for (source, expected) in [
            (format!("中文 {image} 图注"), format!("中文 {block} 图注")),
            (format!("{image}\n\n{image}"), format!("{block}\n\n{block}")),
            (format!("`{image}`"), format!("`{image}`")),
            (
                format!("```md\n{image}\n```"),
                format!("```md\n{image}\n```"),
            ),
            (format!("[{image}]({href})"), block),
            (
                "![web](https://example.org/image)".into(),
                "![web](https://example.org/image)".into(),
            ),
        ] {
            assert_eq!(refs.link_markdown(&source), expected);
        }
    }
}
