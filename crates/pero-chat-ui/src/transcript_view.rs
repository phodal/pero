//! Shared transcript disclosures and completed-reply actions for Native and Wasm.
use crate::{
    conversation::{Conversation, Tool},
    panel::ChatPanel,
    process::{ProcessEntry, ProcessGroup},
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use gpui_kit::{
    component::{button::*, *},
    prelude::*,
    *,
};

#[derive(Clone)]
enum OutputSource {
    Reply(usize),
    Tool(String),
}

impl ChatPanel {
    pub(crate) fn reply_view(
        &self,
        conversation: &Conversation,
        index: usize,
        i: usize,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let message = &conversation.messages[index];
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        let user = message.role == "user";
        if let Some(brief) = conversation.brief.as_ref().filter(|_| {
            !user
                && conversation.messages[..index]
                    .iter()
                    .filter(|message| message.role == "user")
                    .count()
                    == 1
        }) {
            let thread = conversation.id.clone();
            let location = format!(
                "pero-app-location://insights/main/brief/{}",
                URL_SAFE_NO_PAD.encode(thread.as_bytes())
            );
            let open = Button::new(("brief-open", i))
                .outline()
                .small()
                .label(self.t("chat.brief_open"))
                .on_click(cx.listener(move |_, _, _, cx| {
                    cx.emit(crate::ChatAction::AppLink(location.clone()));
                }));
            let raw = Button::new(("brief-raw", i))
                .ghost()
                .small()
                .label(self.t("chat.brief_raw"))
                .child(
                    self.icon(if brief.raw_open {
                        "chevron-down"
                    } else {
                        "chevron-right"
                    })
                    .size(px(14.)),
                )
                .on_click(cx.listener(move |this, _, _, cx| {
                    if let Some(brief) = this
                        .chats
                        .iter_mut()
                        .find(|chat| chat.id == thread)
                        .and_then(|chat| chat.brief.as_mut())
                    {
                        brief.raw_open = !brief.raw_open;
                    }
                    cx.notify();
                }));
            return div()
                .id(("brief-result", i))
                .mb(px(pero_theme::SPACE_12))
                .flex()
                .flex_col()
                .gap(px(pero_theme::SPACE_8))
                .anchor_scroll(
                    self.artifacts
                        .anchors
                        .get(&format!("{}/message:{index}", conversation.id))
                        .cloned(),
                )
                .child(
                    div()
                        .text_color(p.text_muted)
                        .child(self.t("chat.brief_result")),
                )
                .child(div().flex().flex_wrap().gap(px(8.)).child(open).child(raw))
                .when(brief.raw_open, |el| {
                    el.child(
                        div()
                            .id(("brief-raw-body", i))
                            .max_h(px(360.))
                            .overflow_y_scroll()
                            .child(message.view.clone()),
                    )
                    .when(conversation.reply_actions.contains(index), |el| {
                        el.child(self.reply_actions(conversation, index, cx))
                    })
                })
                .into_any_element();
        }
        div()
            .id(("message", i))
            .mb(px(pero_theme::SPACE_12))
            .flex()
            .flex_col()
            .gap(px(pero_theme::SPACE_8))
            .anchor_scroll(
                self.artifacts
                    .anchors
                    .get(&format!("{}/message:{index}", conversation.id))
                    .cloned(),
            )
            .child(
                div()
                    .when(user, |el| {
                        el.w_full()
                            .px(px(pero_theme::SPACE_12))
                            .py(px(pero_theme::SPACE_8))
                            .bg(p.surface)
                            .border_1()
                            .border_color(p.border)
                            .rounded(px(pero_theme::RADIUS_PANEL))
                    })
                    .child(message.view.clone()),
            )
            .when(!message.attached_files.is_empty(), |el| {
                el.child(
                    div()
                        .flex()
                        .flex_wrap()
                        .gap(px(8.))
                        .text_size(
                            pero_theme::UiAppearance::global(cx)
                                .text(pero_theme::TextRole::Caption),
                        )
                        .text_color(p.text_muted)
                        .children(message.attached_files.iter().map(|name| {
                            div()
                                .flex()
                                .items_center()
                                .gap(px(4.))
                                .child(self.icon("file").size(px(13.)))
                                .child(name.clone())
                        })),
                )
            })
            .when(!user && conversation.reply_actions.contains(index), |el| {
                el.child(self.reply_actions(conversation, index, cx))
            })
            .into_any_element()
    }

    pub(crate) fn reply_actions(
        &self,
        conversation: &Conversation,
        index: usize,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        self.output_actions(
            &conversation.id,
            OutputSource::Reply(index),
            &conversation.messages[index].text,
            cx,
        )
    }

    pub(crate) fn tool_actions(
        &self,
        thread: &str,
        tool: &Tool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        self.output_actions(
            thread,
            OutputSource::Tool(tool.id.clone()),
            &tool.content,
            cx,
        )
    }

    fn output_actions(
        &self,
        thread: &str,
        source: OutputSource,
        text: &str,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let thread = thread.to_owned();
        let text = text.to_owned();
        let (key, save_label) = match &source {
            OutputSource::Reply(index) => (format!("save-reply:{index}"), "artifacts.save_reply"),
            OutputSource::Tool(id) => (format!("save-tool:{id}"), "artifacts.save_result"),
        };
        let saving = self
            .artifacts
            .conversations
            .get(&thread)
            .is_some_and(|state| state.mutation.is_some());
        div()
            .flex()
            .items_center()
            .gap(px(4.))
            .child(
                Button::new(SharedString::from(format!("copy-{key}")))
                    .ghost()
                    .small()
                    .p_0()
                    .w(px(28.))
                    .h(px(28.))
                    .accessibility_label(self.t("menu.copy"))
                    .tooltip(self.t("menu.copy"))
                    .icon(Icon::default().path(crate::assets::UiIcon::named("copy").path()))
                    .on_click(move |_, _, cx| {
                        cx.write_to_clipboard(ClipboardItem::new_string(text.clone()))
                    }),
            )
            .child(
                Button::new(SharedString::from(key.clone()))
                    .relative()
                    .children(
                        self.artifacts
                            .bounds
                            .get(&format!("{thread}/{key}"))
                            .map(|bounds| bounds.probe()),
                    )
                    .ghost()
                    .small()
                    .p_0()
                    .w(px(28.))
                    .h(px(28.))
                    .disabled(saving)
                    .accessibility_label(self.t(save_label))
                    .tooltip(self.t(save_label))
                    .icon(Icon::default().path(crate::assets::UiIcon::named("file").path()))
                    .on_click(cx.listener(move |this, _, _, cx| match &source {
                        OutputSource::Reply(index) => this.save_reply_artifact(&thread, *index, cx),
                        OutputSource::Tool(id) => this.save_tool_artifact(&thread, id, cx),
                    })),
            )
            .into_any_element()
    }

    fn thought_view(
        &self,
        chat: &Conversation,
        index: usize,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let message = &chat.messages[index];
        let thread = chat.id.clone();
        let open = chat.thinking.open(index);
        let active = chat.busy() && chat.thinking.active(index);
        let preview = crate::thinking::reasoning_preview(&message.text, active);
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        div()
            .id(("thought", index))
            .flex()
            .flex_col()
            .min_w_0()
            .child(
                Button::new(("thought-toggle", index))
                    .relative()
                    .child(message.toggle_bounds.probe())
                    .ghost()
                    .small()
                    .w_full()
                    .justify_start()
                    .px_0()
                    .text_color(p.text_muted)
                    .toggled(open)
                    .accessibility_label(self.t("chat.reasoning"))
                    .child(
                        self.icon(if open {
                            "chevron-down"
                        } else {
                            "chevron-right"
                        })
                        .size(px(12.)).text_color(p.text_muted),
                    )
                    .child(
                        self.icon(if active { "clock" } else { "circle-filled" })
                            .size(px(12.)).text_color(p.text_muted),
                    )
                    .child(self.t("chat.reasoning"))
                    .when(!open && !preview.is_empty(), |el| {
                        el.child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .truncate()
                                .text_left()
                                .child(format!(" · {preview}")),
                        )
                    })
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if let Some(chat) = this.chats.iter_mut().find(|chat| chat.id == thread) {
                            chat.thinking.toggle(index);
                        }
                        cx.notify();
                    })),
            )
            .when(open, |el| {
                el.child(div().pl(px(20.)).child(message.view.clone()))
            })
            .into_any_element()
    }

    pub(crate) fn delivery_links(
        &self,
        chat: &Conversation,
        group: &ProcessGroup,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let mut deliveries = group.members().iter().filter_map(|entry| match *entry {
            ProcessEntry::Tool(index) => self.artifact_delivery(&chat.id, &chat.tools[index]),
            _ => None,
        }).peekable();
        deliveries.peek()?;
        Some(div().flex().flex_wrap().gap(px(4.)).mb(px(8.)).children(
            deliveries.map(|(artifact, snapshot)| {
                let thread = chat.id.clone();
                let id = artifact.id.clone();
                let version = snapshot.version;
                let label = format!("{} · v{version}", snapshot.filename.as_deref().unwrap_or(&artifact.title));
                Button::new(SharedString::from(format!("open-delivery:{id}:{version}")))
                    .outline()
                    .small()
                    .max_w_full()
                    .icon(Icon::default().path(crate::assets::UiIcon::named("file").path()).size(px(14.)))
                    .child(div().min_w_0().truncate().child(label.clone()))
                    .accessibility_label(label.clone())
                    .tooltip(label)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.open_delivered_artifact(&thread, &id, version, cx)
                    }))
            }),
        ).into_any_element())
    }

    pub(crate) fn process_view(
        &self,
        chat: &Conversation,
        group: &ProcessGroup,
        row: usize,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let member = |entry: &ProcessEntry, cx: &mut Context<Self>| match *entry {
            ProcessEntry::Thought(index) => self.thought_view(chat, index, cx),
            ProcessEntry::Tool(index) => div()
                .id(("tool-source-anchor", index))
                .anchor_scroll(
                    self.artifacts
                        .anchors
                        .get(&format!("{}/tool:{}", chat.id, chat.tools[index].id))
                        .cloned(),
                )
                .child(self.tool_row(&chat.id, &chat.tools[index], index, cx))
                .into_any_element(),
            ProcessEntry::Reply(_) => unreachable!("replies are outside process groups"),
        };
        if group.members().len() == 1 {
            return member(&group.first(), cx);
        }
        let tools: Vec<&Tool> = group
            .members()
            .iter()
            .filter_map(|entry| match *entry {
                ProcessEntry::Tool(index) => Some(&chat.tools[index]),
                _ => None,
            })
            .collect();
        let key = format!("{}/process:{}", chat.id, group.first().key());
        let open = crate::chat::process_open(chat, group, &self.expanded_tools);
        let summary = self.process_summary(chat, group);
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        let running = chat.busy() && (tools.iter().any(|tool| {
            !tool.cancelled && !matches!(tool.status.as_str(), "completed" | "failed")
        }) || group.members().iter().any(
            |entry| matches!(entry, ProcessEntry::Thought(index) if chat.thinking.active(*index)),
        ));
        let thread = chat.id.clone();
        let members = group.members().to_vec();
        div()
            .id(("process", row))
            .mb(px(8.))
            .min_w_0()
            .child(
                Button::new(("process-toggle", row))
                    .relative()
                    .children(self.artifacts.bounds.get(&key).map(|bounds| bounds.probe()))
                    .ghost()
                    .small()
                    .w_full()
                    .justify_start()
                    .px_0()
                    .toggled(open)
                    .accessibility_label(format!(
                        "{summary}. {}",
                        self.t(if open {
                            "chat.tool_collapse"
                        } else {
                            "chat.tool_expand"
                        })
                    ))
                    .child(
                        self.icon(if open {
                            "chevron-down"
                        } else {
                            "chevron-right"
                        })
                        .size(px(12.))
                        .text_color(p.text_muted),
                    )
                    .child(
                        self.icon(if running { "clock" } else { "layout-list" })
                            .size(px(14.))
                            .text_color(p.text_muted),
                    )
                    .child(
                        div()
                            .min_w_0()
                            .flex_1()
                            .truncate()
                            .text_left()
                            .text_color(p.text_muted)
                            .child(summary),
                    )
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if open {
                            this.expanded_tools.remove(&key);
                            if let Some(chat) = this.chats.iter_mut().find(|chat| chat.id == thread)
                            {
                                for entry in &members {
                                    match entry {
                                        ProcessEntry::Thought(index)
                                            if chat.thinking.open(*index) =>
                                        {
                                            chat.thinking.toggle(*index)
                                        }
                                        ProcessEntry::Tool(index) => {
                                            this.expanded_tools.remove(&format!(
                                                "{thread}/{}",
                                                chat.tools[*index].id
                                            ));
                                        }
                                        _ => {}
                                    }
                                }
                            }
                        } else {
                            this.expanded_tools.insert(key.clone());
                        }
                        this.sync_follow(cx);
                        cx.notify();
                    })),
            )
            .when(open, |el| {
                el.child(
                    div()
                        .pl(px(20.))
                        .flex()
                        .flex_col()
                        .gap(px(4.))
                        .children(group.members().iter().map(|entry| member(entry, cx))),
                )
            })
            .when(!open, |el| {
                el.children(
                    tools
                        .iter()
                        .map(|tool| self.tool_notices(&chat.id, tool, true, cx)),
                )
            })
            .into_any_element()
    }

    fn process_summary(&self, chat: &Conversation, group: &ProcessGroup) -> String {
        let tools: Vec<_> = group
            .members()
            .iter()
            .filter_map(|entry| match *entry {
                ProcessEntry::Tool(index) => Some(&chat.tools[index]),
                _ => None,
            })
            .collect();
        if chat.busy() {
            if let Some(tool) = tools.iter().rev().find(|tool| {
                !tool.cancelled && !matches!(tool.status.as_str(), "completed" | "failed")
            }) {
                let label = self.t(crate::tool_ui::action(tool.activity.kind.as_str()).0);
                return if tool.activity.detail.is_empty() {
                    label.into()
                } else {
                    format!("{label} · {}", tool.activity.detail)
                };
            }
            if let Some(index) = group.members().iter().find_map(|entry| match *entry {
                ProcessEntry::Thought(index) if chat.thinking.active(index) => Some(index),
                _ => None,
            }) {
                let detail = crate::thinking::reasoning_preview(&chat.messages[index].text, true);
                return if detail.is_empty() {
                    self.t("chat.thinking").into()
                } else {
                    format!("{} · {detail}", self.t("chat.reasoning"))
                };
            }
        }
        let counts =
            crate::tool_activity::ActivitySummary::new(tools.iter().map(|tool| &tool.activity))
                .counts;
        let mut parts: Vec<_> = counts
            .iter()
            .take(3)
            .map(|(kind, count)| {
                format!(
                    "{} {count}",
                    self.t(crate::tool_ui::action(kind.as_str()).0)
                )
            })
            .collect();
        if counts.len() > 3 {
            parts.push(self.t("chat.process_more").into());
        }
        if parts.is_empty() {
            parts.push(self.t("chat.reasoning").into());
        }
        parts.join(" · ")
    }
}
