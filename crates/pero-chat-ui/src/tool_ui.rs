//! Compact tool presentation. Protocol data stays in Conversation; only output
//! and explicitly disclosed arguments are kept separate.
use serde_json::Value;

pub(crate) fn action(kind: &str) -> (&'static str, &'static str) {
    match kind {
        "read" => ("chat.tool_read", "file"),
        "search" => ("chat.tool_search", "search"),
        "fetch" => ("chat.tool_fetch", "external-link"),
        "edit" => ("chat.tool_edit", "file-code"),
        "execute" => ("chat.tool_execute", "terminal"),
        "delete" => ("chat.tool_delete", "file-code"),
        "move" => ("chat.tool_move", "arrow-right"),
        "think" => ("chat.tool_think", "circle-filled"),
        _ => ("chat.tool_other", "layout-list"),
    }
}

pub(crate) fn visible_output(content: &str, output: &[Value]) -> bool {
    !content.trim().is_empty()
        || output.iter().any(|item| match item["type"].as_str() {
            Some("diff") => ["oldText", "newText"]
                .iter()
                .any(|key| item[key].as_str().is_some_and(|text| !text.is_empty())),
            Some("terminal") => item["terminalId"].as_str().is_some(),
            Some("content") => item["content"]["type"].as_str() != Some("text"),
            _ => true,
        })
}

/// Chat chrome only. Stored ACP titles keep the wire name.
pub(crate) fn display_tool_title(title: &str) -> String {
    let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
    let Some(rest) = title.strip_prefix("mcp__") else {
        return title;
    };
    let parts = rest
        .split("__")
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    match parts.as_slice() {
        // Prefer the leaf tool name so the chip can show the action, not the
        // transport path. App id is only a disambiguator when several tools share a leaf.
        ["pero-app-use", "app", app, tool @ ..] if !tool.is_empty() => {
            let leaf = tool.join("__");
            if tool.len() == 1 {
                leaf
            } else {
                format!("{app}/{leaf}")
            }
        }
        ["pero-app-use", tool @ ..] if !tool.is_empty() => tool.join("__"),
        [server, tool @ ..] if !tool.is_empty() => {
            let leaf = tool.join("__");
            if tool.len() == 1 {
                leaf
            } else {
                format!("{server}/{leaf}")
            }
        }
        [server] => (*server).to_string(),
        _ => title,
    }
}

pub(crate) fn short_label(action: &str, title: &str, path: Option<&str>) -> String {
    if let Some(path) = path.filter(|path| !path.is_empty()) {
        let file = path.rsplit(['/', '\\']).next().unwrap_or(path);
        return format!("{action} {file}");
    }
    let title = display_tool_title(title);
    if title.is_empty() || title.eq_ignore_ascii_case("tool") {
        return action.into();
    }
    let mut text: String = title.chars().take(88).collect();
    if title.chars().count() > 88 {
        text.push('…');
    }
    text
}

#[cfg(any(target_family = "wasm", feature = "native"))]
mod rendering {
    use super::*;
    use crate::{conversation::Tool, panel::ChatPanel, theme::WorkbenchStyle as W};
    use gpui_kit::{
        component::{Sizable, button::*},
        prelude::*,
        *,
    };

    fn embedded_result(tool: &Tool) -> bool {
        tool.status == "completed"
            && !tool.cancelled
            && tool.chart_error.is_none()
            && (tool.table.is_some() || tool.chart.is_some() || tool.control.is_some() || tool.molecule.is_some())
    }

