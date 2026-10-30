use pero_contracts::content_origin::ContentOrigin;
use pero_contracts::reader_state::ReaderState;
pub(crate) use pero_contracts::workspace_session::{
    HistoryEntry, PaneSide, WorkbenchPage, WorkspaceHistory, WorkspaceItem, WorkspaceRoute,
    WorkspaceSnapshot,
};
#[cfg(target_family = "wasm")]
pub(crate) trait LegacyPage {
    fn legacy_index(self) -> usize;
}
#[cfg(target_family = "wasm")]
impl LegacyPage for WorkbenchPage {
    /// Numeric names are retained only for the existing diagnostic consumers.
    fn legacy_index(self) -> usize {
        match self {
            Self::Conversation => 0,
            Self::Document => 10,
            Self::Web => 11,
            Self::Projects => 1,
            Self::Agents => 2,
            Self::Tasks => 3,
            Self::Workers => 5,
            Self::Apps => 7,
            Self::Insights => 8,
            Self::Connections => 9,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ConversationTab {
    #[default]
    Chat,
    Logs,
}

#[cfg(target_family = "wasm")]
impl ConversationTab {
    pub(crate) fn legacy_index(self) -> usize {
        match self {
            Self::Chat => 4,
            Self::Logs => 3,
        }
    }
}

/// Owns open content and the one visible route. Closing a tab changes this
/// value only; it never deletes a source object or stops its execution.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct WorkspaceNavigation {
    items: Vec<WorkspaceItem>,
    route: WorkspaceRoute,
    other: Option<WorkspaceRoute>,
    focused: PaneSide,
    history: WorkspaceHistory,
}

impl Default for WorkspaceNavigation {
    fn default() -> Self {
        Self {
            items: Vec::new(),
            route: WorkspaceRoute::Page(WorkbenchPage::Projects),
            other: None,
            focused: PaneSide::Left,
            history: WorkspaceHistory::default(),
        }
    }
}

impl WorkspaceNavigation {
    pub(crate) fn route(&self) -> &WorkspaceRoute {
        &self.route
    }

    pub(crate) fn page(&self) -> WorkbenchPage {
        self.route.page()
    }

    pub(crate) fn current(&self) -> Option<&WorkspaceItem> {
        match &self.route {
            WorkspaceRoute::Content(item) => Some(item),
            WorkspaceRoute::Page(_) => None,
        }
    }

    pub(crate) fn items(&self) -> &[WorkspaceItem] {
        &self.items
    }

    /// A route is returned only when it changes, so the shell can carry out
    /// activation once rather than repeating it while rendering.
    fn set_route(&mut self, route: WorkspaceRoute) {
        if self.other.as_ref() == Some(&route) {
            self.other = Some(std::mem::replace(&mut self.route, route));
            self.focused = if self.focused == PaneSide::Left {
                PaneSide::Right
            } else {
                PaneSide::Left
            };
        } else {
            if !matches!(
                route,
                WorkspaceRoute::Content(WorkspaceItem::Document { .. })
            ) {
                self.other = None;
                self.focused = PaneSide::Left;
            }
            self.route = route;
        }
    }
    fn change_route(&mut self, route: WorkspaceRoute) -> Option<WorkspaceRoute> {
        if self.route == route {
            return None;
        }
        self.history.depart(&self.route);
        self.set_route(route);
        Some(self.route.clone())
    }
    pub(crate) fn snapshot(&self) -> WorkspaceSnapshot {
        WorkspaceSnapshot {
            items: self.items.clone(),
            route: self.route.clone(),
            other: self.other.clone(),
            focused: self.focused,
            history: self.history.clone(),
        }
    }
    pub(crate) fn restore(&mut self, snapshot: WorkspaceSnapshot) {
        self.items = snapshot.items;
        self.route = snapshot.route;
        self.other = snapshot.other;
        self.focused = snapshot.focused;
        self.history = snapshot.history;
    }
    pub(crate) fn can_back(&self) -> bool {
        self.history.can_step(&self.route, false)
    }
    pub(crate) fn can_forward(&self) -> bool {
        self.history.can_step(&self.route, true)
    }
    pub(crate) fn step_history(&mut self, forward: bool) -> Option<HistoryEntry> {
        let entry = self.history.step(&self.route, forward)?;
        self.set_route(entry.route.clone());
        Some(entry)
    }
    pub(crate) fn observe_reading(&mut self, item: &WorkspaceItem, state: ReaderState) {
        if self.current() == Some(item) {
            self.history.observe(&self.route, state);
        }
    }
    pub(crate) fn jump(&mut self, item: &WorkspaceItem, before: ReaderState, after: ReaderState) {
        if self.current() == Some(item) {
            self.history.jump(&self.route, before, after);
        }
    }
    fn prune_history(&mut self) {
        let available = |route: &WorkspaceRoute| match route {
            WorkspaceRoute::Page(_) => true,
            WorkspaceRoute::Content(item) => self.items.contains(item),
        };
        self.history.retain(available);
        if self.other.as_ref().is_some_and(|route| !available(route)) {
            self.other = None;
            self.focused = PaneSide::Left;
        }
    }
    pub(crate) fn split_document(&mut self, item: &WorkspaceItem) -> bool {
        if !matches!(self.current(), Some(WorkspaceItem::Document { .. }))
            || !matches!(item, WorkspaceItem::Document { .. })
            || self.current() == Some(item)
            || !self.items.contains(item)
        {
            return false;
        }
        self.other = Some(WorkspaceRoute::Content(item.clone()));
        self.focused = PaneSide::Left;
        true
    }
    pub(crate) fn collapse_panes(&mut self) -> Option<WorkspaceRoute> {
        let other = self.other.take()?;
        let changed = if self.focused == PaneSide::Right {
            self.history.depart(&self.route);
            self.route = other;
            Some(self.route.clone())
        } else {
            None
        };
        self.focused = PaneSide::Left;
        changed
    }
    pub(crate) fn panes(&self) -> Option<(&WorkspaceItem, &WorkspaceItem, PaneSide)> {
        let WorkspaceRoute::Content(active) = &self.route else {
            return None;
        };
        let WorkspaceRoute::Content(other) = self.other.as_ref()? else {
            return None;
        };
        Some(if self.focused == PaneSide::Left {
            (active, other, self.focused)
        } else {
            (other, active, self.focused)
        })
    }
    pub(crate) fn open(&mut self, item: WorkspaceItem) -> Option<WorkspaceRoute> {
        if !self.items.contains(&item) {
            self.items.push(item.clone());
        }
        self.change_route(WorkspaceRoute::Content(item))
    }

    pub(crate) fn show(&mut self, page: WorkbenchPage) -> Option<WorkspaceRoute> {
        self.change_route(WorkspaceRoute::Page(page))
    }

    /// Selecting an absent item does not open it.
    pub(crate) fn select(&mut self, item: &WorkspaceItem) -> Option<WorkspaceRoute> {
        if !self.items.contains(item) {
            return None;
        }
        self.change_route(WorkspaceRoute::Content(item.clone()))
    }

    /// Corrects a source identity without activating the same object again.
    /// If both names were open, their earliest position is retained.
    pub(crate) fn replace_identity(&mut self, old: &WorkspaceItem, new: WorkspaceItem) -> bool {
        if old == &new || !self.items.contains(old) {
            return false;
        }
        let mut items = Vec::with_capacity(self.items.len());
        for item in &self.items {
            let item = if item == old { &new } else { item };
            if !items.contains(item) {
                items.push(item.clone());
            }
        }
        if self.current() == Some(old) {
            self.route = WorkspaceRoute::Content(new.clone());
        }
        let replace = |route: &mut WorkspaceRoute| {
            if let WorkspaceRoute::Content(item) = route {
                if item == old {
                    *item = new.clone();
                }
            }
        };
        if let Some(other) = &mut self.other {
            replace(other);
        }
        self.history.replace_identity(old, &new);
        if self.other.as_ref() == Some(&self.route) {
            self.other = None;
            self.focused = PaneSide::Left;
        }
        self.items = items;
        true
    }

    /// Uses the first surviving right neighbor, or the final left neighbor.
    /// With no remaining content, an App returns to its library.
    fn replacement_route(&self, removed: &WorkspaceItem, index: usize) -> WorkspaceRoute {
        self.items
            .get(index)
            .or_else(|| self.items.last())
            .cloned()
            .map(WorkspaceRoute::Content)
            .unwrap_or_else(|| {
                WorkspaceRoute::Page(if matches!(removed, WorkspaceItem::App { .. }) {
                    WorkbenchPage::Apps
                } else {
                    WorkbenchPage::Projects
                })
            })
    }

    pub(crate) fn close(&mut self, item: &WorkspaceItem) -> Option<WorkspaceRoute> {
        let index = self.items.iter().position(|open| open == item)?;
        self.items.remove(index);
        let route = if self.current() == Some(item) {
            let next = self
                .other
                .take()
                .unwrap_or_else(|| self.replacement_route(item, index));
            self.focused = PaneSide::Left;
            self.change_route(next)
        } else {
            None
        };
        self.prune_history();
        route
    }

    /// Removes unavailable sources without opening new ones. A utility page
    /// stays visible when only its background tabs are removed.
    pub(crate) fn reconcile(&mut self, available: &[WorkspaceItem]) -> Option<WorkspaceRoute> {
        let removed = self
            .current()
            .filter(|item| !available.contains(item))
            .map(|item| {
                let index = self
                    .items
                    .iter()
                    .take_while(|open| *open != item)
                    .filter(|open| available.contains(open))
                    .count();
                (item.clone(), index)
            });
        self.items.retain(|item| available.contains(item));
        let route=removed.and_then(|(item,index)| {
            let next=self.other.take().filter(|route|matches!(route,WorkspaceRoute::Content(item) if self.items.contains(item))).unwrap_or_else(||self.replacement_route(&item,index));
            self.focused=PaneSide::Left;self.change_route(next)
        });
        self.prune_history();
        route
    }

    pub(crate) fn select_next(&mut self) -> Option<WorkspaceRoute> {
        if self.items.is_empty() {
            return None;
        }
        let index = self
            .current()
            .and_then(|current| self.items.iter().position(|item| item == current))
            .map_or(0, |index| (index + 1) % self.items.len());
        let next = self.items[index].clone();
        self.select(&next)
    }

    pub(crate) fn select_previous(&mut self) -> Option<WorkspaceRoute> {
        let last = self.items.len().checked_sub(1)?;
        let index = self
            .current()
            .and_then(|current| self.items.iter().position(|item| item == current))
            .map_or(last, |index| if index == 0 { last } else { index - 1 });
        let previous = self.items[index].clone();
        self.select(&previous)
    }
}

#[cfg(test)]
mod tests {
    use super::ContentOrigin;
    use super::{WorkbenchPage, WorkspaceItem, WorkspaceNavigation, WorkspaceRoute};

    #[derive(Clone)]
    enum Action {
        Open(WorkspaceItem),
        Show(WorkbenchPage),
        Select(WorkspaceItem),
        Close(WorkspaceItem),
        ReplaceIdentity(WorkspaceItem, WorkspaceItem),
        Reconcile(Vec<WorkspaceItem>),
        Next,
        Previous,
        Back,
        Forward,
    }

    #[test]
    fn workspace_tab_transitions() {
        use Action::*;
        let conversation = WorkspaceItem::Conversation("conversation".into());
        let document = WorkspaceItem::Document {
            origin: ContentOrigin::Conversation {
                thread_id: "conversation".into(),
            },
            source: "output".into(),
        };
        let other_document = WorkspaceItem::Document {
            origin: ContentOrigin::Conversation {
                thread_id: "other".into(),
            },
            source: "output".into(),
        };
        let project = WorkspaceItem::Project("project".into());
        let task = WorkspaceItem::Task("project".into());
        let shared_project = WorkspaceItem::Project("shared:pero".into());
        let workspace_project = WorkspaceItem::Project("workspace:/work/pero".into());
        let app = WorkspaceItem::App {
            name: "paper-agent".into(),
            panel: "papers".into(),
        };
        let app_report = WorkspaceItem::App {
            name: "paper-agent".into(),
            panel: "report".into(),
        };

        struct Case {
            name: &'static str,
            actions: Vec<Action>,
            items: Vec<WorkspaceItem>,
            route: WorkspaceRoute,
        }

        let cases = [
            Case {
                name: "workspace history walks sources and utility pages without opening duplicates",
                actions: vec![
                    Open(document.clone()),
                    Open(app.clone()),
                    Back,
                    Forward,
                    Show(WorkbenchPage::Connections),
                    Back,
                ],
                items: vec![document.clone(), app.clone()],
                route: WorkspaceRoute::Content(app.clone()),
            },
            Case {
                name: "new navigation clears the forward branch and closed sources leave history",
                actions: vec![
                    Open(document.clone()),
                    Open(app.clone()),
                    Back,
                    Open(project.clone()),
                    Forward,
                    Close(document.clone()),
                    Back,
                ],
                items: vec![app.clone(), project.clone()],
                route: WorkspaceRoute::Page(WorkbenchPage::Projects),
            },
            Case {
                name: "Web sources retain one tab across utility pages and reopen",
                actions: vec![
                    Open(WorkspaceItem::Web("https://example.com/".into())),
                    Show(WorkbenchPage::Connections),
                    Open(WorkspaceItem::Web("https://example.com/".into())),
                ],
                items: vec![WorkspaceItem::Web("https://example.com/".into())],
                route: WorkspaceRoute::Content(WorkspaceItem::Web("https://example.com/".into())),
            },
            Case {
                name: "closing the selected Web source returns to its surviving document",
                actions: vec![
                    Open(document.clone()),
                    Open(WorkspaceItem::Web("https://example.com/".into())),
                    Close(WorkspaceItem::Web("https://example.com/".into())),
                ],
                items: vec![document.clone()],
                route: WorkspaceRoute::Content(document.clone()),
            },
            Case {
                name: "documents with equal source ids remain distinct across authority namespaces",
                actions: vec![
                    Open(document.clone()),
                    Open(WorkspaceItem::Document {
                        origin: ContentOrigin::File {
                            path: "/work/output".into(),
                        },
                        source: "output".into(),
                    }),
                ],
                items: vec![
                    document.clone(),
                    WorkspaceItem::Document {
                        origin: ContentOrigin::File {
                            path: "/work/output".into(),
                        },
                        source: "output".into(),
                    },
                ],
                route: WorkspaceRoute::Content(WorkspaceItem::Document {
                    origin: ContentOrigin::File {
                        path: "/work/output".into(),
                    },
                    source: "output".into(),
                }),
            },
            Case {
                name: "document identity includes its source owner and deduplicates reopen",
                actions: vec![
                    Open(document.clone()),
                    Open(other_document.clone()),
                    Open(document.clone()),
                ],
                items: vec![document.clone(), other_document.clone()],
                route: WorkspaceRoute::Content(document.clone()),
            },
            Case {
                name: "closing a document selects its retained conversation",
                actions: vec![
                    Open(conversation.clone()),
                    Open(document.clone()),
                    Close(document.clone()),
                ],
                items: vec![conversation.clone()],
                route: WorkspaceRoute::Content(conversation.clone()),
            },
            Case {
                name: "missing selection and empty navigation do not open tabs",
                actions: vec![
                    Select(project.clone()),
                    Close(project.clone()),
                    Next,
                    Previous,
                ],
                items: vec![],
                route: WorkspaceRoute::Page(WorkbenchPage::Projects),
            },
            Case {
                name: "opening an existing item selects it without duplication",
                actions: vec![
                    Open(conversation.clone()),
                    Open(project.clone()),
                    Open(conversation.clone()),
                ],
                items: vec![conversation.clone(), project.clone()],
                route: WorkspaceRoute::Content(conversation.clone()),
            },
            Case {
                name: "selecting an existing item retains open order",
                actions: vec![
                    Open(conversation.clone()),
                    Open(project.clone()),
                    Select(conversation.clone()),
                    Select(app.clone()),
                ],
                items: vec![conversation.clone(), project.clone()],
                route: WorkspaceRoute::Content(conversation.clone()),
            },
            Case {
                name: "closing an earlier inactive tab retains the active identity",
                actions: vec![
                    Open(conversation.clone()),
                    Open(project.clone()),
                    Close(conversation.clone()),
                ],
                items: vec![project.clone()],
                route: WorkspaceRoute::Content(project.clone()),
            },
            Case {
                name: "closing a later inactive tab retains the active identity",
                actions: vec![
                    Open(conversation.clone()),
                    Open(project.clone()),
                    Select(conversation.clone()),
                    Close(project.clone()),
                ],
                items: vec![conversation.clone()],
                route: WorkspaceRoute::Content(conversation.clone()),
            },
            Case {
                name: "closing the selected middle tab selects its right neighbor",
                actions: vec![
                    Open(conversation.clone()),
                    Open(project.clone()),
                    Open(app.clone()),
                    Select(project.clone()),
                    Close(project.clone()),
                ],
                items: vec![conversation.clone(), app.clone()],
                route: WorkspaceRoute::Content(app.clone()),
            },
            Case {
                name: "closing the selected last tab selects its left neighbor",
                actions: vec![
                    Open(conversation.clone()),
                    Open(project.clone()),
                    Close(project.clone()),
                ],
                items: vec![conversation.clone()],
                route: WorkspaceRoute::Content(conversation.clone()),
            },
            Case {
                name: "closing the last open tab clears selection",
                actions: vec![Open(conversation.clone()), Close(conversation.clone())],
                items: vec![],
                route: WorkspaceRoute::Page(WorkbenchPage::Projects),
            },
            Case {
                name: "closing the last app returns to its library",
                actions: vec![Open(app.clone()), Close(app.clone())],
                items: vec![],
                route: WorkspaceRoute::Page(WorkbenchPage::Apps),
            },
            Case {
                name: "app panels have independent persistent identities",
                actions: vec![
                    Open(app.clone()),
                    Open(app_report.clone()),
                    Open(app.clone()),
                ],
                items: vec![app.clone(), app_report.clone()],
                route: WorkspaceRoute::Content(app.clone()),
            },
            Case {
                name: "a task and project with the same source id open separately",
                actions: vec![
                    Open(project.clone()),
                    Open(task.clone()),
                    Open(project.clone()),
                ],
                items: vec![project.clone(), task.clone()],
                route: WorkspaceRoute::Content(project.clone()),
            },
            Case {
                name: "correcting the current project identity keeps its content selected",
                actions: vec![
                    Open(shared_project.clone()),
                    ReplaceIdentity(shared_project.clone(), workspace_project.clone()),
                ],
                items: vec![workspace_project.clone()],
                route: WorkspaceRoute::Content(workspace_project.clone()),
            },
            Case {
                name: "correcting a background identity retains the current conversation",
                actions: vec![
                    Open(shared_project.clone()),
                    Open(conversation.clone()),
                    ReplaceIdentity(shared_project.clone(), workspace_project.clone()),
                ],
                items: vec![workspace_project.clone(), conversation.clone()],
                route: WorkspaceRoute::Content(conversation.clone()),
            },
            Case {
                name: "merged identities retain their earliest position and canonical selection",
                actions: vec![
                    Open(shared_project.clone()),
                    Open(conversation.clone()),
                    Open(workspace_project.clone()),
                    ReplaceIdentity(shared_project.clone(), workspace_project.clone()),
                ],
                items: vec![workspace_project.clone(), conversation.clone()],
                route: WorkspaceRoute::Content(workspace_project.clone()),
            },
            Case {
                name: "merging the selected alias into an earlier canonical tab retains order",
                actions: vec![
                    Open(workspace_project.clone()),
                    Open(conversation.clone()),
                    Open(shared_project.clone()),
                    ReplaceIdentity(shared_project.clone(), workspace_project.clone()),
                ],
                items: vec![workspace_project.clone(), conversation.clone()],
                route: WorkspaceRoute::Content(workspace_project.clone()),
            },
            Case {
                name: "correcting background identities leaves a utility page visible",
                actions: vec![
                    Open(shared_project.clone()),
                    Show(WorkbenchPage::Connections),
                    ReplaceIdentity(shared_project.clone(), workspace_project.clone()),
                ],
                items: vec![workspace_project.clone()],
                route: WorkspaceRoute::Page(WorkbenchPage::Connections),
            },
            Case {
                name: "reconciliation removes deleted objects and selects a surviving neighbor",
                actions: vec![
                    Open(conversation.clone()),
                    Open(project.clone()),
                    Open(app.clone()),
                    Select(project.clone()),
                    Reconcile(vec![app.clone(), conversation.clone(), app_report.clone()]),
                ],
                items: vec![conversation.clone(), app.clone()],
                route: WorkspaceRoute::Content(app.clone()),
            },
            Case {
                name: "uninstalled apps close all their panels without changing a surviving selection",
                actions: vec![
                    Open(app.clone()),
                    Open(app_report.clone()),
                    Open(conversation.clone()),
                    Reconcile(vec![conversation.clone()]),
                ],
                items: vec![conversation.clone()],
                route: WorkspaceRoute::Content(conversation.clone()),
            },
            Case {
                name: "reconciliation can remove every source object",
                actions: vec![
                    Open(conversation.clone()),
                    Open(project.clone()),
                    Reconcile(vec![]),
                ],
                items: vec![],
                route: WorkspaceRoute::Page(WorkbenchPage::Projects),
            },
            Case {
                name: "removing all sources returns the current app to its library",
                actions: vec![
                    Open(app.clone()),
                    Open(conversation.clone()),
                    Select(app.clone()),
                    Reconcile(vec![]),
                ],
                items: vec![],
                route: WorkspaceRoute::Page(WorkbenchPage::Apps),
            },
            Case {
                name: "removing current and right sources selects the surviving left neighbor",
                actions: vec![
                    Open(conversation.clone()),
                    Open(project.clone()),
                    Open(app.clone()),
                    Select(project.clone()),
                    Reconcile(vec![conversation.clone()]),
                ],
                items: vec![conversation.clone()],
                route: WorkspaceRoute::Content(conversation.clone()),
            },
            Case {
                name: "opening the same content twice keeps one tab and one route",
                actions: vec![Open(conversation.clone()), Open(conversation.clone())],
                items: vec![conversation.clone()],
                route: WorkspaceRoute::Content(conversation.clone()),
            },
            Case {
                name: "a utility page keeps the open content in the background",
                actions: vec![
                    Open(conversation.clone()),
                    Open(app.clone()),
                    Show(WorkbenchPage::Connections),
                    Show(WorkbenchPage::Connections),
                    Select(project.clone()),
                ],
                items: vec![conversation.clone(), app.clone()],
                route: WorkspaceRoute::Page(WorkbenchPage::Connections),
            },
            Case {
                name: "closing a background app does not leave the utility page",
                actions: vec![
                    Open(app.clone()),
                    Show(WorkbenchPage::Connections),
                    Close(app.clone()),
                ],
                items: vec![],
                route: WorkspaceRoute::Page(WorkbenchPage::Connections),
            },
            Case {
                name: "reconciliation on a utility page cleans tabs without navigation",
                actions: vec![
                    Open(conversation.clone()),
                    Open(app.clone()),
                    Show(WorkbenchPage::Workers),
                    Reconcile(vec![]),
                ],
                items: vec![],
                route: WorkspaceRoute::Page(WorkbenchPage::Workers),
            },
            Case {
                name: "a utility page cycles forward into the first open item",
                actions: vec![
                    Open(conversation.clone()),
                    Open(app.clone()),
                    Show(WorkbenchPage::Insights),
                    Next,
                ],
                items: vec![conversation.clone(), app.clone()],
                route: WorkspaceRoute::Content(conversation.clone()),
            },
            Case {
                name: "a utility page cycles backward into the last open item",
                actions: vec![
                    Open(conversation.clone()),
                    Open(app.clone()),
                    Show(WorkbenchPage::Insights),
                    Previous,
                ],
                items: vec![conversation.clone(), app.clone()],
                route: WorkspaceRoute::Content(app.clone()),
            },
            Case {
                name: "next wraps from the last tab to the first",
                actions: vec![Open(conversation.clone()), Open(project.clone()), Next],
                items: vec![conversation.clone(), project.clone()],
                route: WorkspaceRoute::Content(conversation.clone()),
            },
            Case {
                name: "previous wraps from the first tab to the last",
                actions: vec![
                    Open(conversation.clone()),
                    Open(project.clone()),
                    Select(conversation.clone()),
                    Previous,
                ],
                items: vec![conversation.clone(), project.clone()],
                route: WorkspaceRoute::Content(project.clone()),
            },
            Case {
                name: "cycling a single tab retains its selection",
                actions: vec![Open(conversation.clone()), Next, Previous],
                items: vec![conversation.clone()],
                route: WorkspaceRoute::Content(conversation.clone()),
            },
        ];

        for case in cases {
            let mut tabs = WorkspaceNavigation::default();
            for action in case.actions {
                let before = tabs.route().clone();
                let identity_correction = matches!(&action, ReplaceIdentity(..));
                let activation = match action {
                    Open(item) => tabs.open(item),
                    Show(page) => tabs.show(page),
                    Select(item) => tabs.select(&item),
                    Close(item) => tabs.close(&item),
                    ReplaceIdentity(old, new) => {
                        tabs.replace_identity(&old, new);
                        None
                    }
                    Reconcile(available) => tabs.reconcile(&available),
                    Next => tabs.select_next(),
                    Previous => tabs.select_previous(),
                    Back => tabs.step_history(false).map(|entry| entry.route),
                    Forward => tabs.step_history(true).map(|entry| entry.route),
                };
                assert_eq!(
                    activation,
                    (!identity_correction && tabs.route() != &before).then(|| tabs.route().clone()),
                    "{}: navigation activates changed routes; identity corrections do not reopen content",
                    case.name,
                );
            }
            assert_eq!(tabs.items(), case.items, "{}", case.name);
            assert_eq!(tabs.route(), &case.route, "{}", case.name);
        }
    }
    #[test]
    fn document_panes_share_navigation_and_restore_focus_without_duplicate_views() {
        let document = |path: &str| WorkspaceItem::Document {
            origin: ContentOrigin::File { path: path.into() },
            source: path.into(),
        };
        let left = document("/left.md");
        let right = document("/right.md");
        for (focus_right, close_left, expected) in [
            (false, false, left.clone()),
            (false, true, right.clone()),
            (true, false, left.clone()),
            (true, true, right.clone()),
        ] {
            let mut navigation = WorkspaceNavigation::default();
            navigation.open(left.clone());
            navigation.open(right.clone());
            navigation.select(&left);
            assert!(navigation.split_document(&right));
            assert!(!navigation.split_document(&left));
            if focus_right {
                navigation.select(&right);
            }
            let snapshot = navigation.snapshot();
            assert!(snapshot.valid());
            let mut restored = WorkspaceNavigation::default();
            restored.restore(snapshot);
            assert_eq!(
                restored.panes(),
                Some((
                    &left,
                    &right,
                    if focus_right {
                        super::PaneSide::Right
                    } else {
                        super::PaneSide::Left
                    }
                ))
            );
            restored.close(if close_left { &left } else { &right });
            assert_eq!(restored.current(), Some(&expected));
            assert!(restored.panes().is_none());
            assert!(restored.snapshot().valid());
        }
        let mut navigation = WorkspaceNavigation::default();
        navigation.open(left.clone());
        navigation.open(right.clone());
        navigation.select(&left);
        navigation.split_document(&right);
        navigation.select(&right);
        navigation.step_history(false);
        assert_eq!(navigation.current(), Some(&left));
        assert_eq!(navigation.panes().unwrap().2, super::PaneSide::Left);
        navigation.select(&right);
        assert!(navigation.collapse_panes().is_some());
        assert_eq!(navigation.current(), Some(&left));
        assert!(navigation.panes().is_none());
    }
}
