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

pub(crate) fn short_label(action: &str, title: &str, path: Option<&str>) -> String {
    if let Some(path) = path.filter(|path| !path.is_empty()) {
        let file = path.rsplit(['/', '\\']).next().unwrap_or(path);
        return format!("{action} {file}");
    }
    let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
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

    impl ChatPanel {
        pub(crate) fn tool_group(
            &self,
            conversation_id: &str,
            tools: Vec<&Tool>,
            row: usize,
            cx: &mut Context<Self>,
        ) -> AnyElement {
            let first = tools[0];
            let key = format!("{conversation_id}/{}", first.id);
            let open = self.expanded_tools.contains(&key);
            let p = &pero_theme::UiAppearance::global(cx).palette.clone();
            let failed = tools
                .iter()
                .any(|tool| tool.status == "failed" && !tool.cancelled);
            let running = tools.iter().any(|tool| {
                !tool.cancelled && !matches!(tool.status.as_str(), "completed" | "failed")
            });
            let cancelled = tools.iter().all(|tool| tool.cancelled);
            let (action_key, mut icon) = action(&first.kind);
            let summary = if tools.len() == 1 {
                short_label(
                    self.t(action_key),
                    &first.title,
                    first.locations.first().map(String::as_str),
                )
            } else {
                let reads = tools.iter().filter(|tool| tool.kind == "read").count();
                let searches = tools.iter().filter(|tool| tool.kind == "search").count();
                let fetches = tools.iter().filter(|tool| tool.kind == "fetch").count();
                if searches > 0 {
                    icon = "search";
                }
                if reads + searches + fetches == tools.len() {
                    let mut parts = vec![];
                    if reads > 0 {
                        parts.push(
                            self.t("chat.read_count")
                                .replace("{count}", &reads.to_string()),
                        );
                    }
                    if searches > 0 {
                        parts.push(
                            self.t("chat.search_count")
                                .replace("{count}", &searches.to_string()),
                        );
                    }
                    if fetches > 0 {
                        parts.push(
                            self.t("chat.fetch_count")
                                .replace("{count}", &fetches.to_string()),
                        );
                    }
                    parts.join(", ")
                } else {
                    self.t("chat.tool_group")
                        .replace("{count}", &tools.len().to_string())
                }
            };
            let status = if failed {
                Some("chat.tool_failed")
            } else if running {
                Some("chat.tool_running")
            } else if cancelled {
                Some("chat.tool_cancelled")
            } else {
                None
            };
            let reader_tools = tools.iter().map(|tool| tool.id.clone()).collect::<Vec<_>>();
            let reader_chat = conversation_id.to_string();
            let disclosure = self.t(if open {
                "chat.tool_collapse"
            } else {
                "chat.tool_expand"
            });
            let failure = tools
                .iter()
                .find(|tool| tool.status == "failed" && !tool.cancelled)
                .and_then(|tool| {
                    tool.content
                        .lines()
                        .map(str::trim)
                        .find(|line| !line.is_empty() && !line.starts_with("```"))
                })
                .map(|line| line.chars().take(180).collect::<String>())
                .unwrap_or_else(|| self.t("chat.tool_expand").into());

            div()
                .id(("tool-group", row))
                .mb(px(2.))
                .min_w_0()
                .child(
                    Button::new(("tool-toggle", row))
                        .relative()
                        .child(first.toggle_bounds.probe())
                        .ghost()
                        .small()
                        .w_full()
                        .h(px(pero_theme::UiAppearance::global(cx).typography.row_height()))
                        .px(px(4.))
                        .justify_start()
                        .accessibility_label(format!("{summary}. {disclosure}"))
                        .toggled(open)
                        .child(self.icon(if open { "chevron-down" } else { "chevron-right" })
                            .size(px(12.)).flex_shrink_0().text_color(p.text_muted))
                        .child(self.icon(if failed { "alert-circle" } else if running { "clock" } else { icon })
                            .size(px(W::ICON))
                            .text_color(if failed { p.error } else { p.text_muted }))
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .truncate()
                                .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Body))
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
                                    for tool in chat.tools.iter_mut().filter(|tool| reader_tools.contains(&tool.id)) {
                                        if let Some(document) = &tool.document {
                                            if tool.reader.is_some() { continue; }
                                            tool.reader = Some(cx.new(|cx| crate::content_reader::ContentReader::new(document.clone(), locale.clone(), window, cx)));
                                        }
                                    }
                                }
                            }
                            this.sync_follow(cx);
                            cx.notify();
                        })),
                )
                .when(open, |el| {
                    el.child(
                        div()
                            .ml(px(10.))
                            .pl(px(22.))
                            .border_l_1()
                            .border_color(p.border)
                            .children(tools.iter().enumerate().map(|(index, tool)| {
                                div()
                                    .id(("tool-detail", index))
                                    .py(px(6.))
                                    .min_w_0()
                                    .flex()
                                    .flex_col()
                                    .gap(px(6.))
                                    .when(tools.len() > 1 || tool.title != summary, |el| {
                                        el.child(div().text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption)).text_color(p.text_muted).child(tool.title.clone()))
                                    })
                                    .when_some(tool.transcript.input_text(), |el, input| {
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
                                    .when(tool.transcript.input.is_some() && !tool.output.is_empty(), |el| el.child(div().text_size(px(12.)).text_color(p.text_muted).child(self.t("chat.tool_output"))))
                                    .children(tool.locations.iter().map(|path| {
                                        div()
                                            .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption))
                                            .text_color(p.text_muted)
                                            .child(path.clone())
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
                                    .when_some(tool.document.as_ref().filter(|_| tool.reader.is_none()), |el, document| {
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
                                    .when_some(tool.reader.as_ref().filter(|_|tool.artifact.as_ref().is_none_or(|artifact|matches!(artifact.status,crate::artifact_read::ArtifactStatus::Loaded))), |el, reader| el.child(reader.clone()))
                                    .when_some(tool.view.as_ref(), |el, view| {
                                        el.child(view.clone())
                                    })
                                    .children(tool.output.iter().enumerate().filter_map(
                                        |(part, item)| {
                                            self.structured_tool_output(row, index, part, item, cx)
                                        },
                                    ))
                            })),
                    )
                })
                .children(tools.iter().filter_map(|tool|self.approval(conversation_id, Some(&tool.id), cx)))
                .when(failed && !open, |el| {
                    el.child(
                        div()
                            .ml(px(24.))
                            .mb(px(2.))
                            .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Body))
                            .text_color(p.error)
                            .child(failure),
                    )
                })
                .into_any_element()
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
}
