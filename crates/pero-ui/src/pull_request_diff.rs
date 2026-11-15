//! PR API patches become retained Kit diff documents at this presentation boundary.
use gpui_kit::{
    App, AppContext, Entity,
    component::diff::{
        DiffFile, DiffLinePosition, DiffLineRange, DiffParseOptions, DiffSide, DiffState,
    },
};
use pero_contracts::pull_request::{DiscussionSide, PullRequestDiscussion, PullRequestView};
use std::collections::HashSet;

pub(super) struct PullRequestDiff {
    pub state: Entity<DiffState>,
    files: Vec<DiffFile>,
    source: Vec<pero_contracts::pull_request::PullRequestFile>,
    head_sha: String,
    pub notices: Vec<(String, &'static str)>,
    discussion_lines: HashSet<DiffLinePosition>,
}

impl PullRequestDiff {
    pub fn new(cx: &mut App) -> Self {
        Self {
            state: cx.new(|cx| DiffState::new([], cx)),
            files: vec![],
            source: vec![],
            head_sha: String::new(),
            notices: vec![],
            discussion_lines: HashSet::new(),
        }
    }

    pub fn receive(&mut self, view: &PullRequestView, cx: &mut App) {
        let Some(snapshot) = &view.snapshot else {
            return;
        };
        if self.source == snapshot.files.items {
            if self.head_sha != snapshot.head_sha {
                self.head_sha = snapshot.head_sha.clone();
                self.filter(view, cx);
            }
            return;
        }
        self.head_sha = snapshot.head_sha.clone();
        self.source = snapshot.files.items.clone();
        self.files.clear();
        self.notices.clear();
        for file in &snapshot.files.items {
            let (parsed, notice) = parse_file(file);
            self.files.push(parsed);
            if let Some(key) = notice {
                self.notices.push((file.filename.clone(), key));
            }
        }
        self.filter(view, cx);
    }

    pub fn filter(&self, view: &PullRequestView, cx: &mut App) {
        self.state.update(cx, |state, cx| {
            state.set_files(
                self.files
                    .iter()
                    .filter(|file| view.shows_file(file.path()))
                    .cloned(),
                cx,
            )
        });
    }

    /// Ask Kit which supplied source coordinates survive its parsed projection.
    /// The offscreen state keeps this probe separate from the reader's selection.
    pub fn receive_discussion_anchors(
        &mut self,
        discussions: &[PullRequestDiscussion],
        cx: &mut App,
    ) {
        self.discussion_lines.clear();
        let projection = cx.new(|cx| DiffState::new(self.files.clone(), cx));
        projection.update(cx, |state, cx| {
            for position in discussions
                .iter()
                .filter(|discussion| !discussion.outdated)
                .filter_map(discussion_position)
            {
                let range = DiffLineRange::new(
                    position.path().clone(),
                    position.side(),
                    position.line(),
                    position.line(),
                );
                state.set_selected_lines(Some(range.clone()), cx);
                if state.selected_lines().as_ref() == Some(&range) {
                    self.discussion_lines.insert(position);
                }
            }
            state.set_selected_lines(None, cx);
        });
    }

    pub fn contains_discussion_line(&self, position: &DiffLinePosition) -> bool {
        self.discussion_lines.contains(position)
    }
}

pub(super) fn discussion_position(discussion: &PullRequestDiscussion) -> Option<DiffLinePosition> {
    Some(DiffLinePosition::new(
        discussion.path.clone(),
        match discussion.side {
            DiscussionSide::Left => DiffSide::Original,
            DiscussionSide::Right => DiffSide::Modified,
        },
        discussion.display_anchor().line? as usize,
    ))
}

// This is a display conversion, not a second PR or patch state machine.
pub(super) fn parse_file(
    file: &pero_contracts::pull_request::PullRequestFile,
) -> (DiffFile, Option<&'static str>) {
    let old = serde_json::to_string(&format!(
        "a/{}",
        file.previous_filename.as_ref().unwrap_or(&file.filename)
    ))
    .unwrap();
    let new = serde_json::to_string(&format!("b/{}", file.filename)).unwrap();
    let header = format!(
        "diff --git {old} {new}\n--- {}\n+++ {}\n",
        if file.status == "added" {
            "/dev/null"
        } else {
            &old
        },
        if file.status == "removed" {
            "/dev/null"
        } else {
            &new
        }
    );
    if let Some(patch) = file
        .patch
        .as_deref()
        .filter(|patch| patch.starts_with("@@ "))
    {
        let lines: Vec<_> = patch.lines().take(5001).collect();
        let limited = lines.len() > 5000;
        let text = format!("{header}{}\n", lines[..lines.len().min(5000)].join("\n"));
        if let Ok(files) =
            DiffFile::parse_with(&text, DiffParseOptions::new().truncated_hunks(true))
        {
            if let Some(parsed) = files.into_iter().find(DiffFile::has_changes) {
                return (parsed, limited.then_some("pr.diff_limited"));
            }
        }
    }
    // Keep binary, omitted and malformed patches visible as files with a notice.
    let parsed = DiffFile::parse(&header)
        .expect("quoted PR file header")
        .remove(0);
    (parsed, Some("pr.patch_unavailable"))
}

#[cfg(test)]
mod tests {
    use super::parse_file;
    use pero_contracts::pull_request::PullRequestFile;

    #[test]
    fn api_patches_keep_renames_and_unavailable_entries() {
        for (name, previous, status, patch, notice) in [
            (
                "src/中文 file.rs",
                Some("src/old.rs"),
                "renamed",
                Some("@@ -10 +20 @@\n-old\n+new"),
                None,
            ),
            (
                "image.png",
                None,
                "added",
                None,
                Some("pr.patch_unavailable"),
            ),
            (
                "broken.rs",
                None,
                "modified",
                Some("not a patch"),
                Some("pr.patch_unavailable"),
            ),
        ] {
            let file = PullRequestFile {
                filename: name.into(),
                previous_filename: previous.map(Into::into),
                status: status.into(),
                additions: 1,
                deletions: 1,
                patch: patch.map(Into::into),
            };
            let (parsed, actual) = parse_file(&file);
            assert_eq!(parsed.path().as_str(), name);
            assert_eq!(actual, notice, "{name}");
            if notice.is_none() {
                assert_eq!(parsed.original_path().unwrap().as_str(), "src/old.rs");
                assert_eq!((parsed.additions(), parsed.deletions()), (1, 1));
            }
        }
        let large = PullRequestFile {
            filename: "large.rs".into(),
            previous_filename: None,
            status: "added".into(),
            additions: 6000,
            deletions: 0,
            patch: Some(format!("@@ -0,0 +1,6000 @@\n{}", "+line\n".repeat(6000))),
        };
        let (parsed, notice) = parse_file(&large);
        assert_eq!(notice, Some("pr.diff_limited"));
        assert_eq!(parsed.additions(), 4999);
    }
}
