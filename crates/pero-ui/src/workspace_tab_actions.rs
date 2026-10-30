//! Real pane tab commands adapt the pure navigation model to retained views.
use crate::{
    app::Workbench,
    workspace::WorkspaceRoute,
};
use gpui_kit::{prelude::*, *};
use pero_contracts::{
    pane_tabs::ViewId,
    workspace_panes::{PaneId, SplitDirection},
};
gpui_kit::actions!(
    pane_item,
    [
        ClosePaneTab,
        ReopenClosedPaneTab,
        OpenPreviewToSide,
        FocusPane1,
        FocusPane2,
        FocusPane3,
        FocusPane4,
        FocusPane5,
        FocusPane6,
        FocusPane7,
        FocusPane8,
        FocusPane9
    ]
);
impl Workbench {
    pub(crate) fn activate_pane_tab(
        &mut self,
        _pane: PaneId,
        view: ViewId,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.remember_current_location(cx);
        if let Some(route) = self.navigation.activate_view(view) {
            self.ensure_document_panes(window, cx);
            self.activate_route(route, window, cx);
        }
    }
    pub(crate) fn move_pane_tab(
        &mut self,
        view: ViewId,
        pane: PaneId,
        index: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.remember_current_location(cx);
        if let Some(view) = self.navigation.move_view(view, pane, index) {
            self.ensure_document_panes(window, cx);
            self.activate_pane_tab(pane, view, window, cx);
        }
        self.queue_workspace_checkpoint(cx);
        cx.notify();
    }
    pub(crate) fn reorder_pane_tab(&mut self, view: ViewId, index: usize, cx: &mut Context<Self>) {
        self.navigation.reorder_view(view, index);
        self.queue_workspace_checkpoint(cx);
        cx.notify();
    }
    pub(crate) fn pin_pane_tab(&mut self, view: ViewId, pinned: bool, cx: &mut Context<Self>) {
        self.navigation.pin_view(view, pinned);
        self.queue_workspace_checkpoint(cx);
        cx.notify();
    }
    pub(crate) fn promote_pane_tab(&mut self, view: ViewId, cx: &mut Context<Self>) {
        self.navigation.promote_view(view);
        self.queue_workspace_checkpoint(cx);
        cx.notify();
    }
    pub(crate) fn close_keyboard_tab(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(view) = self.navigation.keyboard_close_view() {
            self.close_pane_tab(view, window, cx);
        } else {
            // A pinned active tab is protected from the ordinary keyboard close.
            // Prefer an ordinary tab in this pane, then another pane, as Zed does.
            let target = self.navigation.pane_layout().and_then(|layout| {
                let focused = layout.focused?;
                let current = layout.leaf(focused)?;
                let only_pinned = current
                    .tabs
                    .items()
                    .iter()
                    .all(|item| current.tabs.is_pinned(item.id));
                if only_pinned {
                    layout
                        .leaves()
                        .iter()
                        .filter(|leaf| leaf.id != focused)
                        .find_map(|leaf| {
                            leaf.tabs
                                .items()
                                .iter()
                                .find(|item| !leaf.tabs.is_pinned(item.id))
                                .map(|item| (leaf.id, item.id))
                        })
                } else {
                    current.tabs.active_id().map(|id| (focused, id))
                }
            });
            if let Some((pane, view)) = target {
                self.activate_pane_tab(pane, view, window, cx);
            }
        }
        cx.stop_propagation();
    }
    pub(crate) fn reopen_closed_tab(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.remember_current_location(cx);
        if let Some(item) = self.navigation.reopen_closed_view() {
            self.ensure_document_panes(window, cx);
            self.activate_route(item.route, window, cx);
        }
        self.queue_workspace_checkpoint(cx);
        cx.stop_propagation();
    }
    pub(crate) fn focus_numbered_pane(
        &mut self,
        index: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let Some(id) = self
            .navigation
            .pane_layout()
            .and_then(|layout| layout.leaves().get(index).map(|leaf| leaf.id))
        {
            self.focus_pane(id, window, cx);
        }
        cx.stop_propagation();
    }
    pub(crate) fn preview_to_side(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(item) = self.navigation.current().cloned() else {
            return;
        };
        let Some(reader) = self.active_document_view(&item) else {
            return;
        };
        if reader.read(cx).document.format
            != pero_contracts::content_document::ContentFormat::Markdown
        {
            return;
        }
        let mut reading = reader.read(cx).reading_state(cx);
        reading.source = false;
        self.remember_current_location(cx);
        let Some(layout) = self.navigation.pane_layout_mut() else {
            return;
        };
        let Some(original) = layout.focused else {
            return;
        };
        if layout
            .split_kind(
                original,
                SplitDirection::Right,
                WorkspaceRoute::Content(item),
                Some(reading),
                pero_contracts::pane_tabs::PaneItemKind::RenderedPreview,
            )
            .is_none()
        {
            return;
        }
        layout.focus(original);
        self.ensure_document_panes(window, cx);
        self.focus_pane(original, window, cx);
        self.queue_workspace_checkpoint(cx);
        cx.stop_propagation();
    }
}
