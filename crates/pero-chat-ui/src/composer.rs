use crate::panel::ChatPanel;
use crate::session_state::SessionState;
use crate::theme::WorkbenchStyle as W;
use gpui_kit::{
    component::{
        button::*,
        input::{Enter, Escape, Indent, IndentInline, MoveDown, MoveUp, Textarea},
        menu::{DropdownMenu, PopupMenuItem},
        *,
    },
    prelude::*,
    *,
};
use pero_contracts::context::ContextKind;
use serde_json::json;

impl ChatPanel {
    pub fn composer_view(&self, window: &Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        let focused = self.composer.read(cx).focus_handle(cx).is_focused(window);
        let chat = self.active_chat.and_then(|i| self.chats.get(i));
        let project_scope = self.project_composer.scope.as_ref();
        let starting = self.project_starting();
        let busy = chat.is_some_and(|c| c.busy());
        let id = chat.map(|c| c.id.clone()).unwrap_or_default();
        let agent = chat
            .map(|c| c.agent.clone())
            .or_else(|| self.agents.get(self.agent_index).map(|a| a.id.clone()))
            .unwrap_or_else(|| "codex".into());
        let editor = self.composer.read(cx);
        let rows = editor
            .value()
            .split('\n')
            .count()
            .max(editor.display_map().wrap_row_count())
            .clamp(1, if self.compact { 3 } else { 7 });
        let inline = self.compact || rows == 1 && self.attachments.is_empty();
        let workspace_path = chat
            .map(|chat| chat.workspace.as_str())
            .filter(|path| !path.is_empty())
            .unwrap_or_else(|| project_scope.map(|scope| scope.workspace.as_deref().unwrap_or_default())
                .unwrap_or(&self.workspace));
        let workspace = crate::composer_workspace::label(workspace_path).to_string();
        let project_retry = chat.filter(|chat| chat.can_retry_project_start()).and_then(|chat| {
            chat.project_agent.as_ref().map(|binding| (binding.project_id.clone(), chat.agent.clone()))
        });
        let can_reconnect = chat.is_some_and(|chat| chat.can_reconnect());
        let can_retry = can_reconnect || project_retry.is_some() || chat.is_some_and(|chat| chat.can_retry());
        let can_send = self.connected
            && self
                .agents
                .iter()
                .any(|choice| choice.id == agent && choice.available)
            && !(self.composer_state.loading && self.composer_state.resolve_range.is_some())
            && (!editor.value().trim().is_empty() || !self.attachments.is_empty())
            && (project_scope.is_none() || self.can_start_project())
            && chat.is_none_or(|chat| chat.can_submit());
        let model_pending =
            chat.is_some_and(|chat| chat.pending_model.is_some() || chat.pending_setting.is_some());
        let selected_agent = agent.clone();
        let agent_choices = self.agents.clone();
        let agent_workbench = cx.entity().downgrade();
        let agent_menu = agent_workbench.clone();
        let paste_workbench = cx.entity().downgrade();
        let model_picker = chat.filter(|chat| !chat.models.is_empty()).map(|chat| {
            let models = chat.models.clone();
            let selected = chat.model.clone();
            let label = models
                .iter()
                .find(|(id, _)| id == &selected)
                .map(|(_, name)| name.clone())
                .unwrap_or_else(|| if selected.is_empty() { self.t("chat.select_model").to_string() } else { selected.clone() });
            let thread = id.clone();
            let workbench = cx.entity().downgrade();
            let open_workbench = workbench.clone();
            W::composer_control(Button::new("model-picker").ghost(), cx)
                .relative().child(self.composer_bounds.model.probe())
                .tooltip(label.clone()).label(label).max_w(px(if self.compact { 100. } else { 180. })).dropdown_caret(true)
                .loading(model_pending).loading_icon(Icon::default().path("icons/clock.svg"))
                .disabled(busy || model_pending || chat.state != SessionState::Idle)
                .dropdown_menu_with_anchor(Anchor::BottomLeft, move |menu, _, _| {
                    models.iter().fold(menu.min_w(px(W::MENU_WIDTH)).max_w(px(340.)).max_h(px(280.))
                        .scrollable(true).check_side(Side::Right), |menu, (model, label)| {
                        let model = model.clone();
                        let selected = selected.clone();
                        let thread = thread.clone();
                        let workbench = workbench.clone();
                        menu.item(PopupMenuItem::new(label.clone()).checked(model == selected)
                            .on_click(move |_, _, cx| {
                                let _ = workbench.update(cx, |this, cx| {
                                    this.select_chat_model(&thread, &model, cx);
                                });
                            }))
                    })
                })
                .on_open_change(move |open, _, cx| {
                    let _ = open_workbench.update(cx, |this, _| {
                        this.model_menu = *open;
                        this.dock_menu = *open;
                    });
                })
        });
        let agent_picker = W::composer_control(Button::new("agent-picker").ghost(), cx)
            .icon(Icon::default().path("icons/terminal.svg"))
            .relative()
            .child(self.composer_bounds.agent.probe())
            .max_w(px(if self.compact { 100. } else { 240. }))
            .label(if self.compact {
                agent.clone()
            } else {
                let name = self
                    .agents
                    .iter()
                    .find(|choice| choice.id == agent)
                    .map(|choice| choice.name.as_str())
                    .unwrap_or(&agent);
                name.to_owned()
            })
            .tooltip(self.t("composer.acp"))
            .dropdown_caret(true)
            .disabled(starting || chat.is_some_and(|chat| !chat.can_retarget()))
            .dropdown_menu_with_anchor(Anchor::BottomLeft, move |menu, _, _| {
                agent_choices.iter().enumerate().fold(
                    menu.min_w(px(W::MENU_WIDTH)).check_side(Side::Right),
                    |menu, (i, choice)| {
                        let workbench = agent_workbench.clone();
                        menu.item(
                            PopupMenuItem::new(choice.name.clone())
                                .checked(choice.id == selected_agent)
                                .disabled(!choice.available)
                                .on_click(move |_, _, cx| {
                                    let _ =
                                        workbench.update(cx, |this, cx| this.select_agent(i, cx));
                                }),
                        )
                    },
                )
            })
            .on_open_change(move |open, _, cx| {
                let _ = agent_menu.update(cx, |this, _| this.dock_menu = *open);
            });
        let (compact_agent, normal_agent) = if self.compact {
            (Some(agent_picker), None)
        } else {
            (None, Some(agent_picker))
        };
        let context_button = W::composer_control(Button::new("attach-context").ghost(), cx)
            .disabled(starting)
            .relative()
            .child(self.composer_bounds.context.probe())
            .icon(IconName::Plus)
            .rounded_full()
            .w(px(pero_theme::UiAppearance::global(cx)
                .typography
                .control_height()
                .max(pero_theme::GHOST_ICON_BUTTON)))
            .p_0()
            .bg(p.surface_muted)
            .accessibility_label(self.t("composer.context"))
            .tooltip(self.t("composer.context"))
            .on_click(cx.listener(|this, _, window, cx| this.open_composer_add(window, cx)));
        let (compact_context, normal_context) = if inline {
            (Some(context_button), None)
        } else {
            (None, Some(context_button))
        };
        let attachments = (!self.attachments.is_empty()).then(|| {
            div()
                .min_w_0()
                .w_full()
                .flex()
                .flex_wrap()
                .gap(px(6.))
                .mb(px(6.))
                .children(self.attachments.iter().enumerate().map(|(i, file)| {
                    let open = file.clone();
                    let preview = file.clone();
                    let thread_id = self
                        .active_chat
                        .and_then(|index| self.chats.get(index))
                        .map(|chat| chat.id.clone())
                        .unwrap_or_default();
                    let can_open = matches!(
                        file.kind,
                        ContextKind::AppObject
                            | ContextKind::File
                            | ContextKind::Directory
                            | ContextKind::Selection
                    );
                    div()
                        .min_w_0()
                        .max_w_full()
                        .flex()
                        .items_center()
                        .gap(px(2.))
                        .rounded(px(pero_theme::RADIUS_BUTTON))
                        .bg(p.surface_muted)
                        .child(
                            W::composer_control(Button::new(("attached-file", i)).ghost(), cx)
                                .flex_1()
                                .min_w_0()
                                .disabled(starting && !can_open)
                                .icon(Icon::default().path(Self::context_kind_icon(file.kind)))
                                .label(file.label.clone())
                                .tooltip(if can_open {
                                    format!("{}\n{}", file.label, file.source)
                                } else {
                                    format!("{}: {}", self.t("composer.remove"), file.source)
                                })
                                .on_click(cx.listener(move |this, _, window, cx| {
                                    if can_open {
                                        cx.emit(crate::ChatAction::OpenContext {
                                            reference: open.clone(),
                                        });
                                    } else {
                                        this.remove_composer_context(i, window, cx);
                                    }
                                })),
                        )
                        .child(
                            W::composer_control(Button::new(("remove-context", i)).ghost(), cx)
                                .disabled(starting)
                                .label("×")
                                .accessibility_label(self.t("composer.remove"))
                                .tooltip(self.t("composer.remove"))
                                .on_click(cx.listener(move |this, _, window, cx| {
                                    this.remove_composer_context(i, window, cx);
                                })),
                        )
                        .when(cfg!(target_family = "wasm"), |row| {
                            row.child(
                                W::composer_control(
                                    Button::new(("preview-context", i))
                                        .relative()
                                        .children(
                                            self.context_preview_bounds
                                                .get(&file.id)
                                                .map(|bounds| bounds.probe()),
                                        )
                                        .ghost(),
                                    cx,
                                )
                                .label(self.t("composer.preview"))
                                .on_click(cx.listener(
                                    move |_, _, _, cx| {
                                        cx.emit(crate::ChatAction::PreviewContext {
                                            reference: preview.clone(),
                                            thread_id: thread_id.clone(),
                                        })
                                    },
                                )),
                            )
                        })
                }))
        });
        let (compact_attachments, normal_attachments) = if self.compact {
            (attachments, None)
        } else {
            (None, attachments)
        };
        let composer = div()
            .id("chat-composer")
            .relative()
            .when(self.compact, |el| el.flex_shrink_0().px(px(W::INSET)))
            .when(!self.compact, |el| {
                el.w_full()
                    .max_w(px(pero_theme::COMPOSER_MAX))
                    .min_w_0()
                    .mx_auto()
            })
            .font_weight(FontWeight::NORMAL)
            .pt(px(pero_theme::SPACE_4))
            .pb(px(pero_theme::SPACE_8))
            .capture_action(cx.listener(|this, action: &Enter, window, cx| {
                if action.shift || !this.composer_action("enter", window, cx) {
                    cx.propagate();
                }
            }))
            .capture_action(cx.listener(|this, _: &MoveUp, window, cx| {
                if !this.composer_action("up", window, cx) {
                    cx.propagate();
                }
            }))
            .capture_action(cx.listener(|this, _: &MoveDown, window, cx| {
                if !this.composer_action("down", window, cx) {
                    cx.propagate();
                }
            }))
            .capture_action(cx.listener(|this, _: &Escape, window, cx| {
                if !this.composer_action("escape", window, cx) {
                    cx.propagate();
                }
            }))
            .capture_action(cx.listener(|this, _: &Indent, window, cx| {
                if !this.composer_action("tab", window, cx) {
                    cx.propagate();
                }
            }))
            .capture_action(cx.listener(|this, _: &IndentInline, window, cx| {
                if !this.composer_action("tab", window, cx) {
                    cx.propagate();
                }
            }))
            .capture_key_down(cx.listener(|this, event, window, cx| {
                this.composer_key_down(event, window, cx);
            }))
            .when(self.composer_state.open, |el| {
                el.child(self.composer_picker_view(cx))
            })
            .when_some(self.history_status, |el, status| {
                let key = match (status.incomplete(), status.save_failure.is_some()) {
                    (_, false) => "chat.history_incomplete",
                    (false, true) => "chat.history_unsaved",
                    (true, true) => "chat.history_incomplete_unsaved",
                };
                el.child(div().id("session-history-status").role(Role::Status)
                    .mb(px(pero_theme::SPACE_8))
                    .px(px(pero_theme::SPACE_8))
                    .py(px(pero_theme::SPACE_4))
                    .bg(p.warning_bg)
                    .text_color(p.warning)
                    .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption))
                    .whitespace_normal()
                    .child(self.t(key)))
            })
            .when(self.error.is_some(), |el| {
                el.child(
                    div()
                        .mb(px(8.))
                        .text_size(
                            pero_theme::UiAppearance::global(cx)
                                .text(pero_theme::TextRole::Caption),
                        )
                        .text_color(p.error)
                        .child(
                            self.error
                                .as_ref()
                                .map(|e| {
                                    if e.contains('.') && !e.contains(' ') {
                                        self.t(e).to_string()
                                    } else {
                                        e.clone()
                                    }
                                })
                                .unwrap_or_default(),
                        ),
                )
            })
            .when(can_retry, |el| {
                el.child(
                    div()
                        .id("composer-session-status")
                        .flex()
                        .flex_wrap()
                        .items_center()
                        .gap(px(pero_theme::SPACE_8))
                        .mb(px(pero_theme::SPACE_8))
                        .text_size(
                            pero_theme::UiAppearance::global(cx)
                                .text(pero_theme::TextRole::Caption),
                        )
                        .text_color(p.text_muted)
                        .when(
                            chat.is_some_and(|chat| chat.state == SessionState::Closed),
                            |el| el.child(self.t("chat.session_closed")),
                        )
                        .child(
                            W::composer_control(Button::new("retry-chat").ghost(), cx)
                                .relative()
                                .child(self.composer_bounds.reconnect.probe())
                                .icon(Icon::default().path(crate::assets::UiIcon::RotateCcw.path()))
                                .label(
                                    if project_retry.is_none() && chat.is_some_and(|chat| chat.state == SessionState::Closed) {
                                        self.t("chat.reconnect")
                                    } else {
                                        self.t("chat.retry")
                                    },
                                )
                                .disabled(!self.connected)
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    if let Some((project_id, agent_id)) = &project_retry {
                                        cx.emit(crate::ChatAction::StartProjectAgent {
                                            project_id: project_id.clone(), agent_id: agent_id.clone(),
                                        });
                                    } else if can_reconnect {
                                        this.reconnect_chat(cx);
                                    } else {
                                        this.retry_chat(cx);
                                    }
                                })),
                        ),
                )
            })
            .children(compact_attachments)
            .child(
                W::composer_field(inline, focused, cx)
                    .when(inline, |el| {
                        el.flex().items_center().gap(px(pero_theme::SPACE_8))
                    })
                    .children(normal_attachments)
                    .children(compact_context)
                    .when(self.compact, |el| el.child(self.output_controls(cx)))
                    .child(
                        div()
                            .relative()
                            .min_w_0()
                            .when(inline, |el| el.flex_1())
                            .child(self.composer_bounds.input.probe())
                            .child(
                                Textarea::new(&self.composer)
                                    // The compound frame owns spacing; Kit's XSmall
                                    // removes its extra vertical padding, not the body font.
                                    .xsmall()
                                    .bordered(false)
                                    .appearance(false)
                                    .font_weight(FontWeight::NORMAL)
                                    .text_color(p.text)
                                    .text_size(
                                        pero_theme::UiAppearance::global(cx)
                                            .text(pero_theme::TextRole::Body),
                                    )
                                    .aria_label(self.composer_placeholder())
                                    .disabled(starting)
                                    .accessibility_id("chat-input")
                                    .on_paste(move |clipboard, window, cx| {
                                        paste_workbench
                                            .update(cx, |this, cx| {
                                                this.composer_paste(clipboard, window, cx)
                                            })
                                            .unwrap_or(false)
                                    })
                                    .h(px(rows as f32
                                        * pero_theme::UiAppearance::global(cx).typography.ui
                                        * 1.4
                                        + 4.)),
                            ),
                    )
                    .child(
                        div()
                            .when(!inline, |el| el.mt(px(pero_theme::SPACE_4)).flex_wrap())
                            .flex()
                            .items_center()
                            .gap(px(pero_theme::SPACE_8))
                            .when(!inline, |el| el.children(normal_context))
                            .child(
                                div()
                                    .ml_auto()
                                    .max_w_full()
                                    .flex_shrink_0()
                                    .flex()
                                    .items_center()
                                    .justify_end()
                                    .gap(px(pero_theme::SPACE_8))
                                    .when(!self.compact, |el| el.flex_wrap())
                                    .children(compact_agent)
                                    .children(model_picker)
                                    .when(
                                        chat.is_some_and(|c| {
                                            c.state == SessionState::Running
                                                || c.state == SessionState::Stopping
                                                || c.queued.is_some()
                                        }),
                                        |el| {
                                            el.child(
                                                W::composer_control(
                                                    Button::new("stop-agent")
                                                        .relative()
                                                        .children([self.stop_button_bounds.probe()])
                                                        .ghost()
                                                        .rounded_full()
                                                        .w(px(pero_theme::GHOST_ICON_BUTTON))
                                                        .p_0(),
                                                    cx,
                                                )
                                                .icon(IconName::Square)
                                                .accessibility_label(self.t("chat.stop"))
                                                .tooltip(self.t("chat.stop"))
                                                .on_click(cx.listener(|this, _, _, cx| {
                                                    if let Some(i) = this.active_chat {
                                                        let id = this.chats[i].id.clone();
                                                        this.chats[i].state =
                                                            SessionState::Stopping;
                                                        this.command(
                                                        json!({"action":"cancel","thread_id":id}),
                                                        cx,
                                                    );
                                                    }
                                                })),
                                            )
                                        },
                                    )
                                    .when(
                                        chat.is_none_or(|c| {
                                            !matches!(
                                                c.state,
                                                SessionState::Running | SessionState::Stopping
                                            ) && c.queued.is_none()
                                        }),
                                        |el| {
                                            el.child(
                                                W::composer_control(
                                                    Button::new("send-chat")
                                                        .when(can_send, |button| button.primary())
                                                        .when(!can_send, |button| button.ghost())
                                                        .rounded_full()
                                                        .w(px(pero_theme::GHOST_ICON_BUTTON))
                                                        .p_0(),
                                                    cx,
                                                )
                                                .icon(IconName::ArrowUp)
                                                .accessibility_label(self.t("probe.send"))
                                                .tooltip(self.t("chat.composer_hint"))
                                                .disabled(!can_send)
                                                .on_click(cx.listener(|this, _, window, cx| {
                                                    this.send_chat(window, cx)
                                                })),
                                            )
                                        },
                                    ),
                            ),
                    ),
            )
            .when(!self.compact, |el| {
                el.child(
                    div()
                        .id("composer-environment")
                        .flex()
                        .flex_wrap()
                        .items_center()
                        .gap(px(pero_theme::SPACE_8))
                        .mt(px(pero_theme::SPACE_4))
                        .text_color(p.text_muted)
                        .children(normal_agent)
                        .children(self.session_extra_controls(cx))
                        .children(self.team_button(cx))
                        .child(self.output_controls(cx))
                        .children(self.session_setting_controls("thought_level", cx))
                        .children(
                            chat.and_then(|chat| chat.usage.as_ref()).map(|usage| {
                                crate::usage::render_usage(usage, &self.locale, p, cx)
                            }),
                        )
                        .child(
                            W::composer_control(Button::new("workspace-picker").ghost(), cx)
                                .relative()
                                .child(self.composer_bounds.workspace.probe())
                                .icon(IconName::Folder)
                                .label(workspace)
                                .tooltip(format!(
                                    "{}: {}",
                                    self.t("chat.workspace"),
                                    workspace_path
                                ))
                                .max_w(px(280.))
                                .disabled(project_scope.is_some() || chat.is_some_and(|chat| !chat.can_retarget()))
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.command(json!({"action":"choose_workspace"}), cx)
                                })),
                        ),
                )
            });
        if self.compact {
            return composer;
        }
        // min(composer max, pane width minus the horizontal inset), centered.
        // A narrower pane shrinks the bar. The frame stays visible so the
        // completion popup is not clipped.
        div()
            .id("chat-composer-frame")
            .w_full()
            .min_w_0()
            .flex_shrink_0()
            .flex()
            .justify_center()
            .px(px(W::INSET))
            .child(composer)
    }
}
