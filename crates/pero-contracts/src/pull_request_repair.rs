//! Frozen review evidence reuses the ordinary Composer context contract.
use super::PullRequestSnapshot;
use crate::context::{ContextContent, ContextKind, ContextReference};
use std::hash::{Hash, Hasher};

impl PullRequestSnapshot {
    pub fn discussion_context(&self, id: &str) -> Option<ContextReference> {
        let discussion = self.discussions.items.iter().find(|item| item.id == id)?;
        let anchor = discussion.display_anchor();
        let line = anchor.line;
        let start = anchor.start_line;
        let position = match (start, line) {
            (Some(start), Some(end)) if start != end => format!("{start}-{end}"),
            (_, Some(line)) => line.to_string(),
            _ => "unavailable".into(),
        };
        let source = discussion.comments.first().map(|comment| comment.url.clone())
            .filter(|url| !url.is_empty()).unwrap_or_else(|| self.reference.url().to_owned());
        let mut text = format!(
            "Pull request: {}\nBase: {} ({})\nHead: {} ({})\nDiscussion: {}\nFile: {}\nSide: {:?}\nLines: {}\nOutdated: {}\nResolved: {}\n",
            self.reference.url(), self.base, self.base_sha, self.head, self.head_sha,
            discussion.id, discussion.path, discussion.side, position,
            discussion.outdated, discussion.resolved,
        );
        for comment in &discussion.comments {
            text.push_str(&format!(
                "\nReviewer: {}\nComment: {}\nUpdated: {}\nCommit: {}\nOriginal commit: {}\n\n{}\n",
                comment.author, comment.url, comment.updated_at,
                comment.commit_sha.as_deref().unwrap_or("unavailable"),
                comment.original_commit_sha.as_deref().unwrap_or("unavailable"),
                comment.body,
            ));
            if !comment.diff_hunk.is_empty() {
                text.push_str("\nOriginal review diff:\n");
                text.push_str(&comment.diff_hunk);
                text.push('\n');
            }
        }
        text.push_str("\nCheck the repository, branch and current HEAD against this frozen review before editing. Reproduce or assess the finding, apply a justified fix, and run relevant checks. Do not silently switch branches, publish replies, or resolve the discussion. Report what was verified.\n");
        // The ID distinguishes revisions of the evidence, including edits and
        // replies on the same PR head. Earlier chips retain their frozen bytes.
        let mut revision = std::collections::hash_map::DefaultHasher::new();
        text.hash(&mut revision);
        Some(ContextReference {
            id: format!("pr-discussion:{id}:{:016x}", revision.finish()),
            kind: ContextKind::Selection,
            label: format!("PR #{} · {}:{}", self.reference.number(), discussion.path, position),
            source,
            content: ContextContent::Text { text },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn review_evidence_keeps_its_original_identity_and_location() {
        let mut snapshot: PullRequestSnapshot = serde_json::from_str(r#"{
            "reference":"https://github.com/phodal/pero/pull/164", "title":"Review",
            "body":"", "status":"open", "author":"phodal", "base":"master", "base_sha":"base-sha",
            "head":"fix/review", "head_sha":"head-sha", "additions":1,"deletions":1,"changed_files":1,
            "files":{"items":[],"error":null},"commits":{"items":[],"error":null},
            "checks":{"items":[],"error":null},"reviews":{"items":[],"error":null},
            "discussions":{"items":[{
                "id":"PRRT_review", "path":"src/source.rs", "line":12,"original_line":8,
                "start_line":10,"original_start_line":6,"side":"right","start_side":"right",
                "outdated":false,"resolved":false,"can_reply":true,"can_resolve":true,"can_unresolve":false,
                "comments":[{"id":"PRRC_comment","author":"reviewer","body":"Preserve the draft on failure.",
                    "url":"https://github.com/phodal/pero/pull/164#discussion_r1", "created_at":"2026-11-14T00:00:00Z",
                    "updated_at":"2026-11-14T00:00:00Z", "diff_hunk":"@@ -8 +12 @@\n-old\n+new",
                    "commit_sha":"reviewed-sha", "original_commit_sha":"original-sha"}]
            }],"error":null}
        }"#).unwrap();
        let frozen = snapshot.discussion_context("PRRT_review").unwrap();
        let ContextContent::Text { text: frozen_text } = &frozen.content else { panic!("text evidence") };
        for (outdated, expected) in [(false, "Lines: 10-12"), (true, "Lines: 6-8")] {
            snapshot.discussions.items[0].outdated = outdated;
            let context = snapshot.discussion_context("PRRT_review").unwrap();
            let ContextContent::Text { text } = context.content else { panic!("text evidence") };
            for evidence in [expected, "head-sha", "base-sha", "reviewed-sha", "Original review diff:", "Preserve the draft on failure."] {
                assert!(text.contains(evidence), "{evidence}");
            }
        }
        snapshot.discussions.items[0].comments[0].body = "Updated finding on the same head".into();
        let edited = snapshot.discussion_context("PRRT_review").unwrap();
        assert_ne!(edited.id, frozen.id);
        assert!(frozen_text.contains("Preserve the draft on failure."));
        assert_eq!(ContextReference::validate_all(&[frozen, edited]), Ok(()));
    }
}
