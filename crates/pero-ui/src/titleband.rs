//! The titleband is the headers of the columns under it.
//!
//! `project` is the one place that decides which primary and which actions
//! belong to a column. The shell paints each segment at that column's width.

/// One workbench column the shell is about to draw.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct WorkbenchColumns {
    pub sidebar_width: f32,
    pub main: MainColumn,
    pub resources: Option<ResourcesColumn>,
}

/// What the main column is showing, plus the facts the header is chosen from.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct MainColumn {
    pub focus: MainFocus,
    /// Installed column-header actions and whether that app failed.
    /// Failure keeps retry and drops the declared actions.
    pub app: Option<FocusedApp>,
    pub open_chat: bool,
    pub close_chat: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum MainFocus {
    /// Pane tabs name the column.
    Tabs,
    /// A web document: the address is the primary.
    Web,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct FocusedApp {
    pub failed: bool,
    pub actions: Vec<DeclaredAction>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct DeclaredAction {
    pub id: String,
    pub label: String,
    pub icon: Option<String>,
}

/// Files, artifacts, or changes open beside the chat. Not a bottom stack.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct ResourcesColumn {
    pub width: f32,
    pub primary: ResourcePrimary,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ResourcePrimary {
    Files,
    Artifacts,
    Changes,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum SegmentWidth {
    Fixed(f32),
    Fill,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ColumnKind {
    Sidebar,
    Main,
    Resources,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Primary {
    /// Traffic-light inset only.
    Inset,
    Tabs,
    Address,
    Resource(ResourcePrimary),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Action {
    SidebarToggle,
    Search,
    OpenChat,
    CloseChat,
    Retry,
    App {
        id: String,
        label: String,
        icon: Option<String>,
    },
    /// View switch, import, refresh, and the rest of today's pane toolbar.
    ResourceToolbar,
    WebRefresh,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Segment {
    pub column: ColumnKind,
    pub width: SegmentWidth,
    pub primary: Primary,
    pub actions: Vec<Action>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Titleband {
    pub segments: Vec<Segment>,
}

impl Titleband {
    pub(crate) fn segment(&self, column: ColumnKind) -> Option<&Segment> {
        self.segments.iter().find(|segment| segment.column == column)
    }
}

/// Columns in, header segments out. Search stays on the main segment.
pub(crate) fn project(columns: &WorkbenchColumns) -> Titleband {
    let mut segments = vec![
        Segment {
            column: ColumnKind::Sidebar,
            width: SegmentWidth::Fixed(columns.sidebar_width),
            primary: Primary::Inset,
            actions: vec![Action::SidebarToggle],
        },
        main_segment(&columns.main),
    ];
    if let Some(resources) = columns.resources {
        segments.push(Segment {
            column: ColumnKind::Resources,
            width: SegmentWidth::Fixed(resources.width),
            primary: Primary::Resource(resources.primary),
            actions: vec![Action::ResourceToolbar],
        });
    }
    Titleband { segments }
}

fn main_segment(main: &MainColumn) -> Segment {
    let (primary, mut actions) = match main.focus {
        MainFocus::Web => (Primary::Address, vec![Action::WebRefresh]),
        MainFocus::Tabs => {
            let actions = match &main.app {
                Some(app) if app.failed => vec![Action::Retry],
                Some(app) => app
                    .actions
                    .iter()
                    .map(|action| Action::App {
                        id: action.id.clone(),
                        label: action.label.clone(),
                        icon: action.icon.clone(),
                    })
                    .collect(),
                None => Vec::new(),
            };
            (Primary::Tabs, actions)
        }
    };
    if main.open_chat {
        actions.push(Action::OpenChat);
    }
    if main.close_chat {
        actions.push(Action::CloseChat);
    }
    actions.push(Action::Search);
    Segment {
        column: ColumnKind::Main,
        width: SegmentWidth::Fill,
        primary,
        actions,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn declared(id: &str) -> DeclaredAction {
        DeclaredAction {
            id: id.into(),
            label: "Import".into(),
            icon: Some("upload".into()),
        }
    }

    fn app_action(id: &str) -> Action {
        Action::App {
            id: id.into(),
            label: "Import".into(),
            icon: Some("upload".into()),
        }
    }

    fn columns(main: MainColumn, resources: Option<ResourcesColumn>) -> WorkbenchColumns {
        WorkbenchColumns {
            sidebar_width: 240.,
            main,
            resources,
        }
    }

    fn main(focus: MainFocus, app: Option<FocusedApp>) -> MainColumn {
        MainColumn {
            focus,
            app,
            open_chat: false,
            close_chat: false,
        }
    }

    #[test]
    fn titleband_follows_the_columns() {
        let import = declared("import");
        let ready = FocusedApp {
            failed: false,
            actions: vec![import.clone()],
        };
        let failed = FocusedApp {
            failed: true,
            actions: vec![import],
        };
        let cases = [
            (
                "resources closed",
                columns(main(MainFocus::Tabs, None), None),
                None,
                vec![Action::Search],
            ),
            (
                "resources open at W",
                columns(
                    main(MainFocus::Tabs, None),
                    Some(ResourcesColumn {
                        width: 420.,
                        primary: ResourcePrimary::Files,
                    }),
                ),
                Some(420.),
                vec![Action::Search],
            ),
            (
                "focused app actions",
                columns(main(MainFocus::Tabs, Some(ready)), None),
                None,
                vec![app_action("import"), Action::Search],
            ),
            (
                "failed app retries",
                columns(main(MainFocus::Tabs, Some(failed)), None),
                None,
                vec![Action::Retry, Action::Search],
            ),
            (
                "web document",
                columns(main(MainFocus::Web, None), None),
                None,
                vec![Action::WebRefresh, Action::Search],
            ),
        ];
        for (name, input, resources_width, main_actions) in cases {
            let band = project(&input);
            let sidebar = band.segment(ColumnKind::Sidebar).expect(name);
            assert_eq!(sidebar.width, SegmentWidth::Fixed(240.), "{name}");
            assert_eq!(sidebar.actions, vec![Action::SidebarToggle], "{name}");
            let main = band.segment(ColumnKind::Main).expect(name);
            assert_eq!(main.width, SegmentWidth::Fill, "{name}");
            assert_eq!(main.actions, main_actions, "{name}");
            assert!(
                main.actions.contains(&Action::Search),
                "{name}: search stays on the main segment"
            );
            assert!(
                !main.actions.contains(&Action::ResourceToolbar),
                "{name}: resource actions stay off the main segment"
            );
            match resources_width {
                None => assert!(band.segment(ColumnKind::Resources).is_none(), "{name}"),
                Some(width) => {
                    let resources = band.segment(ColumnKind::Resources).expect(name);
                    assert_eq!(resources.width, SegmentWidth::Fixed(width), "{name}");
                    assert_eq!(resources.actions, vec![Action::ResourceToolbar], "{name}");
                    assert!(!resources.actions.contains(&Action::Search), "{name}");
                }
            }
        }
        let failed_band = project(&columns(
            main(
                MainFocus::Tabs,
                Some(FocusedApp {
                    failed: true,
                    actions: vec![declared("import")],
                }),
            ),
            None,
        ));
        let failed_main = failed_band.segment(ColumnKind::Main).unwrap();
        assert!(failed_main.actions.contains(&Action::Retry));
        assert!(failed_main.actions.iter().all(|action| !matches!(action, Action::App { .. })));
        let web = project(&columns(main(MainFocus::Web, None), None));
        assert_eq!(
            web.segment(ColumnKind::Main).unwrap().primary,
            Primary::Address
        );
    }
}
