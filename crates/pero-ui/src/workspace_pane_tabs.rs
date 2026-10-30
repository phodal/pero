//! Pane tab presentation. Ordering, preview and pin transitions belong to PaneTabSet.
use crate::{app::Workbench, workspace::WorkspaceRoute};
use gpui_kit::{
    component::{
        button::*,
        menu::{ContextMenuExt, DropdownMenu, PopupMenuItem},
        *,
    },
    prelude::*,
    *,
};
use pero_chat_ui::theme::WorkbenchStyle as W;
use pero_contracts::{
    pane_tabs::{PaneItem, ViewId},
    workspace_panes::{PaneId, PaneLeaf},
};
use std::{cell::RefCell, collections::HashMap};

gpui_kit::actions!(
    pane_tabs,
    [
        NextPaneTabMru,
        PreviousPaneTabMru,
        ConfirmPaneTabSwitch,
        CancelPaneTabSwitch
    ]
);

#[derive(Default)]
pub(crate) struct PaneTabsUiState {
    strips: RefCell<HashMap<PaneId, PaneStrip>>,
    switcher: RefCell<Option<TabSwitcher>>,
}
impl PaneTabsUiState {
    pub(crate) fn switching(&self) -> bool {
        self.switcher.borrow().is_some()
    }
}
#[derive(Default)]
struct PaneStrip {
    pinned: ScrollHandle,
    ordinary: ScrollHandle,
    revealed: Option<(ViewId, usize, usize, u32)>,
}
struct TabSwitcher {
    pane: PaneId,
    order: Vec<ViewId>,
    selected: usize,
    scroll: ScrollHandle,
}
#[derive(Clone)]
struct PaneTabDrag {
    pane: PaneId,
    view: ViewId,
    title: String,
}
impl Render for PaneTabDrag {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = &pero_theme::UiAppearance::global(cx).palette;
        div()
            .px_3()
            .py_1()
            .max_w(px(260.))
            .bg(p.surface)
            .text_color(p.text)
            .border_1()
            .border_color(p.border)
            .child(self.title.clone())
    }
}

