//! Split geometry and each pane's tab transitions share one navigation owner.
use super::*;
use pero_contracts::{
    pane_tabs::{OpenIntent, ViewId},
    workspace_panes::{PaneId, PaneLayout, SplitDirection},
};
impl WorkspaceNavigation {
    pub(crate) fn ensure_document_layout(&mut self) {
        self.ensure_pane_layout();
    }
    pub(crate) fn pane_layout_visible(&self) -> bool {
        self.pane_layout
            .as_ref()
            .is_some_and(|layout| layout.is_active(&self.route))
    }
    pub(crate) fn ensure_pane_layout(&mut self) {
        if self.pane_layout.is_none() && self.route.supports_pane() {
            self.pane_layout = Some(PaneLayout::new(
                self.route.clone(),
                self.history.reading.clone(),
            ));
        }
    }
    pub(crate) fn pane_layout(&self) -> Option<&PaneLayout> {
        self.pane_layout.as_ref()
    }
    pub(crate) fn pane_layout_mut(&mut self) -> Option<&mut PaneLayout> {
        self.pane_layout.as_mut()
    }
    pub(crate) fn open_item_in_pane(
        &mut self,
        item: WorkspaceItem,
        target: PaneId,
        direction: SplitDirection,
    ) -> Option<PaneId> {
        if !self.items.contains(&item) {
            return None;
        }
        let id = self.pane_layout.as_mut()?.place(
            target,
            direction,
            WorkspaceRoute::Content(item),
            None,
        )?;
        self.focus_pane(id)?;
        Some(id)
    }
    pub(super) fn restore_panes(&mut self, snapshot: &WorkspaceSnapshot) {
        self.pane_layout = snapshot.panes.clone();
    }
    pub(super) fn select_pane_route(&mut self, route: &WorkspaceRoute) -> bool {
        if !route.supports_pane() {
            return false;
        }
        if self.pane_layout.is_none() {
            self.pane_layout = Some(PaneLayout::new(route.clone(), None));
            return true;
        }
        let layout = self.pane_layout.as_mut().unwrap();
        let Some(pane) = layout.focused else {
            return false;
        };
        if let Some(view) = layout
            .leaf(pane)
            .and_then(|leaf| leaf.tabs.find_route(route))
            .map(|item| item.id)
        {
            layout.activate_view(view);
            return true;
        }
        layout
            .open_tab(pane, route.clone(), None, OpenIntent::Permanent)
            .is_some()
    }
    pub(super) fn sync_legacy_panes(&mut self) {
        self.other = None;
        self.focused = PaneSide::Left;
        let Some(layout) = &self.pane_layout else {
            return;
        };
        let leaves = layout.leaves();
        if leaves.len() == 2
            && leaves
                .iter()
                .all(|leaf| leaf.route().is_some_and(WorkspaceRoute::can_clone_pane))
            && leaves[0].route() != leaves[1].route()
        {
            let index = usize::from(layout.focused == Some(leaves[1].id));
            self.other = leaves[1 - index].route().cloned();
            self.focused = if index == 0 {
                PaneSide::Left
            } else {
                PaneSide::Right
            };
        }
    }
    pub(super) fn prune_panes(&mut self) {
        if let Some(layout) = &mut self.pane_layout {
            let panes = layout
                .leaves()
                .into_iter()
                .map(|leaf| leaf.id)
                .collect::<Vec<_>>();
            for pane in panes {
                layout
                    .leaf_mut(pane)
                    .unwrap()
                    .tabs
                    .retain_sources(&self.items);
            }
        }
        self.sync_legacy_panes();
    }
    pub(crate) fn split_pane(&mut self, direction: SplitDirection) -> Option<PaneId> {
        self.ensure_pane_layout();
        let layout = self.pane_layout.as_mut()?;
        let target = layout.focused?;
        let active = layout.leaf(target)?.active().cloned();
        let id = if let Some(item) = active.filter(|item| item.route.can_clone_pane()) {
            layout.split(target, direction, item.route, item.reading)?
        } else {
            layout.split_empty(target, direction)?
        };
        self.focus_pane(id)?;
        Some(id)
    }
    pub(crate) fn focus_pane(&mut self, id: PaneId) -> Option<WorkspaceRoute> {
        let layout = self.pane_layout.as_mut()?;
        let route = layout.focus(id)?;
        self.route = route.clone();
        self.history.reading = layout.leaf(id)?.reading().cloned();
        self.sync_legacy_panes();
        Some(route)
    }
    pub(crate) fn close_pane(&mut self, id: PaneId) -> Option<WorkspaceRoute> {
        let layout = self.pane_layout.as_mut()?;
        if layout.leaves().len() > 1 {
            if !layout.close(id) {
                return None;
            }
        } else {
            let tabs = layout
                .leaf(id)?
                .tabs
                .items()
                .iter()
                .map(|item| item.id)
                .collect::<Vec<_>>();
            for tab in tabs {
                layout.close_tab(tab);
            }
        }
        let focused = layout.focused?;
        self.focus_pane(focused)
    }
    pub(crate) fn move_pane(&mut self, direction: SplitDirection) -> bool {
        let Some(layout) = &mut self.pane_layout else {
            return false;
        };
        let Some(source) = layout.focused else {
            return false;
        };
        let Some(target) = layout.neighbor(source, direction) else {
            return false;
        };
        let Some(view) = layout.leaf(source).and_then(|leaf| leaf.tabs.active_id()) else {
            return false;
        };
        let index = layout.leaf(target).unwrap().tabs.items().len();
        if let Some(view) = layout.move_tab(view, target, index) {
            self.activate_view(view);
            true
        } else {
            false
        }
    }
    pub(crate) fn step_pane_focus(&mut self, direction: SplitDirection) -> Option<PaneId> {
        let layout = self.pane_layout.as_ref()?;
        let id = layout.neighbor(layout.focused?, direction)?;
        self.focus_pane(id)?;
        Some(id)
    }
    pub(crate) fn observe_view_reading(&mut self, id: ViewId, state: ReaderState) {
        let Some(layout) = &mut self.pane_layout else {
            return;
        };
        let Some((pane, _)) = layout.view(id) else {
            return;
        };
        layout
            .leaf_mut(pane)
            .unwrap()
            .tabs
            .observe(id, state.clone());
        if layout.focused == Some(pane) && layout.leaf(pane).unwrap().tabs.active_id() == Some(id) {
            self.history.reading = Some(state);
        }
    }
    pub(crate) fn rebase_document_edit(
        &mut self,
        item: &WorkspaceItem,
        edit: &pero_contracts::text_edit_anchor::TextEdit,
    ) {
        self.history.rebase_edit(item, edit);
        if let Some(layout) = &mut self.pane_layout {
            let ids = layout
                .leaves()
                .into_iter()
                .map(|leaf| leaf.id)
                .collect::<Vec<_>>();
            for id in ids {
                layout.leaf_mut(id).unwrap().tabs.rebase_edit(item, edit);
            }
        }
    }
    pub(crate) fn bind_document_revision(&mut self, item: &WorkspaceItem, revision: u64) {
        self.history.bind_revision(item, revision);
        if let Some(layout) = &mut self.pane_layout {
            let ids = layout
                .leaves()
                .into_iter()
                .map(|leaf| leaf.id)
                .collect::<Vec<_>>();
            for id in ids {
                layout
                    .leaf_mut(id)
                    .unwrap()
                    .tabs
                    .bind_revision(item, revision);
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn document_views_share_source_identity_but_keep_live_locations_and_close_independently() {
        let item = WorkspaceItem::Document {
            origin: ContentOrigin::File { path: "/a".into() },
            source: "/a".into(),
        };
        let mut navigation = WorkspaceNavigation::default();
        navigation.open(item.clone());
        navigation.ensure_document_layout();
        let first = navigation.pane_layout().unwrap().focused.unwrap();
        let second = navigation.split_pane(SplitDirection::Right).unwrap();
        let third = navigation.split_pane(SplitDirection::Down).unwrap();
        navigation.observe_view_reading(
            navigation
                .pane_layout()
                .unwrap()
                .leaf(first)
                .unwrap()
                .active()
                .unwrap()
                .id,
            ReaderState {
                selection: 3..9,
                ..Default::default()
            },
        );
        navigation.observe_view_reading(
            navigation
                .pane_layout()
                .unwrap()
                .leaf(second)
                .unwrap()
                .active()
                .unwrap()
                .id,
            ReaderState {
                selection: 20..30,
                ..Default::default()
            },
        );
        navigation.rebase_document_edit(
            &item,
            &pero_contracts::text_edit_anchor::TextEdit {
                old: 0..0,
                new_len: 7,
                old_lines: 0..0,
                new_line_count: 1,
            },
        );
        assert_eq!(
            navigation
                .pane_layout()
                .unwrap()
                .leaf(first)
                .unwrap()
                .reading()
                .unwrap()
                .selection,
            10..16
        );
        assert_eq!(
            navigation
                .pane_layout()
                .unwrap()
                .leaf(second)
                .unwrap()
                .reading()
                .unwrap()
                .selection,
            27..37
        );
        assert_eq!(navigation.items(), &[item.clone()]);
        assert!(navigation.snapshot().valid());
        let snapshot = navigation.snapshot();
        let mut reopened = WorkspaceNavigation::default();
        reopened.restore(snapshot.clone());
        assert_eq!(reopened.snapshot(), snapshot);
        reopened.close_pane(third);
        assert_eq!(reopened.pane_layout().unwrap().leaves().len(), 2);
        assert!(reopened.items().contains(&item));
        reopened.close(&item);
        assert!(reopened.pane_layout().unwrap().active_items().is_empty());
        assert!(reopened.items().is_empty());
        assert!(reopened.snapshot().valid());
    }
    #[test]
    fn retained_document_observation_cannot_attach_reading_state_to_an_app_route() {
        let document = WorkspaceItem::Document {
            origin: ContentOrigin::App {
                app: "data-agent".into(),
                panel: "main".into(),
            },
            source: "observations.json".into(),
        };
        let mut navigation = WorkspaceNavigation::default();
        navigation.open(document);
        navigation.ensure_document_layout();
        let pane = navigation.pane_layout().unwrap().focused.unwrap();
        navigation.observe_view_reading(
            navigation
                .pane_layout()
                .unwrap()
                .leaf(pane)
                .unwrap()
                .active()
                .unwrap()
                .id,
            ReaderState {
                selection: 99..130,
                ..Default::default()
            },
        );
        navigation.open(WorkspaceItem::App {
            name: "data-agent".into(),
            panel: "main".into(),
        });
        navigation.observe_view_reading(
            navigation
                .pane_layout()
                .unwrap()
                .leaf(pane)
                .unwrap()
                .active()
                .unwrap()
                .id,
            ReaderState {
                selection: 99..130,
                ..Default::default()
            },
        );
        assert!(navigation.snapshot().history.reading.is_none());
        assert!(navigation.snapshot().valid());
        assert!(
            navigation
                .pane_layout()
                .unwrap()
                .leaf(pane)
                .unwrap()
                .reading()
                .is_none()
        );
        assert!(navigation.pane_layout_visible());
    }
}
