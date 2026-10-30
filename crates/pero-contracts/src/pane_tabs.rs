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
    closed: Vec<HistoryEntry>,
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
    pub fn closed_items(&self) -> &[HistoryEntry] {
        &self.closed
    }
    pub fn can_reopen(&self) -> bool {
        !self.closed.is_empty()
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
            self.history.preview = self.preview == Some(item.id);
            self.history.depart(&item.route);
        }
    }
    fn focus(&mut self, id: ViewId) -> bool {
        let Some(item) = self.item(id) else {
            return false;
        };
        self.history.reading = item.reading.clone();
        self.history.preview = self.preview == Some(id);
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
        self.open_inner(item, intent, intent == OpenIntent::Preview)
    }
    fn open_inner(
        &mut self,
        item: PaneItem,
        intent: OpenIntent,
        preview: bool,
    ) -> Result<OpenTab, PaneTabError> {
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
        if preview {
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
            if self.active == Some(id) {
                self.history.preview = false;
            }
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
        self.promote(id);
        let pinned = previous < self.pinned_count;
        let target = index.min(self.items.len() - 1);
        if previous == target {
            return false;
        }
        let item = self.items.remove(previous);
        self.items.insert(target, item);
        match (pinned, target < self.pinned_count) {
            (false, true) => self.pinned_count += 1,
            (true, false) => self.pinned_count -= 1,
            _ => {}
        }
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
        self.remove(id, true)
    }
    /// Moving a view is not closing it, and must not create a reopen entry.
    pub fn take(&mut self, id: ViewId) -> Option<PaneItem> {
        self.remove(id, false)
    }
    /// Cmd-W preserves pinned tabs and selects the first ordinary tab instead.
    pub fn keyboard_close_target(&mut self) -> Option<ViewId> {
        let active = self.active?;
        if !self.is_pinned(active) {
            return Some(active);
        }
        if let Some(id) = self.items.get(self.pinned_count).map(|item| item.id) {
            self.activate(id);
        }
        None
    }
    fn remove(&mut self, id: ViewId, closing: bool) -> Option<PaneItem> {
        let index = self.items.iter().position(|item| item.id == id)?;
        if closing && self.preview != Some(id) {
            let item = &self.items[index];
            if self.closed.len() == 1024 {
                self.closed.remove(0);
            }
            self.closed.push(HistoryEntry {
                route: item.route.clone(),
                reading: item.reading.clone(),
                preview: false,
            });
        }
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
            self.history.preview = false;
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
    pub fn reopen_closed(&mut self, new_id: ViewId) -> Option<PaneItem> {
        let entry = self.closed.last()?.clone();
        let item = PaneItem {
            id: new_id,
            route: entry.route,
            reading: entry.reading,
        };
        let reading = item.reading.clone();
        let opened = self.open(item, OpenIntent::Permanent).ok()?;
        if let Some(item) = self.items.iter_mut().find(|item| item.id == opened.active) {
            item.reading = reading;
        }
        self.focus(opened.active);
        self.closed.pop();
        self.item(opened.active).cloned()
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
        if self
            .open_inner(item.clone(), OpenIntent::History, entry.preview)
            .is_err()
        {
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
        self.history.preview = self.active == self.preview && self.active.is_some();
    }
    pub fn rebase_edit(&mut self, item: &WorkspaceItem, edit: &TextEdit) {
        if let Some(id) = self
            .find_route(&WorkspaceRoute::Content(item.clone()))
            .map(|item| item.id)
        {
            self.promote(id);
        }
        for view in &mut self.items {
            if view.route == WorkspaceRoute::Content(item.clone()) {
                if let Some(reading) = &mut view.reading {
                    edit.rebase(reading);
                }
            }
        }
        self.history.rebase_edit(item, edit);
        for entry in &mut self.closed {
            entry.rebase_edit(item, edit);
        }
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
        for entry in &mut self.closed {
            entry.bind_revision(item, revision);
        }
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
            self.take(source);
            if focused {
                self.focus(target);
            }
        }
        self.history.replace_identity(old, new);
        for entry in &mut self.closed {
            entry.replace_identity(old, new);
        }
        self.history.reading = self.active().and_then(|item| item.reading.clone());
    }
    /// Reconcile an explicitly removed producer, not an ordinary view close.
    pub fn retain_sources(&mut self, admitted: &[WorkspaceItem]) {
        let keep = |route: &WorkspaceRoute| matches!(route, WorkspaceRoute::Content(item) if admitted.contains(item));
        let removed: Vec<_> = self
            .items
            .iter()
            .filter(|item| !keep(&item.route))
            .map(|item| item.id)
            .collect();
        for id in removed {
            self.take(id);
        }
        self.history.retain(keep);
        self.closed.retain(|entry| keep(&entry.route));
    }
    pub fn clear_document_locations(&mut self, source: &WorkspaceItem) {
        for item in &mut self.items {
            if item.route == WorkspaceRoute::Content(source.clone()) {
                item.reading = item.reading.take().map(ReaderState::without_location);
            }
        }
        self.history.clear_document_locations(source);
        for entry in &mut self.closed {
            entry.clear_document_locations(source);
        }
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
        self.closed.len() <= 1024
            && self.pinned_count <= self.items.len()
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
                .chain(&self.closed)
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
        assert_eq!(tabs.items()[0].id, ViewId(3));
        assert_eq!(tabs.pinned_count(), 2);
        tabs.move_tab(ViewId(3), tabs.items().len());
        assert_eq!(tabs.pinned_count(), 1);
        assert_eq!(tabs.items()[0].id, ViewId(7));
        let duplicate = tabs
            .open(item(8, "/another"), OpenIntent::Permanent)
            .unwrap();
        assert_eq!(duplicate.active, ViewId(7));
        assert!(!duplicate.inserted);
        assert_eq!(tabs.keyboard_close_target(), None);
        assert_eq!(tabs.active_id(), Some(ViewId(1)));
        let previously_closed = tabs.closed_items().to_vec();
        tabs.close(ViewId(2));
        tabs.activate(ViewId(3));
        assert_eq!(
            tabs.reopen_closed(ViewId(9)).unwrap().route,
            item(2, "/2").route
        );
        assert_eq!(tabs.closed_items(), previously_closed);
        tabs.close(ViewId(9));
        tabs.open(item(11, "/2"), OpenIntent::Permanent).unwrap();
        tabs.observe(
            ViewId(11),
            ReaderState {
                selection: 20..22,
                ..Default::default()
            },
        );
        let reopened = tabs.reopen_closed(ViewId(12)).unwrap();
        assert_eq!(reopened.id, ViewId(11));
        assert_eq!(reopened.reading, None);
        tabs.open(item(10, "/temporary"), OpenIntent::Preview)
            .unwrap();
        tabs.close(ViewId(10));
        assert_eq!(tabs.closed_items(), previously_closed);
        tabs.take(ViewId(11));
        assert_eq!(tabs.closed_items(), previously_closed);
        assert!(tabs.valid());
        let saved: PaneTabSet =
            serde_json::from_value(serde_json::to_value(&tabs).unwrap()).unwrap();
        assert_eq!(saved, tabs);
        let mut previews = PaneTabSet::default();
        previews.open(item(1, "/a"), OpenIntent::Preview).unwrap();
        previews.open(item(2, "/b"), OpenIntent::Preview).unwrap();
        previews.step_history(false, ViewId(3)).unwrap();
        assert_eq!(previews.preview_id(), Some(ViewId(3)));
        previews.open(item(4, "/c"), OpenIntent::Preview).unwrap();
        assert_eq!(previews.items().len(), 1);
        assert_eq!(previews.active_id(), Some(ViewId(4)));
        assert!(previews.valid());
        previews.retain_sources(&[]);
        assert!(previews.items().is_empty());
        assert!(!previews.can_reopen());
        assert!(!previews.can_step_history(false));
        assert!(previews.valid());
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
        left.clear_document_locations(source);
        assert_eq!(
            left.active().unwrap().reading.as_ref().unwrap().selection,
            0..0
        );
        assert!(left.active().unwrap().reading.as_ref().unwrap().source);
        assert_eq!(right.active().unwrap().reading, Some(state(30)));
        assert!(left.valid());
        assert!(right.valid());
    }
}