impl Workbench {
    /// Capture the MRU order once, then move the highlight until Control is released.
    /// Activating only on commit keeps embedded surfaces from taking keyboard focus.
    pub(crate) fn cycle_pane_tab_mru(
        &mut self,
        reverse: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let pane = self
            .navigation
            .pane_layout()
            .and_then(|layout| layout.focused);
        let Some(pane) = pane else {
            return;
        };
        let Some(leaf) = self
            .navigation
            .pane_layout()
            .and_then(|layout| layout.leaf(pane))
        else {
            return;
        };
        let mut state = self.pane_tabs.switcher.borrow_mut();
        if state.as_ref().is_none_or(|state| state.pane != pane) {
            let order = leaf.tabs.mru_items();
            if order.len() < 2 {
                return;
            }
            *state = Some(TabSwitcher {
                pane,
                order,
                selected: 0,
                scroll: ScrollHandle::new(),
            });
        }
        let switcher = state.as_mut().unwrap();
        let length = switcher.order.len();
        switcher.selected = (switcher.selected + if reverse { length - 1 } else { 1 }) % length;
        switcher.scroll.scroll_to_item(switcher.selected);
        drop(state);
        self.workspace_focus.focus(window, cx);
        cx.notify();
    }
    pub(crate) fn confirm_pane_tab_switch(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let state = self.pane_tabs.switcher.borrow_mut().take();
        if let Some(state) = state {
            if let Some(view) = state.order.get(state.selected) {
                self.activate_pane_tab(state.pane, *view, window, cx);
            }
            cx.notify();
        }
    }
    pub(crate) fn cancel_pane_tab_switch(&mut self, cx: &mut Context<Self>) {
        if self.pane_tabs.switcher.borrow_mut().take().is_some() {
            cx.notify();
        }
    }
    pub(crate) fn pane_tab_modifiers(
        &mut self,
        event: &ModifiersChangedEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !event.modifiers.control {
            self.confirm_pane_tab_switch(window, cx);
        }
    }
    pub(crate) fn pane_tab_bar(&self, leaf: &PaneLeaf, cx: &mut Context<Self>) -> AnyElement {
        let appearance = pero_theme::UiAppearance::global(cx);
        let p = appearance.palette.clone();
        let height = W::TAB.max(appearance.typography.row_height() + 4.);
        let pane = leaf.id;
        let count = leaf.tabs.pinned_count();
        let focused = self
            .navigation
            .pane_layout()
            .is_some_and(|layout| layout.focused == Some(pane));
        let (pinned_scroll, ordinary_scroll) = {
            let mut strips = self.pane_tabs.strips.borrow_mut();
            strips.retain(|id, _| {
                self.navigation
                    .pane_layout()
                    .is_some_and(|layout| layout.leaf(*id).is_some())
            });
            let strip = strips.entry(pane).or_default();
            if let Some((index, active)) = leaf
                .tabs
                .items()
                .iter()
                .enumerate()
                .find(|(_, item)| Some(item.id) == leaf.tabs.active_id())
            {
                let scroll = if index < count {
                    &strip.pinned
                } else {
                    &strip.ordinary
                };
                let local_index = if index < count { index } else { index - count };
                let revealed = (
                    active.id,
                    index,
                    count,
                    f32::from(scroll.bounds().size.width).to_bits(),
                );
                if strip.revealed != Some(revealed) {
                    scroll.scroll_to_item(local_index);
                    strip.revealed = Some(revealed);
                }
            }
            (strip.pinned.clone(), strip.ordinary.clone())
        };
        let tab = |(index, item): (usize, &PaneItem)| self.pane_tab(leaf, item, index, focused, cx);
        let pinned = leaf
            .tabs
            .items()
            .iter()
            .enumerate()
            .take(count)
            .map(tab)
            .collect::<Vec<_>>();
        let ordinary = leaf
            .tabs
            .items()
            .iter()
            .enumerate()
            .skip(count)
            .map(|(index, item)| self.pane_tab(leaf, item, index, focused, cx))
            .collect::<Vec<_>>();
        let mru = leaf
            .tabs
            .mru_items()
            .into_iter()
            .filter_map(|id| {
                let item = leaf.tabs.item(id)?;
                let WorkspaceRoute::Content(source) = &item.route else {
                    return None;
                };
                Some((id, self.content_label(source, cx).0))
            })
            .collect::<Vec<_>>();
        let target = cx.entity().downgrade();
        let end = leaf.tabs.items().len();
        div()
            .id(("pane-tab-bar", pane.0 as usize))
            .relative()
            .flex_shrink_0()
            .h(px(height))
            .flex()
            .items_center()
            .border_b_1()
            .border_color(p.border)
            .bg(p.bg)
            .when(count > 0, |bar| {
                bar.child(
                    div()
                        .id(("pane-pinned-tabs", pane.0 as usize))
                        .flex()
                        .h_full()
                        .min_w_0()
                        .max_w(relative(0.45))
                        .overflow_x_scroll()
                        .track_scroll(&pinned_scroll)
                        .children(pinned)
                        .border_r_1()
                        .border_color(p.border),
                )
            })
            .child(
                div()
                    .id(("pane-tab-scroll", pane.0 as usize))
                    .flex()
                    .h_full()
                    .flex_1()
                    .min_w_0()
                    .overflow_x_scroll()
                    .track_scroll(&ordinary_scroll)
                    .children(ordinary)
                    .child(
                        div()
                            .id(("pane-tab-end", pane.0 as usize))
                            .min_w(px(24.))
                            .flex_1()
                            .h_full()
                            .drag_over::<PaneTabDrag>(|el, _, _, cx| {
                                el.border_l_2().border_color(
                                    pero_theme::UiAppearance::global(cx).palette.action,
                                )
                            })
                            .on_drop(cx.listener(move |this, drag: &PaneTabDrag, window, cx| {
                                if drag.pane == pane {
                                    this.reorder_pane_tab(drag.view, end, cx);
                                } else {
                                    this.move_pane_tab(drag.view, pane, end, window, cx);
                                }
                            })),
                    ),
            )
            .child(
                Button::new(("pane-tab-list", pane.0 as usize))
                    .ghost()
                    .small()
                    .icon(IconName::ChevronDown)
                    .tooltip(self.t("workspace.switch_tabs"))
                    .accessibility_label(self.t("workspace.switch_tabs"))
                    .dropdown_caret(false)
                    .dropdown_menu(move |mut menu, _, _| {
                        for (view, title) in &mru {
                            let view = *view;
                            let owner = target.clone();
                            menu = menu.item(PopupMenuItem::new(title.clone()).on_click(
                                move |_, window, cx| {
                                    let _ = owner.update(cx, |this, cx| {
                                        this.activate_pane_tab(pane, view, window, cx)
                                    });
                                },
                            ));
                        }
                        menu
                    }),
            )
            .child(self.pane_actions(pane, cx))
            .when_some(self.pane_tab_switcher(leaf, height, cx), |bar, switcher| {
                bar.child(switcher)
            })
            .into_any_element()
    }

