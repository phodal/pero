//! Tab selection and item history are scoped to the focused pane.
use super::*;
use pero_contracts::{
    pane_tabs::{OpenIntent, PaneItem, PaneTabSet, ViewId},
    workspace_panes::PaneId,
};
impl WorkspaceNavigation {
    pub(crate) fn clear_document_locations(&mut self, item: &WorkspaceItem) {
        self.history.clear_document_locations(item);
        if let Some(layout) = &mut self.pane_layout {
            let panes = layout
                .leaves()
                .iter()
                .map(|leaf| leaf.id)
                .collect::<Vec<_>>();
            for pane in panes {
                layout
                    .leaf_mut(pane)
                    .unwrap()
                    .tabs
                    .clear_document_locations(item);
            }
        }
    }

    pub(crate) fn focused_tabs(&self) -> Option<&PaneTabSet> {
        let layout = self.pane_layout.as_ref()?;
        Some(&layout.leaf(layout.focused?)?.tabs)
    }
    pub(crate) fn active_view_id(&self) -> Option<ViewId> {
        self.focused_tabs()?.active_id()
    }
    pub(crate) fn view_count(&self, item: &WorkspaceItem) -> usize {
        self.pane_layout.as_ref().map_or(0, |layout| {
            layout
                .items()
                .iter()
                .filter(|view| view.route == WorkspaceRoute::Content(item.clone()))
                .count()
        })
    }
    pub(crate) fn activate_view(&mut self, id: ViewId) -> Option<WorkspaceRoute> {
        let layout = self.pane_layout.as_mut()?;
        let route = layout.activate_view(id)?;
        self.route = route.clone();
        self.history.reading = layout.view(id)?.1.reading.clone();
        self.sync_legacy_panes();
        Some(route)
    }
    pub(crate) fn close_view(&mut self, id: ViewId) -> Option<PaneItem> {
        let layout = self.pane_layout.as_mut()?;
        let removed = layout.close_tab(id)?;
        let focused = layout.focused?;
        self.focus_pane(focused);
        Some(removed)
    }
    pub(crate) fn move_view(&mut self, id: ViewId, target: PaneId, index: usize) -> Option<ViewId> {
        let moved = self.pane_layout.as_mut()?.move_tab(id, target, index)?;
        self.activate_view(moved)?;
        Some(moved)
    }
    pub(crate) fn reorder_view(&mut self, id: ViewId, index: usize) -> bool {
        let Some(layout) = &mut self.pane_layout else {
            return false;
        };
        let Some((pane, _)) = layout.view(id) else {
            return false;
        };
        layout.leaf_mut(pane).unwrap().tabs.move_tab(id, index)
    }
    pub(crate) fn pin_view(&mut self, id: ViewId, pinned: bool) -> bool {
        let Some(layout) = &mut self.pane_layout else {
            return false;
        };
        let Some((pane, _)) = layout.view(id) else {
            return false;
        };
        layout.leaf_mut(pane).unwrap().tabs.pin(id, pinned)
    }
    pub(crate) fn promote_view(&mut self, id: ViewId) -> bool {
        let Some(layout) = &mut self.pane_layout else {
            return false;
        };
        let Some((pane, _)) = layout.view(id) else {
            return false;
        };
        layout.leaf_mut(pane).unwrap().tabs.promote(id)
    }
    pub(crate) fn keyboard_close_view(&mut self) -> Option<ViewId> {
        let layout = self.pane_layout.as_mut()?;
        let pane = layout.focused?;
        let target = layout.leaf_mut(pane)?.tabs.keyboard_close_target();
        self.focus_pane(pane);
        target
    }
    pub(crate) fn reopen_closed_view(&mut self) -> Option<PaneItem> {
        let layout = self.pane_layout.as_mut()?;
        let pane = layout.focused?;
        let id = layout.allocate_view_id();
        let item = layout.leaf_mut(pane)?.tabs.reopen_closed(id)?;
        if let WorkspaceRoute::Content(source) = &item.route {
            if !self.items.contains(source) {
                self.items.push(source.clone());
            }
        }
        self.activate_view(item.id);
        Some(item)
    }
    pub(crate) fn cycle_pane_tab(&mut self, next: bool) -> Option<WorkspaceRoute> {
        let before = self.active_view_id();
        let was_visible = self.pane_layout_visible();
        let layout = self.pane_layout.as_mut()?;
        let pane = layout.focused?;
        let id = layout.leaf_mut(pane)?.tabs.cycle(next)?;
        if was_visible && before == Some(id) {
            None
        } else {
            self.activate_view(id)
        }
    }
    pub(crate) fn open_with_intent(
        &mut self,
        item: WorkspaceItem,
        intent: OpenIntent,
    ) -> Option<PaneItem> {
        if !self.items.contains(&item) {
            self.items.push(item.clone());
        }
        let route = WorkspaceRoute::Content(item);
        self.ensure_pane_layout();
        if self.pane_layout.is_none() {
            self.set_route(route);
            return None;
        }
        let layout = self.pane_layout.as_mut()?;
        let pane = layout.focused?;
        let (_, opened) = layout.open_tab(pane, route, None, intent)?;
        self.activate_view(opened.active);
        opened.replaced
    }
}
