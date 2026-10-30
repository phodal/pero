//! Pane transitions are owned by WorkspaceNavigation alongside route history.
use super::*;
use pero_contracts::workspace_panes::{PaneId, PaneLayout, SplitDirection};
impl WorkspaceNavigation {
    pub(crate) fn ensure_document_layout(&mut self) {
        if self.pane_layout.is_none()
            && matches!(self.current(), Some(WorkspaceItem::Document { .. }))
        {
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
    pub(super) fn restore_panes(&mut self, snapshot: &WorkspaceSnapshot) {
        self.pane_layout = snapshot.panes.clone().or_else(|| {
            let other = snapshot.other.clone()?;
            let (left, right) = if snapshot.focused == PaneSide::Left {
                (snapshot.route.clone(), other)
            } else {
                (other, snapshot.route.clone())
            };
            let mut layout = PaneLayout::new(left, None);
            let first = layout.focused?;
            let second = layout.split(first, SplitDirection::Right, right, None)?;
            layout.focus(if snapshot.focused == PaneSide::Left {
                first
            } else {
                second
            });
            Some(layout)
        });
    }
    pub(super) fn select_pane_route(&mut self, route: &WorkspaceRoute) -> bool {
        if !matches!(
            route,
            WorkspaceRoute::Content(WorkspaceItem::Document { .. })
        ) {
            return false;
        }
        let Some(layout) = &mut self.pane_layout else {
            return false;
        };
        let Some(focused) = layout.focused else {
            return false;
        };
        if layout
            .leaf(focused)
            .is_some_and(|view| &view.route == route)
        {
            return true;
        }
        if let Some(id) = layout
            .leaves()
            .iter()
            .find(|view| &view.route == route)
            .map(|view| view.id)
        {
            layout.focus(id);
        } else if let Some(view) = layout.leaf_mut(focused) {
            view.route = route.clone();
            view.reading = None;
        }
        true
    }
    pub(super) fn sync_legacy_panes(&mut self) {
        let Some(layout) = &self.pane_layout else {
            return;
        };
        let leaves = layout.leaves();
        self.other = None;
        self.focused = PaneSide::Left;
        if leaves.len() == 2
            && leaves[0].route != leaves[1].route
            && matches!(
                self.route,
                WorkspaceRoute::Content(WorkspaceItem::Document { .. })
            )
        {
            let index = usize::from(layout.focused == Some(leaves[1].id));
            self.other = Some(leaves[1 - index].route.clone());
            self.focused = if index == 0 {
                PaneSide::Left
            } else {
                PaneSide::Right
            };
        }
    }
    pub(super) fn prune_panes(&mut self) {
        if let Some(layout) = &mut self.pane_layout {
            let removed=layout.leaves().iter().filter(|view|matches!(&view.route,WorkspaceRoute::Content(item) if !self.items.contains(item))).map(|view|view.id).collect::<Vec<_>>();
            for id in removed {
                layout.close(id);
            }
            if layout.root.is_none() {
                self.pane_layout = None;
            }
        }
        self.sync_legacy_panes();
    }
    pub(crate) fn split_pane(&mut self, direction: SplitDirection) -> Option<PaneId> {
        if !matches!(self.current(), Some(WorkspaceItem::Document { .. })) {
            return None;
        }
        if self.pane_layout.is_none() {
            self.pane_layout = Some(PaneLayout::new(
                self.route.clone(),
                self.history.reading.clone(),
            ));
        }
        let layout = self.pane_layout.as_mut()?;
        let id = layout.focused?;
        let view = layout.leaf(id)?.clone();
        let new = layout.split(id, direction, view.route, view.reading);
        self.sync_legacy_panes();
        new
    }
    pub(crate) fn focus_pane(&mut self, id: PaneId) -> Option<WorkspaceRoute> {
        let route = self.pane_layout.as_mut()?.focus(id)?;
        if self.route != route {
            self.history.depart(&self.route);
            self.route = route.clone();
        }
        self.history.reading = self.pane_layout.as_ref()?.leaf(id)?.reading.clone();
        self.sync_legacy_panes();
        Some(route)
    }
    pub(crate) fn close_pane(&mut self, id: PaneId) -> Option<WorkspaceRoute> {
        let layout = self.pane_layout.as_mut()?;
        if layout.leaves().len() <= 1 {
            return None;
        }
        if !layout.close(id) {
            return None;
        }
        let focused = layout.focused?;
        self.focus_pane(focused)
    }
    pub(crate) fn move_pane(&mut self, direction: SplitDirection) -> bool {
        let Some(layout) = &mut self.pane_layout else {
            return false;
        };
        let Some(id) = layout.focused else {
            return false;
        };
        let Some(target) = layout.neighbor(id, direction) else {
            return false;
        };
        let moved = layout.move_to(id, target, direction);
        self.sync_legacy_panes();
        moved
    }
    pub(crate) fn step_pane_focus(&mut self, direction: SplitDirection) -> Option<PaneId> {
        let layout = self.pane_layout.as_ref()?;
        let id = layout.neighbor(layout.focused?, direction)?;
        self.focus_pane(id)?;
        Some(id)
    }
    pub(crate) fn observe_pane_reading(&mut self, id: PaneId, state: ReaderState) {
        if let Some(layout) = &mut self.pane_layout {
            if let Some(view) = layout.leaf_mut(id) {
                view.reading = Some(state.clone());
            }
            if layout.focused == Some(id)
                && layout.leaf(id).is_some_and(|view| view.route == self.route)
                && matches!(
                    self.route,
                    WorkspaceRoute::Content(WorkspaceItem::Document { .. })
                )
            {
                self.history.reading = Some(state);
            }
        }
    }
    pub(crate) fn rebase_document_edit(
        &mut self,
        item: &WorkspaceItem,
        edit: &pero_contracts::text_edit_anchor::TextEdit,
    ) {
        self.history.rebase_edit(item, edit);
        if self.current() == Some(item) {
            if let Some(state) = &mut self.history.reading {
                edit.rebase(state);
            }
        }
        if let Some(layout) = &mut self.pane_layout {
            let ids = layout
                .leaves()
                .iter()
                .filter(|view| view.route == WorkspaceRoute::Content(item.clone()))
                .map(|view| view.id)
                .collect::<Vec<_>>();
            for id in ids {
                if let Some(state) = &mut layout.leaf_mut(id).unwrap().reading {
                    edit.rebase(state);
                }
            }
        }
    }
    pub(crate) fn bind_document_revision(&mut self, item: &WorkspaceItem, revision: u64) {
        self.history.bind_revision(item, revision);
        if self.current() == Some(item) {
            if let Some(state) = &mut self.history.reading {
                state.source_revision = Some(revision);
            }
        }
        if let Some(layout) = &mut self.pane_layout {
            let ids = layout
                .leaves()
                .iter()
                .filter(|view| view.route == WorkspaceRoute::Content(item.clone()))
                .map(|view| view.id)
                .collect::<Vec<_>>();
            for id in ids {
                if let Some(state) = &mut layout.leaf_mut(id).unwrap().reading {
                    state.source_revision = Some(revision);
                }
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
        navigation.observe_pane_reading(
            first,
            ReaderState {
                selection: 3..9,
                ..Default::default()
            },
        );
        navigation.observe_pane_reading(
            second,
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
                .reading
                .as_ref()
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
                .reading
                .as_ref()
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
        assert!(reopened.pane_layout().is_none());
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
        navigation.observe_pane_reading(
            pane,
            ReaderState {
                selection: 99..130,
                ..Default::default()
            },
        );
        navigation.open(WorkspaceItem::App {
            name: "data-agent".into(),
            panel: "main".into(),
        });
        navigation.observe_pane_reading(
            pane,
            ReaderState {
                selection: 99..130,
                ..Default::default()
            },
        );
        assert!(navigation.snapshot().history.reading.is_none());
        assert!(navigation.snapshot().valid());
        assert_eq!(
            navigation
                .pane_layout()
                .unwrap()
                .leaf(pane)
                .unwrap()
                .reading
                .as_ref()
                .unwrap()
                .selection,
            99..130
        );
    }
}
