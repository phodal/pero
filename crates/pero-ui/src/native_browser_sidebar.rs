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
    Edit {
        before: String,
        start: usize,
        end: usize,
        insert: String,
    },
    Choose {
        text: String,
        index: usize,
        label: String,
    },
    Dismiss,
    Model {
        id: String,
    },
    Submit {
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
            SidebarAction::Edit {
                before,
                start,
                end,
                insert,
            } => self.chat.update(cx, |panel, cx| -> anyhow::Result<()> {
                anyhow::ensure!(
                    panel.composer.read(cx).value().as_str() == before
                        && before.get(start..end).is_some(),
                    "The draft changed in Pero. Review it before editing."
                );
                panel.replace_composer_range(start..end, &insert, window, cx);
                panel.update_composer_completion(cx);
                Ok(())
            })?,
            SidebarAction::Choose { text, index, label } => {
                self.chat.update(cx, |panel, cx| -> anyhow::Result<()> {
                    anyhow::ensure!(
                        panel.composer.read(cx).value().as_str() == text
                            && panel.composer_state.open
                            && panel
                                .composer_picker_items()
                                .get(index)
                                .is_some_and(|item| item.label == label),
                        "Choices changed. Select again."
                    );
                    panel.select_composer_candidate(index, window, cx);
                    Ok(())
                })?
            }
            SidebarAction::Dismiss => self
                .chat
                .update(cx, |panel, cx| panel.close_composer_picker(cx)),
            SidebarAction::Model { id } => self
                .chat
                .update(cx, |panel, cx| panel.select_chat_model(thread, &id, cx)),
            SidebarAction::Submit { text, contexts } => {
                self.chat.update(cx, |panel, cx| -> anyhow::Result<()> {
                    anyhow::ensure!(
                        panel.composer.read(cx).value().as_str() == text,
                        "The draft changed in Pero. Review before sending."
                    );
                    for reference in contexts {
                        let end = panel.composer.read(cx).value().len();
                        panel.insert_composer_reference(reference, end..end, window, cx);
                    }
                    panel.send_chat(window, cx);
                    Ok(())
                })?
            }
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
        self.chat
            .update(cx, |panel, cx| panel.apply_composer_context(window, cx));
        let panel = self.chat.read(cx);
        let chat = &panel.chats[panel.active_chat.expect("paired conversation")];
        Ok(json!({
            "sessionId":chat.id, "title":chat.title.display(), "workspace":panel.workspace,
            "composer":{"text":panel.composer.read(cx).value().to_string(), "model":chat.model, "models":chat.models,
                "sessionReady":chat.can_submit(),
                "modelDisabled":chat.state != pero_chat_ui::session_state::SessionState::Idle || chat.pending_model.is_some() || chat.pending_setting.is_some(),
                "open":panel.composer_state.open, "loading":panel.composer_state.loading, "error":panel.composer_state.error,
                "references":panel.attachments.iter().map(|r| &r.label).collect::<Vec<_>>(),
                "items":panel.composer_picker_items().iter().map(|i|json!({"label":i.label,"detail":i.detail,"group":i.group})).collect::<Vec<_>>()},
            "running":chat.state.busy(), "attention":chat.permission.is_some(), "error":chat.error,
            "messages":chat.messages.iter().filter(|m| m.role == "user" || m.role == "assistant")
                .map(|m|json!({"role":m.role,"text":m.text,"files":m.attached_files})).collect::<Vec<_>>(),
            "sessions":panel.chats.iter().filter(|c|c.scope.is_none() && c.workspace == panel.workspace)
                .map(|c|json!({"id":c.id,"title":c.title.display()})).collect::<Vec<_>>()
        }))
    }
}