    fn pane_tab(
        &self,
        leaf: &PaneLeaf,
        item: &PaneItem,
        index: usize,
        focused: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let p = pero_theme::UiAppearance::global(cx).palette.clone();
        let WorkspaceRoute::Content(source) = &item.route else {
            return div().into_any_element();
        };
        let (title, icon) = self.content_label(source, cx);
        let pane = leaf.id;
        let view = item.id;
        let active = leaf.tabs.active_id() == Some(view);
        let pinned = leaf.tabs.is_pinned(view);
        let preview = leaf.tabs.preview_id() == Some(view);
        let dirty = self
            .documents
            .iter()
            .any(|open| &open.item == source && open.view.read(cx).dirty());
        let owner = cx.entity().downgrade();
        let pin_label = self.t(if pinned {
            "workspace.unpin_tab"
        } else {
            "workspace.pin_tab"
        });
        let keep_label = self.t("workspace.keep_tab");
        let close_label = self.t("workspace.close_tab");
        let drag = PaneTabDrag {
            pane,
            view,
            title: title.clone(),
        };
        div()
            .id(("pane-tab", view.0 as usize))
            .h_full()
            .flex()
            .items_center()
            .flex_shrink_0()
            .min_w(px(if pinned { 65. } else { 110. }))
            .max_w(px(if pinned { 150. } else { 220. }))
            .px(px(W::GAP))
            .gap_1()
            .cursor_pointer()
            .bg(if active { p.surface } else { p.bg })
            .text_color(if active { p.text } else { p.text_muted })
            .border_b_2()
            .border_color(if active && focused {
                p.action
            } else if active {
                p.border
            } else {
                p.bg
            })
            .hover(|el| el.bg(p.surface_muted))
            .child(
                Icon::default()
                    .size(px(W::ICON))
                    .path(pero_chat_ui::icon_theme::asset_path(&icon)),
            )
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .text_ellipsis()
                    .when(preview, |label| label.italic())
                    .child(title.clone()),
            )
            .when(dirty, |tab| {
                tab.child(div().size(px(6.)).rounded_full().bg(p.text))
            })
            .when(pinned, |tab| {
                tab.child(Icon::default().size(px(12.)).path("icons/pin.svg"))
            })
            .child(
                Button::new(("pane-tab-close", view.0 as usize))
                    .ghost()
                    .small()
                    .w(px(22.))
                    .h(px(22.))
                    .icon(Icon::default().path("icons/x.svg"))
                    .tooltip(close_label.clone())
                    .accessibility_label(format!("{close_label}: {title}"))
                    .on_click(cx.listener(move |this, _, window, cx| {
                        cx.stop_propagation();
                        this.close_pane_tab(view, window, cx);
                    })),
            )
            .on_mouse_down(
                MouseButton::Middle,
                cx.listener(move |this, _, window, cx| {
                    cx.stop_propagation();
                    this.close_pane_tab(view, window, cx);
                }),
            )
            .on_click(cx.listener(move |this, event: &ClickEvent, window, cx| {
                this.activate_pane_tab(pane, view, window, cx);
                if event.click_count() > 1 {
                    this.promote_pane_tab(view, cx);
                }
            }))
            .on_drag(drag, {
                let owner = owner.clone();
                move |drag, _, _, cx| {
                    let _ = owner.update(cx, |this, cx| this.promote_pane_tab(drag.view, cx));
                    cx.new(|_| drag.clone())
                }
            })
            .drag_over::<PaneTabDrag>(|el, _, _, cx| {
                el.border_l_2()
                    .border_color(pero_theme::UiAppearance::global(cx).palette.action)
            })
            .on_drop(cx.listener(move |this, drag: &PaneTabDrag, window, cx| {
                if drag.pane == pane {
                    this.reorder_pane_tab(drag.view, index, cx);
                } else {
                    this.move_pane_tab(drag.view, pane, index, window, cx);
                }
            }))
            .context_menu(move |mut menu, _, _| {
                if preview {
                    let owner = owner.clone();
                    menu = menu.item(PopupMenuItem::new(keep_label.clone()).on_click(
                        move |_, _, cx| {
                            let _ = owner.update(cx, |this, cx| this.promote_pane_tab(view, cx));
                        },
                    ));
                }
                let pin_owner = owner.clone();
                menu.item(
                    PopupMenuItem::new(pin_label.clone()).on_click(move |_, _, cx| {
                        let _ =
                            pin_owner.update(cx, |this, cx| this.pin_pane_tab(view, !pinned, cx));
                    }),
                )
                .separator()
                .item(PopupMenuItem::new(close_label.clone()).on_click({
                    let owner = owner.clone();
                    move |_, window, cx| {
                        let _ = owner.update(cx, |this, cx| this.close_pane_tab(view, window, cx));
                    }
                }))
            })
            .into_any_element()
    }

    fn pane_tab_switcher(
        &self,
        leaf: &PaneLeaf,
        height: f32,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let state = self.pane_tabs.switcher.borrow();
        let switcher = state.as_ref().filter(|state| state.pane == leaf.id)?;
        let p = pero_theme::UiAppearance::global(cx).palette.clone();
        let pane = leaf.id;
        let rows = switcher
            .order
            .iter()
            .enumerate()
            .filter_map(|(index, id)| {
                let item = leaf.tabs.item(*id)?;
                let WorkspaceRoute::Content(source) = &item.route else {
                    return None;
                };
                let (title, icon) = self.content_label(source, cx);
                let view = *id;
                Some(
                    Button::new(("pane-tab-mru", view.0 as usize))
                        .ghost()
                        .small()
                        .w_full()
                        .justify_start()
                        .icon(Icon::default().path(pero_chat_ui::icon_theme::asset_path(&icon)))
                        .label(title)
                        .toggled(index == switcher.selected)
                        .on_click(cx.listener(move |this, _, window, cx| {
                            this.cancel_pane_tab_switch(cx);
                            this.activate_pane_tab(pane, view, window, cx);
                        })),
                )
            })
            .collect::<Vec<_>>();
        Some(
            deferred(
                div()
                    .id(("pane-tab-switcher", pane.0 as usize))
                    .absolute()
                    .top(px(height))
                    .left(px(12.))
                    .w(px(320.))
                    .max_w_full()
                    .max_h(px(320.))
                    .bg(p.surface)
                    .text_color(p.text)
                    .border_1()
                    .border_color(p.border)
                    .occlude()
                    .overflow_y_scroll()
                    .track_scroll(&switcher.scroll)
                    .children(rows),
            )
            .with_priority(gpui_kit::base::POPUP_PRIORITY)
            .into_any_element(),
        )
    }
}
