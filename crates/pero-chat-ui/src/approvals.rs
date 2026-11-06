//! Keep the existing Host approval next to its tool; retain a fallback for early requests.
use crate::panel::ChatPanel;
use gpui_kit::{component::Icon, prelude::*, *};
use pero_theme::{
    ActionKind, Chrome, GHOST_ICON_BUTTON, ICON_GAP, RADIUS_PANEL, SPACE_4, SPACE_8, SPACE_12,
    TYPE_BODY, TYPE_CAPTION, action_button, feedback_actions,
};
use serde_json::json;

impl ChatPanel {
    pub(crate) fn approval(
        &self,
        thread: &str,
        tool: Option<&str>,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let chat = self.chats.iter().find(|chat| chat.id == thread)?;
        let permission = chat.permission.as_ref()?;
        // An early request may name a tool from an older turn. Keep that
        // request at the conversation footer instead of hiding it in history.
        let target = permission["toolCall"]["toolCallId"].as_str().filter(|target| {
            chat.timeline.iter().rev().take_while(|item| {
                !matches!(item, crate::conversation::StreamItem::Message(index) if chat.messages[*index].role == "user")
            }).any(|item| {
                matches!(item, crate::conversation::StreamItem::Tool(index) if chat.tools[*index].id == *target)
            })
        });
        if tool != target {
            return None;
        }
        let chrome = Chrome::from_app(cx);
        let p = chrome.palette;
        let request = permission["permission_id"]
            .as_str()
            .unwrap_or_default()
            .to_owned();
        let options = permission["options"].as_array().into_iter().flatten();
        // Only a single-use grant gets emphasis; persistent grants stay secondary.
        let primary = options
            .clone()
            .position(|option| option["kind"].as_str() == Some("allow_once"));
        Some(
            div()
                .w_full()
                .max_w(px(pero_theme::COMPOSER_MAX))
                .min_w_0()
                .mx_auto()
                .my(chrome.geo(SPACE_8))
                .p(chrome.geo(SPACE_12))
                .flex()
                .flex_wrap()
                .items_center()
                .gap(chrome.geo(SPACE_12))
                .rounded(chrome.geo(RADIUS_PANEL))
                .border_1()
                .border_color(p.border)
                .bg(p.surface)
                .text_color(p.text)
                .text_size(chrome.text(TYPE_BODY))
                .font_weight(FontWeight::NORMAL)
                .child(
                    div()
                        .id("permission-status")
                        .role(Role::Status)
                        .flex_1()
                        .flex_basis(relative(0.5))
                        .min_w_0()
                        .flex()
                        .flex_col()
                        .gap(chrome.geo(SPACE_4))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(chrome.geo(ICON_GAP))
                                .text_size(chrome.text(TYPE_CAPTION))
                                .text_color(p.text_muted)
                                .child(
                                    Icon::default()
                                        .path("icons/shield.svg")
                                        .size(chrome.text(TYPE_BODY)),
                                )
                                .child(self.t("chat.permission")),
                        )
                        .when(tool.is_none(), |el| {
                            el.child(
                                div().whitespace_normal().child(
                                    crate::tool_ui::display_tool_title(
                                        permission["toolCall"]["title"].as_str().unwrap_or_default(),
                                    ),
                                ),
                            )
                        }),
                )
                .child(
                    feedback_actions(
                        options.enumerate().map(|(i, option)| {
                            let option_id = option["optionId"].as_str().unwrap_or_default().to_owned();
                            let label = option["name"].as_str().unwrap_or("Allow").to_owned();
                            let thread = thread.to_owned();
                            let request = request.clone();
                            action_button(
                                ("permission", i),
                                label.clone(),
                                if primary == Some(i) { ActionKind::Primary } else { ActionKind::Ghost },
                                chrome,
                                cx,
                            )
                            .h(chrome.control(GHOST_ICON_BUTTON))
                            .min_w_0()
                            .max_w_full()
                            .font_weight(FontWeight::NORMAL)
                            .tooltip(label)
                            .relative()
                            .children(chat.permission_bounds.get(i).map(|bounds| bounds.probe()))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.command(json!({"action":"permission","thread_id":thread,"request_id":request,"option_id":option_id}), cx);
                                if let Some(chat) = this.chats.iter_mut().find(|chat| chat.id == thread) {
                                    chat.permission = None;
                                }
                                cx.notify();
                            }))
                            .into_any_element()
                        }),
                        chrome,
                    )
                    .min_w_0()
                    .max_w_full(),
                )
                .into_any_element(),
        )
    }
}
