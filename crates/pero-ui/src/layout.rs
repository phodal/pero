//! Pure display choices shared by the Workbench renderer and App surface.
use crate::workspace::{ConversationTab, WorkbenchPage, WorkspaceItem, WorkspaceRoute};
use pero_contracts::workbench::LayoutPreferences;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ChatPlacement {
    Hidden,
    Main,
    Dock,
    Float,
    Slot,
}

/// Collapsed sidebar. Wide enough for one icon, narrower than the macOS traffic lights.
pub(crate) const SIDEBAR_RAIL: f32 = 48.;

/// Effective layout for one viewport. Saved preferences remain unchanged when
/// the available space requires a smaller dock or a chat-only view.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct WorkspaceLayout {
    pub sidebar_width: f32,
    pub narrow: bool,
    pub chat: ChatPlacement,
    pub chat_width: f32,
    pub content_visible: bool,
    pub embedded_surface_visible: bool,
}

impl WorkspaceLayout {
    pub(crate) fn chat_placement(
        route: &WorkspaceRoute,
        tab: ConversationTab,
        preferences: &LayoutPreferences,
    ) -> ChatPlacement {
        match route.page() {
            WorkbenchPage::Conversation if tab == ConversationTab::Chat => ChatPlacement::Main,
            WorkbenchPage::Tasks | WorkbenchPage::Document | WorkbenchPage::Web
                if preferences.chat_open =>
            {
                ChatPlacement::Dock
            }
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
        panes: Option<&pero_contracts::workspace_panes::PaneLayout>,
    ) -> Self {
        let sidebar_width = Self::sidebar_span(viewport_width, preferences.sidebar_width());
        let narrow = viewport_width < 1050.;
        let available = (viewport_width - sidebar_width).max(0.);
        let panes = panes.filter(|layout| layout.is_active(route));
        let chat_in_pane = panes.is_some_and(|layout| layout.conversation().is_some());
        let chat = if chat_in_pane {
            ChatPlacement::Hidden
        } else {
            Self::chat_placement(route, tab, preferences)
        };
        let chat_width = if chat == ChatPlacement::Dock {
            Self::dock_width(available, narrow, preferences)
        } else {
            0.
        };
        let content_visible = chat != ChatPlacement::Dock || !narrow;
        let embedded_surface_visible = (matches!(
            route,
            WorkspaceRoute::Content(WorkspaceItem::App { .. } | WorkspaceItem::Web(_))
        ) || panes.is_some_and(|layout| {
            layout.leaves().iter().any(|leaf| {
                matches!(
                    leaf.route(),
                    Some(WorkspaceRoute::Content(WorkspaceItem::App { .. } | WorkspaceItem::Web(_)))
                )
            })
        })) && content_visible
            && !covered;
        Self {
            sidebar_width,
            narrow,
            chat,
            chat_width,
            content_visible,
            embedded_surface_visible,
        }
    }

    /// Saved sidebar width, narrowed when the viewport cannot keep 480px of content.
    pub(crate) fn sidebar_span(viewport_width: f32, preferred: f32) -> f32 {
        let min = pero_contracts::workbench::LayoutPreferences::MIN_SIDEBAR_WIDTH as f32;
        let max = pero_contracts::workbench::LayoutPreferences::MAX_SIDEBAR_WIDTH as f32;
        let max = (viewport_width - 480.).clamp(min, max);
        preferred.clamp(min, max)
    }

    fn dock_width(available: f32, narrow: bool, preferences: &LayoutPreferences) -> f32 {
        if narrow {
            available
        } else {
            preferences.chat_width().min(available * 0.55)
        }
    }

    /// Fold the sidebar down to an icon rail. Saved dock width and the narrow breakpoint stay.
    pub(crate) fn hide_sidebar(
        mut self,
        viewport_width: f32,
        preferences: &LayoutPreferences,
    ) -> Self {
        self.sidebar_width = SIDEBAR_RAIL;
        if self.chat == ChatPlacement::Dock {
            let available = (viewport_width - SIDEBAR_RAIL).max(0.);
            self.chat_width = Self::dock_width(available, self.narrow, preferences);
        }
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_chat_mount_disables_the_dock_and_keeps_other_pane_surfaces_visible() {
        use pero_contracts::workspace_panes::{PaneLayout, SplitDirection};
        let app = WorkspaceRoute::Content(WorkspaceItem::App {
            name: "fixture".into(),
            panel: "main".into(),
        });
        let mut panes = PaneLayout::new(app.clone(), None);
        let first = panes.focused.unwrap();
        let chat = WorkspaceRoute::Content(WorkspaceItem::Conversation("thread".into()));
        panes
            .split(first, SplitDirection::Right, chat, None)
            .unwrap();
        panes.focus(first);
        let mut preferences = LayoutPreferences::default();
        preferences.chat_open = true;
        for (width, covered, visible) in [
            (800., false, true),
            (1488., false, true),
            (1488., true, false),
        ] {
            let layout = WorkspaceLayout::resolve(
                width,
                &app,
                ConversationTab::Chat,
                &preferences,
                covered,
                Some(&panes),
            );
            assert_eq!(layout.chat, ChatPlacement::Hidden);
            assert!(layout.content_visible);
            assert_eq!(layout.embedded_surface_visible, visible);
        }
    }

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
        // center content visible, embedded surface visible.
        for (name, viewport, route, tab, open, preferred_width, covered, expected) in [
            (
                "documents share the content dock without an App surface",
                1488.,
                Content(WorkspaceItem::Document {
                    origin: pero_contracts::content_origin::ContentOrigin::Conversation {
                        thread_id: "conversation".into(),
                    },
                    source: "code".into(),
                }),
                Chat,
                true,
                420.,
                false,
                (260., false, Dock, 420., true, false),
            ),
            (
                "narrow document content gives the shared dock the available width",
                1000.,
                Content(WorkspaceItem::Document {
                    origin: pero_contracts::content_origin::ContentOrigin::Conversation {
                        thread_id: "conversation".into(),
                    },
                    source: "code".into(),
                }),
                Chat,
                true,
                420.,
                false,
                (260., true, Dock, 740., false, false),
            ),
            (
                "Web and dock share the available viewport",
                1488.,
                Content(WorkspaceItem::Web("https://example.com/".into())),
                Chat,
                true,
                420.,
                false,
                (260., false, Dock, 420., true, true),
            ),
            (
                "a narrow Web dock hides the child engine",
                1000.,
                Content(WorkspaceItem::Web("https://example.com/".into())),
                Chat,
                true,
                420.,
                false,
                (260., true, Dock, 740., false, false),
            ),
            (
                "closing the narrow dock reveals the retained Web engine",
                1000.,
                Content(WorkspaceItem::Web("https://example.com/".into())),
                Chat,
                false,
                420.,
                false,
                (260., true, Hidden, 0., true, true),
            ),
            (
                "an overlay hides the native Web child without hiding the dock",
                1488.,
                Content(WorkspaceItem::Web("https://example.com/".into())),
                Chat,
                true,
                420.,
                true,
                (260., false, Dock, 420., true, false),
            ),
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
                (260., true, Hidden, 0., true, true),
            ),
            (
                "narrow App chat replaces the App view without resizing its preference",
                1049.,
                app.clone(),
                Chat,
                true,
                512.,
                false,
                (260., true, Dock, 789., false, false),
            ),
            (
                "the dock fits the available proportion at the narrow breakpoint",
                1050.,
                app.clone(),
                Chat,
                true,
                640.,
                false,
                (260., false, Dock, 434.5, true, true),
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
            let layout =
                WorkspaceLayout::resolve(viewport, &route, tab, &preferences, covered, None);
            assert_eq!(
                (
                    layout.sidebar_width,
                    layout.narrow,
                    layout.chat,
                    layout.chat_width,
                    layout.content_visible,
                    layout.embedded_surface_visible,
                ),
                expected,
                "{name}",
            );
            assert_eq!(preferences.chat_width(), preferred_width, "{name}");
        }
    }

    #[test]
    fn collapsing_the_sidebar_releases_its_width_and_keeps_the_saved_dock_width() {
        use ChatPlacement::{Dock, Main};
        use ConversationTab::Chat;
        use WorkbenchPage::Conversation;
        use WorkspaceRoute::{Content, Page};
        let app = Content(WorkspaceItem::App {
            name: "paper-agent".into(),
            panel: "main".into(),
        });
        let mut preferences = LayoutPreferences::default();
        preferences.chat_open = true;
        preferences.resize_chat(420.);
        let open = WorkspaceLayout::resolve(1488., &app, Chat, &preferences, false, None);
        let hidden = open.hide_sidebar(1488., &preferences);
        assert_eq!(open.sidebar_width, 260.);
        assert_eq!(hidden.sidebar_width, SIDEBAR_RAIL);
        assert_eq!(hidden.chat, Dock);
        assert_eq!(hidden.chat_width, 420.);
        assert!(hidden.content_visible);
        assert_eq!(preferences.chat_width(), 420.);

        let narrow = WorkspaceLayout::resolve(1000., &app, Chat, &preferences, false, None);
        let narrow_hidden = narrow.hide_sidebar(1000., &preferences);
        assert_eq!(narrow.chat_width, 740.);
        assert_eq!(narrow_hidden.sidebar_width, SIDEBAR_RAIL);
        assert_eq!(narrow_hidden.chat_width, 1000. - SIDEBAR_RAIL);
        assert!(narrow_hidden.narrow);
        assert!(!narrow_hidden.content_visible);

        let conversation = WorkspaceLayout::resolve(
            1488.,
            &Page(Conversation),
            Chat,
            &LayoutPreferences::default(),
            false,
            None,
        );
        let conversation_hidden = conversation.hide_sidebar(1488., &LayoutPreferences::default());
        assert_eq!(conversation.chat, Main);
        assert_eq!(conversation_hidden.sidebar_width, SIDEBAR_RAIL);
        assert_eq!(conversation_hidden.chat, Main);
        assert_eq!(conversation_hidden.chat_width, 0.);
    }
}
