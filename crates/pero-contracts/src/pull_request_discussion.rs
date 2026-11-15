//! A review discussion keeps its remote identity and the version it comments on.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiscussionSide {
    Left,
    Right,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct DiscussionBody(String);
impl TryFrom<String> for DiscussionBody {
    type Error = &'static str;
    fn try_from(body: String) -> Result<Self, Self::Error> {
        if body.trim().is_empty() {
            Err("A discussion comment cannot be empty")
        } else {
            Ok(Self(body))
        }
    }
}
impl From<DiscussionBody> for String {
    fn from(body: DiscussionBody) -> Self {
        body.0
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PullRequestDiscussionComment {
    pub id: String,
    pub author: String,
    pub body: String,
    pub url: String,
    pub created_at: String,
    pub updated_at: String,
    pub diff_hunk: String,
    pub commit_sha: Option<String>,
    pub original_commit_sha: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PullRequestDiscussion {
    pub id: String,
    pub path: String,
    pub line: Option<u32>,
    pub original_line: Option<u32>,
    pub start_line: Option<u32>,
    pub original_start_line: Option<u32>,
    pub side: DiscussionSide,
    pub start_side: Option<DiscussionSide>,
    pub outdated: bool,
    pub resolved: bool,
    pub can_reply: bool,
    pub can_resolve: bool,
    pub can_unresolve: bool,
    pub comments: Vec<PullRequestDiscussionComment>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DiscussionAnchor {
    pub line: Option<u32>,
    pub start_line: Option<u32>,
}

/// The shell executes only effects admitted against an observed discussion.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DiscussionEffect {
    Reply {
        discussion_id: String,
        body: DiscussionBody,
    },
    SetResolved {
        discussion_id: String,
        resolved: bool,
    },
    Unchanged,
}
impl PullRequestDiscussion {
    pub fn display_anchor(&self) -> DiscussionAnchor {
        if self.outdated {
            DiscussionAnchor {
                line: self.original_line,
                start_line: self.original_start_line,
            }
        } else {
            DiscussionAnchor {
                line: self.line,
                start_line: self.start_line,
            }
        }
    }
    pub fn reply(&self, body: DiscussionBody) -> Result<DiscussionEffect, &'static str> {
        if !self.can_reply {
            return Err("You cannot reply to this discussion");
        }
        Ok(DiscussionEffect::Reply {
            discussion_id: self.id.clone(),
            body,
        })
    }
    pub fn set_resolved(&self, resolved: bool) -> Result<DiscussionEffect, &'static str> {
        if self.resolved == resolved {
            return Ok(DiscussionEffect::Unchanged);
        }
        if resolved && !self.can_resolve || !resolved && !self.can_unresolve {
            return Err("You cannot change this discussion's resolved state");
        }
        Ok(DiscussionEffect::SetResolved {
            discussion_id: self.id.clone(),
            resolved,
        })
    }
}

/// A new comment is bound to the head the user was reading; it is never moved.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NewPullRequestDiscussion {
    pub head_sha: String,
    pub path: String,
    pub side: DiscussionSide,
    pub line: u32,
    #[serde(default)]
    pub start_line: Option<u32>,
    #[serde(default)]
    pub start_side: Option<DiscussionSide>,
    pub body: DiscussionBody,
}
impl NewPullRequestDiscussion {
    pub fn admit(&self, current_head: &str) -> Result<(), &'static str> {
        if self.head_sha.is_empty() || self.head_sha != current_head {
            return Err("The pull request head changed. Refresh before adding a discussion");
        }
        if self.path.is_empty() || self.line == 0 {
            return Err("Choose a file and line, and enter a discussion comment");
        }
        match (self.start_line, self.start_side) {
            (None, None) => Ok(()),
            (Some(start), Some(side)) if start > 0 && side == self.side && start < self.line => {
                Ok(())
            }
            _ => Err("A discussion range must start before its end on the same diff side"),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PullRequestDiscussionUpdated {
    pub reference: super::PullRequestRef,
    pub discussion: PullRequestDiscussion,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discussion_effects_preserve_text_and_permissions() {
        for (can_reply, can_resolve, can_unresolve, resolved, reply_ok, resolve_ok, reopen_ok) in [
            (true, true, false, false, true, true, true),
            (false, false, false, false, false, false, true),
            (true, false, true, true, true, true, true),
            (false, false, false, true, false, true, false),
        ] {
            let discussion = PullRequestDiscussion {
                id: "thread".into(),
                path: "src/main.rs".into(),
                line: Some(3),
                original_line: Some(3),
                start_line: None,
                original_start_line: None,
                side: DiscussionSide::Right,
                start_side: None,
                outdated: false,
                resolved,
                can_reply,
                can_resolve,
                can_unresolve,
                comments: vec![],
            };
            let body =
                DiscussionBody::try_from("  Keep this\n\"exact\" text  ".to_owned()).unwrap();
            let reply = discussion.reply(body.clone());
            assert_eq!(reply.is_ok(), reply_ok);
            if reply_ok {
                assert_eq!(
                    reply.unwrap(),
                    DiscussionEffect::Reply {
                        discussion_id: "thread".into(),
                        body
                    }
                );
            }
            assert_eq!(discussion.set_resolved(true).is_ok(), resolve_ok);
            assert_eq!(discussion.set_resolved(false).is_ok(), reopen_ok);
        }
    }

    #[test]
    fn discussion_locations_remain_bound_to_the_observed_head() {
        for (head, line, start, start_side, expected) in [
            ("current", 3, None, None, true),
            ("previous", 3, None, None, false),
            ("current", 0, None, None, false),
            ("current", 3, Some(1), Some(DiscussionSide::Right), true),
            ("current", 3, Some(3), Some(DiscussionSide::Right), false),
            ("current", 3, Some(1), Some(DiscussionSide::Left), false),
        ] {
            let new = NewPullRequestDiscussion {
                head_sha: head.into(),
                path: "a.rs".into(),
                side: DiscussionSide::Right,
                line,
                start_line: start,
                start_side,
                body: DiscussionBody::try_from("Review".to_owned()).unwrap(),
            };
            assert_eq!(new.admit("current").is_ok(), expected);
        }
    }

    #[test]
    fn discussion_refresh_observes_edits_and_retains_failed_data() {
        use super::super::{PullRequestSection, PullRequestSnapshot, PullRequestView};
        let original: PullRequestSnapshot = serde_json::from_str(r#"{
            "reference":"https://github.com/phodal/pero/pull/164","title":"Review","body":"","status":"open",
            "author":"reviewer","base":"master","head":"feature","head_sha":"head","additions":1,"deletions":0,"changed_files":1,
            "files":{"items":[],"error":null},"commits":{"items":[],"error":null},"checks":{"items":[],"error":null},"reviews":{"items":[],"error":null},
            "discussions":{"items":[{"id":"thread","path":"a.rs","line":3,"original_line":3,"start_line":null,"original_start_line":null,"side":"right","start_side":null,
            "outdated":false,"resolved":false,"can_reply":true,"can_resolve":true,"can_unresolve":false,"comments":[{"id":"comment","author":"reviewer","body":"Original",
            "url":"https://github.com/phodal/pero/pull/164#discussion_r1","created_at":"t1","updated_at":"t1","diff_hunk":"@@ -0,0 +1 @@\n+line","commit_sha":"head","original_commit_sha":"head"}]}],"error":null}}
        "#).unwrap();
        for change in ["unchanged", "edited", "resolved", "failed"] {
            let mut next = original.clone();
            match change {
                "edited" => next.discussions.items[0].comments[0].body = "Edited".into(),
                "resolved" => next.discussions.items[0].resolved = true,
                "failed" => {
                    next.discussions = PullRequestSection {
                        items: vec![],
                        error: Some("offline".into()),
                    }
                }
                _ => {}
            }
            let mut view = PullRequestView::new(original.reference.clone());
            view.refresh("initial".into());
            view.receive("initial", Ok(original.clone()));
            view.refresh_observed("refresh".into());
            view.receive("refresh", Ok(next));
            assert_eq!(view.sections.discussions, change != "unchanged", "{change}");
            let observed = view.snapshot.unwrap();
            assert_eq!(observed.discussions.items.len(), 1, "{change}");
            if change == "failed" {
                assert_eq!(observed.discussions.items, original.discussions.items);
                assert_eq!(observed.discussions.error.as_deref(), Some("offline"));
                assert!(observed.files.error.is_none());
            }
        }
    }
}
