//! A compact conversation catalog around the shared embedded reader.
use crate::{
    assets::UiIcon,
    panel::{ChatAction, ChatPanel},
    session_artifacts::{ArtifactCollection, ArtifactPaneResize},
};
use gpui_kit::{
    component::{Disableable, Icon, Sizable, button::*, input::Input},
    prelude::*,
    *,
};
use pero_contracts::{
    session_artifact::{ArtifactSource, SessionArtifact},
    workbench::{LayoutPreferences, ResourceTab},
};

/// Side resources column measured for the workbench titleband.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ResourceColumn {
    pub width: f32,
    pub primary: ResourcePrimary,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResourcePrimary {
    Files,
    Artifacts,
    Changes,
}

impl ChatPanel {
    /// Chat column keeps this much space before the artifact column replaces it.
    const CHAT_COLUMN_MIN: f32 = 320.;
    pub(crate) const RESOURCE_TOOLBAR_MIN: f32 = 456.;
    /// The resize handle stays reachable. This is not a content-width limit.
    const PANE_DIVIDER: f32 = 12.;
    const BOTTOM_PANE_MIN: f32 = 120.;
    const BOTTOM_PANE_DEFAULT: f32 = 320.;
    const BOTTOM_CHAT_RESERVE: f32 = 160.;

    fn artifact_probe(&self, thread: &str, action: &str) -> Option<AnyElement> {
        self.artifacts
            .bounds
            .get(&format!("{thread}/{action}"))
            .map(|bounds| bounds.probe().into_any_element())
    }

    fn artifact_button(&self, thread: &str, id: &'static str, key: &str, label: &str) -> Button {
        Button::new(id)
            .relative()
            .children(self.artifact_probe(thread, key))
            .ghost()
            .small()
            .h(px(24.))
            .label(label.to_owned())
    }

    fn note_resource_column(&mut self, next: Option<ResourceColumn>, cx: &mut Context<Self>) {
        let changed = match (self.resource_column, next) {
            (None, None) => false,
            (Some(current), Some(next)) => {
                current.primary != next.primary || (current.width - next.width).abs() >= 0.5
            }
            _ => true,
        };
        if changed {
            self.resource_column = next;
            cx.notify();
        }
    }

    /// Open resources for the selected conversation without changing selection.
    /// Shells call this for an explicit user action; per-conversation pane layout
    /// and reading state remain with the retained resources owner.
    pub fn open_resource_tab(&mut self, tab: ResourceTab, cx: &mut Context<Self>) {
        let Some(thread) = self
            .active_chat
            .and_then(|index| self.chats.get(index))
            .map(|chat| chat.id.clone())
        else {
            return;
        };
        self.choose_resource_tab(&thread, tab, cx);
        if tab == ResourceTab::Artifacts && !self.artifacts.conversations[&thread].requested {
            self.refresh_artifacts(&thread, cx);
        }
        if self.compact {
            cx.emit(ChatAction::CompactNeedsSpace);
        }
    }

    /// Close the selected conversation's resources while preserving its contents.
    pub fn close_resource_pane(&mut self, cx: &mut Context<Self>) {
        if let Some(thread) = self
            .active_chat
            .and_then(|index| self.chats.get(index))
            .map(|chat| chat.id.clone())
        {
            if let Some(state) = self.artifacts.conversations.get_mut(&thread) {
                state.return_to_chat(true);
            }
        }
        self.note_resource_column(None, cx);
        cx.notify();
    }

    pub fn resource_column_toolbar(&self, cx: &mut Context<Self>) -> AnyElement {
        let Some(thread) = self
            .active_chat
            .and_then(|index| self.chats.get(index))
            .map(|chat| chat.id.clone())
        else {
            return div().into_any_element();
        };
        let Some(state) = self.artifacts.conversations.get(&thread) else {
            return div().into_any_element();
        };
        self.pane_toolbar(&thread, state, false, true, cx)
    }

