//! One route owns each retained external surface; panes only supply placement.
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
use pero_contracts::workspace_panes::{PaneId, PaneLeaf, SplitDirection};
use serde_json::json;

impl Workbench {
    pub(crate) fn restore_pane_app_surfaces(&mut self, cx: &mut Context<Self>) {
        let apps = self
            .navigation
            .pane_layout()
            .filter(|_| self.navigation.pane_layout_visible())
            .map(|layout| {
                layout
                    .leaves()
                    .iter()
                    .filter_map(|leaf| match &leaf.route {
                        WorkspaceRoute::Content(WorkspaceItem::App { name, panel })
                            if &leaf.route != self.navigation.route() =>
                        {
                            Some((name.clone(), panel.clone()))
                        }
                        _ => None,
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        for (name, panel) in apps {
            if self.apps.contains_panel(&name, &panel) {
                self.command(json!({"action":"apps_open","name":name,"panel":panel}), cx);
            }
        }
    }
    pub(crate) fn pane_open_candidates(
        &self,
        target: Option<PaneId>,
        cx: &App,
    ) -> Vec<(WorkspaceItem, String)> {
        let current = target
            .and_then(|id| self.navigation.pane_layout()?.leaf(id))
            .map(|leaf| &leaf.route)
            .unwrap_or_else(|| self.navigation.route());
        self.navigation
            .items()
            .iter()
            .filter(|item| {
                let route = WorkspaceRoute::Content((*item).clone());
                route.supports_pane() && !route.shares_pane_instance(current)
            })
            .map(|item| (item.clone(), self.content_label(item, cx).0))
            .collect()
    }
    pub(crate) fn workspace_split_control(&self, cx: &mut Context<Self>) -> AnyElement {
        let button = Button::new("workspace-split")
            .ghost()
            .small()
            .icon(Icon::default().path("icons/panel-right-open.svg"))
            .tooltip(self.t("workspace.split"))
            .accessibility_label(self.t("workspace.split"));
        if self.navigation.route().can_clone_pane() {
            return button
                .on_click(cx.listener(|this, _, window, cx| this.toggle_document_split(window, cx)))
                .into_any_element();
        }
        let candidates = self.pane_open_candidates(None, cx);
        let owner = cx.entity().downgrade();
        let menu_owner = owner.clone();
        button
            .disabled(candidates.is_empty())
            .dropdown_menu_with_anchor(Anchor::BottomRight, move |mut menu, _, _| {
                for (item, title) in &candidates {
                    let owner = owner.clone();
                    let item = item.clone();
                    menu = menu.item(PopupMenuItem::new(title.clone()).on_click(
                        move |_, window, cx| {
                            let _ = owner.update(cx, |this, cx| {
                                this.open_item_in_pane(
                                    item.clone(),
                                    None,
                                    SplitDirection::Right,
                                    window,
                                    cx,
                                )
                            });
                        },
                    ));
                }
                menu
            })
            .on_open_change(move |_, _, cx| {
                let _ = menu_owner.update(cx, |_, cx| cx.notify());
            })
            .into_any_element()
    }
    pub(crate) fn focus_surface_pane(
        &mut self,
        id: PaneId,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.navigation.pane_layout_visible()
            && self
                .navigation
                .pane_layout()
                .is_some_and(|layout| layout.focused != Some(id) && layout.leaf(id).is_some())
        {
            self.focus_pane(id, window, cx);
        }
    }
    pub(crate) fn focus_surface_item(
        &mut self,
        item: &WorkspaceItem,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let Some(id) = self.navigation.pane_layout().and_then(|layout| {
            layout
                .leaves()
                .iter()
                .find(|leaf| leaf.route == WorkspaceRoute::Content(item.clone()))
                .map(|leaf| leaf.id)
        }) {
            self.focus_surface_pane(id, window, cx);
        }
    }
    pub(crate) fn render_pane_leaf(&self, leaf: &PaneLeaf, cx: &mut Context<Self>) -> AnyElement {
        let id = leaf.id;
        let route = leaf.route.clone();
        let item = match &route {
            WorkspaceRoute::Content(item) => Some(item.clone()),
            _ => None,
        };
        let focused = self
            .navigation
            .pane_layout()
            .is_some_and(|layout| layout.focused == Some(id));
        let document = route.can_clone_pane();
        let save = item.clone();
        let file_busy = item
            .as_ref()
            .and_then(|item| self.documents.iter().find(|open| &open.item == item))
            .is_some_and(|open| {
                self.workspace_file_busy(&pero_contracts::workspace_session::SourceKey::of(
                    &open.view.read(cx).document.header(),
                ))
            });
        let owner = cx.entity().clone();
        div()
            .id(("workspace-pane", id.0 as usize))
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .min_w_0()
            .overflow_hidden()
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
                                    .map(|item| self.content_label(item, cx).0)
                                    .unwrap_or_default(),
                            ),
                    )
                    .child(self.pane_actions(id, cx))
                    .when(document, |header| {
                        header.child(
                            Button::new(("pane-save-as", id.0 as usize))
                                .ghost()
                                .small()
                                .label(self.t("content.save_as"))
                                .disabled(self.pending_save_as.is_some() || file_busy)
                                .tooltip(self.t(
                                    if item.as_ref().is_some_and(|item| self.save_as_pending(item))
                                    {
                                        "content.saving_as"
                                    } else {
                                        "content.save_as"
                                    },
                                ))
                                .accessibility_label(self.t("content.save_as"))
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    if let Some(item) = &save {
                                        this.choose_document_copy(item, cx);
                                    }
                                })),
                        )
                    })
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
                document
                    && item.as_ref().is_some_and(|item| {
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
                document
                    && item.as_ref().is_some_and(|item| {
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
            .child(
                div()
                    .id(("pane-body", id.0 as usize))
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
                    .child(self.pane_surface_content(leaf, cx)),
            )
            .into_any_element()
    }
    fn pane_surface_content(&self, leaf: &PaneLeaf, cx: &mut Context<Self>) -> AnyElement {
        match &leaf.route {
            WorkspaceRoute::Content(item @ WorkspaceItem::Document { .. }) => {
                if let Some(reader) = self.pane_views.iter().find(|pane| pane.id == leaf.id) {
                    reader.view.clone().into_any_element()
                } else {
                    self.deferred_document_content(item, cx)
                }
            }
            WorkspaceRoute::Content(WorkspaceItem::Conversation(_)) => {
                self.chat.clone().into_any_element()
            }
            WorkspaceRoute::Content(WorkspaceItem::App { .. }) => div()
                .flex_1()
                .min_h_0()
                .when(!cfg!(target_family = "wasm"), |view| {
                    view.child(self.t("apps.native_unavailable"))
                })
                .into_any_element(),
            WorkspaceRoute::Content(WorkspaceItem::Web(id)) => {
                #[cfg(target_family = "wasm")]
                {
                    let _ = id;
                    div().flex_1().min_h_0().into_any_element()
                }
                #[cfg(not(target_family = "wasm"))]
                {
                    div()
                        .flex_1()
                        .min_h_0()
                        .min_w_0()
                        .children(
                            self.native_web_pages
                                .get(id)
                                .filter(|_| self.layout.embedded_surface_visible)
                                .map(|page| page.view.clone()),
                        )
                        .into_any_element()
                }
            }
            _ => div().flex_1().into_any_element(),
        }
    }
    pub(crate) fn open_item_in_pane(
        &mut self,
        item: WorkspaceItem,
        target: Option<PaneId>,
        direction: SplitDirection,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.remember_current_location(cx);
        self.navigation.ensure_pane_layout();
        let target = target.or_else(|| {
            self.navigation
                .pane_layout()
                .and_then(|layout| layout.focused)
        });
        if let Some(id) =
            target.and_then(|target| self.navigation.open_item_in_pane(item, target, direction))
        {
            self.ensure_document_panes(window, cx);
            self.focus_pane(id, window, cx);
        }
        self.queue_workspace_checkpoint(cx);
        cx.notify();
    }
    pub(crate) fn sync_pane_surfaces(&mut self, cx: &mut Context<Self>) {
        #[cfg(target_family = "wasm")]
        {
            let surfaces = self
                .navigation
                .pane_layout()
                .filter(|_| {
                    self.navigation.pane_layout_visible() && self.layout.embedded_surface_visible
                })
                .map(|layout| {
                    self.pane_surfaces
                        .iter()
                        .filter(|surface| {
                            layout
                                .leaf(surface.id)
                                .is_some_and(|leaf| leaf.route == surface.route)
                        })
                        .cloned()
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let apps=surfaces.iter().filter_map(|surface|match &surface.route {WorkspaceRoute::Content(WorkspaceItem::App{name,panel})=>Some(json!({"visible":true,"pane":surface.id,"name":name,"panel":panel,"left":surface.bounds.x,"top":surface.bounds.y,"width":surface.bounds.width,"height":surface.bounds.height,"focused":self.navigation.pane_layout().and_then(|layout|layout.focused)==Some(surface.id)})),_=>None}).collect::<Vec<_>>();
            let open = self
                .navigation
                .items()
                .iter()
                .filter_map(|item| match item {
                    WorkspaceItem::App { name, panel } => Some(json!({"name":name,"panel":panel})),
                    _ => None,
                })
                .collect::<Vec<_>>();
            self.publish_app_surfaces(json!({"surfaces":apps,"open":open,"dark":pero_theme::UiAppearance::global(cx).dark,"appearance":pero_theme::UiAppearance::global(cx),"locale":self.locale}),cx);
            let web=surfaces.iter().filter_map(|surface|match &surface.route {WorkspaceRoute::Content(WorkspaceItem::Web(id))=>Some(json!({"id":id,"bounds":surface.bounds,"focused":self.navigation.pane_layout().and_then(|layout|layout.focused)==Some(surface.id)})),_=>None}).collect::<Vec<_>>();
            self.publish_web_surfaces(json!({"action":"web_surfaces","surfaces":web}), cx);
        }
        #[cfg(not(target_family = "wasm"))]
        self.sync_web_surface(None, cx);
    }
}
