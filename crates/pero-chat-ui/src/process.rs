//! Transcript process groups preserve replies and observed order without changing history.
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", content = "index", rename_all = "snake_case")]
pub enum ProcessEntry {
    Reply(usize),
    Thought(usize),
    Tool(usize),
}
impl ProcessEntry {
    pub fn key(self) -> String {
        match self {
            Self::Reply(index) => format!("reply:{index}"),
            Self::Thought(index) => format!("thought:{index}"),
            Self::Tool(index) => format!("tool:{index}"),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TranscriptRow {
    Reply(usize),
    Process(ProcessGroup),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProcessGroup {
    members: Vec<ProcessEntry>,
}
impl ProcessGroup {
    pub fn members(&self) -> &[ProcessEntry] {
        &self.members
    }
    pub fn first(&self) -> ProcessEntry {
        self.members[0]
    }
}

pub fn transcript_rows(entries: impl IntoIterator<Item = ProcessEntry>) -> Vec<TranscriptRow> {
    let mut rows = Vec::new();
    for entry in entries {
        if let ProcessEntry::Reply(index) = entry {
            rows.push(TranscriptRow::Reply(index));
        } else if let Some(TranscriptRow::Process(group)) = rows.last_mut() {
            group.members.push(entry);
        } else {
            rows.push(TranscriptRow::Process(ProcessGroup {
                members: vec![entry],
            }));
        }
    }
    rows
}

/// Only a committed, normally finished reply receives the conversation action bar.
#[derive(Clone, Default)]
pub struct ReplyActions {
    completed: std::collections::HashSet<usize>,
}
impl ReplyActions {
    pub fn finish(&mut self, reply: Option<usize>, normal: bool) {
        if normal {
            if let Some(index) = reply {
                self.completed.insert(index);
            }
        }
    }
    pub fn contains(&self, index: usize) -> bool {
        self.completed.contains(&index)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ProcessEntry::*;
    #[test]
    fn process_boundaries_and_completed_actions() {
        for (entries, sizes) in [
            (
                vec![Reply(0), Thought(1), Tool(0), Tool(1), Reply(2)],
                vec![1, 3, 1],
            ),
            (vec![Thought(0), Tool(0), Reply(1), Tool(1)], vec![2, 1, 1]),
            (vec![Tool(0), Tool(1)], vec![2]),
            (vec![], vec![]),
        ] {
            let rows = transcript_rows(entries.clone());
            let restored: Vec<_> = rows
                .iter()
                .flat_map(|row| match row {
                    TranscriptRow::Reply(index) => vec![Reply(*index)],
                    TranscriptRow::Process(group) => group.members().to_vec(),
                })
                .collect();
            assert_eq!(restored, entries);
            assert_eq!(
                rows.iter()
                    .map(|row| match row {
                        TranscriptRow::Reply(_) => 1,
                        TranscriptRow::Process(g) => g.members().len(),
                    })
                    .collect::<Vec<_>>(),
                sizes
            );
        }
    }

    #[test]
    fn completed_reply_actions_require_normal_completion() {
        let mut actions = ReplyActions::default();
        for (reply, normal, expected) in [
            (Some(1), false, false),
            (None, true, false),
            (Some(1), true, true),
        ] {
            actions.finish(reply, normal);
            assert_eq!(actions.contains(1), expected);
        }
    }
}
