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
        self.follow_link(
            href,
            pero_contracts::workbench::LinkClick::default(),
            window,
            cx,
        );
    }
    pub(crate) fn open_link_target(
        &mut self,
        target: WorkspaceLink,
        click: pero_contracts::workbench::LinkClick,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match target {
            WorkspaceLink::PullRequest(reference) => self.open_source(
                pero_contracts::source_target::SourceTarget::PullRequest(reference),
                click,
                window,
                cx,
            ),
            WorkspaceLink::App(address) => self.open_app_location(address, cx),
            WorkspaceLink::Web(address) => {
                if self.preferences.layout.link_surface.opens_externally(click) {
                    cx.open_url(address.as_str());
                } else {
                    self.web_command(
                        serde_json::json!({"action":"web_open","url":address}),
                        window,
                        cx,
                    );
                }
            }
            WorkspaceLink::External(url) => cx.open_url(&url),
        }
    }
}
