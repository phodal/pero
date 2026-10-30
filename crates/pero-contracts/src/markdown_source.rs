//! Heading anchors point into the same Markdown bytes the renderer consumes.
use markdown::{ParseOptions, mdast::Node};
use std::{
    collections::{HashMap, HashSet},
    ops::Range,
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MarkdownHeading {
    pub anchor: String,
    pub text: String,
    pub source: Range<usize>,
}
#[derive(Default)]
pub struct MarkdownSource {
    pub headings: Vec<MarkdownHeading>,
}
impl MarkdownSource {
    pub fn parse(source: &str) -> Self {
        let Ok(root) = markdown::to_mdast(source, &ParseOptions::gfm()) else {
            return Self::default();
        };
        let mut this = Self::default();
        let mut occurrences = HashMap::<String, usize>::new();
        let mut used = HashSet::<String>::new();
        fn text(node: &Node, output: &mut String) {
            match node {
                Node::Text(value) => output.push_str(&value.value),
                Node::InlineCode(value) => output.push_str(&value.value),
                Node::Image(value) => output.push_str(&value.alt),
                _ => {
                    if let Some(children) = node.children() {
                        for child in children {
                            text(child, output);
                        }
                    }
                }
            }
        }
        fn walk(
            node: &Node,
            this: &mut MarkdownSource,
            occurrences: &mut HashMap<String, usize>,
            used: &mut HashSet<String>,
        ) {
            if let Node::Heading(heading) = node {
                let mut label = String::new();
                text(node, &mut label);
                let slug: String = label
                    .to_lowercase()
                    .chars()
                    .filter_map(|c| {
                        if c.is_whitespace() {
                            Some('-')
                        } else if c.is_alphanumeric() || c == '_' || c == '-' {
                            Some(c)
                        } else {
                            None
                        }
                    })
                    .collect();
                let count = occurrences.entry(slug.clone()).or_default();
                let anchor = loop {
                    let candidate = if *count == 0 {
                        slug.clone()
                    } else {
                        format!("{slug}-{count}")
                    };
                    *count += 1;
                    if used.insert(candidate.clone()) {
                        break candidate;
                    }
                };
                if let Some(position) = &heading.position {
                    this.headings.push(MarkdownHeading {
                        anchor,
                        text: label,
                        source: position.start.offset..position.end.offset,
                    });
                }
            }
            if let Some(children) = node.children() {
                for child in children {
                    walk(child, this, occurrences, used);
                }
            }
        }
        walk(&root, &mut this, &mut occurrences, &mut used);
        this
    }
    pub fn anchor(&self, fragment: &str) -> Option<Range<usize>> {
        let fragment = percent_encoding::percent_decode_str(fragment)
            .decode_utf8()
            .ok()?;
        self.headings
            .iter()
            .find(|heading| heading.anchor == fragment)
            .map(|heading| heading.source.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn heading_anchors_ignore_code_and_keep_original_markdown_ranges() {
        let source = "# Hello **world**!\n\n```md\n# Ignored\n```\n\nHello *world*!\n===\n\n## 中文 `code`\n";
        let parsed = MarkdownSource::parse(source);
        assert_eq!(
            parsed
                .headings
                .iter()
                .map(|heading| heading.anchor.as_str())
                .collect::<Vec<_>>(),
            vec!["hello-world", "hello-world-1", "中文-code"]
        );
        assert_eq!(
            &source[parsed.anchor("hello-world").unwrap()],
            "# Hello **world**!"
        );
        assert_eq!(
            &source[parsed.anchor("中文-code").unwrap()],
            "## 中文 `code`"
        );
        assert!(parsed.anchor("ignored").is_none());
        assert_eq!(
            parsed.anchor("%E4%B8%AD%E6%96%87-code"),
            parsed.anchor("中文-code")
        );
        let collisions = MarkdownSource::parse("# topic\n# topic-1\n# topic\n");
        assert_eq!(
            collisions
                .headings
                .iter()
                .map(|h| h.anchor.as_str())
                .collect::<Vec<_>>(),
            vec!["topic", "topic-1", "topic-2"]
        );
    }
}