    impl ChatPanel {
        pub(crate) fn tool_row(
            &self,
            conversation_id: &str,
            tool: &Tool,
            row: usize,
            cx: &mut Context<Self>,
        ) -> AnyElement {
            let key = format!("{conversation_id}/{}", tool.id);
            let open = self.expanded_tools.contains(&key);
            let p = &pero_theme::UiAppearance::global(cx).palette.clone();
            let failed = (tool.status == "failed" || tool.body.failed()) && !tool.cancelled;
            let running = !tool.cancelled && !matches!(tool.status.as_str(), "completed" | "failed");
            let cancelled = tool.cancelled;
            let (action_key, icon) = action(tool.activity.kind.as_str());
            let embedded = embedded_result(tool);
            let summary = if matches!(tool.body, crate::tool_body::ToolBody::Terminal { .. }) {
                format!("{} · {}", self.t(action_key), self.t("chat.tool_shell"))
            } else if !tool.activity.detail.is_empty() {
                format!("{} · {}", self.t(action_key), crate::tool_activity::preview(&tool.activity.detail, 72))
            } else { short_label(self.t(action_key), &tool.title, tool.locations.first().map(|location| location.path.as_str())) };
            let status = if failed {
                Some("chat.tool_failed")
            } else if running {
                Some("chat.tool_running")
            } else if cancelled {
                Some("chat.tool_cancelled")
            } else {
                Some("chat.tool_completed")
            };
            let reader_tool = tool.id.clone();
            let reader_chat = conversation_id.to_string();
            let disclosure = self.t(if open {
                "chat.tool_collapse"
            } else {
                "chat.tool_expand"
            });

            div()
                .id(("tool-group", row))
                .mb(px(2.))
                .min_w_0()
                .child(self.embedded_preview(conversation_id, tool, cx))
                .child(
                    Button::new(("tool-toggle", row))
                        .relative()
                        .child(tool.toggle_bounds.probe())
                        .ghost()
                        .w_full()
                        .h(px(pero_theme::UiAppearance::global(cx).typography.row_height()))
                        .text_size(px(pero_theme::UiAppearance::global(cx).typography.ui))
                        .px(px(4.))
                        .justify_start()
                        .accessibility_label(format!("{summary}. {disclosure}"))
                        .toggled(open)
                        .child(self.icon(if open { "chevron-down" } else { "chevron-right" })
                            .size(px(12.)).flex_shrink_0().text_color(p.text_muted))
                        .when(!embedded, |el| el.child(self.icon(if failed { "alert-circle" } else if running { "clock" } else { icon })
                            .size(px(W::ICON))
                            .text_color(if failed { p.error } else { p.text_muted })))
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .truncate()
                                .text_size(px((pero_theme::UiAppearance::global(cx).typography.chat - 1.).max(12.)))
                                .text_color(p.text_muted)
                                .child(summary.clone()),
                        )
                        .when_some(status, |el, status| {
                            el.child(
                                div()
                                    .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption))
                                    .text_color(if failed { p.error } else { p.text_muted })
                                    .child(self.t(status)),
                            )
                        })

