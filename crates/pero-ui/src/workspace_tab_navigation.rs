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
        self.history.view_kind = layout.view(id)?.1.kind;
        self.history.preview = layout
            .view(id)
            .is_some_and(|(pane, _)| layout.leaf(pane).unwrap().tabs.preview_id() == Some(id));
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
        let item = layout.reopen_closed(pane)?;
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
        if self.pane_layout.is_none() {
            self.pane_layout = Some(pero_contracts::workspace_panes::PaneLayout::empty());
        }
        let layout = self.pane_layout.as_mut()?;
        let pane = layout.focused?;
        let (_, opened) = layout.open_tab(pane, route, None, intent)?;
        self.activate_view(opened.active);
        opened.replaced
    }
}

/// A quick-open session can restore its original views without undoing source arrivals.
#[derive(Clone)]
pub(crate) struct PreviewOrigin {
    layout: Option<pero_contracts::workspace_panes::PaneLayout>,
    route: WorkspaceRoute,
    history: WorkspaceHistory,
}
impl WorkspaceNavigation {
    pub(crate) fn preview_origin(&self) -> PreviewOrigin {
        PreviewOrigin {
            layout: self.pane_layout.clone(),
            route: self.route.clone(),
            history: self.history.clone(),
        }
    }
    pub(crate) fn cancel_preview(&mut self, origin: PreviewOrigin) -> WorkspaceRoute {
        self.pane_layout = origin.layout;
        self.route = origin.route;
        self.history = origin.history;
        self.sync_legacy_panes();
        self.route.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quick_open_replaces_temporary_views_and_escape_restores_original_pane_and_kind() {
        let doc = |name: &str| WorkspaceItem::Document {
            origin: pero_contracts::content_origin::ContentOrigin::File {
                path: format!("/tmp/{name}"),
            },
            source: name.into(),
        };
        let mut navigation = WorkspaceNavigation::default();
        navigation.open(doc("first"));
        navigation.open(doc("second"));
        navigation.open(doc("third"));
        let first = navigation.items[0].clone();
        navigation.select(&first);
        let baseline = navigation.pane_layout.clone();
        let origin = navigation.preview_origin();
        // Recent sources need not already have a view in the current pane.
        let focused = navigation.pane_layout.as_ref().unwrap().focused.unwrap();
        let second = navigation
            .focused_tabs()
            .unwrap()
            .find_route(&WorkspaceRoute::Content(doc("second")))
            .unwrap()
            .id;
        let third = navigation
            .focused_tabs()
            .unwrap()
            .find_route(&WorkspaceRoute::Content(doc("third")))
            .unwrap()
            .id;
        navigation
            .pane_layout
            .as_mut()
            .unwrap()
            .leaf_mut(focused)
            .unwrap()
            .tabs
            .take(second);
        navigation
            .pane_layout
            .as_mut()
            .unwrap()
            .leaf_mut(focused)
            .unwrap()
            .tabs
            .take(third);
        navigation.open_with_intent(doc("second"), OpenIntent::Preview);
        let replaced = navigation
            .open_with_intent(doc("third"), OpenIntent::Preview)
            .unwrap();
        assert_eq!(replaced.route, WorkspaceRoute::Content(doc("second")));
        assert_eq!(navigation.focused_tabs().unwrap().items().len(), 2);
        navigation.cancel_preview(origin);
        assert_eq!(navigation.pane_layout, baseline);
        assert_eq!(navigation.current(), Some(&first));
        navigation.open_with_intent(doc("new"), OpenIntent::Preview);
        let view = navigation.active_view_id().unwrap();
        navigation.promote_view(view);
        assert_eq!(navigation.focused_tabs().unwrap().preview_id(), None);
        navigation.open_with_intent(doc("next"), OpenIntent::Preview);
        assert!(navigation.focused_tabs().unwrap().item(view).is_some());
        // A utility-page departure preserves the explicit rendered-view identity.
        let source_route = WorkspaceRoute::Content(first.clone());
        let layout = navigation.pane_layout.as_mut().unwrap();
        let pane = layout.focused.unwrap();
        let rendered = layout
            .split_kind(
                pane,
                pero_contracts::workspace_panes::SplitDirection::Right,
                source_route.clone(),
                Some(ReaderState {
                    source: false,
                    ..Default::default()
                }),
                pero_contracts::pane_tabs::PaneItemKind::RenderedPreview,
            )
            .unwrap();
        navigation.focus_pane(rendered);
        let rendered_id = navigation.active_view_id().unwrap();
        navigation.show(WorkbenchPage::Workers);
        let returned = navigation.step_history(false).unwrap();
        assert_eq!(
            returned.view_kind,
            pero_contracts::pane_tabs::PaneItemKind::RenderedPreview
        );
        assert_eq!(navigation.active_view_id(), Some(rendered_id));
        assert_eq!(
            navigation.focused_tabs().unwrap().active().unwrap().kind,
            pero_contracts::pane_tabs::PaneItemKind::RenderedPreview
        );
    }
}
