//! A compact conversation catalog around the shared embedded reader.
use crate::{
    assets::UiIcon,
    panel::{ChatAction, ChatPanel},
    session_artifacts::ArtifactCollection,
};
use gpui_kit::{
    base::Selectable,
    component::{
        Disableable, Icon, Sizable,
        button::*,
        input::Input,
        menu::{DropdownMenu, PopupMenuItem},
        resizable::{h_resizable, resizable_panel},
    },
    prelude::*,
    *,
};
use pero_contracts::{
    session_artifact::{ArtifactSource, SessionArtifact},
    workbench::ArtifactView,
};

impl ChatPanel {
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

    fn artifact_icon_button(
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
        let state = self.artifacts.conversations.get(&thread);
        let open = state.is_some_and(|state| state.open);
        let reviewing = state.is_some_and(|state| state.show_changes);
        let count = state.map_or(0, |state| state.items.len());
        let toggle_thread = thread.clone();
        let title = self.t(
            if self.files.selection.tab == pero_contracts::workbench::ResourceTab::Files {
                "files.title"
            } else {
                "artifacts.title"
            },
        );
        let label = if count == 0 || self.files.selection.tab == pero_contracts::workbench::ResourceTab::Files
        {
            title.to_owned()
        } else {
            format!("{title} {count}")
        };
        let header_height = pero_theme::WorkbenchStyle::TAB
            .max(pero_theme::UiAppearance::global(cx).typography.row_height() + 4.)
            .max(36.);
        let header = ((!thread.is_empty() && !reviewing) || self.docked).then(|| {
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
                .when(open && !reviewing, |el| {
                    let toolbar = if self.files.selection.tab == pero_contracts::workbench::ResourceTab::Files
                    {
                        self.files_toolbar(&thread, cx)
                    } else {
                        self.artifacts_toolbar(&thread, state.expect("open artifact catalog"), cx)
                    };
                    el.child(
                        div()
                            .min_w_0()
                            .when(self.artifacts.narrow, |el| el.flex_1())
                            .when(!self.artifacts.narrow, |el| {
                                el.w(px(self.artifact_pane_width()))
                            })
                            .child(toolbar),
                    )
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
            if self.artifacts.narrow {
                pane
            } else {
                let owner = cx.entity().downgrade();
                h_resizable("session-artifact-split")
                    .on_resize(move |state, _, cx| {
                        let Some(width) = state.read(cx).sizes().get(1).copied() else {
                            return;
                        };
                        let width = f32::from(width);
                        let _ = owner.update(cx, |this, cx| {
                            if (this.artifact_pane_width() - width).abs() >= 0.5 {
                                this.set_artifact_pane_width(width, cx);
                                cx.emit(ChatAction::ArtifactPaneWidth {
                                    width: this.artifact_pane_width(),
                                });
                            }
                        });
                    })
                    .child(
                        resizable_panel()
                            .size_range(px(320.)..px(10000.))
                            .child(chat),
                    )
                    .child(
                        resizable_panel()
                            .size(px(self.artifact_pane_width()))
                            .fixed()
                            .size_range(px(280.)..px(1200.))
                            .child(pane),
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

    fn artifacts_toolbar(
        &self,
        thread: &str,
        state: &ArtifactCollection,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let p = pero_theme::UiAppearance::global(cx).palette.clone();
        let picker_thread = thread.to_owned();
        let menu_owner = cx.entity().downgrade();
        let file_label = self.t("artifacts.add_file").to_owned();
        let path_label = self.t("artifacts.enter_path").to_owned();
        let refresh_thread = thread.to_owned();
        let close_thread = thread.to_owned();
        div()
            .h(px(36.))
            .min_h(px(36.))
            .px(px(8.))
            .flex()
            .items_center()
            .gap(px(4.))
            .border_b(px(0.5))
            .border_color(p.border)
            .child(self.resource_tabs(thread, cx))
            .when(!state.items.is_empty(), |el| {
                el.child(
                    div()
                        .text_sm()
                        .text_color(p.text_muted)
                        .child(state.items.len().to_string()),
                )
            })
            .child(div().flex_1())
            .child(
                div()
                    .id("artifact-view-controls")
                    .flex()
                    .items_center()
                    .p(px(2.))
                    .rounded(px(7.))
                    .bg(p.surface_muted)
                    .children(
                        [
                            (ArtifactView::Icons, "layout-grid", "artifacts.view_icons"),
                            (ArtifactView::List, "layout-list", "artifacts.view_list"),
                            (
                                ArtifactView::Gallery,
                                "gallery-horizontal",
                                "artifacts.view_gallery",
                            ),
                        ]
                        .into_iter()
                        .map(|(view, icon, label)| {
                            let active = self.artifacts.view == view;
                            Button::new(SharedString::from(format!("artifact-view-{icon}")))
                                .ghost()
                                .small()
                                .w(px(28.))
                                .h(px(24.))
                                .p_0()
                                .rounded(px(5.))
                                .icon(
                                    Icon::default()
                                        .path(UiIcon::named(icon).path())
                                        .size(px(14.)),
                                )
                                .text_color(if active { p.text } else { p.text_muted })
                                .when(active, |button| {
                                    button.bg(p.surface).border(px(0.5)).border_color(p.border)
                                })
                                .selected(active)
                                .tooltip(self.t(label).to_owned())
                                .accessibility_label(self.t(label).to_owned())
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.set_artifact_view(view, cx);
                                    cx.emit(ChatAction::ArtifactView { view });
                                }))
                        }),
                    ),
            )
            .child(div().w(px(4.)))
            .child(
                self.artifact_icon_button(
                    thread,
                    "artifact-import",
                    "import",
                    "plus",
                    self.t("artifacts.import"),
                )
                .disabled(state.mutation.is_some())
                .dropdown_caret(false)
                .dropdown_menu_with_anchor(
                    Anchor::BottomRight,
                    move |menu, _, _| {
                        let file_owner = menu_owner.clone();
                        let file_thread = picker_thread.clone();
                        let path_owner = menu_owner.clone();
                        let path_thread = picker_thread.clone();
                        menu.item(PopupMenuItem::new(file_label.clone()).on_click(
                            move |_, _, cx| {
                                let _ = file_owner.update(cx, |_, cx| {
                                    cx.emit(ChatAction::ChooseArtifactFile {
                                        thread_id: file_thread.clone(),
                                    })
                                });
                            },
                        ))
                        .item(
                            PopupMenuItem::new(path_label.clone()).on_click(move |_, _, cx| {
                                let _ = path_owner.update(cx, |this, cx| {
                                    if let Some(state) =
                                        this.artifacts.conversations.get_mut(&path_thread)
                                    {
                                        state.path_open = true;
                                    }
                                    cx.notify();
                                });
                            }),
                        )
                    },
                ),
            )
            .child(
                self.artifact_icon_button(
                    thread,
                    "artifact-refresh",
                    "refresh",
                    "refresh",
                    self.t("artifacts.refresh"),
                )
                .disabled(state.loading)
                .on_click(
                    cx.listener(move |this, _, _, cx| this.refresh_artifacts(&refresh_thread, cx)),
                ),
            )
            .child(
                self.artifact_icon_button(
                    thread,
                    "artifact-close",
                    "close",
                    "x",
                    self.t("artifacts.close"),
                )
                .on_click(cx.listener(move |this, _, _, cx| {
                    if let Some(state) = this.artifacts.conversations.get_mut(&close_thread) {
                        state.open = false;
                    }
                    cx.notify();
                })),
            )
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
            .child(self.output_tabs(thread,state,cx))
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
            .when_some(
                selected.filter(|_| state.chart.is_some()),
                |el, (artifact, version)| {
                    el.child(self.artifact_document_bar(thread, artifact, version, cx))
                },
            )
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

    fn artifact_document_bar(
        &self,
        thread: &str,
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
        let filename = match &source.source {
            ArtifactSource::File { path } => {
                path.rsplit(['/', '\\']).next().unwrap_or(path).to_owned()
            }
            ArtifactSource::Text | ArtifactSource::Research { .. } => artifact.title.clone(),
        };
        let previous_thread = thread.to_owned();
        let previous_id = artifact.id.clone();
        let next_thread = thread.to_owned();
        let next_id = artifact.id.clone();
        div()
            .h(px(30.))
            .min_h(px(30.))
            .px(px(12.))
            .flex()
            .items_center()
            .gap(px(4.))
            .border_b(px(0.5))
            .border_color(p.border)
            .child(
                div()
                    .text_sm()
                    .text_color(p.text_muted)
                    .flex_1()
                    .min_w_0()
                    .truncate()
                    .child(filename),
            )
            .child(
                self.artifact_icon_button(
                    thread,
                    "artifact-previous-version",
                    "previous",
                    "chevron-left",
                    self.t("artifacts.previous_version"),
                )
                .disabled(version <= 1)
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.read_artifact(&previous_thread, &previous_id, version - 1, false, cx)
                })),
            )
            .child(
                div()
                    .text_sm()
                    .text_color(p.text_muted)
                    .child(format!("v{version} / {}", artifact.latest().version)),
            )
            .child(
                self.artifact_icon_button(
                    thread,
                    "artifact-next-version",
                    "next",
                    "chevron-right",
                    self.t("artifacts.next_version"),
                )
                .disabled(version >= artifact.latest().version)
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.read_artifact(&next_thread, &next_id, version + 1, false, cx)
                })),
            )
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
