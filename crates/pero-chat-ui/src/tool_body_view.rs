//! Result cards share one secondary type scale and bounded inline previews.
use crate::{
    conversation::Tool,
    panel::{ChatAction, ChatPanel},
    tool_body::ToolBody,
};
use gpui_kit::{
    component::{button::*, *},
    prelude::*,
    *,
};
use pero_contracts::workspace_changes::{DiffLineKind, FileComparison};
impl ChatPanel {
    pub(crate) fn tool_body_view(
        &self,
        thread: &str,
        tool: &Tool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let appearance = pero_theme::UiAppearance::global(cx);
        let p = appearance.palette.clone();
        let size = (appearance.typography.chat - 1.).max(12.);
        let mut rows = vec![];
        let mut limit = 8;
        let mut root = div()
            .min_w_0()
            .text_size(px(size))
            .font_weight(FontWeight::NORMAL)
            .flex()
            .flex_col()
            .gap(px(4.));
        match &tool.body {
            ToolBody::Terminal {
                command,
                output,
                exit_code,
                cwd,
            } => {
                limit = usize::MAX;
                root = root.child(
                    div()
                        .flex()
                        .gap(px(8.))
                        .items_center()
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .font_family("JetBrains Mono")
                                .child(format!("$ {command}")),
                        )
                        .children(exit_code.map(|code| {
                            div()
                                .text_color(if code == 0 { p.text_muted } else { p.error })
                                .child(format!("exit {code}"))
                        }))
                        .when(
                            tool.document.is_some()
                                && tool.status == "completed"
                                && !tool.cancelled,
                            |el| el.child(self.tool_actions(thread, tool, cx)),
                        ),
                );
                if let Some(cwd) = cwd {
                    root = root.child(div().text_color(p.text_muted).child(cwd.clone()));
                }
                for line in output.lines() {
                    rows.push(
                        div()
                            .font_family("JetBrains Mono")
                            .child(line.to_owned())
                            .into_any_element(),
                    );
                }
            }
            ToolBody::Read { path, text, start } => {
                let document = tool.document.clone();
                root = root.child(
                    div()
                        .flex()
                        .items_center()
                        .child(
                            Button::new(SharedString::from(format!("read-path-{}", tool.id)))
                                .ghost()
                                .small()
                                .justify_start()
                                .label(path.clone())
                                .disabled(document.is_none())
                                .on_click(cx.listener(move |_, _, _, cx| {
                                    if let Some(document) = &document {
                                        cx.emit(ChatAction::OpenDocument(document.clone()));
                                    }
                                })),
                        )
                        .when(
                            tool.document.is_some()
                                && tool.status == "completed"
                                && !tool.cancelled,
                            |el| el.child(self.tool_actions(thread, tool, cx)),
                        ),
                );
                for (index, line) in text.lines().enumerate() {
                    rows.push(
                        div()
                            .flex()
                            .gap(px(12.))
                            .font_family("JetBrains Mono")
                            .child(
                                div()
                                    .w(px(36.))
                                    .flex_shrink_0()
                                    .text_color(p.text_muted)
                                    .child((start + index).to_string()),
                            )
                            .child(div().min_w_0().child(line.to_owned()))
                            .into_any_element(),
                    );
                }
            }
            ToolBody::Search { text } => {
                for line in text.lines() {
                    rows.push(
                        div()
                            .font_family("JetBrains Mono")
                            .child(line.to_owned())
                            .into_any_element(),
                    );
                }
            }
            ToolBody::Diff { files } => {
                limit = 9;
                for (index, file) in files.iter().enumerate() {
                    let thread_id = thread.to_owned();
                    let path = file.path.clone();
                    rows.push(
                        div()
                            .flex()
                            .gap(px(8.))
                            .child(
                                Button::new(("diff-file", index))
                                    .ghost()
                                    .small()
                                    .justify_start()
                                    .label(file.path.clone())
                                    .on_click(cx.listener(move |_, event: &ClickEvent, _, cx| {
                                        cx.emit(ChatAction::OpenSource {
                                            target: pero_contracts::source_target::SourceTarget::Changes {
                                                thread_id: thread_id.clone(),
                                                scope: pero_contracts::workspace_changes::ChangeScope::Turn,
                                                path: Some(path.clone()),
                                            },
                                            middle: false,
                                            primary_modifier: event.modifiers().platform,
                                        });
                                    })),
                            )
                            .child(
                                div()
                                    .text_color(p.success)
                                    .child(format!("+{}", file.added)),
                            )
                            .child(
                                div()
                                    .text_color(p.error)
                                    .child(format!("−{}", file.deleted)),
                            )
                            .into_any_element(),
                    );
                    for line in (FileComparison::Text {
                        patch: file.patch.clone(),
                    })
                    .lines()
                    {
                        let bg = match line.kind {
                            DiffLineKind::Added => p.success_bg,
                            DiffLineKind::Deleted => p.error_bg,
                            _ => p.surface,
                        };
                        rows.push(
                            div()
                                .bg(bg)
                                .font_family("JetBrains Mono")
                                .child(line.text)
                                .into_any_element(),
                        );
                    }
                }
            }
            ToolBody::Generic => {}
        }
        let total = rows.len();
        let shown = if tool.output_expanded {
            total
        } else {
            limit.min(total)
        };
        root = root.child(
            div()
                .id(SharedString::from(format!("tool-body-{}", tool.id)))
                .max_h(px(400.))
                .overflow_y_scroll()
                .children(rows.into_iter().take(shown)),
        );
        if total > limit {
            let id = tool.id.clone();
            let thread = thread.to_owned();
            root = root.child(
                Button::new(SharedString::from(format!("tool-body-more-{id}")))
                    .ghost()
                    .small()
                    .justify_start()
                    .label(format!(
                        "{} ({total})",
                        self.t(if tool.output_expanded {
                            "chat.tool_collapse"
                        } else {
                            "chat.tool_expand"
                        })
                    ))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if let Some(tool) = this
                            .chats
                            .iter_mut()
                            .find(|chat| chat.id == thread)
                            .and_then(|chat| chat.tools.iter_mut().find(|tool| tool.id == id))
                        {
                            tool.output_expanded = !tool.output_expanded;
                        }
                        cx.notify();
                    })),
            );
        }
        root.into_any_element()
    }
}
