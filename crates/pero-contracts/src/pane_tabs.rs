//! A pane owns its tabs and locations. Sources and the split tree have other owners.
use crate::{
    reader_state::ReaderState,
    text_edit_anchor::TextEdit,
    workspace_session::{HistoryEntry, WorkspaceHistory, WorkspaceItem, WorkspaceRoute},
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ViewId(pub u64);

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaneItem {
    pub id: ViewId,
    pub route: WorkspaceRoute,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reading: Option<ReaderState>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OpenIntent {
    Permanent,
    Preview,
    /// Restoring a history entry must not append another departure.
    History,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PaneTabError {
    InvalidItem,
    DuplicateView,
}
impl std::fmt::Display for PaneTabError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::InvalidItem => "Invalid pane item",
            Self::DuplicateView => "Duplicate pane view",
        })
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct OpenTab {
    pub active: ViewId,
    pub inserted: bool,
    /// Removing a view does not itself discard or release its source.
    pub replaced: Option<PaneItem>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct PaneTabSet {
    items: Vec<PaneItem>,
    active: Option<ViewId>,
    preview: Option<ViewId>,
    pinned_count: usize,
    activation_history: Vec<ViewId>,
    history: WorkspaceHistory,
}

impl PaneTabSet {
    pub fn items(&self) -> &[PaneItem] {
        &self.items
    }
    pub fn active(&self) -> Option<&PaneItem> {
        self.active.and_then(|id| self.item(id))
    }
    pub fn active_id(&self) -> Option<ViewId> {
        self.active
    }
    pub fn preview_id(&self) -> Option<ViewId> {
        self.preview
    }
    pub fn pinned_count(&self) -> usize {
        self.pinned_count
    }
    pub fn history(&self) -> &WorkspaceHistory {
        &self.history
    }
    pub fn item(&self, id: ViewId) -> Option<&PaneItem> {
        self.items.iter().find(|item| item.id == id)
    }
    pub fn find_route(&self, route: &WorkspaceRoute) -> Option<&PaneItem> {
        self.items.iter().find(|item| &item.route == route)
    }
    pub fn is_pinned(&self, id: ViewId) -> bool {
        self.items
            .iter()
            .position(|item| item.id == id)
            .is_some_and(|index| index < self.pinned_count)
    }
    pub fn mru_items(&self) -> Vec<ViewId> {
        self.activation_history.clone()
    }

    fn depart(&mut self) {
        if let Some(item) = self.active().cloned() {
            self.history.reading = item.reading;
            self.history.depart(&item.route);
        }
    }
    fn focus(&mut self, id: ViewId) -> bool {
        let Some(item) = self.item(id) else {
            return false;
        };
        self.history.reading = item.reading.clone();
        self.active = Some(id);
        self.activation_history.retain(|entry| *entry != id);
        self.activation_history.insert(0, id);
        true
    }
    pub fn activate(&mut self, id: ViewId) -> bool {
        if self.item(id).is_none() {
            return false;
        }
        if self.active != Some(id) {
            self.depart();
        }
        self.focus(id)
    }

    pub fn open(&mut self, item: PaneItem, intent: OpenIntent) -> Result<OpenTab, PaneTabError> {
        if item.id.0 == 0
            || !item.route.supports_pane()
            || !HistoryEntry::valid_location(&item.route, item.reading.as_ref())
        {
            return Err(PaneTabError::InvalidItem);
        }
        if let Some(existing) = self.find_route(&item.route).map(|item| item.id) {
            if intent == OpenIntent::Permanent {
                self.promote(existing);
            }
            if intent == OpenIntent::History {
                self.focus(existing);
            } else {
                self.activate(existing);
            }
            return Ok(OpenTab {
                active: existing,
                inserted: false,
                replaced: None,
            });
        }
        if self.item(item.id).is_some() {
            return Err(PaneTabError::DuplicateView);
        }
        let position = self
            .active
            .and_then(|id| self.items.iter().position(|item| item.id == id))
            .map_or(self.items.len(), |index| index + 1)
            .max(self.pinned_count);
        if intent != OpenIntent::History {
            self.depart();
        }
        let mut replaced = None;
        let mut index = position;
        if intent == OpenIntent::Preview {
            if let Some(previous) = self.preview.take() {
                if let Some(at) = self.items.iter().position(|item| item.id == previous) {
                    index = at;
                    replaced = Some(self.items.remove(at));
                    self.activation_history.retain(|id| *id != previous);
                }
            }
            self.preview = Some(item.id);
        }
        let active = item.id;
        self.items.insert(index.min(self.items.len()), item);
        self.focus(active);
        Ok(OpenTab {
            active,
            inserted: true,
            replaced,
        })
    }

    pub fn promote(&mut self, id: ViewId) -> bool {
        if self.preview == Some(id) {
            self.preview = None;
            true
        } else {
            false
        }
    }
    /// Pinned tabs occupy a prefix; a permanent tab need not be pinned.
    pub fn pin(&mut self, id: ViewId, pinned: bool) -> bool {
        let Some(index) = self.items.iter().position(|item| item.id == id) else {
            return false;
        };
        if (index < self.pinned_count) == pinned {
            return false;
        }
        self.promote(id);
        let item = self.items.remove(index);
        if pinned {
            self.items.insert(self.pinned_count, item);
            self.pinned_count += 1;
        } else {
            self.pinned_count -= 1;
            self.items.insert(self.pinned_count, item);
        }
        true
    }
    pub fn move_tab(&mut self, id: ViewId, index: usize) -> bool {
        let Some(previous) = self.items.iter().position(|item| item.id == id) else {
            return false;
        };
        let pinned = previous < self.pinned_count;
        let target = if pinned {
            index.min(self.pinned_count - 1)
        } else {
            index.max(self.pinned_count).min(self.items.len() - 1)
        };
        if previous == target {
            return false;
        }
        let item = self.items.remove(previous);
        self.items.insert(target, item);
        true
    }
    pub fn cycle(&mut self, next: bool) -> Option<ViewId> {
        let index = self
            .items
            .iter()
            .position(|item| Some(item.id) == self.active)?;
        let step = if next { 1 } else { self.items.len() - 1 };
        let id = self.items[(index + step) % self.items.len()].id;
        self.activate(id);
        Some(id)
    }
    pub fn close(&mut self, id: ViewId) -> Option<PaneItem> {
        let index = self.items.iter().position(|item| item.id == id)?;
        if self.active == Some(id) {
            self.depart();
        }
        let removed = self.items.remove(index);
        if index < self.pinned_count {
            self.pinned_count -= 1;
        }
        self.promote(id);
        self.activation_history.retain(|entry| *entry != id);
        if self.active == Some(id) {
            self.active = None;
            self.history.reading = None;
            let fallback = self
                .activation_history
                .first()
                .copied()
                .or_else(|| self.items.get(index.saturating_sub(1)).map(|item| item.id));
            if let Some(id) = fallback {
                self.focus(id);
            }
        }
        Some(removed)
    }
    pub fn observe(&mut self, id: ViewId, reading: ReaderState) {
        let Some(item) = self.items.iter_mut().find(|item| item.id == id) else {
            return;
        };
        if !HistoryEntry::valid_location(&item.route, Some(&reading)) {
            return;
        }
        item.reading = Some(reading.clone());
        if self.active == Some(id) {
            self.history.observe(&item.route, reading);
        }
    }
    pub fn jump(&mut self, id: ViewId, before: ReaderState, after: ReaderState) -> bool {
        let Some(item) = self.item(id).cloned() else {
            return false;
        };
        if !HistoryEntry::valid_location(&item.route, Some(&after)) {
            return false;
        }
        if self.active != Some(id) {
            self.observe(id, after);
            return false;
        }
        let changed = self.history.jump(&item.route, before, after.clone());
        if let Some(item) = self.items.iter_mut().find(|item| item.id == id) {
            item.reading = Some(after);
        }
        changed
    }
    pub fn can_step_history(&self, forward: bool) -> bool {
        self.history
            .can_step_optional(self.active().map(|item| &item.route), forward)
    }
    pub fn step_history(&mut self, forward: bool, new_id: ViewId) -> Option<PaneItem> {
        let route = self.active().map(|item| item.route.clone());
        let previous = self.history.clone();
        let entry = self.history.step_optional(route.as_ref(), forward)?;
        if let Some(id) = self.find_route(&entry.route).map(|item| item.id) {
            if let Some(item) = self.items.iter_mut().find(|item| item.id == id) {
                item.reading = entry.reading;
            }
            self.focus(id);
            return self.item(id).cloned();
        }
        let item = PaneItem {
            id: new_id,
            route: entry.route,
            reading: entry.reading,
        };
        if self.open(item.clone(), OpenIntent::History).is_err() {
            self.history = previous;
            return None;
        }
        Some(item)
    }
    /// Only snapshot admission uses this, once; regular navigation owns its own history.
    pub fn restore_legacy_history(&mut self, mut history: WorkspaceHistory) {
        history.retain(WorkspaceRoute::supports_pane);
        if let Some(item) = self
            .items
            .iter_mut()
            .find(|item| Some(item.id) == self.active)
        {
            if history.reading.is_some()
                && HistoryEntry::valid_location(&item.route, history.reading.as_ref())
            {
                item.reading = history.reading.clone();
            } else {
                history.reading = item.reading.clone();
            }
        } else {
            history.reading = None;
        }
        self.history = history;
    }
    pub fn rebase_edit(&mut self, item: &WorkspaceItem, edit: &TextEdit) {
        for view in &mut self.items {
            if view.route == WorkspaceRoute::Content(item.clone()) {
                if let Some(reading) = &mut view.reading {
                    edit.rebase(reading);
                }
            }
        }
        self.history.rebase_edit(item, edit);
        self.history.reading = self.active().and_then(|item| item.reading.clone());
    }
    pub fn bind_revision(&mut self, item: &WorkspaceItem, revision: u64) {
        for view in &mut self.items {
            if view.route == WorkspaceRoute::Content(item.clone()) {
                if let Some(reading) = &mut view.reading {
                    reading.source_revision = Some(revision);
                }
            }
        }
        self.history.bind_revision(item, revision);
        self.history.reading = self.active().and_then(|item| item.reading.clone());
    }
    pub fn replace_identity(&mut self, old: &WorkspaceItem, new: &WorkspaceItem) {
        let route = WorkspaceRoute::Content(new.clone());
        let existing = self.find_route(&route).map(|item| item.id);
        let mut duplicate = None;
        for view in &mut self.items {
            if view.route == WorkspaceRoute::Content(old.clone()) {
                if let Some(target) = existing {
                    duplicate = Some((view.id, target));
                } else {
                    view.route = route.clone();
                    view.reading = None;
                }
            }
        }
        if let Some((source, target)) = duplicate {
            let focused = self.active == Some(source);
            self.close(source);
            if focused {
                self.focus(target);
            }
        }
        self.history.replace_identity(old, new);
        self.history.reading = self.active().and_then(|item| item.reading.clone());
    }
    pub fn valid(&self) -> bool {
        let mut ids = std::collections::HashSet::new();
        let mut routes = Vec::new();
        for item in &self.items {
            if item.id.0 == 0
                || !ids.insert(item.id)
                || !item.route.supports_pane()
                || routes.contains(&&item.route)
                || !HistoryEntry::valid_location(&item.route, item.reading.as_ref())
            {
                return false;
            }
            routes.push(&item.route);
        }
        self.pinned_count <= self.items.len()
            && self.active.is_some() == !self.items.is_empty()
            && self.active.is_none_or(|id| ids.contains(&id))
            && self
                .preview
                .is_none_or(|id| ids.contains(&id) && !self.is_pinned(id))
            && self.activation_history.len() == self.items.len()
            && self.activation_history.iter().all(|id| ids.remove(id))
            && self
                .history
                .back
                .iter()
                .chain(&self.history.forward)
                .all(|entry| entry.valid() && entry.route.supports_pane())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::content_origin::ContentOrigin;
    fn item(id: u64, path: &str) -> PaneItem {
        PaneItem {
            id: ViewId(id),
            route: WorkspaceRoute::Content(WorkspaceItem::Document {
                origin: ContentOrigin::File { path: path.into() },
                source: path.into(),
            }),
            reading: None,
        }
    }
    #[test]
    fn opening_preview_promotion_pinning_and_mru_close_are_distinct() {
        let mut tabs = PaneTabSet::default();
        for id in 1..=3 {
            tabs.open(item(id, &format!("/{id}")), OpenIntent::Permanent)
                .unwrap();
        }
        tabs.activate(ViewId(1));
        tabs.open(item(4, "/4"), OpenIntent::Permanent).unwrap();
        assert_eq!(
            tabs.items()
                .iter()
                .map(|item| item.id.0)
                .collect::<Vec<_>>(),
            [1, 4, 2, 3]
        );
        assert_eq!(tabs.close(ViewId(4)).unwrap().id, ViewId(4));
        assert_eq!(tabs.active_id(), Some(ViewId(1)));
        tabs.open(item(5, "/preview"), OpenIntent::Preview).unwrap();
        let replacement = tabs.open(item(6, "/next"), OpenIntent::Preview).unwrap();
        assert_eq!(replacement.replaced.unwrap().id, ViewId(5));
        tabs.promote(ViewId(6));
        tabs.open(item(7, "/another"), OpenIntent::Preview).unwrap();
        assert!(tabs.item(ViewId(6)).is_some());
        assert_eq!(tabs.preview_id(), Some(ViewId(7)));
        tabs.pin(ViewId(7), true);
        assert_eq!(tabs.preview_id(), None);
        assert_eq!(tabs.items()[0].id, ViewId(7));
        tabs.move_tab(ViewId(3), 0);
        assert_eq!(tabs.items()[0].id, ViewId(7));
        let duplicate = tabs
            .open(item(8, "/another"), OpenIntent::Permanent)
            .unwrap();
        assert_eq!(duplicate.active, ViewId(7));
        assert!(!duplicate.inserted);
        assert!(tabs.valid());
        let saved: PaneTabSet =
            serde_json::from_value(serde_json::to_value(&tabs).unwrap()).unwrap();
        assert_eq!(saved, tabs);
    }
    #[test]
    fn locations_history_and_edits_stay_in_their_pane_and_can_reopen_closed_tabs() {
        let mut left = PaneTabSet::default();
        let mut right = PaneTabSet::default();
        left.open(item(1, "/same"), OpenIntent::Permanent).unwrap();
        right.open(item(2, "/same"), OpenIntent::Permanent).unwrap();
        let state = |offset| ReaderState {
            selection: offset..offset + 2,
            source: true,
            ..Default::default()
        };
        left.observe(ViewId(1), state(5));
        right.observe(ViewId(2), state(30));
        right.restore_legacy_history(WorkspaceHistory::default());
        assert_eq!(right.active().unwrap().reading, Some(state(30)));
        left.jump(ViewId(1), state(5), state(12));
        assert_eq!(
            left.step_history(false, ViewId(3)).unwrap().reading,
            Some(state(5))
        );
        assert_eq!(right.active().unwrap().reading, Some(state(30)));
        left.close(ViewId(1));
        assert!(left.active().is_none());
        let closed = left.clone();
        assert!(left.step_history(false, ViewId(0)).is_none());
        assert_eq!(left, closed);
        assert_eq!(
            left.step_history(false, ViewId(4)).unwrap().route,
            item(1, "/same").route
        );
        let WorkspaceRoute::Content(source) = &item(1, "/same").route else {
            unreachable!()
        };
        left.rebase_edit(
            source,
            &TextEdit {
                old: 0..0,
                new_len: 4,
                old_lines: 0..0,
                new_line_count: 0,
            },
        );
        assert_eq!(
            left.active().unwrap().reading.as_ref().unwrap().selection,
            9..11
        );
        assert_eq!(right.active().unwrap().reading, Some(state(30)));
        assert!(left.valid());
        assert!(right.valid());
    }
}
