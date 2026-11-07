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
    workbench::LayoutPreferences,
};

impl ChatPanel {
    /// Chat column keeps this much space before the artifact column replaces it.
    const CHAT_COLUMN_MIN: f32 = 320.;
    /// The resize handle stays reachable. This is not a content-width limit.
    const PANE_DIVIDER: f32 = 12.;

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
                        let x: f32 = event.position.x.into();
                        let floor = Self::PANE_DIVIDER.min(resize.max_width);
                        let width = (resize.origin_width - (x - resize.origin_x))
                            .clamp(floor, resize.max_width);
                        if (this.artifact_pane_width() - width).abs() >= 0.5 {
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
                        if this.artifacts.resize.take().is_some() {
                            cx.emit(ChatAction::ArtifactPaneWidth {
                                width: this.artifact_pane_width(),
                            });
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
        let available = f32::from(size.width);
        self.artifacts.narrow = available
            < Self::CHAT_COLUMN_MIN + f32::from(LayoutPreferences::MIN_ARTIFACT_PANE_WIDTH);
        let state = self.artifacts.conversations.get(&thread);
        let open = state.is_some_and(|state| state.open);
        let reviewing = state.is_some_and(|state| state.show_changes);
        let maximized = !reviewing
            && self.files.selection.tab == pero_contracts::workbench::ResourceTab::Artifacts
            && state.is_some_and(|state| state.maximized);
        let split = open && !self.artifacts.narrow && !maximized;
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
            } else {
                let shown = self.artifact_column_width(available);
                let border = pero_theme::UiAppearance::global(cx).palette.border;
                div()
                    .relative()
                    .size_full()
                    .min_w_0()
                    .min_h_0()
                    .flex()
                    .child(self.artifact_resize_capture(cx))
                    .child(
                        div()
                            .relative()
                            .flex_1()
                            .h_full()
                            .min_w_0()
                            .child(chat)
                            .child(
                                div()
                                    .absolute()
                                    .right_0()
                                    .top_0()
                                    .bottom_0()
                                    .w(px(1.))
                                    .bg(border),
                            ),
                    )
                    .child(
                        div()
                            .relative()
                            .h_full()
                            .w(px(shown))
                            .min_w_0()
                            .flex_shrink_0()
                            .flex()
                            .flex_col()
                            .border_l(px(1.))
                            .border_color(border)
                            .child(
                                div()
                                    .h(px(header_height))
                                    .min_h(px(header_height))
                                    .flex()
                                    .items_center()
                                    .min_w_0()
                                    .child(
                                        div().flex_1().min_w_0().child(self.pane_toolbar(
                                            &thread,
                                            collection,
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
                            .child(div().flex_1().min_h_0().min_w_0().child(pane))
                            .child(
                                div()
                                    .id(SharedString::from(format!("artifact-pane-resize-{thread}")))
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
                                                    f32::from(
                                                        LayoutPreferences::DEFAULT_ARTIFACT_PANE_WIDTH,
                                                    ),
                                                    cx,
                                                );
                                                cx.emit(ChatAction::ArtifactPaneWidth {
                                                    width: this.artifact_pane_width(),
                                                });
                                            } else {
                                                this.artifacts.resize = Some(ArtifactPaneResize {
                                                    origin_x: event.position.x.into(),
                                                    origin_width: shown,
                                                    max_width: available.max(shown),
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
