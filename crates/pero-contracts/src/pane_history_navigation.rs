//! History restores a view through the same tree-wide singleton admission as open.
use super::*;
use crate::workspace_session::HistoryEntry;

impl PaneLayout {
    pub fn step_history(&mut self, pane: PaneId, forward: bool) -> Option<PaneItem> {
        let id = self.allocate_view_id();
        let item = self.leaf_mut(pane)?.tabs.step_history(forward, id)?;
        self.admit_history_item(item)
    }
    pub fn reopen_closed(&mut self, pane: PaneId) -> Option<PaneItem> {
        let id = self.allocate_view_id();
        let item = self.leaf_mut(pane)?.tabs.reopen_closed(id)?;
        self.admit_history_item(item)
    }
    pub fn restore_history_entry(&mut self, pane: PaneId, entry: HistoryEntry) -> Option<PaneItem> {
        let id = self.allocate_view_id();
        let item = self.leaf_mut(pane)?.tabs.restore_history_entry(entry, id)?;
        self.admit_history_item(item)
    }
    fn admit_history_item(&mut self, item: PaneItem) -> Option<PaneItem> {
        let active = if !item.route.can_clone_pane() {
            let existing = self
                .items()
                .into_iter()
                .find(|other| other.id != item.id && other.route.shares_pane_instance(&item.route))
                .map(|other| other.id);
            if let Some(existing) = existing {
                let temporary_pane = self.view(item.id)?.0;
                self.leaf_mut(temporary_pane)?.tabs.take(item.id);
                let owner = self.view(existing)?.0;
                self.open_tab(owner, item.route, item.reading, OpenIntent::History)?
                    .1
                    .active
            } else {
                item.id
            }
        } else {
            item.id
        };
        self.activate_view(active)?;
        self.view(active).map(|(_, item)| item.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn history_and_closed_restore_focus_the_existing_singleton_in_another_pane() {
        for reopen in [false, true] {
            let app = WorkspaceRoute::Content(WorkspaceItem::App {
                name: "one".into(),
                panel: "main".into(),
            });
            let other = WorkspaceRoute::Content(WorkspaceItem::Web("two".into()));
            let mut layout = PaneLayout::new(app.clone(), None);
            let left = layout.focused.unwrap();
            let original = layout.leaf(left).unwrap().tabs.active_id().unwrap();
            if reopen {
                layout.close_tab(original);
            }
            layout
                .open_tab(left, other, None, OpenIntent::Permanent)
                .unwrap();
            let right = layout.split_empty(left, SplitDirection::Right).unwrap();
            let expected = if reopen {
                layout
                    .open_tab(right, app.clone(), None, OpenIntent::Permanent)
                    .unwrap()
                    .1
                    .active
            } else {
                layout.move_tab(original, right, 0).unwrap()
            };
            layout.focus(left);
            let restored = if reopen {
                layout.reopen_closed(left)
            } else {
                layout.step_history(left, false)
            }
            .unwrap();
            assert_eq!(restored.id, expected);
            assert_eq!(layout.focused, Some(right));
            assert_eq!(
                layout
                    .items()
                    .iter()
                    .filter(|item| item.route == app)
                    .count(),
                1
            );
            assert!(layout.valid());
        }
    }
}
