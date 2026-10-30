//! Retained Reader views for pane identities. Immutable sources remain shared.
use crate::{
    app::Workbench,
    workspace::{WorkspaceItem, WorkspaceRoute},
};
use gpui_kit::{
    component::{
        button::*,
        menu::{DropdownMenu, PopupMenuItem},
        *,
    },
    prelude::*,
    *,
};
use pero_chat_ui::content_reader::{ContentReader, ReaderAction};
use pero_contracts::workspace_panes::{
    PaneAxis, PaneBounds, PaneId, PaneNode, PaneSurface, SplitDirection,
};
gpui_kit::actions!(
    pane,
    [
        SplitPaneLeft,
        SplitPaneRight,
        SplitPaneUp,
        SplitPaneDown,
        FocusPaneLeft,
        FocusPaneRight,
        FocusPaneUp,
        FocusPaneDown,
        ClosePane
    ]
);
pub(crate) struct PaneReader {
    pub id: PaneId,
    pub item: WorkspaceItem,
    pub view: Entity<ContentReader>,
    _subscriptions: Vec<Subscription>,
}
pub(crate) struct PaneResize {
    split: u64,
    axis: PaneAxis,
    bounds: PaneBounds,
}
impl Workbench {
    pub(crate) fn active_document_view(
        &self,
        item: &WorkspaceItem,
    ) -> Option<Entity<ContentReader>> {
        let focused = self
            .navigation
            .pane_layout()
            .and_then(|layout| layout.focused);
        self.pane_views
            .iter()
            .find(|view| &view.item == item && Some(view.id) == focused)
            .map(|view| view.view.clone())
            .or_else(|| {
                self.documents
                    .iter()
                    .find(|open| &open.item == item)
                    .map(|open| open.view.clone())
            })
    }
    pub(crate) fn ensure_document_panes(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let leaves = self
            .navigation
            .pane_layout()
            .map(|layout| layout.leaves().into_iter().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        self.pane_views.retain(|view| {
            leaves.iter().any(|leaf| {
                leaf.id == view.id && leaf.route == WorkspaceRoute::Content(view.item.clone())
            })
        });
        self.pane_surfaces
            .retain(|surface| leaves.iter().any(|leaf| leaf.id == surface.id));
        for leaf in leaves {
            let WorkspaceRoute::Content(item @ WorkspaceItem::Document { .. }) = leaf.route else {
                continue;
            };
            if self.pane_views.iter().any(|view| view.id == leaf.id) {
                continue;
            }
            let Some(primary) = self
                .documents
                .iter()
                .find(|open| open.item == item)
                .map(|open| open.view.clone())
            else {
                self.request_workspace_source(&item, cx);
                continue;
            };
            let reading = leaf
                .reading
                .unwrap_or_else(|| primary.read(cx).reading_state(cx));
            let used = self.pane_views.iter().any(|view| view.view == primary);
            let (view, subscriptions) = if !used {
                (primary.clone(), vec![])
            } else {
                let document = primary.read(cx).document.clone();
                let locale = self.locale.clone();
                let view = cx.new(|cx| {
                    ContentReader::new(document, locale, window, cx).workspace(window, cx)
                });
                let close = item.clone();
                let subscription =
                    cx.subscribe_in(&view, window, move |this, view, action, window, cx| {
                        this.handle_document_action(&close, view, action, window, cx)
                    });
                let observed = item.clone();
                let observer = cx.observe(&view, move |this, view, cx| {
                    this.observe_document_view(&observed, &view, cx)
                });
                (view, vec![subscription, observer])
            };
            let draft = primary.read(cx).draft(cx);
            view.update(cx, |view, cx| {
                if used {
                    if let Some(draft) = draft {
                        view.restore_draft(draft, window, cx);
                    }
                }
                view.restore_reading_state(reading, window, cx);
            });
            self.pane_views.push(PaneReader {
                id: leaf.id,
                item,
                view,
                _subscriptions: subscriptions,
            });
        }
    }
    pub(crate) fn observe_document_view(
        &mut self,
        item: &WorkspaceItem,
        view: &Entity<ContentReader>,
        cx: &mut Context<Self>,
    ) {
        let reading = view.read(cx).reading_state(cx);
        if let Some(pane) = self.pane_views.iter().find(|pane| pane.view == *view) {
            self.navigation.observe_pane_reading(pane.id, reading);
        } else if self.navigation.pane_layout().is_none() {
            self.navigation.observe_reading(item, reading);
        }
        self.queue_workspace_checkpoint(cx);
        cx.notify();
    }
    pub(crate) fn handle_document_action(
        &mut self,
        item: &WorkspaceItem,
        view: &Entity<ContentReader>,
        action: &ReaderAction,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !matches!(
            action,
            ReaderAction::Edit { .. }
                | ReaderAction::Undo { .. }
                | ReaderAction::EditTransaction { .. }
        ) {
            if let Some(id) = self
                .pane_views
                .iter()
                .find(|pane| pane.view == *view)
                .map(|pane| pane.id)
            {
                self.navigation.focus_pane(id);
            }
        }
        match action {
            ReaderAction::Focus=>{self.sync_follow(cx);self.queue_workspace_checkpoint(cx);cx.notify();},
            ReaderAction::EditTransaction {begin}=>{if let Some(primary)=self.documents.iter().find(|open|&open.item==item).map(|open|open.view.clone()) {if primary!=*view {primary.update(cx,|view,cx|view.document_transaction(*begin,window,cx));}}},
            ReaderAction::Undo {redo}=>{if let Some(primary)=self.documents.iter().find(|open|&open.item==item).map(|open|open.view.clone()) {primary.update(cx,|view,cx|view.undo_document(*redo,window,cx));}},
            ReaderAction::Edit {edit,inserted}=>self.synchronize_document_edit(item,view,edit,inserted,window,cx),
            ReaderAction::Save {source,revision,text}=>self.command(serde_json::json!({"method":"documents","action":"save","request_id":format!("save:{source}"),"source":source,"revision":revision,"text":text}),cx),
            ReaderAction::Reload {path}=>self.command(serde_json::json!({"method":"documents","action":"open","request_id":"reload","path":path}),cx),
            ReaderAction::DiscardAndClose=>self.discard_document(item,window,cx),
            ReaderAction::Navigate {before,after}=>self.record_document_jump(item,before.clone(),after.clone(),cx),
            ReaderAction::Link(href)=> {
                let WorkspaceItem::Document {origin,source}=item else {return;};
                match pero_contracts::content_link::ContentLink::resolve(origin,href) {
                    pero_contracts::content_link::ContentLink::File(href)=>self.command(serde_json::json!({"method":"documents","action":"follow","request_id":"link","source":source,"href":href}),cx),
                    pero_contracts::content_link::ContentLink::External(url)=>cx.open_url(&url),
                    _=>{self.error=Some(self.t("content.link_unavailable").into());cx.notify();}
                }
            }
        }
    }
    fn synchronize_document_edit(
        &mut self,
        item: &WorkspaceItem,
        emitter: &Entity<ContentReader>,
        edit: &pero_contracts::text_edit_anchor::TextEdit,
        inserted: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.navigation.rebase_document_edit(item, edit);
        let Some(primary) = self
            .documents
            .iter()
            .find(|open| &open.item == item)
            .map(|open| open.view.clone())
        else {
            return;
        };
        let mut receivers = vec![];
        if primary != *emitter {
            receivers.push((primary.clone(), true));
        }
        for pane in &self.pane_views {
            if &pane.item == item
                && pane.view != *emitter
                && pane.view != primary
                && !receivers.iter().any(|(view, _)| *view == pane.view)
            {
                receivers.push((pane.view.clone(), false));
            }
        }
        for (view, canonical) in receivers {
            let mut reading = view.read(cx).reading_state(cx);
            edit.rebase(&mut reading);
            view.update(cx, |view, cx| {
                if canonical {
                    view.apply_document_edit(edit.old.clone(), inserted.to_owned(), window, cx);
                } else {
                    view.apply_shared_edit(edit.old.clone(), inserted.to_owned(), window, cx);
                }
                view.restore_reading_state(reading, window, cx);
            });
        }
        self.queue_workspace_checkpoint(cx);
    }
    pub(crate) fn focus_pane(&mut self, id: PaneId, window: &mut Window, cx: &mut Context<Self>) {
        self.remember_current_location(cx);
        if let Some(route) = self.navigation.focus_pane(id) {
            self.activate_route(route, window, cx);
        }
    }
    pub(crate) fn split_document_pane(
        &mut self,
        direction: SplitDirection,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.remember_current_location(cx);
        if let Some(id) = self.navigation.split_pane(direction) {
            self.ensure_document_panes(window, cx);
            self.focus_pane(id, window, cx);
        }
        self.queue_workspace_checkpoint(cx);
    }
    pub(crate) fn close_document_pane(
        &mut self,
        id: PaneId,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self
            .navigation
            .pane_layout()
            .is_some_and(|layout| layout.leaves().len() <= 1)
        {
            if let Some(item) = self.navigation.current().cloned() {
                self.close_content(&item, window, cx);
            }
            return;
        }
        self.remember_current_location(cx);
        if let Some(route) = self.navigation.close_pane(id) {
            self.ensure_document_panes(window, cx);
            self.activate_route(route, window, cx);
        }
        self.queue_workspace_checkpoint(cx);
    }
    pub(crate) fn focus_document_pane_direction(
        &mut self,
        direction: SplitDirection,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.remember_current_location(cx);
        if let Some(id) = self.navigation.step_pane_focus(direction) {
            self.focus_pane(id, window, cx);
        }
    }
    pub(crate) fn close_active_document_pane(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let Some(id) = self
            .navigation
            .pane_layout()
            .and_then(|layout| layout.focused)
        {
            self.close_document_pane(id, window, cx);
        } else if let Some(item) = self.navigation.current().cloned() {
            self.close_content(&item, window, cx);
        }
    }
    pub(crate) fn observe_pane_surface(
        &mut self,
        id: PaneId,
        route: WorkspaceRoute,
        bounds: Bounds<Pixels>,
        _cx: &mut Context<Self>,
    ) {
        let focused = self
            .navigation
            .pane_layout()
            .is_some_and(|layout| layout.focused == Some(id));
        let surface = PaneSurface {
            id,
            route,
            bounds: PaneBounds {
                x: f32::from(bounds.origin.x),
                y: f32::from(bounds.origin.y),
                width: f32::from(bounds.size.width),
                height: f32::from(bounds.size.height),
            },
            focused,
        };
        if let Some(previous) = self
            .pane_surfaces
            .iter_mut()
            .find(|surface| surface.id == id)
        {
            *previous = surface;
        } else {
            self.pane_surfaces.push(surface);
        }
    }
    pub(crate) fn resize_document_pane(&mut self, position: Point<Pixels>, cx: &mut Context<Self>) {
        let Some(resize) = &self.pane_resize else {
            return;
        };
        let ratio = match resize.axis {
            PaneAxis::Horizontal => (f32::from(position.x) - resize.bounds.x) / resize.bounds.width,
            PaneAxis::Vertical => (f32::from(position.y) - resize.bounds.y) / resize.bounds.height,
        };
        if self
            .navigation
            .pane_layout_mut()
            .is_some_and(|layout| layout.resize(resize.split, ratio.clamp(0.05, 0.95)))
        {
            cx.notify();
        }
    }
    fn pane_actions(&self, id: PaneId, cx: &mut Context<Self>) -> AnyElement {
        let owner = cx.entity().downgrade();
        let locale = self.locale.clone();
        let clone_allowed = self
            .navigation
            .pane_layout()
            .and_then(|layout| layout.leaf(id))
            .is_some_and(|view| {
                matches!(
                    view.route,
                    WorkspaceRoute::Content(WorkspaceItem::Document { .. })
                )
            });
        let movable = [
            SplitDirection::Left,
            SplitDirection::Right,
            SplitDirection::Up,
            SplitDirection::Down,
        ]
        .into_iter()
        .filter(|direction| {
            self.navigation
                .pane_layout()
                .is_some_and(|layout| layout.neighbor(id, *direction).is_some())
        })
        .collect::<Vec<_>>();
        Button::new(("pane-actions", id.0 as usize))
            .ghost()
            .small()
            .icon(Icon::default().path("icons/chevron-down.svg"))
            .tooltip(self.t("workspace.pane_actions"))
            .accessibility_label(self.t("workspace.pane_actions"))
            .dropdown_caret(false)
            .dropdown_menu_with_anchor(Anchor::BottomRight, move |menu, _, _| {
                let mut menu = menu;
                for (direction, split, move_key) in [
                    (
                        SplitDirection::Left,
                        "workspace.split_left",
                        "workspace.move_left",
                    ),
                    (
                        SplitDirection::Right,
                        "workspace.split_right",
                        "workspace.move_right",
                    ),
                    (
                        SplitDirection::Up,
                        "workspace.split_up",
                        "workspace.move_up",
                    ),
                    (
                        SplitDirection::Down,
                        "workspace.split_down",
                        "workspace.move_down",
                    ),
                ] {
                    let target = owner.clone();
                    if clone_allowed {
                        menu = menu.item(
                            PopupMenuItem::new(pero_contracts::i18n::text(&locale, split))
                                .on_click(move |_, window, cx| {
                                    let _ = target.update(cx, |this, cx| {
                                        this.focus_pane(id, window, cx);
                                        this.split_document_pane(direction, window, cx);
                                    });
                                }),
                        );
                    }
                    let target = owner.clone();
                    menu = menu.item(
                        PopupMenuItem::new(pero_contracts::i18n::text(&locale, move_key))
                            .disabled(!movable.contains(&direction))
                            .on_click(move |_, window, cx| {
                                let _ = target.update(cx, |this, cx| {
                                    this.focus_pane(id, window, cx);
                                    this.navigation.move_pane(direction);
                                    this.ensure_document_panes(window, cx);
                                    this.queue_workspace_checkpoint(cx);
                                    cx.notify();
                                });
                            }),
                    );
                }
                menu
            })
            .into_any_element()
    }
    pub(crate) fn render_pane_tree(&self, node: &PaneNode, cx: &mut Context<Self>) -> AnyElement {
        match node {
            PaneNode::Leaf { view } => {
                let id = view.id;
                let route = view.route.clone();
                let selected = route.clone();
                let owner = cx.entity().clone();
                let item = match &route {
                    WorkspaceRoute::Content(item) => Some(item.clone()),
                    _ => None,
                };
                let reader = self.pane_views.iter().find(|pane| pane.id == id);
                let focused = self
                    .navigation
                    .pane_layout()
                    .is_some_and(|layout| layout.focused == Some(id));
                div()
                    .id(("workspace-pane", id.0 as usize))
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_h_0()
                    .min_w_0()
                    .overflow_hidden()
                    .on_prepaint(move |bounds, _, cx| {
                        owner.update(cx, |this, cx| {
                            this.observe_pane_surface(id, route.clone(), bounds, cx)
                        })
                    })
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(move |this, _, window, cx| {
                            if this
                                .navigation
                                .pane_layout()
                                .is_some_and(|layout| layout.focused != Some(id))
                            {
                                this.focus_pane(id, window, cx);
                            }
                        }),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .h(px(28.))
                            .flex_shrink_0()
                            .px(px(4.))
                            .gap(px(4.))
                            .border_b_1()
                            .border_color(if focused {
                                cx.theme().accent
                            } else {
                                cx.theme().border
                            })
                            .child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .truncate()
                                    .text_size(px(12.))
                                    .child(
                                        item.as_ref()
                                            .map(|item| self.document_label(item, cx).0)
                                            .unwrap_or_default(),
                                    ),
                            )
                            .child(self.pane_actions(id, cx))
                            .child(
                                Button::new(("pane-save-as", id.0 as usize))
                                    .ghost()
                                    .small()
                                    .label(self.t("content.save_as"))
                                    .disabled(self.pending_save_as.is_some())
                                    .tooltip(
                                        self.t(
                                            if item
                                                .as_ref()
                                                .is_some_and(|item| self.save_as_pending(item))
                                            {
                                                "content.saving_as"
                                            } else {
                                                "content.save_as"
                                            },
                                        ),
                                    )
                                    .accessibility_label(self.t("content.save_as"))
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        if let WorkspaceRoute::Content(item) = &selected {
                                            this.choose_document_copy(item, cx);
                                        }
                                    })),
                            )
                            .when(
                                self.navigation
                                    .pane_layout()
                                    .is_some_and(|layout| layout.leaves().len() > 1),
                                |header| {
                                    header.child(
                                        Button::new(("close-pane", id.0 as usize))
                                            .ghost()
                                            .small()
                                            .icon(IconName::Close)
                                            .tooltip(self.t("workspace.close_split"))
                                            .on_click(cx.listener(move |this, _, window, cx| {
                                                this.close_document_pane(id, window, cx)
                                            })),
                                    )
                                },
                            ),
                    )
                    .when(
                        item.as_ref().is_some_and(|item| {
                            self.documents
                                .iter()
                                .any(|open| &open.item == item && open.cached)
                        }),
                        |pane| {
                            pane.child(
                                div()
                                    .px(px(8.))
                                    .py(px(4.))
                                    .text_size(px(12.))
                                    .child(self.t("workspace.cached_source")),
                            )
                        },
                    )
                    .when(
                        item.as_ref().is_some_and(|item| {
                            self.save_as_feedback
                                .as_ref()
                                .is_some_and(|feedback| &feedback.item == item)
                        }),
                        |pane| {
                            pane.child(
                                div()
                                    .px(px(8.))
                                    .text_size(px(12.))
                                    .child(self.t(self.save_as_feedback.as_ref().unwrap().key)),
                            )
                        },
                    )
                    .when_some(reader, |pane, reader| pane.child(reader.view.clone()))
                    .when(reader.is_none(), |pane| {
                        if let Some(item) = &item {
                            pane.child(self.deferred_document_content(item, cx))
                        } else {
                            pane
                        }
                    })
                    .into_any_element()
            }
            PaneNode::Split {
                id,
                axis,
                ratio,
                first,
                second,
            } => {
                let split = *id;
                let horizontal = *axis == PaneAxis::Horizontal;
                let ratio = *ratio;
                let owner = cx.entity().clone();
                let axis = *axis;
                div()
                    .id(("pane-split", split as usize))
                    .flex()
                    .when(!horizontal, |view| view.flex_col())
                    .flex_1()
                    .min_h_0()
                    .min_w_0()
                    .on_prepaint(move |bounds, _, cx| {
                        owner.update(cx, |this, _| {
                            let bounds = PaneBounds {
                                x: f32::from(bounds.origin.x),
                                y: f32::from(bounds.origin.y),
                                width: f32::from(bounds.size.width),
                                height: f32::from(bounds.size.height),
                            };
                            if let Some(previous) = this
                                .pane_split_bounds
                                .iter_mut()
                                .find(|(id, _)| *id == split)
                            {
                                previous.1 = bounds;
                            } else {
                                this.pane_split_bounds.push((split, bounds));
                            }
                        })
                    })
                    .child(
                        div()
                            .flex()
                            .min_w_0()
                            .min_h_0()
                            .overflow_hidden()
                            .map(|view| {
                                if horizontal {
                                    view.w(relative(ratio)).h_full()
                                } else {
                                    view.h(relative(ratio)).w_full()
                                }
                            })
                            .child(self.render_pane_tree(first, cx)),
                    )
                    .child(
                        div()
                            .id(("pane-resize", split as usize))
                            .flex_shrink_0()
                            .bg(cx.theme().border)
                            .map(|view| {
                                if horizontal {
                                    view.w(px(4.)).h_full().cursor_col_resize()
                                } else {
                                    view.h(px(4.)).w_full().cursor_row_resize()
                                }
                            })
                            .on_mouse_down(
                                MouseButton::Left,
                                cx.listener(move |this, _, _, cx| {
                                    if let Some((_, bounds)) =
                                        this.pane_split_bounds.iter().find(|(id, _)| *id == split)
                                    {
                                        this.pane_resize = Some(PaneResize {
                                            split,
                                            axis,
                                            bounds: *bounds,
                                        });
                                    }
                                    cx.stop_propagation();
                                }),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_1()
                            .min_w_0()
                            .min_h_0()
                            .overflow_hidden()
                            .child(self.render_pane_tree(second, cx)),
                    )
                    .into_any_element()
            }
        }
    }
}
