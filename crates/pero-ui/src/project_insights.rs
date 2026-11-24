use crate::{app::Workbench, projects::ProjectTab, workspace::WorkspaceItem};
use gpui_kit::{prelude::*, *};
#[cfg(target_family = "wasm")]
use gpui_kit::base::ElementExt;
use serde_json::json;

impl Workbench {
    pub(crate) fn project_insights_id(&self) -> Option<&str> {
        match self.navigation.current() {
            Some(WorkspaceItem::Project(key))
                if self.project_tab == ProjectTab::Overview && self.active_research_editor().is_none() =>
            {
                key.strip_prefix("research:")
            }
            _ => None,
        }
    }

    pub(crate) fn open_project_insights_discussion(&mut self, scope: pero_contracts::AppChatScope, cx: &mut Context<Self>) {
        let index = self.chat.update(cx, |chat, cx| {
            chat.new_chat_in_scope(Some(scope), cx);
            chat.active_chat
        });
        self.focus_chat(index, crate::workspace::ConversationTab::Chat, cx);
    }

    pub(crate) fn ensure_project_insights(&mut self, cx: &mut Context<Self>) {
        if self.project_insights_id().is_some()
            && !self.apps.project_insights_requested
            && self.apps.contains_panel("insights", "main")
        {
            self.apps.project_insights_requested = true;
            self.apps.open_errors.remove(&("insights".into(), "main".into()));
            self.command(json!({"action":"apps_open","name":"insights","panel":"main"}), cx);
        }
    }

    pub(crate) fn project_insights_panel(&self, cx: &mut Context<Self>) -> AnyElement {
        if !self.apps.retains_panel("insights", "main") {
            return div().into_any_element();
        }
        let panel = div()
            .id("project-insights")
            .flex()
            .flex_1()
            .min_h_0()
            .min_w_0();
        #[cfg(not(target_family = "wasm"))]
        return panel.child(self.native_app_content("insights", "main", cx)).into_any_element();
        #[cfg(target_family = "wasm")]
        {
            let owner = cx.entity().clone();
            panel.child(div()
                .flex_1()
                .min_h_0()
                .min_w_0()
                .on_prepaint(move |bounds, _, cx| {
                    owner.update(cx, |this, cx| this.sync_app_surface(Some(bounds), cx))
                }))
                .into_any_element()
        }
    }
}
