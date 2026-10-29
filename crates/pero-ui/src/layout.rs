//! Pure display choices shared by the Workbench renderer and App surface.
use crate::workspace::{ConversationTab, WorkbenchPage, WorkspaceItem, WorkspaceRoute};
use pero_contracts::workbench::LayoutPreferences;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ChatPlacement {
    Hidden,
    Main,
    Dock,
}

/// Effective layout for one viewport. Saved preferences remain unchanged when
/// the available space requires a smaller dock or a chat-only view.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct WorkspaceLayout {
    pub sidebar_width: f32,
    pub narrow: bool,
    pub chat: ChatPlacement,
    pub chat_width: f32,
    pub content_visible: bool,
    pub app_surface_visible: bool,
}

impl WorkspaceLayout {
    pub(crate) fn chat_placement(
        route: &WorkspaceRoute,
        tab: ConversationTab,
        preferences: &LayoutPreferences,
    ) -> ChatPlacement {
        match route.page() {
            WorkbenchPage::Conversation if tab == ConversationTab::Chat => ChatPlacement::Main,
            WorkbenchPage::Tasks if preferences.chat_open => ChatPlacement::Dock,
            WorkbenchPage::Apps
                if preferences.chat_open
                    && matches!(route, WorkspaceRoute::Content(WorkspaceItem::App { .. })) =>
            {
                ChatPlacement::Dock
            }
            _ => ChatPlacement::Hidden,
        }
    }

    pub(crate) fn resolve(
        viewport_width: f32,
        route: &WorkspaceRoute,
        tab: ConversationTab,
        preferences: &LayoutPreferences,
        covered: bool,
    ) -> Self {
        let sidebar_width = if viewport_width < 1150. { 240. } else { 260. };
        let narrow = viewport_width < 1050.;
        let available = (viewport_width - sidebar_width).max(0.);
        let chat = Self::chat_placement(route, tab, preferences);
        let chat_width = if chat == ChatPlacement::Dock {
            if narrow {
                available
            } else {
                preferences.chat_width().min(available * 0.55)
            }
        } else {
            0.
        };
        let content_visible = chat != ChatPlacement::Dock || !narrow;
        let app_surface_visible =
            matches!(route, WorkspaceRoute::Content(WorkspaceItem::App { .. }))
                && content_visible
                && !covered;
        Self {
            sidebar_width,
            narrow,
            chat,
            chat_width,
            content_visible,
            app_surface_visible,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_layout_follows_content_and_available_space_without_changing_preferences() {
        use ChatPlacement::{Dock, Hidden, Main};
        use ConversationTab::{Chat, Logs};
        use WorkbenchPage::{Apps, Connections, Conversation, Tasks};
        use WorkspaceRoute::{Content, Page};
        let app = Content(WorkspaceItem::App {
            name: "paper-agent".into(),
            panel: "main".into(),
        });

        // Expected columns: sidebar, narrow, chat placement, dock width,
        // center content visible, App surface visible.
        for (name, viewport, route, tab, open, preferred_width, covered, expected) in [
            (
                "conversation chat stays in the main content area",
                1488.,
                Page(Conversation),
                Chat,
                false,
                420.,
                false,
                (260., false, Main, 0., true, false),
            ),
            (
                "conversation logs do not show the shared chat",
                1488.,
                Page(Conversation),
                Logs,
                true,
                420.,
                false,
                (260., false, Hidden, 0., true, false),
            ),
            (
                "task page opens the preferred dock",
                1488.,
                Page(Tasks),
                Chat,
                true,
                420.,
                false,
                (260., false, Dock, 420., true, false),
            ),
            (
                "task content respects a closed dock",
                1488.,
                Content(WorkspaceItem::Task("task".into())),
                Chat,
                false,
                512.,
                false,
                (260., false, Hidden, 0., true, false),
            ),
            (
                "project content shares the task dock policy",
                1488.,
                Content(WorkspaceItem::Project("project".into())),
                Logs,
                true,
                512.,
                false,
                (260., false, Dock, 512., true, false),
            ),
            (
                "App and chat remain visible together in a wide viewport",
                1488.,
                app.clone(),
                Chat,
                true,
                640.,
                false,
                (260., false, Dock, 640., true, true),
            ),
            (
                "closing the App dock reveals the App at narrow widths",
                1000.,
                app.clone(),
                Chat,
                false,
                512.,
                false,
                (240., true, Hidden, 0., true, true),
            ),
            (
                "narrow App chat replaces the App view without resizing its preference",
                1049.,
                app.clone(),
                Chat,
                true,
                512.,
                false,
                (240., true, Dock, 809., false, false),
            ),
            (
                "the dock fits the available proportion at the narrow breakpoint",
                1050.,
                app.clone(),
                Chat,
                true,
                640.,
                false,
                (240., false, Dock, 445.5, true, true),
            ),
            (
                "the sidebar uses its full width at the compact breakpoint",
                1150.,
                app.clone(),
                Chat,
                true,
                640.,
                false,
                (260., false, Dock, 489.5, true, true),
            ),
            (
                "an overlay hides the iframe while retaining the GPUI content and dock",
                1488.,
                app.clone(),
                Chat,
                true,
                420.,
                true,
                (260., false, Dock, 420., true, false),
            ),
            (
                "the App catalog has no active App surface or dock",
                1488.,
                Page(Apps),
                Chat,
                true,
                420.,
                false,
                (260., false, Hidden, 0., true, false),
            ),
            (
                "other pages do not inherit an open dock",
                1488.,
                Page(Connections),
                Chat,
                true,
                420.,
                false,
                (260., false, Hidden, 0., true, false),
            ),
        ] {
            let mut preferences = LayoutPreferences::default();
            preferences.resize_chat(preferred_width);
            preferences.chat_open = open;
            let layout = WorkspaceLayout::resolve(viewport, &route, tab, &preferences, covered);
            assert_eq!(
                (
                    layout.sidebar_width,
                    layout.narrow,
                    layout.chat,
                    layout.chat_width,
                    layout.content_visible,
                    layout.app_surface_visible,
                ),
                expected,
                "{name}",
            );
            assert_eq!(preferences.chat_width(), preferred_width, "{name}");
        }
    }
}