                        .on_click(cx.listener(move |this, _, window, cx| {
                            if !this.expanded_tools.remove(&key) {
                                this.expanded_tools.insert(key.clone());
                                let locale = this.locale.clone();
                                if let Some(chat) = this.chats.iter_mut().find(|chat| chat.id == reader_chat) {
                                    if let Some(tool) = chat.tools.iter_mut().find(|tool| tool.id == reader_tool) {
                                        if let Some(document) = tool.document.as_ref().filter(|_| !tool.body.specialized()) {
                                            if tool.reader.is_none() {
                                                tool.reader = Some(cx.new(|cx| crate::content_reader::ContentReader::new(document.clone(), locale.clone(), window, cx)));
                                            }
                                        }
                                    }
                                }
                            }
                            this.sync_follow(cx);
                            cx.notify();
                        })),
                )
                .when(open,|el|el.child(self.mcp_app_surface(conversation_id,tool,cx)))
                .when(open, |el| {
                    el.child(
                        div()
                            .ml(px(10.))
                            .pl(px(22.))
                            .border_l_1()
                            .border_color(p.border)
                            .child({
                                let index = row;
                                div()
                                    .id(("tool-detail", index))
                                    .anchor_scroll(self.artifacts.anchors.get(&format!("{conversation_id}/tool:{}",tool.id)).cloned())
                                    .py(px(6.))
                                    .min_w_0()
                                    .flex()
                                    .flex_col()
                                    .gap(px(6.))
                                    .when_some(tool.transcript.input_text().filter(|_|!tool.body.specialized()), |el, input| {
                                        let chat_id = conversation_id.to_owned();
                                        let tool_id = tool.id.clone();
                                        el.child(Button::new(("tool-input", index)).relative().child(tool.input_bounds.probe())
                                            .ghost().small().justify_start()
                                            .text_color(p.text_muted)
                                            .accessibility_label(self.t("chat.tool_input"))
                                            .child(self.icon(if tool.input_open { "chevron-down" } else { "chevron-right" }).size(px(12.)).text_color(p.text_muted))
                                            .child(div().flex_1().text_left().text_color(p.text_muted).child(self.t("chat.tool_input")))
                                            .on_click(cx.listener(move |this, _, _, cx| {
                                                if let Some(tool) = this.chats.iter_mut().find(|chat|chat.id==chat_id).and_then(|chat|chat.tools.iter_mut().find(|tool|tool.id==tool_id)) {
                                                    tool.input_open = !tool.input_open;
                                                    if tool.input_open && tool.input_view.is_none() {
                                                        tool.input_view = Some(cx.new(|cx| {
                                                            let mut view = crate::stream::StreamText::new(&format!("```json\n{input}\n```"), cx);
                                                            view.appearance = crate::stream::StreamAppearance::Tool;
                                                            view
                                                        }));
                                                    }
                                                }
                                                cx.notify();
                                            })))
                                    })
                                    .when(tool.input_open, |el| el.child(div().id(("tool-input-scroll",index)).max_h(px(180.)).overflow_y_scroll().children(tool.input_view.clone())))
                                    .when(!tool.body.specialized() && tool.transcript.input.is_some() && !tool.output.is_empty(), |el| el.child(div().text_size(px(12.)).text_color(p.text_muted).child(self.t("chat.tool_output"))))
                                    .children(tool.locations.iter().enumerate().filter(|_|!tool.body.specialized()).map(|(location_index, location)| {
                                        let label = match location.line {
                                            Some(line) => format!("{}:{line}", location.path),
                                            None => location.path.clone(),
                                        };
                                        let workspace = self.workspace.clone();
                                        let path = location.path.clone();
                                        let line = location.line;
                                        Button::new(("tool-location", location_index))
                                            .ghost()
                                            .small()
                                            .justify_start()
                                            .label(label)
                                            .on_click(cx.listener(move |_, event: &ClickEvent, _, cx| {
                                                let target = pero_contracts::source_target::SourceTarget::file_in_workspace(&workspace, &path, line, None);
                                                cx.emit(crate::panel::ChatAction::OpenSource {
                                                    target,
                                                    middle: false,
                                                    primary_modifier: event.modifiers().platform,
                                                });
                                            }))
                                    }))
                                    .when_some(tool.artifact.as_ref(), |el, artifact| {
                                        use crate::artifact_read::{ArtifactStatus,ContentReadIntent};
                                        let loading=matches!(artifact.status,ArtifactStatus::Loading {..});
                                        let loaded=matches!(artifact.status,ArtifactStatus::Loaded);
                                        let load_failed=matches!(artifact.status,ArtifactStatus::Failed {..});
                                        let chat_id=conversation_id.to_owned(); let tool_id=tool.id.clone();
                                        el.when(!loaded, |el|el.child(Button::new(("full-result",index)).relative().child(tool.artifact_bounds.probe()).ghost().small()
                                            .label(if loading {self.t("content.cancel_load").to_string()} else {format!("{} · {} B",self.t(if load_failed {"content.retry_load"} else {"content.open_full"}),artifact.reference.bytes)})
                                            .on_click(cx.listener(move |this,_,_,cx| {
                                                this.next_request+=1;
                                                let request_id=format!("content-{}",this.next_request);
                                                if let Some(artifact)=this.chats.iter_mut().find(|chat|chat.id==chat_id)
                                                    .and_then(|chat|chat.tools.iter_mut().find(|tool|tool.id==tool_id)).and_then(|tool|tool.artifact.as_mut()) {
                                                    let intent=if let Some(request_id)=artifact.cancel() {
                                                        Some(ContentReadIntent::CancelReadResult {request_id})
                                                    } else {artifact.request(request_id.clone()).map(|reference|ContentReadIntent::ReadResult {thread_id:chat_id.clone(),tool_call_id:tool_id.clone(),artifact_id:reference.id,request_id})};
                                                    if let Some(intent)=intent {cx.emit(crate::panel::ChatAction::Content(intent));}
                                                }
                                                cx.notify();
                                            }))))
                                            .when(load_failed, |el|el.child(div().text_color(p.error).child(self.t("content.load_failed"))))
                                    })
                                    .when(!matches!(tool.body, crate::tool_body::ToolBody::Terminal{..}|crate::tool_body::ToolBody::Read{..}) && tool.document.is_some() && tool.status=="completed" && !tool.cancelled && tool.artifact.as_ref().is_none_or(|artifact|matches!(artifact.status,crate::artifact_read::ArtifactStatus::Loaded)), |el| {
                                        el.child(self.tool_actions(conversation_id, tool, cx))
                                    })
                                    .when(tool.body.specialized(), |el| el.child(self.tool_body_view(conversation_id, tool, cx)))
                                    .when_some(tool.document.as_ref().filter(|_| !tool.body.specialized() && tool.reader.is_none()), |el, document| {
                                        let document = document.clone();
                                        let chat_id = conversation_id.to_string();
                                        let tool_id = tool.id.clone();
                                        el.child(Button::new(("open-content", index)).ghost().small().label(self.t("content.open"))
                                            .on_click(cx.listener(move |this, _, window, cx| {
                                                let locale = this.locale.clone();
                                                if let Some(tool) = this.chats.iter_mut().find(|c| c.id == chat_id).and_then(|c| c.tools.iter_mut().find(|t| t.id == tool_id)) {
                                                    tool.reader = Some(cx.new(|cx| crate::content_reader::ContentReader::new(document.clone(), locale, window, cx)));
                                                }
                                                cx.notify();
                                            })))
                                    })
                                    .when_some(tool.reader.as_ref().filter(|_|!tool.body.specialized() && tool.artifact.as_ref().is_none_or(|artifact|matches!(artifact.status,crate::artifact_read::ArtifactStatus::Loaded))), |el, reader| el.child(reader.clone()))
                                    .when_some(tool.view.as_ref().filter(|_|!tool.body.specialized()), |el, view| {
                                        el.child(view.clone())
                                    })
                                    .children(tool.output.iter().filter(|_|!tool.body.specialized()).enumerate().filter_map(
                                        |(part, item)| {
                                            self.structured_tool_output(row, index, part, item, cx)
                                        },
                                    ))
                            }),
                    )
                })
                .child(self.tool_notices(conversation_id, tool, !open, cx))
                .into_any_element()
        }

        /// Chart, table, control and molecule receipts stay in the message
        /// stream. A collapsed multi-tool group hides the tool log, not them.
        pub(crate) fn embedded_preview(&self, conversation_id: &str, tool: &Tool, cx: &mut Context<Self>) -> AnyElement {
            div().min_w_0().flex().flex_col()
                .when(embedded_result(tool), |el| {
                    el.children(tool.table.as_ref().map(|table| self.inline_table(conversation_id, &tool.id, table, cx)))
                        .children(tool.chart.as_ref().map(|chart| self.inline_chart(conversation_id, &tool.id, chart, cx)))
                        .children(tool.control.as_ref().map(|result| self.inline_control(conversation_id, &tool.id, result, cx)))
                        .children(tool.molecule.as_ref().map(|result| self.inline_molecule(conversation_id, &tool.id, result, cx)))
                })
                .into_any_element()
        }

        pub(crate) fn tool_notices(&self, conversation_id: &str, tool: &Tool, show_failure: bool, cx: &mut Context<Self>) -> AnyElement {
            let p = &pero_theme::UiAppearance::global(cx).palette.clone();
            div().flex().flex_col()
                .child(div().flex().flex_wrap().gap(px(4.)).children(tool.app_links.iter().enumerate().map(|(index, link)| {
                    let url = link.url.clone();
                    Button::new(SharedString::from(format!("app-source-{}-{index}", tool.id))).relative().child(link.bounds.probe()).ghost().small()
                        .label(link.label.clone()).accessibility_label(link.label.clone())
                        .on_click(cx.listener(move |_, _, _, cx| cx.emit(crate::ChatAction::AppLink(url.clone()))))
                })))
                .children(tool.chart_error.as_ref().map(|error| div().text_color(p.error).child(error.clone())))
                .when(!embedded_result(tool), |el| {
                    el.children(tool.table.as_ref().map(|table| self.inline_table(conversation_id, &tool.id, table, cx)))
                        .children(tool.chart.as_ref().map(|chart| self.inline_chart(conversation_id, &tool.id, chart, cx)))
                        .children(tool.control.as_ref().map(|result| self.inline_control(conversation_id, &tool.id, result, cx)))
                        .children(tool.molecule.as_ref().map(|result| self.inline_molecule(conversation_id, &tool.id, result, cx)))
                })
                .children(self.approval(conversation_id, Some(&tool.id), cx))
                .when(show_failure && (tool.status == "failed" || tool.body.failed()) && !tool.cancelled, |el| {
                    let failure = tool.content.lines().map(str::trim).find(|line| !line.is_empty() && !line.starts_with("```"))
                        .map(|line| crate::tool_activity::preview(line, 180)).unwrap_or_else(|| self.t("chat.tool_failed").into());
                    el.child(div().ml(px(24.)).text_color(p.error).child(format!("{} · {failure}", display_tool_title(&tool.title))))
                }).into_any_element()
        }

        fn structured_tool_output(
            &self,
            row: usize,
            tool: usize,
            part: usize,
            item: &Value,
            cx: &App,
        ) -> Option<AnyElement> {
            let p = &pero_theme::UiAppearance::global(cx).palette.clone();
            match item["type"].as_str()? {
                "diff" => {
                    let mut element = div().flex().flex_col().gap(px(5.));
                    if let Some(path) = item["path"].as_str() {
                        element = element.child(
                            div()
                                .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Body))
                                .font_weight(FontWeight::BOLD)
                                .child(path.to_string()),
                        );
                    }
                    for (field, label) in [
                        ("oldText", "chat.tool_before"),
                        ("newText", "chat.tool_after"),
                    ] {
                        if let Some(text) = item[field].as_str() {
                            element = element
                                .child(
                                    div()
                                        .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption))
                                        .text_color(p.text_muted)
                                        .child(self.t(label)),
                                )
                                .child(
                                    div()
                                        .id(SharedString::from(format!(
                                            "diff-{row}-{tool}-{part}-{field}"
                                        )))
                                        .max_h(px(240.))
                                        .overflow_y_scroll()
                                        .p(px(8.))
                                        .bg(p.surface_muted)
                                        .font_family("JetBrains Mono")
                                        .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Body))
                                        .child(text.to_string()),
                                );
                        }
                    }
                    Some(element.into_any_element())
                }
                "terminal" => Some(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption))
                        .text_color(p.text_muted)
                        .child(self.icon("terminal").size(px(13.)))
                        .child(format!(
                            "{} · {}",
                            self.t("chat.tool_terminal"),
                            item["terminalId"].as_str().unwrap_or_default()
                        ))
                        .into_any_element(),
                ),
                // Text already uses the retained Markdown view above. Retain
                // unknown structured output without exposing raw JSON/arguments.
                "content" if item["content"]["type"] == "text" => None,
                kind => Some(
                    div()
                        .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption))
                        .text_color(p.text_muted)
                        .child(format!("{} · {kind}", self.t("chat.tool_other")))
                        .into_any_element(),
                ),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn actions_cover_acp_kinds_and_future_fallback() {
        for kind in [
            "read", "search", "fetch", "edit", "execute", "delete", "move", "think",
        ] {
            assert_ne!(action(kind).0, "chat.tool_other");
        }
        assert_eq!(
            action("vendor_future_tool"),
            ("chat.tool_other", "layout-list")
        );
    }

    #[test]
    fn cancelled_visibility_keeps_real_output() {
        assert!(!visible_output("", &[]));
        assert!(!visible_output(
            "",
            &[json!({"type":"content","content":{"type":"text","text":""}})]
        ));
        assert!(visible_output("failure evidence", &[]));
        assert!(visible_output(
            "",
            &[json!({"type":"diff","path":"a.rs","oldText":"a","newText":"b"})]
        ));
        assert!(visible_output(
            "",
            &[json!({"type":"terminal","terminalId":"term-1"})]
        ));
    }

    #[test]
    fn labels_are_one_line_and_use_file_context() {
        assert_eq!(
            short_label(
                "Read",
                "Read every file in the workspace",
                Some("/repo/src/main.rs")
            ),
            "Read main.rs"
        );
        assert_eq!(
            short_label("Tool", "search\n   configuration", None),
            "search configuration"
        );
        assert_eq!(short_label("Tool", "Tool", None), "Tool");
        assert!(short_label("Run", &"x".repeat(100), None).ends_with('…'));
    }

    #[test]
    fn mcp_wire_names_drop_transport_prefix() {
        assert_eq!(
            display_tool_title("mcp__pero-app-use__app__paper-agent__prepare-research"),
            "prepare-research"
        );
        assert_eq!(
            display_tool_title("mcp__pero-app-use__content_read"),
            "content_read"
        );
        assert_eq!(display_tool_title("mcp__evidence__lookup"), "lookup");
        assert_eq!(
            short_label(
                "Tool",
                "mcp__pero-app-use__app__paper-agent__inspect-research-link",
                None
            ),
            "inspect-research-link"
        );
        assert_eq!(display_tool_title("chart_render"), "chart_render");
    }
}
