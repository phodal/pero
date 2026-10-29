//! Keep the existing Host approval next to its tool; retain a fallback for early requests.
use crate::panel::ChatPanel;
use gpui_kit::{
    component::{Sizable, button::*},
    prelude::*,
    *,
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
        let p = pero_theme::UiAppearance::global(cx).palette.clone();
        let request = permission["permission_id"]
            .as_str()
            .unwrap_or_default()
            .to_owned();
        Some(div().mx(px(4.)).my(px(6.)).p(px(8.)).bg(p.warning_bg)
            .child(div().text_size(px(12.)).font_weight(FontWeight::SEMIBOLD).child(self.t("chat.permission")))
            .when(tool.is_none(), |el| el.child(permission["toolCall"]["title"].as_str().unwrap_or_default().to_owned()))
            .child(div().mt(px(6.)).flex().flex_wrap().gap(px(6.)).children(
                permission["options"].as_array().into_iter().flatten().enumerate().map(|(i,option)| {
                    let option_id = option["optionId"].as_str().unwrap_or_default().to_owned();
                    let thread = thread.to_owned(); let request = request.clone();
                    Button::new(("permission",i)).relative().children(chat.permission_bounds.get(i).map(|bounds|bounds.probe()))
                        .small().label(option["name"].as_str().unwrap_or("Allow").to_owned())
                        .on_click(cx.listener(move |this,_,_,cx| {
                            this.command(json!({"action":"permission","thread_id":thread,"request_id":request,"option_id":option_id}),cx);
                            if let Some(chat)=this.chats.iter_mut().find(|chat|chat.id==thread) { chat.permission=None; }
                            cx.notify();
                        }))
                })
            )).into_any_element())
    }
}
