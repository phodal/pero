use crate::{
    panel::{ChatAction, ChatPanel},
    resource_panel::{PanelTabAction, ResourcePrimary, panel_launcher, panel_tab_strip},
    session_artifacts::{ArtifactCollection, ResourceView},
};
use gpui_kit::*;
use pero_contracts::workbench::ResourceTab;

impl ChatPanel {
    pub(crate) fn tabbed_resources(&self) -> bool {
        #[cfg(all(feature = "native", target_os = "macos"))]
        {
            self.native_desktop_pane.is_some()
        }
        #[cfg(not(all(feature = "native", target_os = "macos")))]
        {
            false
        }
    }

    pub(crate) fn resource_primary(&self, view: ResourceView) -> ResourcePrimary {
        match view {
            ResourceView::Launcher => ResourcePrimary::Launcher,
            ResourceView::Changes => ResourcePrimary::Changes,
            ResourceView::Desktop => ResourcePrimary::Desktop,
            ResourceView::Contents if self.files.selection.tab == ResourceTab::Files => {
                ResourcePrimary::Files
            }
            ResourceView::Contents => ResourcePrimary::Artifacts,
        }
    }

    pub(crate) fn open_panel_launcher(&mut self, thread: &str, cx: &mut Context<Self>) {
        let state = self
            .artifacts
            .conversations
            .entry(thread.into())
            .or_default();
        state.show_pane(ResourceView::Launcher);
        if self.compact {
            cx.emit(ChatAction::CompactNeedsSpace);
        }
        cx.notify();
    }

    pub(crate) fn select_panel_view(
        &mut self,
        thread: &str,
        pane: ResourcePrimary,
        cx: &mut Context<Self>,
    ) {
        match pane {
            ResourcePrimary::Launcher => self.open_panel_launcher(thread, cx),
            ResourcePrimary::Files => self.choose_resource_tab(thread, ResourceTab::Files, cx),
            ResourcePrimary::Artifacts => self.open_resource_tab(ResourceTab::Artifacts, cx),
            ResourcePrimary::Changes => self.open_changes_pane(thread, cx),
            ResourcePrimary::Desktop => self.open_desktop_pane(cx),
        }
    }

    pub(crate) fn conversation_panel_launcher(
        &self,
        thread: &str,
        cx: &Context<Self>,
    ) -> AnyElement {
        let mut available = vec![
            ResourcePrimary::Files,
            ResourcePrimary::Artifacts,
            ResourcePrimary::Changes,
        ];
        if self.desktop_pane_available() {
            available.push(ResourcePrimary::Desktop);
        }
        let owner = cx.entity().downgrade();
        let thread = thread.to_owned();
        panel_launcher(
            &available,
            &self.locale,
            move |pane, cx| {
                let _ = owner.update(cx, |this, cx| this.select_panel_view(&thread, pane, cx));
            },
            cx,
        )
    }

    pub(crate) fn conversation_panel_tabs(
        &self,
        thread: &str,
        state: &ArtifactCollection,
        cx: &Context<Self>,
    ) -> AnyElement {
        let active = self.resource_primary(state.resource_view);
        let owner = cx.entity().downgrade();
        let thread = thread.to_owned();
        panel_tab_strip(
            &state.panel_tabs,
            active,
            &self.locale,
            move |action, cx| {
                let _ = owner.update(cx, |this, cx| match action {
                    PanelTabAction::Select(pane) => this.select_panel_view(&thread, pane, cx),
                    PanelTabAction::Close(pane) => {
                        let Some(state) = this.artifacts.conversations.get_mut(&thread) else {
                            return;
                        };
                        if pane == ResourcePrimary::Launcher && state.panel_tabs.is_empty() {
                            this.close_resource_pane(cx);
                        } else {
                            let next = state.panel_tabs.closed(pane, active);
                            if next != active {
                                this.select_panel_view(&thread, next, cx);
                            } else {
                                cx.notify();
                            }
                        }
                    }
                });
            },
            cx,
        )
    }
}
