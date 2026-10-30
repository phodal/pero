//! Explicit jumps share the workbench history with route changes.
use super::{WorkspaceItem, WorkspaceRoute};
use crate::reader_state::ReaderState;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct HistoryEntry {
    pub route: WorkspaceRoute,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reading: Option<ReaderState>,
}
impl<'de> Deserialize<'de> for HistoryEntry {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Saved {
            Located {
                route: WorkspaceRoute,
                #[serde(default)]
                reading: Option<ReaderState>,
            },
            Legacy(WorkspaceRoute),
        }
        Ok(match Saved::deserialize(deserializer)? {
            Saved::Located { route, reading } => Self { route, reading },
            Saved::Legacy(route) => Self {
                route,
                reading: None,
            },
        })
    }
}
impl HistoryEntry {
    fn same_location(&self, other: &Self) -> bool {
        self.route == other.route
            && match (&self.reading, &other.reading) {
                (Some(left), Some(right)) => left.same_location(right),
                // Older route-only entries do not identify a second position.
                _ => true,
            }
    }
    pub fn valid(&self) -> bool {
        self.reading.is_none()
            || matches!(
                self.route,
                WorkspaceRoute::Content(WorkspaceItem::Document { .. })
            )
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct WorkspaceHistory {
    pub reading: Option<ReaderState>,
    pub back: Vec<HistoryEntry>,
    pub forward: Vec<HistoryEntry>,
}
impl WorkspaceHistory {
    /// Observe ordinary cursor/scroll changes without turning each into a jump.
    pub fn observe(&mut self, route: &WorkspaceRoute, state: ReaderState) {
        if matches!(
            route,
            WorkspaceRoute::Content(WorkspaceItem::Document { .. })
        ) {
            self.reading = Some(state);
        }
    }
    pub fn depart(&mut self, route: &WorkspaceRoute) {
        self.back.push(HistoryEntry {
            route: route.clone(),
            reading: self.reading.take(),
        });
        self.forward.clear();
    }
    pub fn jump(
        &mut self,
        route: &WorkspaceRoute,
        before: ReaderState,
        after: ReaderState,
    ) -> bool {
        if !matches!(
            route,
            WorkspaceRoute::Content(WorkspaceItem::Document { .. })
        ) || before.same_location(&after)
        {
            return false;
        }
        let entry = HistoryEntry {
            route: route.clone(),
            reading: Some(before),
        };
        if self
            .back
            .last()
            .is_none_or(|previous| !previous.same_location(&entry))
        {
            self.back.push(entry);
        }
        self.reading = Some(after);
        self.forward.clear();
        true
    }
    pub fn can_step(&self, route: &WorkspaceRoute, forward: bool) -> bool {
        let current = HistoryEntry {
            route: route.clone(),
            reading: self.reading.clone(),
        };
        let entries = if forward { &self.forward } else { &self.back };
        entries.iter().any(|entry| !entry.same_location(&current))
    }
    pub fn step(&mut self, route: &WorkspaceRoute, forward: bool) -> Option<HistoryEntry> {
        let current = HistoryEntry {
            route: route.clone(),
            reading: self.reading.clone(),
        };
        let (from, to) = if forward {
            (&mut self.forward, &mut self.back)
        } else {
            (&mut self.back, &mut self.forward)
        };
        while let Some(entry) = from.pop() {
            if !entry.same_location(&current) {
                to.push(current);
                self.reading = entry.reading.clone();
                return Some(entry);
            }
        }
        None
    }
    pub fn retain(&mut self, mut admitted: impl FnMut(&WorkspaceRoute) -> bool) {
        self.back.retain(|entry| admitted(&entry.route));
        self.forward.retain(|entry| admitted(&entry.route));
    }
    pub fn rebase_edit(&mut self, item: &WorkspaceItem, edit: &crate::text_edit_anchor::TextEdit) {
        let route = WorkspaceRoute::Content(item.clone());
        for entry in self.back.iter_mut().chain(&mut self.forward) {
            if entry.route == route {
                if let Some(reading) = &mut entry.reading {
                    edit.rebase(reading);
                }
            }
        }
    }
    pub fn bind_revision(&mut self, item: &WorkspaceItem, revision: u64) {
        let route = WorkspaceRoute::Content(item.clone());
        for entry in self.back.iter_mut().chain(&mut self.forward) {
            if entry.route == route {
                if let Some(reading) = &mut entry.reading {
                    reading.source_revision = Some(revision);
                }
            }
        }
    }
    pub fn replace_identity(&mut self, old: &WorkspaceItem, new: &WorkspaceItem) {
        for entry in self.back.iter_mut().chain(&mut self.forward) {
            if entry.route == WorkspaceRoute::Content(old.clone()) {
                entry.route = WorkspaceRoute::Content(new.clone());
                if matches!(old, WorkspaceItem::Document { .. }) {
                    // A copied file can also start at revision 1. Source
                    // identity replacement does not prove range compatibility.
                    entry.reading = None;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        content_origin::ContentOrigin,
        workspace_session::{WorkbenchPage, WorkspaceSnapshot},
    };
    #[test]
    fn jumps_restore_positions_branch_and_survive_route_changes() {
        let document = WorkspaceRoute::Content(WorkspaceItem::Document {
            origin: ContentOrigin::File { path: "/a".into() },
            source: "/a".into(),
        });
        let page = WorkspaceRoute::Page(WorkbenchPage::Projects);
        let position = |offset| ReaderState {
            source: true,
            selection: offset..offset + 3,
            scroll: [0., -(offset as f32)],
            query: "retained query".into(),
            folded_lines: vec![2],
            ..Default::default()
        };
        for branch in [false, true] {
            let mut history = WorkspaceHistory::default();
            assert!(!history.jump(&page, position(0), position(50)));
            history.observe(&document, position(0));
            let mut mode_only = position(0);
            mode_only.source = false;
            assert!(!history.jump(&document, position(0), mode_only));
            assert!(history.jump(&document, position(0), position(50)));
            assert!(!history.jump(&document, position(50), position(50)));
            assert_eq!(
                history.step(&document, false).unwrap().reading,
                Some(position(0))
            );
            if branch {
                history.jump(&document, position(0), position(80));
                assert!(!history.can_step(&document, true));
            } else {
                assert_eq!(
                    history.step(&document, true).unwrap().reading,
                    Some(position(50))
                );
                history.depart(&document);
                let entry = history.step(&page, false).unwrap();
                assert_eq!(entry.route, document);
                assert_eq!(entry.reading, Some(position(50)));
            }
            let restored: WorkspaceHistory =
                serde_json::from_value(serde_json::to_value(&history).unwrap()).unwrap();
            assert_eq!(restored, history);
            let WorkspaceRoute::Content(item) = &document else {
                unreachable!()
            };
            let snapshot = WorkspaceSnapshot {
                items: vec![item.clone()],
                route: document.clone(),
                history,
                ..Default::default()
            };
            let value = serde_json::to_value(&snapshot).unwrap();
            assert!(value.get("back").is_some());
            assert_eq!(
                serde_json::from_value::<WorkspaceSnapshot>(value).unwrap(),
                snapshot
            );
        }
        let old: HistoryEntry =
            serde_json::from_value(serde_json::to_value(&document).unwrap()).unwrap();
        assert_eq!(old.route, document);
        assert!(old.reading.is_none());
        let WorkspaceRoute::Content(item) = &document else {
            unreachable!()
        };
        let renamed = WorkspaceItem::Document {
            origin: ContentOrigin::File {
                path: "/copy".into(),
            },
            source: "/copy".into(),
        };
        let mut history = WorkspaceHistory::default();
        history.jump(&document, position(0), position(50));
        history.replace_identity(item, &renamed);
        assert_eq!(history.back[0].route, WorkspaceRoute::Content(renamed));
        assert!(history.back[0].reading.is_none());
    }
    #[test]
    fn source_edits_rebase_only_matching_history_anchors_and_saved_revision() {
        let item = |path: &str| WorkspaceItem::Document {
            origin: ContentOrigin::File { path: path.into() },
            source: path.into(),
        };
        let a = item("/a");
        let b = item("/b");
        let entry = |item: WorkspaceItem| HistoryEntry {
            route: WorkspaceRoute::Content(item),
            reading: Some(ReaderState {
                source_revision: Some(1),
                selection: 10..20,
                query: "preserved".into(),
                ..Default::default()
            }),
        };
        let mut history = WorkspaceHistory {
            back: vec![entry(a.clone()), entry(b.clone())],
            forward: vec![entry(a.clone())],
            ..Default::default()
        };
        history.rebase_edit(
            &a,
            &crate::text_edit_anchor::TextEdit {
                old: 0..0,
                new_len: 7,
                old_lines: 0..0,
                new_line_count: 1,
            },
        );
        history.bind_revision(&a, 2);
        for reading in [&history.back[0].reading, &history.forward[0].reading] {
            let reading = reading.as_ref().unwrap();
            assert_eq!(reading.selection, 17..27);
            assert_eq!(reading.source_revision, Some(2));
            assert_eq!(reading.query, "preserved");
        }
        assert_eq!(history.back[1].reading.as_ref().unwrap().selection, 10..20);
        assert_eq!(
            history.back[1].reading.as_ref().unwrap().source_revision,
            Some(1)
        );
    }
}
