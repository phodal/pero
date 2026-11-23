//! Chrome projects the selected ordinary conversation through its existing ChatPanel.
use crate::app::Workbench;
use gpui_kit::{prelude::*, *};
use pero_contracts::context::ContextReference;
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum SidebarAction {
    Snapshot,
    Send {
        text: String,
        contexts: Vec<ContextReference>,
    },
    Stop,
    Open,
    Create,
    Select {
        id: String,
    },
}

impl Workbench {
    pub(crate) fn native_sidebar(
        &mut self,
        thread: &str,
        action: SidebarAction,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> anyhow::Result<Value> {
        anyhow::ensure!(
            self.browser_thread(cx).as_deref() == Some(thread),
            "Select the paired conversation in Pero."
        );
        match action {
            SidebarAction::Send { text, contexts } => {
                anyhow::ensure!(
                    self.chat
                        .update(cx, |chat, cx| chat.submit_prompt(text, contexts, cx)),
                    "Pero could not submit this message."
                );
            }
            SidebarAction::Stop => self.command(json!({"action":"cancel","thread_id":thread}), cx),
            SidebarAction::Open => {
                cx.activate(true);
                window.activate_window();
            }
            SidebarAction::Create | SidebarAction::Select { .. } => {
                self.chat.update(cx, |panel, cx| -> anyhow::Result<()> {
                    match action {
                        SidebarAction::Select { id } => {
                            let i = panel
                                .chats
                                .iter()
                                .position(|c| {
                                    c.id == id
                                        && c.scope.is_none()
                                        && c.workspace == panel.workspace
                                })
                                .ok_or_else(|| {
                                    anyhow::anyhow!(
                                        "Conversation is unavailable in this workspace."
                                    )
                                })?;
                            panel.focus_chat(Some(i), cx);
                        }
                        _ => panel.new_chat(cx),
                    }
                    Ok(())
                })?;
                if let Some(next) = self.browser_thread(cx).filter(|id| id != thread) {
                    self.pair_sidebar_conversation(next, window, cx);
                    return Ok(Value::Null);
                }
            }
            SidebarAction::Snapshot => {}
        }
        let panel = self.chat.read(cx);
        let chat = &panel.chats[panel.active_chat.expect("paired conversation")];
        Ok(json!({
            "sessionId":chat.id, "title":chat.title.display(), "workspace":panel.workspace,
            "running":chat.state.busy(), "attention":chat.permission.is_some(), "error":chat.error,
            "messages":chat.messages.iter().filter(|m| m.role == "user" || m.role == "assistant")
                .map(|m|json!({"role":m.role,"text":m.text,"files":m.attached_files})).collect::<Vec<_>>(),
            "sessions":panel.chats.iter().filter(|c|c.scope.is_none() && c.workspace == panel.workspace)
                .map(|c|json!({"id":c.id,"title":c.title.display()})).collect::<Vec<_>>()
        }))
    }
}
