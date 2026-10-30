//! Explicit jumps share the workbench history with route changes.
use super::{WorkspaceItem, WorkspaceRoute};
use crate::pane_tabs::PaneItemKind;
use crate::reader_state::ReaderState;
use serde::{Deserialize, Serialize};

pub const MAX_NAVIGATION_HISTORY: usize = 1024;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct HistoryEntry {
    pub route: WorkspaceRoute,
    #[serde(skip_serializing_if = "PaneItemKind::is_primary")]
    pub view_kind: PaneItemKind,
    #[serde(skip_serializing_if = "is_false")]
    pub preview: bool,
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
                view_kind: PaneItemKind,
                #[serde(default)]
                preview: bool,
                #[serde(default)]
                reading: Option<ReaderState>,
            },
            Legacy(WorkspaceRoute),
        }
        Ok(match Saved::deserialize(deserializer)? {
            Saved::Located {
                route,
                reading,
                preview,
                view_kind,
            } => Self {
                route,
                reading,
                preview,
                view_kind,
            },
            Saved::Legacy(route) => Self {
                route,
                reading: None,
                preview: false,
                view_kind: PaneItemKind::Primary,
            },
        })
    }
}
fn is_false(value: &bool) -> bool {
    !value
}
impl HistoryEntry {
    fn same_location(&self, other: &Self) -> bool {
        self.route == other.route
            && self.view_kind == other.view_kind
            && match (&self.reading, &other.reading) {
                (Some(left), Some(right)) => left.same_location(right),
                // Older route-only entries do not identify a second position.
                _ => true,
            }
    }
    pub fn valid(&self) -> bool {
        Self::valid_location(&self.route, self.reading.as_ref())
            && self.view_kind.valid_for(&self.route)
    }
    pub fn valid_location(route: &WorkspaceRoute, reading: Option<&ReaderState>) -> bool {
        reading.is_none()
            || matches!(
                route,
                WorkspaceRoute::Content(WorkspaceItem::Document { .. })
            )
    }
    pub fn rebase_edit(&mut self, item: &WorkspaceItem, edit: &crate::text_edit_anchor::TextEdit) {
        if self.route == WorkspaceRoute::Content(item.clone()) {
            if let Some(reading) = &mut self.reading {
                edit.rebase(reading);
            }
        }
    }
    pub fn bind_revision(&mut self, item: &WorkspaceItem, revision: u64) {
        if self.route == WorkspaceRoute::Content(item.clone()) {
            if let Some(reading) = &mut self.reading {
                reading.source_revision = Some(revision);
            }
        }
    }
    pub fn replace_identity(&mut self, old: &WorkspaceItem, new: &WorkspaceItem) {
        if self.route == WorkspaceRoute::Content(old.clone()) {
            self.route = WorkspaceRoute::Content(new.clone());
            if matches!(old, WorkspaceItem::Document { .. }) {
                self.reading = None;
            }
        }
    }
    pub fn clear_document_locations(&mut self, item: &WorkspaceItem) {
        if self.route == WorkspaceRoute::Content(item.clone()) {
            self.reading = self.reading.take().map(ReaderState::without_location);
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct WorkspaceHistory {
    pub reading: Option<ReaderState>,
    #[serde(skip_serializing_if = "PaneItemKind::is_primary")]
    pub view_kind: PaneItemKind,
    #[serde(skip_serializing_if = "is_false")]
    pub preview: bool,
    pub back: Vec<HistoryEntry>,
    pub forward: Vec<HistoryEntry>,
}
impl WorkspaceHistory {
    fn push(entries: &mut Vec<HistoryEntry>, entry: HistoryEntry) {
        entries.retain(|previous| !previous.same_location(&entry));
        entries.drain(..entries.len().saturating_sub(MAX_NAVIGATION_HISTORY - 1));
        entries.push(entry);
    }
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
        Self::push(
            &mut self.back,
            HistoryEntry {
                route: route.clone(),
                reading: self.reading.take(),
                preview: std::mem::take(&mut self.preview),
                view_kind: std::mem::take(&mut self.view_kind),
            },
        );
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
            preview: self.preview,
            view_kind: self.view_kind,
        };
        Self::push(&mut self.back, entry);
        self.reading = Some(after);
        self.forward.clear();
        true
    }
    pub fn can_step(&self, route: &WorkspaceRoute, forward: bool) -> bool {
        self.can_step_optional(Some(route), forward)
    }
    pub fn can_step_optional(&self, route: Option<&WorkspaceRoute>, forward: bool) -> bool {
        let entries = if forward { &self.forward } else { &self.back };
        let Some(route) = route else {
            return !entries.is_empty();
        };
        let current = HistoryEntry {
            route: route.clone(),
            reading: self.reading.clone(),
            preview: self.preview,
            view_kind: self.view_kind,
        };
        let entries = if forward { &self.forward } else { &self.back };
        entries.iter().any(|entry| !entry.same_location(&current))
    }
    pub fn step(&mut self, route: &WorkspaceRoute, forward: bool) -> Option<HistoryEntry> {
        self.step_optional(Some(route), forward)
    }
    pub fn step_optional(
        &mut self,
        route: Option<&WorkspaceRoute>,
        forward: bool,
    ) -> Option<HistoryEntry> {
        let Some(route) = route else {
            let entries = if forward {
                &mut self.forward
            } else {
                &mut self.back
            };
            let entry = entries.pop()?;
            self.reading = entry.reading.clone();
            self.preview = entry.preview;
            self.view_kind = entry.view_kind;
            return Some(entry);
        };
        let current = HistoryEntry {
            route: route.clone(),
            reading: self.reading.clone(),
            preview: self.preview,
            view_kind: self.view_kind,
        };
        let (from, to) = if forward {
            (&mut self.forward, &mut self.back)
        } else {
            (&mut self.back, &mut self.forward)
        };
        while let Some(entry) = from.pop() {
            if !entry.same_location(&current) {
                Self::push(to, current);
                self.reading = entry.reading.clone();
                self.preview = entry.preview;
                self.view_kind = entry.view_kind;
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
        for entry in self.back.iter_mut().chain(&mut self.forward) {
            entry.rebase_edit(item, edit);
        }
    }
    pub fn bind_revision(&mut self, item: &WorkspaceItem, revision: u64) {
        for entry in self.back.iter_mut().chain(&mut self.forward) {
            entry.bind_revision(item, revision);
        }
    }
    pub fn replace_identity(&mut self, old: &WorkspaceItem, new: &WorkspaceItem) {
        for entry in self.back.iter_mut().chain(&mut self.forward) {
            entry.replace_identity(old, new);
        }
    }
    pub fn clear_document_locations(&mut self, item: &WorkspaceItem) {
        for entry in self.back.iter_mut().chain(&mut self.forward) {
            entry.clear_document_locations(item);
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
    fn navigation_keeps_recent_distinct_locations_and_expires_old_sources() {
        let mut history = WorkspaceHistory::default();
        for id in 0..MAX_NAVIGATION_HISTORY + 8 {
            history.depart(&WorkspaceRoute::Content(WorkspaceItem::Document {
                origin: ContentOrigin::File {
                    path: format!("/{id}"),
                },
                source: format!("/{id}"),
            }));
        }
        assert_eq!(history.back.len(), MAX_NAVIGATION_HISTORY);
        assert!(history.back.iter().all(|entry| match &entry.route {
            WorkspaceRoute::Content(WorkspaceItem::Document { source, .. }) => source != "/0",
            _ => false,
        }));
        let recent = history.back.last().unwrap().route.clone();
        history.depart(&recent);
        assert_eq!(history.back.len(), MAX_NAVIGATION_HISTORY);
        assert_eq!(
            history
                .back
                .iter()
                .filter(|entry| entry.route == recent)
                .count(),
            1
        );
        assert!(history.step(&recent, false).is_some());
        assert_eq!(history.forward.len(), 1);
    }
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
            preview: false,
            view_kind: PaneItemKind::Primary,
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
