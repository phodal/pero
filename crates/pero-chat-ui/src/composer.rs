use crate::session_state::SessionState;
use crate::panel::ChatPanel;
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
        let busy = chat.is_some_and(|c| c.busy());
        let id = chat.map(|c| c.id.clone()).unwrap_or_default();
        let agent = chat
            .map(|c| c.agent.clone())
            .or_else(|| self.agents.get(self.agent_index).map(|a| a.id.clone()))
            .unwrap_or_else(|| "codex".into());
        let rows = self.composer.read(cx).value().lines().count().clamp(2, 7);
        let workspace = self
            .workspace
            .rsplit('/')
            .next()
            .unwrap_or("Workspace")
            .to_string();
        let model_pending =
            chat.is_some_and(|chat| chat.pending_model.is_some() || chat.pending_setting.is_some());
        let selected_agent = agent.clone();
        let agent_available = self.agents.iter().any(|choice| choice.id == agent && choice.available);
        let agent_choices = self.agents.clone();
        let agent_workbench = cx.entity().downgrade();
        let context_workbench = cx.entity().downgrade();
        let paste_workbench = cx.entity().downgrade();
        let context_sources = [
            ContextKind::File,
            ContextKind::Directory,
            ContextKind::Symbol,
            ContextKind::Thread,
            ContextKind::Skill,
            ContextKind::Image,
            ContextKind::Selection,
            ContextKind::BranchDiff,
            ContextKind::Fetch,
        ]
        .map(|kind| (kind, self.context_kind_label(kind).to_string()));
        let browse_sources = [
            (ContextKind::File, self.t("composer.browse").to_string()),
            (
                ContextKind::Image,
                self.t("composer.browse_image").to_string(),
            ),
            (
                ContextKind::Directory,
                self.t("composer.browse_directory").to_string(),
            ),
        ];
        let supports_images = chat.is_some_and(|chat| chat.capabilities.images);
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
            Button::new("model-picker").ghost().small().h(px(pero_theme::UiAppearance::global(cx).typography.control_height()))
                .label(label).max_w(px(220.)).dropdown_caret(true)
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
                                    let Some(index) = this.chats.iter().position(|chat| chat.id == thread) else { return; };
                                    let chat = &mut this.chats[index];
                                    if chat.model == model || chat.busy() || chat.pending_model.is_some() { return; }
                                    // The active model is authoritative ACP state. Keep its
                                    // label until the Agent acknowledges this selection.
                                    chat.pending_model = Some(model.clone());
                                    chat.error = None;
                                    this.command(json!({"action":"model","thread_id":thread,"model_id":model}), cx);
                                });
                            }))
                    })
                })
                .on_open_change(move |open, _, cx| {
                    let _ = open_workbench.update(cx, |this, _| {
                        this.model_menu = *open;
                    });
                })
        });
        div()
            .id("chat-composer")
            .relative()
            .flex_shrink_0()
            .border_t_1()
            .border_color(p.border)
            .bg(p.surface)
            .px(px(12.))
            .pt(px(W::INSET))
            .pb(px(W::INSET))
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
            .when(self.error.is_some(), |el| {
                el.child(
                    div()
                        .mb(px(8.))
                        .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption))
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
            .when(!self.attachments.is_empty(), |el| {
                el.child(div().flex().flex_wrap().gap(px(6.)).mb(px(6.)).children(
                    self.attachments.iter().enumerate().map(|(i, file)| {
                        let preview=file.clone();
                        let thread_id=self.active_chat.and_then(|index|self.chats.get(index)).map(|chat|chat.id.clone()).unwrap_or_default();
                        div().flex().items_center().child(
                        Button::new(("attached-file", i))
                            .ghost()
                            .small().h(px(pero_theme::UiAppearance::global(cx).typography.control_height()))
                            .icon(IconName::File)
                            .label(format!("{} ×", file.label))
                            .tooltip(format!("{}: {}", self.t("composer.remove"), file.source))
                            .on_click(cx.listener(move |this, _, window, cx| {
                                this.remove_composer_context(i, window, cx);
                            }))
                        ).when(cfg!(target_family="wasm"), |row| row.child(
                            Button::new(("preview-context",i)).ghost().small().h(px(pero_theme::UiAppearance::global(cx).typography.control_height())).label(self.t("composer.preview"))
                                .on_click(cx.listener(move|_,_,_,cx|cx.emit(crate::ChatAction::PreviewContext{reference:preview.clone(),thread_id:thread_id.clone()})))
                        ))
                    }),
                ))
            })
            .child(
                div()
                    .id("composer-field")
                    .border_1()
                    .border_color(if focused { p.focus } else { p.input_border })
                    .rounded(px(W::INSET))
                    .bg(p.surface)
                    .px(px(W::INSET))
                    .pt(px(W::GAP))
                    .pb(px(W::GAP))
                    .child(
                Textarea::new(&self.composer)
                    .bordered(false)
                    .appearance(false)

                    .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Body))
                    .aria_label(self.t("chat.placeholder"))
                    .accessibility_id("chat-input")
                    .on_paste(move |clipboard, window, cx| {
                        paste_workbench
                            .update(cx, |this, cx| this.composer_paste(clipboard, window, cx))
                            .unwrap_or(false)
                    })
                    .h(px(rows as f32 * pero_theme::UiAppearance::global(cx).typography.ui * 1.5 + 8.)),
            )
            .child(
                div()
                    .mt(px(6.))
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap(px(W::GAP))
                    .child(
                        Button::new("attach-context")
                            .ghost()
                            .small().h(px(pero_theme::UiAppearance::global(cx).typography.control_height()))
                            .icon(IconName::Plus)
                            .accessibility_label(self.t("composer.context"))
                            .tooltip(self.t("composer.context"))
                            .dropdown_menu_with_anchor(Anchor::BottomLeft, move |menu, _, _| {
                                let menu = context_sources.iter().fold(
                                    menu.min_w(px(W::MENU_WIDTH)),
                                    |menu, (kind, label)| {
                                        let kind = *kind;
                                        let workbench = context_workbench.clone();
                                        menu.item(
                                            PopupMenuItem::new(label.clone())
                                                .icon(
                                                    Icon::default()
                                                        .path(Self::context_kind_icon(kind)),
                                                )
                                                .disabled(
                                                    kind == ContextKind::Selection
                                                        || kind == ContextKind::Image
                                                            && !supports_images,
                                                )
                                                .on_click(move |_, window, cx| {
                                                    let _ = workbench.update(cx, |this, cx| {
                                                        this.open_context_source(kind, window, cx)
                                                    });
                                                }),
                                        )
                                    },
                                );
                                browse_sources.iter().fold(
                                    menu.separator(),
                                    |menu, (kind, label)| {
                                        let kind = *kind;
                                        let workbench = context_workbench.clone();
                                        menu.item(
                                            PopupMenuItem::new(label.clone())
                                                .icon(
                                                    Icon::default()
                                                        .path(Self::context_kind_icon(kind)),
                                                )
                                                .disabled(
                                                    kind == ContextKind::Image && !supports_images,
                                                )
                                                .on_click(move |_, _, cx| {
                                                    let _ = workbench.update(cx, |this, cx| {
                                                        this.browse_composer_context(kind, cx)
                                                    });
                                                }),
                                        )
                                    },
                                )
                            }),
                    )
                    .children(self.session_extra_controls(cx))
                    .child(div().flex_1())
                    .child(
                        Button::new("agent-picker")
                            .ghost()
                            .small().h(px(pero_theme::UiAppearance::global(cx).typography.control_height()))
                            .icon(Icon::default().path("icons/terminal.svg"))
                            .label(agent.clone())
                            .tooltip(self.t("composer.acp"))
                            .dropdown_caret(chat.is_none_or(|chat| chat.can_retarget()))
                            .disabled(chat.is_some_and(|chat| !chat.can_retarget()))
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
                                                    let _ = workbench.update(cx, |this, cx| this.select_agent(i, cx));
                                                }),
                                        )
                                    },
                                )
                            }),
                    )
                    .children(model_picker)
                    .children(self.session_setting_controls("thought_level", cx))
                    .when(chat.is_none_or(|chat| chat.can_retarget()), |el| {
                        el.child(
                            Button::new("workspace-picker")
                                .ghost()
                                .small().h(px(pero_theme::UiAppearance::global(cx).typography.control_height()))
                                .icon(IconName::Folder)
                                .label(workspace)
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.command(json!({"action":"choose_workspace"}), cx)
                                })),
                        )
                    })
                    .when(chat.is_some_and(|c| c.state == SessionState::Closed && c.can_retarget()), |el| {
                        el.child(
                            Button::new("retry-chat")
                                .outline()
                                .small().h(px(pero_theme::UiAppearance::global(cx).typography.control_height()))
                                .label(self.t("chat.retry"))
                                .disabled(!self.connected)
                                .on_click(cx.listener(|this, _, _, cx| this.retry_chat(cx))),
                        )
                    })
                    .when(chat.is_some_and(|c| c.state == SessionState::Running || c.state == SessionState::Stopping || c.queued.is_some()), |el| {
                        el.child(
                            Button::new("stop-agent")
                                .outline()
                                .small().h(px(pero_theme::UiAppearance::global(cx).typography.control_height()))
                                .icon(IconName::Square)
                                .label(self.t("chat.stop"))
                                .on_click(cx.listener(|this, _, _, cx| {
                                    if let Some(i) = this.active_chat {
                                        let id = this.chats[i].id.clone();
                                        this.chats[i].state = SessionState::Stopping;
                                        this.command(json!({"action":"cancel","thread_id":id}), cx);
                                    }
                                })),
                        )
                    })
                    .when(chat.is_none_or(|c| !matches!(c.state, SessionState::Running | SessionState::Stopping) && c.queued.is_none()), |el| {
                        el.child(
                            Button::new("send-chat")
                                .primary()
                                .small().h(px(pero_theme::UiAppearance::global(cx).typography.control_height()))
                                .icon(IconName::ArrowRight)
                                .label(self.t("probe.send"))
                                .disabled(
                                    !self.connected
                                        || !agent_available
                                        || self.composer_state.loading
                                            && self.composer_state.resolve_range.is_some()
                                        || self.composer.read(cx).value().trim().is_empty()
                                            && self.attachments.is_empty()
                                        || chat.is_some_and(|c| {
                                            !c.can_submit()
                                        }),
                                )
                                .on_click(
                                    cx.listener(|this, _, window, cx| this.send_chat(window, cx)),
                                ),
                        )
                    }),
            ))
    }
}