    /// Files, artifacts, or changes for the workbench resources column.
    /// The column header is painted by the shell, so this is only the body.
    pub fn resource_column_body(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let Some(thread) = self
            .active_chat
            .and_then(|index| self.chats.get(index))
            .map(|chat| chat.id.clone())
        else {
            return div().into_any_element();
        };
        let Some(state) = self.artifacts.conversations.get(&thread) else {
            return div().into_any_element();
        };
        let pane = if state.show_changes {
            self.changes_panel(&thread, state, cx)
        } else if self.files.selection.tab == ResourceTab::Files {
            self.file_panel(&thread, cx)
        } else {
            self.artifact_panel(&thread, state, cx)
        };
        let shown = self
            .resource_column
            .map(|column| column.width)
            .unwrap_or_else(|| self.artifact_pane_width());
        let limit = self.artifacts.side_limit.max(shown);
        let identity = (shown < Self::RESOURCE_TOOLBAR_MIN).then(|| self.pane_resource_identity(&thread,state,cx)).flatten();
        div()
            .size_full()
            .relative()
            .min_h_0()
            .min_w_0()
            .flex().flex_col()
            .child(self.artifact_resize_capture(cx))
            .children(identity.map(|identity| div().h(px(32.)).flex_shrink_0().px(px(8.)).flex().items_center().child(identity)))
            .child(div().flex_1().min_h_0().min_w_0().child(pane))
            .child(
                div()
                    .id(SharedString::from(format!("artifact-column-resize-{thread}")))
                    .absolute()
                    .left_0()
                    .top_0()
                    .bottom_0()
                    .w(px(12.))
                    .cursor(CursorStyle::ResizeLeftRight)
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(move |this, event: &MouseDownEvent, _, cx| {
                            if event.click_count == 2 {
                                this.artifacts.resize = None;
                                this.set_artifact_pane_width(
                                    f32::from(LayoutPreferences::DEFAULT_ARTIFACT_PANE_WIDTH),
                                    cx,
                                );
                                cx.emit(ChatAction::ArtifactPaneWidth {
                                    width: this.artifact_pane_width(),
                                });
                            } else {
                                this.artifacts.resize = Some(ArtifactPaneResize {
                                    origin_x: event.position.x.into(),
                                    origin_width: shown,
                                    max_width: limit,
                                    vertical: false,
                                });
                            }
                            cx.stop_propagation();
                        }),
                    ),
            )
            .into_any_element()
    }

    pub(crate) fn artifact_icon_button(
        &self,
        thread: &str,
        id: &'static str,
        key: &str,
        icon: &str,
        label: &str,
    ) -> Button {
        Button::new(id)
            .relative()
            .children(self.artifact_probe(thread, key))
            .ghost()
            .small()
            .w(px(24.))
            .h(px(24.))
            .p_0()
            .icon(Icon::default().path(UiIcon::named(icon).path()))
            .tooltip(label.to_owned())
            .accessibility_label(label.to_owned())
    }

    fn artifact_column_width(&self, available: f32) -> f32 {
        let available = available.max(0.);
        self.artifact_pane_width()
            .clamp(Self::PANE_DIVIDER.min(available), available)
    }

    /// Window-level drag so the pointer can leave the hairline without dropping the resize.
    fn artifact_resize_capture(&self, cx: &Context<Self>) -> impl IntoElement + use<> {
        let owner = cx.entity().downgrade();
        canvas(
            |_, _, _| (),
            move |_, _, window, _| {
                let move_owner = owner.clone();
                window.on_mouse_event(move |event: &MouseMoveEvent, _, _, cx| {
                    let _ = move_owner.update(cx, |this, cx| {
                        let Some(resize) = this.artifacts.resize else {
                            return;
                        };
                        let x: f32 = if resize.vertical { event.position.y.into() } else { event.position.x.into() };
                        let floor = if resize.vertical {
                            Self::BOTTOM_PANE_MIN.min(resize.max_width)
                        } else {
                            Self::PANE_DIVIDER.min(resize.max_width)
                        };
                        let width = (resize.origin_width - (x - resize.origin_x))
                            .clamp(floor, resize.max_width);
                        if resize.vertical {
                            let thread = this
                                .active_chat
                                .and_then(|index| this.chats.get(index).map(|chat| chat.id.clone()));
                            if let Some(thread) = thread {
                                if let Some(state) = this.artifacts.conversations.get_mut(&thread) {
                                    state.bottom_height = Some(width);
                                }
                            }
                            cx.notify();
                            cx.stop_propagation();
                        } else if (this.artifact_pane_width() - width).abs() >= 0.5 {
                            this.set_artifact_pane_width(width, cx);
                            cx.stop_propagation();
                        }
                    });
                });
                window.on_mouse_event(move |event: &MouseUpEvent, _, _, cx| {
                    if event.button != MouseButton::Left {
                        return;
                    }
                    let _ = owner.update(cx, |this, cx| {
                        if let Some(resize) = this.artifacts.resize.take() {
                            if !resize.vertical { cx.emit(ChatAction::ArtifactPaneWidth {
                                width: this.artifact_pane_width(),
                            }); }
                            cx.stop_propagation();
                        }
                    });
                });
            },
        )
        .absolute()
        .size_full()
    }

    pub(crate) fn artifact_chat_layout(
        &mut self,
        size: Size<Pixels>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let thread = self
            .active_chat
            .and_then(|index| self.chats.get(index))
            .map(|chat| chat.id.clone())
            .unwrap_or_default();
        if !thread.is_empty() {
            self.init_files(&thread, cx);
        }
        if self.files.selection.tab == pero_contracts::workbench::ResourceTab::Files
            && !thread.is_empty()
            && self
                .artifacts
                .conversations
                .get(&thread)
                .is_some_and(|state| state.open)
        {
            self.prepare_file_reader(&thread, window, cx);
        }
        let reported = self.resource_column.map(|column| column.width).unwrap_or(0.);
        let available = f32::from(size.width) + if self.host_titleband { reported } else { 0. };
        self.artifacts.side_limit = available;
        self.artifacts.narrow = available
            < Self::CHAT_COLUMN_MIN + f32::from(LayoutPreferences::MIN_ARTIFACT_PANE_WIDTH);
        let state = self.artifacts.conversations.get(&thread);
        let open = state.is_some_and(|state| state.open);
        let reviewing = state.is_some_and(|state| state.show_changes);
        let bottom = state.is_some_and(|state| state.bottom);
        let maximized = !reviewing
            && self.files.selection.tab == pero_contracts::workbench::ResourceTab::Artifacts
            && state.is_some_and(|state| state.maximized);
        let split = open && !self.artifacts.narrow && !maximized;
        let resource_primary = if reviewing {
            ResourcePrimary::Changes
        } else if self.files.selection.tab == ResourceTab::Files {
            ResourcePrimary::Files
        } else {
            ResourcePrimary::Artifacts
        };
        let mut side_width = None;
        let count = state.map_or(0, |state| state.items.len());
        let toggle_thread = thread.clone();
        let title = self.t(
            if self.files.selection.tab == pero_contracts::workbench::ResourceTab::Files {
                "files.title"
            } else {
                "artifacts.title"
            },
        );
        let label = if count == 0
            || self.files.selection.tab == pero_contracts::workbench::ResourceTab::Files
        {
            title.to_owned()
        } else {
            format!("{title} {count}")
        };
        let header_height = pero_theme::WorkbenchStyle::TAB
            .max(pero_theme::UiAppearance::global(cx).typography.row_height() + 4.)
            .max(36.);
        let header = (!split && (!thread.is_empty() || self.docked)).then(|| {
            div()
                .h(px(header_height))
                .min_h(px(header_height))
                .flex()
                .items_center()
                .justify_end()
                .when(!thread.is_empty() && !open, |el| {
                    el.child(
                        self.artifact_button(&thread, "session-artifacts-toggle", "toggle", &label)
                            .icon(Icon::default().path(UiIcon::Columns2.path()))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                let state = this
                                    .artifacts
                                    .conversations
                                    .entry(toggle_thread.clone())
                                    .or_default();
                                state.inline_open = false;
                                state.open = !state.open;
                                if this.compact {
                                    cx.emit(ChatAction::CompactNeedsSpace);
                                }
                                cx.notify();
                            })),
                    )
                })
                .when(open, |el| {
                    el.child(div().min_w_0().flex_1().child(self.pane_toolbar(
                        &thread,
                        state.expect("open artifact catalog"),
                        false,
                        false,
                        cx,
                    )))
                })
                .when(self.docked, |el| {
                    el.child(
                        self.artifact_icon_button(
                            &thread,
                            "workspace-chat-close",
                            "close-chat",
                            "panel-right-close",
                            self.t("chat.close_panel"),
                        )
                        .on_click(cx.listener(|_, _, _, cx| cx.emit(ChatAction::ClosePanel))),
                    )
                })
                .into_any_element()
        });
        let chat = div()
            .flex()
            .flex_col()
            .w_full()
            .h_full()
            .min_h_0()
            .min_w_0()
            .child(self.chat_view(window, cx))
            .into_any_element();
        let body = if open {
            let collection = state.expect("open artifact catalog");
            let pane = if collection.show_changes {
                self.changes_panel(&thread, collection, cx)
            } else if self.files.selection.tab == pero_contracts::workbench::ResourceTab::Files {
                self.file_panel(&thread, cx)
            } else {
                self.artifact_panel(&thread, collection, cx)
            };
            if !split {
                pane
            } else if !bottom && self.host_titleband {
                // The workbench column owns this header and body. Leaving the pane here would sit under that header.
                side_width = Some(self.artifact_column_width(available));
                chat
            } else {
                let height = f32::from(size.height);
                let bottom_limit = (height - Self::BOTTOM_CHAT_RESERVE).max(Self::BOTTOM_PANE_MIN);
                let shown = if bottom {
                    collection
                        .bottom_height
                        .unwrap_or(Self::BOTTOM_PANE_DEFAULT)
                        .clamp(Self::BOTTOM_PANE_MIN, bottom_limit)
                } else {
                    side_width = Some(self.artifact_column_width(available));
                    side_width.expect("side column width")
                };
                let compact_toolbar = !bottom && shown < Self::RESOURCE_TOOLBAR_MIN;
                let has_identity = !reviewing
                    && self.files.selection.tab == pero_contracts::workbench::ResourceTab::Artifacts
                    && collection.selected.is_some()
                    && (self.artifacts.view == pero_contracts::workbench::ArtifactView::Gallery
                        || collection.chart.is_some());
                let pane_header_height = if compact_toolbar {
                    header_height + if has_identity { 60. } else { 30. }
                } else {
                    header_height
                };
                let bottom_thread = thread.clone();
                let border = pero_theme::UiAppearance::global(cx).palette.border;
                div()
                    .relative()
                    .size_full()
                    .min_w_0()
                    .min_h_0()
                    .flex()
                    .when(bottom, |el| el.flex_col())
                    .child(self.artifact_resize_capture(cx))
                    .child(
                        div()
                            .relative()
                            .flex_1()
                            .when(!bottom, |el| el.h_full())
                            .min_h_0()
                            .min_w_0()
                            .child(chat)
                            .when(!bottom, |column| {
                                column.child(
                                    div()
                                        .absolute()
                                        .right_0()
                                        .top_0()
                                        .bottom_0()
                                        .w(px(1.))
                                        .bg(border),
                                )
                            }),
                    )
                    .child(
                        div()
                            .relative()
                            .when(!bottom, |el| el.h_full().w(px(shown)).border_l(px(1.)))
                            .when(bottom, |el| el.w_full().h(px(shown)).border_t(px(1.)))
                            .min_w_0()
                            .flex_shrink_0()
                            .flex()
                            .flex_col()
                            .border_color(border)
                            // A bottom-stacked artifact pane is not a titleband column; this placement keeps its in-pane toolbar.
                            .when(bottom || !self.host_titleband, |column| {
                                column.child(
                                    div()
                                        .h(px(pane_header_height))
                                        .min_h(px(pane_header_height))
                                        .flex()
                                        .items_center()
                                        .min_w_0()
                                        .child(
                                            div().flex_1().min_w_0().child(self.pane_toolbar(
                                                &thread,
                                                collection,
                                                compact_toolbar,
                                                false,
                                                cx,
                                            )),
                                        )
                                        .when(self.docked, |row| {
                                            row.child(
                                                self.artifact_icon_button(
                                                    &thread,
                                                    "workspace-chat-close",
                                                    "close-chat",
                                                    "panel-right-close",
                                                    self.t("chat.close_panel"),
                                                )
                                                .on_click(cx.listener(|_, _, _, cx| {
                                                    cx.emit(ChatAction::ClosePanel)
                                                })),
                                            )
                                        }),
                                )
                            })
                            .child(div().flex_1().min_h_0().min_w_0().child(pane))
                            .child(
                                div()
                                    .id(SharedString::from(format!("artifact-pane-resize-{thread}")))
                                    .absolute()
                                    .left_0().top_0()
                                    .when(!bottom, |el| el.bottom_0().w(px(12.)).cursor(CursorStyle::ResizeLeftRight))
                                    .when(bottom, |el| el.right_0().h(px(8.)).cursor(CursorStyle::ResizeUpDown))
                                    .on_mouse_down(
                                        MouseButton::Left,
                                        cx.listener(move |this, event: &MouseDownEvent, _, cx| {
                                            if event.click_count == 2 {
                                                this.artifacts.resize = None;
                                                if bottom {
                                                    if let Some(state) = this
                                                        .artifacts
                                                        .conversations
                                                        .get_mut(&bottom_thread)
                                                    {
                                                        state.bottom_height =
                                                            Some(Self::BOTTOM_PANE_DEFAULT);
                                                    }
                                                    cx.notify();
                                                } else {
                                                    this.set_artifact_pane_width(
                                                        f32::from(
                                                            LayoutPreferences::DEFAULT_ARTIFACT_PANE_WIDTH,
                                                        ),
                                                        cx,
                                                    );
                                                    cx.emit(ChatAction::ArtifactPaneWidth {
                                                        width: this.artifact_pane_width(),
                                                    });
                                                }
                                            } else {
                                                this.artifacts.resize = Some(ArtifactPaneResize {
                                                    origin_x: if bottom {
                                                        event.position.y.into()
                                                    } else {
                                                        event.position.x.into()
                                                    },
                                                    origin_width: shown,
                                                    max_width: if bottom {
                                                        bottom_limit
                                                    } else {
                                                        available.max(shown)
                                                    },
                                                    vertical: bottom,
                                                });
                                            }
                                            cx.stop_propagation();
                                        }),
                                    ),
                            ),
                    )
                    .into_any_element()
            }
        } else {
            chat
        };
        self.note_resource_column(
            side_width.map(|width| ResourceColumn {
                width,
                primary: resource_primary,
            }),
            cx,
        );
        div()
            .w(size.width)
            .h(size.height)
            .min_w_0()
            .min_h_0()
            .flex()
            .flex_col()
            .children(header)
            .child(div().flex_1().min_h_0().min_w_0().flex().child(body))
            .into_any_element()
    }

    fn artifact_panel(
        &self,
        thread: &str,
        state: &ArtifactCollection,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let p = pero_theme::UiAppearance::global(cx).palette.clone();
        let selected = state.selected.as_ref().and_then(|(id, version)| {
            state
                .items
                .iter()
                .find(|item| &item.id == id)
                .map(|item| (item, *version))
        });
        div()
            .id("session-artifact-pane")
            .w_full()
            .h_full()
            .min_h_0()
            .min_w_0()
            .flex()
            .flex_col()
            .bg(p.surface)
            .when(state.path_open, |el| {
                let thread = thread.to_owned();
                let dismiss_thread = thread.clone();
                el.child(
                    div()
                        .px(px(12.))
                        .py(px(6.))
                        .flex()
                        .items_center()
                        .gap(px(4.))
                        .children(
                            state
                                .path_input
                                .as_ref()
                                .map(|input| Input::new(input).small().flex_1()),
                        )
                        .child(
                            self.artifact_button(
                                &thread,
                                "artifact-save-path",
                                "path-add",
                                self.t("artifacts.add"),
                            )
                            .disabled(state.mutation.is_some())
                            .on_click(cx.listener(
                                move |this, _, _, cx| this.register_artifact_path(&thread, cx),
                            )),
                        )
                        .child(
                            self.artifact_icon_button(
                                &dismiss_thread,
                                "artifact-dismiss-path",
                                "path-dismiss",
                                "x",
                                self.t("artifacts.cancel_path"),
                            )
                            .on_click(cx.listener(
                                move |this, _, _, cx| {
                                    if let Some(state) =
                                        this.artifacts.conversations.get_mut(&dismiss_thread)
                                    {
                                        state.path_open = false;
                                    }
                                    cx.notify();
                                },
                            )),
                        ),
                )
            })
            .when_some(state.error.as_ref(), |el, error| {
                el.child(
                    div()
                        .px(px(12.))
                        .py(px(6.))
                        .text_sm()
                        .text_color(p.error)
                        .child(error.clone()),
                )
            })
            .when(state.loading || state.mutation.is_some(), |el| {
                el.child(
                    div()
                        .px(px(12.))
                        .py(px(4.))
                        .text_sm()
                        .text_color(p.text_muted)
                        .child(self.t(if state.loading {
                            "artifacts.loading"
                        } else {
                            "artifacts.saving"
                        })),
                )
            })
            .child(
                div()
                    .id("session-artifact-preview")
                    .flex_1()
                    .w_full()
                    .min_h_0()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .when(state.pending.is_some(), |el| {
                        el.child(
                            div()
                                .p(px(20.))
                                .text_sm()
                                .text_color(p.text_muted)
                                .child(self.t("artifacts.loading")),
                        )
                    })
                    .when(state.chart.is_some(), |el| {
                        let thread = thread.to_owned();
                        el.child(
                            div()
                                .h(px(24.))
                                .min_h(px(24.))
                                .px(px(8.))
                                .flex()
                                .items_center()
                                .child(
                                    self.artifact_button(
                                        &thread,
                                        "artifact-chart-source",
                                        "chart-source",
                                        self.t(if state.chart_source_open {
                                            "content.preview"
                                        } else {
                                            "content.source"
                                        }),
                                    )
                                    .on_click(cx.listener(
                                        move |this, _, _, cx| {
                                            if let Some(state) =
                                                this.artifacts.conversations.get_mut(&thread)
                                            {
                                                state.chart_source_open = !state.chart_source_open;
                                            }
                                            cx.notify();
                                        },
                                    )),
                                ),
                        )
                    })
                    .children(
                        state
                            .chart
                            .as_ref()
                            .filter(|_| !state.chart_source_open)
                            .map(|chart| chart.artifact_preview(cx)),
                    )
                    .when(state.chart.is_none() || state.chart_source_open, |el| {
                        el.child(self.artifact_preview_surface(thread, state, cx))
                    }),
            )
            .when_some(selected, |el, (artifact, version)| {
                el.child(self.artifact_footer(thread, state, artifact, version, cx))
            })
            .into_any_element()
    }

    fn artifact_footer(
        &self,
        thread: &str,
        state: &ArtifactCollection,
        artifact: &SessionArtifact,
        version: u64,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let p = pero_theme::UiAppearance::global(cx).palette.clone();
        let source = artifact
            .versions
            .iter()
            .find(|item| item.version == version)
            .unwrap_or_else(|| artifact.latest());
        let can_source = self
            .artifact_source_key(thread, &artifact.id, version)
            .is_some();
        let can_update = matches!(source.source, ArtifactSource::File { .. })
            || source.source_message_id.is_some()
            || source.source_tool_call_id.is_some();
        let source_thread = thread.to_owned();
        let source_id = artifact.id.clone();
        let update_thread = thread.to_owned();
        let update_id = artifact.id.clone();
        let compose_thread = thread.to_owned();
        div()
            .h(px(36.))
            .min_h(px(36.))
            .px(px(8.))
            .flex()
            .items_center()
            .gap(px(4.))
            .border_t(px(0.5))
            .border_color(p.border)
            .when(can_source, |el| {
                el.child(
                    self.artifact_button(
                        thread,
                        "artifact-return-source",
                        "source",
                        self.t("artifacts.return_source"),
                    )
                    .icon(Icon::default().path(UiIcon::ArrowLeft.path()))
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.reveal_artifact_source(&source_thread, &source_id, window, cx)
                    })),
                )
            })
            .when(can_update, |el| {
                el.child(
                    self.artifact_icon_button(
                        thread,
                        "artifact-update-version",
                        "update",
                        "refresh",
                        self.t("artifacts.update_version"),
                    )
                    .disabled(state.mutation.is_some())
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.update_artifact_version(&update_thread, &update_id, cx)
                    })),
                )
            })
            .child(div().flex_1())
            .child(
                Button::new("artifact-add-context")
                    .relative()
                    .children(self.artifact_probe(thread, "add-context"))
                    .primary()
                    .small()
                    .h(px(24.))
                    .label(self.t("artifacts.add_context"))
                    .disabled(state.pending.is_some() || state.context.is_some())
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.compose_artifact(&compose_thread, cx)
                    })),
            )
            .into_any_element()
    }
}
