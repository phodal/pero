use crate::app::Workbench;
use gpui_kit::{
    component::{
        button::*,
        input::Editor,
        menu::{DropdownMenu, PopupMenuItem},
        *,
    },
    prelude::*,
    *,
};
use serde_json::json;

impl Workbench {
    pub fn composer_view(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let p = self.palettes.get(self.dark);
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
        let agent_choices = self.agents.clone();
        let agent_workbench = cx.entity().downgrade();
        let setting_pickers = chat.map(|chat| chat.settings.options.iter().enumerate().map(|(index, option)| {
            let thread = id.clone();
            let setting = option.clone();
            let workbench = cx.entity().downgrade();
            let label = option.choices.iter().find(|choice| choice.value == option.current)
                .map(|choice| choice.label.clone()).unwrap_or_else(|| option.name.clone());
            let loading = chat.pending_setting.as_ref().is_some_and(|pending| pending.id == option.id);
            Button::new(("session-setting",index)).ghost().small().label(label)
                .dropdown_caret(true).max_w(px(160.)).loading(loading)
                .disabled(busy || model_pending || chat.state != "idle")
                .dropdown_menu_with_anchor(Anchor::BottomLeft, move |menu,_,_| {
                    setting.choices.iter().fold(menu.min_w(px(200.)).max_h(px(280.)).scrollable(true).check_side(Side::Right)
                        .item(PopupMenuItem::label(setting.name.clone())), |menu,choice| {
                        let selection = choice.value.clone();
                        let setting_id = setting.id.clone();
                        let thread = thread.clone();
                        let workbench = workbench.clone();
                        let label = choice.label.clone();
                        let description = choice.description.clone();
                        let menu = menu.item(PopupMenuItem::new(label).checked(choice.value == setting.current)
                            .on_click(move |_,_,cx| {
                                let _ = workbench.update(cx, |this,cx| {
                                    let Some(index) = this.chats.iter().position(|chat| chat.id == thread) else { return; };
                                    let chat = &mut this.chats[index];
                                    if chat.busy() || chat.pending_setting.is_some() || chat.pending_model.is_some() { return; }
                                    let Ok(pending) = chat.settings.select(&setting_id,&selection) else { return; };
                                    chat.pending_setting = Some(pending);
                                    chat.error = None;
                                    this.command(json!({"action":"configure","thread_id":thread,"config_id":setting_id,"value":selection}),cx);
                                });
                            }));
                        if setting.category == "mode" && !description.is_empty() {
                            menu.item(PopupMenuItem::label(description))
                        } else { menu }

                    })
                }).into_any_element()
        }).collect::<Vec<_>>()).unwrap_or_default();
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
            Button::new("model-picker").ghost().small()
                .label(label).max_w(px(240.)).dropdown_caret(true)
                .loading(model_pending).loading_icon(Icon::default().path("icons/clock.svg"))
                .disabled(busy || model_pending || chat.state != "idle")
                .dropdown_menu_with_anchor(Anchor::BottomLeft, move |menu, _, _| {
                    models.iter().fold(menu.min_w(px(240.)).max_w(px(340.)).max_h(px(280.))
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
            .relative()
            .flex_shrink_0()
            .border_t_1()
            .border_color(p.color("border"))
            .bg(p.color("surface"))
            .px(px(16.))
            .pt(px(10.))
            .pb(px(10.))
            .when(self.error.is_some(), |el| {
                el.child(
                    div()
                        .mb(px(8.))
                        .text_size(px(12.))
                        .text_color(p.color("error"))
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
                        Button::new(("attached-file", i))
                            .ghost()
                            .small()
                            .icon(IconName::File)
                            .label(file["name"].as_str().unwrap_or("File").to_string())
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.attachments.remove(i);
                                cx.notify();
                            }))
                    }),
                ))
            })
            .child(
                Editor::new(&self.composer)
                    .bordered(false)
                    .appearance(false)
                    .font_family("Noto Sans CJK SC")
                    .text_size(px(14.))
                    .aria_label(self.t("chat.placeholder"))
                    .h(px(rows as f32 * 21. + 8.)),
            )
            .child(
                div()
                    .mt(px(6.))
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap(px(4.))
                    .child(
                        Button::new("attach-context")
                            .ghost()
                            .small()
                            .icon(IconName::Plus)
                            .label(self.t("chat.attach"))
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.command(json!({"action":"choose_context"}), cx)
                            })),
                    )
                    .child(
                        Button::new("agent-picker")
                            .ghost()
                            .small()
                            .label(agent.clone())
                            .dropdown_caret(true)
                            .disabled(chat.is_some_and(|c| c.state != "draft"))
                            .dropdown_menu_with_anchor(Anchor::BottomLeft, move |menu, _, _| {
                                agent_choices.iter().enumerate().fold(
                                    menu.min_w(px(220.)).check_side(Side::Right),
                                    |menu, (i, a)| {
                                        let agent = a.id.clone();
                                        let workbench = agent_workbench.clone();
                                        menu.item(
                                            PopupMenuItem::new(a.name.clone())
                                                .checked(a.id == selected_agent)
                                                .disabled(!a.available)
                                                .on_click(move |_, _, cx| {
                                                    let _ = workbench.update(cx, |this, cx| {
                                                        this.agent_index = i;
                                                        if let Some(chat) = this
                                                            .active_chat
                                                            .and_then(|i| this.chats.get_mut(i))
                                                        {
                                                            if chat.state == "draft" {
                                                                chat.agent = agent.clone();
                                                            }
                                                        }
                                                        cx.notify();
                                                    });
                                                }),
                                        )
                                    },
                                )
                            }),
                    )
                    .children(model_picker)
                    .children(setting_pickers)
                    .child(div().flex_1())
                    .child(
                        Button::new("workspace-picker")
                            .ghost()
                            .small()
                            .icon(IconName::Folder)
                            .label(workspace)
                            .disabled(chat.is_some_and(|c| c.state != "draft"))
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.command(json!({"action":"choose_workspace"}), cx)
                            })),
                    )
                    .when(chat.is_some_and(|c| c.state == "draft"), |el| {
                        el.child(
                            Button::new("connect-chat")
                                .outline()
                                .small()
                                .label(self.t("chat.connect"))
                                .on_click(cx.listener(|this, _, _, cx| this.connect_chat(cx))),
                        )
                    })
                    .when(busy, |el| {
                        el.child(
                            Button::new("stop-agent")
                                .outline()
                                .small()
                                .icon(IconName::Square)
                                .label(self.t("chat.stop"))
                                .on_click(cx.listener(|this, _, _, cx| {
                                    if let Some(i) = this.active_chat {
                                        let id = this.chats[i].id.clone();
                                        this.chats[i].state = "stopping".into();
                                        this.command(json!({"action":"cancel","thread_id":id}), cx);
                                    }
                                })),
                        )
                    })
                    .when(!busy, |el| {
                        el.child(
                            Button::new("send-chat")
                                .primary()
                                .small()
                                .icon(IconName::ArrowRight)
                                .label(self.t("probe.send"))
                                .disabled(
                                    !self.connected
                                        || model_pending
                                        || self.composer.read(cx).value().trim().is_empty()
                                        || chat.is_some_and(|c| {
                                            !matches!(c.state.as_str(), "idle" | "draft")
                                        }),
                                )
                                .on_click(
                                    cx.listener(|this, _, window, cx| this.send_chat(window, cx)),
                                ),
                        )
                    }),
            )
    }
}
