//! Workbench-owned navigation to scientific computing and the Automation App.
use crate::{app::Workbench, workspace::WorkspaceItem};
use gpui_kit::{prelude::*, *};
impl Workbench {
    pub(crate) fn open_compute(&mut self, cx: &mut Context<Self>) {
        self.remember_current_location(cx);
        self.navigation.open(WorkspaceItem::Compute);
        self.sync_follow(cx);
        self.queue_workspace_checkpoint(cx);
        cx.notify();
    }

    pub(crate) fn open_automation_session(&mut self, id: &str, cx: &mut Context<Self>) {
        let index=self.chat.read(cx).chats.iter().position(|chat|chat.id==id);
        if let Some(index)=index {
            self.focus_chat(Some(index), crate::workspace::ConversationTab::Chat, cx);
            cx.notify();
        }
    }

    pub(crate) fn open_automations(&mut self, _: &mut Window, cx: &mut Context<Self>) {
        self.pending_app = Some(("automations".into(), "main".into()));
        self.refresh_apps(cx);
        self.open_app("automations".into(), "main".into(), cx);
    }
}
