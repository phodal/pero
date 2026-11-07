//! Shared link entry for chat, document, PR and context-reference consumers.
use crate::app::Workbench;
use gpui_kit::*;
use pero_contracts::content_link::WorkspaceLink;

impl Workbench {
    pub(crate) fn open_workspace_link(
        &mut self,
        href: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let Some(target) = WorkspaceLink::parse(href) {
            self.open_link_target(target, window, cx);
        }
    }
    pub(crate) fn open_link_target(
        &mut self,
        target: WorkspaceLink,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match target {
            WorkspaceLink::PullRequest(reference) => self.open_pull_request(reference, window, cx),
            WorkspaceLink::App(address) => self.open_app_location(address, cx),
            WorkspaceLink::Web(address) => self.web_command(
                serde_json::json!({"action":"web_open","url":address}),
                window,
                cx,
            ),
            WorkspaceLink::External(url) => cx.open_url(&url),
        }
    }
}
