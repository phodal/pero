//! Recoverable workspace values. Restoring a view does not execute its producer.
use crate::{
    content_document::DocumentHeader, content_origin::ContentOrigin, reader_state::ReaderState,
    web_document::WebAddress,
};
use serde::{Deserialize, Serialize};
#[path = "workspace_history.rs"]
mod history;
pub use history::{HistoryEntry, WorkspaceHistory};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum WorkspaceItem {
    Conversation(String),
    Web(String),
    Document {
        origin: ContentOrigin,
        source: String,
    },
    Project(String),
    Task(String),
    App {
        name: String,
        panel: String,
    },
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkbenchPage {
    Conversation,
    Document,
    Web,
    #[default]
    Projects,
    Agents,
    Tasks,
    Workers,
    Apps,
    Insights,
    Connections,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum WorkspaceRoute {
    Page(WorkbenchPage),
    Content(WorkspaceItem),
}
impl WorkspaceRoute {
    pub fn page(&self) -> WorkbenchPage {
        match self {
            Self::Page(page) => *page,
            Self::Content(item) => match item {
                WorkspaceItem::Conversation(_) => WorkbenchPage::Conversation,
                WorkspaceItem::Document { .. } => WorkbenchPage::Document,
                WorkspaceItem::Web(_) => WorkbenchPage::Web,
                WorkspaceItem::Project(_) | WorkspaceItem::Task(_) => WorkbenchPage::Tasks,
                WorkspaceItem::App { .. } => WorkbenchPage::Apps,
            },
        }
    }
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaneSide {
    #[default]
    Left,
    Right,
}
#[derive(Clone, Debug, PartialEq)]
pub struct WorkspaceSnapshot {
    pub items: Vec<WorkspaceItem>,
    pub route: WorkspaceRoute,
    pub other: Option<WorkspaceRoute>,
    pub focused: PaneSide,
    pub panes: Option<crate::workspace_panes::PaneLayout>,
    pub history: WorkspaceHistory,
}
impl Serialize for WorkspaceSnapshot {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        #[derive(Serialize)]
        struct Current<'a> {
            items: &'a [WorkspaceItem],
            route: &'a WorkspaceRoute,
            other: &'a Option<WorkspaceRoute>,
            focused: PaneSide,
            panes: &'a crate::workspace_panes::PaneLayout,
            #[serde(flatten)]
            history: &'a WorkspaceHistory,
        }
        // Even an empty current layout carries its view counter. Only old flat
        // snapshots need their source registry interpreted as open tabs.
        let empty = crate::workspace_panes::PaneLayout::default();
        Current {
            items: &self.items,
            route: &self.route,
            other: &self.other,
            focused: self.focused,
            panes: self.panes.as_ref().unwrap_or(&empty),
            history: &self.history,
        }
        .serialize(serializer)
    }
}
impl<'de> Deserialize<'de> for WorkspaceSnapshot {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        use crate::{
            pane_tabs::{OpenIntent, PaneTabSet},
            workspace_panes::{PaneLayout, SplitDirection},
        };
        struct SavedPanes {
            layout: PaneLayout,
            legacy: bool,
        }
        impl<'de> Deserialize<'de> for SavedPanes {
            fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                PaneLayout::deserialize_snapshot(deserializer)
                    .map(|(layout, legacy)| Self { layout, legacy })
            }
        }
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Saved {
            items: Vec<WorkspaceItem>,
            route: WorkspaceRoute,
            #[serde(default)]
            other: Option<WorkspaceRoute>,
            #[serde(default)]
            focused: PaneSide,
            #[serde(default)]
            panes: Option<SavedPanes>,
            #[serde(flatten)]
            history: WorkspaceHistory,
        }
        let saved = Saved::deserialize(deserializer)?;
        let legacy = saved.panes.as_ref().is_none_or(|panes| panes.legacy);
        let mut panes = saved.panes.map(|panes| panes.layout);
        if legacy {
            if panes.is_none() {
                let current = saved
                    .route
                    .supports_pane()
                    .then(|| saved.route.clone())
                    .or_else(|| {
                        saved
                            .items
                            .iter()
                            .map(|item| WorkspaceRoute::Content(item.clone()))
                            .find(WorkspaceRoute::supports_pane)
                    });
                if let Some(route) = current {
                    let reading = (route == saved.route)
                        .then(|| saved.history.reading.clone())
                        .flatten();
                    let mut layout = PaneLayout::new(route, reading);
                    if let (Some(first), Some(other)) = (layout.focused, saved.other.clone()) {
                        let direction = if saved.focused == PaneSide::Left {
                            SplitDirection::Right
                        } else {
                            SplitDirection::Left
                        };
                        layout.split(first, direction, other, None);
                        layout.focus(first);
                    }
                    panes = Some(layout);
                }
            }
            if let Some(layout) = &mut panes {
                if let Some(focused) = layout.focused {
                    let previous = layout
                        .leaf(focused)
                        .map(|pane| pane.tabs.clone())
                        .unwrap_or_default();
                    let others: Vec<_> = layout
                        .leaves()
                        .iter()
                        .filter(|pane| pane.id != focused)
                        .flat_map(|pane| pane.tabs.items().iter().map(|item| item.route.clone()))
                        .collect();
                    let mut tabs = PaneTabSet::default();
                    for item in &saved.items {
                        let route = WorkspaceRoute::Content(item.clone());
                        if !route.supports_pane()
                            || (previous.find_route(&route).is_none()
                                && others.iter().any(|other| route.shares_pane_instance(other)))
                        {
                            continue;
                        }
                        // A singleton retained surface stays with its active instance.
                        if !route.can_clone_pane()
                            && previous.active().is_some_and(|active| {
                                active.route != route && active.route.shares_pane_instance(&route)
                            })
                        {
                            continue;
                        }
                        let view = previous.find_route(&route).cloned().unwrap_or_else(|| {
                            crate::pane_tabs::PaneItem {
                                id: layout.allocate_view_id(),
                                kind: Default::default(),
                                route,
                                reading: None,
                            }
                        });
                        tabs.open(view, OpenIntent::Permanent)
                            .map_err(serde::de::Error::custom)?;
                    }
                    if let Some(active) = previous.active() {
                        let opened = tabs
                            .open(active.clone(), OpenIntent::Permanent)
                            .map_err(serde::de::Error::custom)?;
                        tabs.activate(opened.active);
                    }
                    tabs.restore_legacy_history(saved.history.clone());
                    if let Some(pane) = layout.leaf_mut(focused) {
                        pane.tabs = tabs;
                    }
                }
            }
        }
        Ok(Self {
            items: saved.items,
            route: saved.route,
            other: saved.other,
            focused: saved.focused,
            panes: panes.filter(|layout| layout.root.is_some()),
            history: saved.history,
        })
    }
}
impl Default for WorkspaceSnapshot {
    fn default() -> Self {
        Self {
            items: vec![],
            route: WorkspaceRoute::Page(WorkbenchPage::Projects),
            other: None,
            focused: PaneSide::Left,
            panes: None,
            history: WorkspaceHistory::default(),
        }
    }
}
impl WorkspaceSnapshot {
    pub fn valid(&self) -> bool {
        let admitted = |route: &WorkspaceRoute| match route {
            WorkspaceRoute::Page(_) => true,
            WorkspaceRoute::Content(item) => self.items.contains(item),
        };
        self.items
            .iter()
            .enumerate()
            .all(|(i, item)| !self.items[..i].contains(item))
            && self.panes.as_ref().is_none_or(|panes| {
                panes.valid()
                    && panes.items().iter().all(|item| admitted(&item.route))
                    && panes.leaves().iter().all(|pane| {
                        pane.tabs
                            .history()
                            .back
                            .iter()
                            .chain(&pane.tabs.history().forward)
                            .chain(pane.tabs.closed_items())
                            .all(|entry| admitted(&entry.route))
                    })
                    && (!matches!(
                        self.route,
                        WorkspaceRoute::Content(WorkspaceItem::Document { .. })
                    ) || panes
                        .focused
                        .and_then(|id| panes.leaf(id))
                        .is_some_and(|view| view.route() == Some(&self.route)))
            })
            && admitted(&self.route)
            && self.other.as_ref().is_none_or(|other| {
                admitted(other)
                    && matches!(
                        other,
                        WorkspaceRoute::Content(WorkspaceItem::Document { .. })
                    )
                    && matches!(
                        self.route,
                        WorkspaceRoute::Content(WorkspaceItem::Document { .. })
                    )
                    && other != &self.route
            })
            && (self.other.is_some() || self.focused == PaneSide::Left)
            && (self.history.reading.is_none()
                || matches!(
                    self.route,
                    WorkspaceRoute::Content(WorkspaceItem::Document { .. })
                ))
            && self
                .history
                .back
                .iter()
                .chain(&self.history.forward)
                .all(|entry| admitted(&entry.route) && entry.valid())
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceKey {
    pub origin: ContentOrigin,
    pub source: String,
    pub revision: u64,
}
impl SourceKey {
    pub fn of(header: &DocumentHeader) -> Self {
        Self {
            origin: header.source.origin.clone(),
            source: header.source.id.clone(),
            revision: header.revision,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SavedDocument {
    pub header: DocumentHeader,
    pub reading: ReaderState,
    #[serde(default)]
    pub draft: Option<String>,
    #[serde(default)]
    pub draft_ref: Option<crate::workspace_draft::DraftRef>,
    #[serde(default)]
    pub legacy_draft: bool,
}
impl SavedDocument {
    pub fn item(&self) -> WorkspaceItem {
        WorkspaceItem::Document {
            origin: self.header.source.origin.clone(),
            source: self.header.source.id.clone(),
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SavedWeb {
    pub id: String,
    pub url: crate::web_document::WebLocation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub html: Option<crate::web_document::InlineHtml>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkspaceSession {
    pub version: u8,
    pub workspace: String,
    pub navigation: WorkspaceSnapshot,
    pub documents: Vec<SavedDocument>,
    pub web: Vec<SavedWeb>,
}
impl WorkspaceSession {
    pub fn valid(&self) -> bool {
        self.version == 1
            && self.navigation.valid()
            && self.navigation.items.iter().all(|item| match item {
                WorkspaceItem::Document { .. } => self
                    .documents
                    .iter()
                    .any(|document| &document.item() == item),
                WorkspaceItem::Web(id) => self.web.iter().any(|web| web.id.as_str() == id),
                _ => true,
            })
            && self.documents.iter().enumerate().all(|(i, doc)| {
                doc.draft_ref.as_ref().is_none_or(|draft| {
                    draft.version > 0 && draft.source == SourceKey::of(&doc.header)
                }) && self.navigation.items.contains(&doc.item())
                    && !self.documents[..i]
                        .iter()
                        .any(|other| other.item() == doc.item())
                    && match &doc.header.source.origin {
                        ContentOrigin::File { path } => path == &doc.header.source.id,
                        _ => doc.draft.is_none() && doc.draft_ref.is_none() && !doc.legacy_draft,
                    }
            })
            && self.web.iter().enumerate().all(|(i, page)| {
                (if let Some(html) = &page.html {
                    !html.id.is_empty() && page.id == format!("html:{}", html.id)
                } else {
                    WebAddress::try_from(page.id.clone()).is_ok()
                }) && self
                    .navigation
                    .items
                    .contains(&WorkspaceItem::Web(page.id.clone()))
                    && !self.web[..i].iter().any(|other| other.id == page.id)
            })
    }
    pub fn accepts_sources(&self, sources: &[WorkspaceSource]) -> bool {
        sources.iter().enumerate().all(|(i, source)| {
            let key = SourceKey::of(&source.header);
            self.documents
                .iter()
                .any(|document| SourceKey::of(&document.header) == key)
                && !sources[..i]
                    .iter()
                    .any(|source| SourceKey::of(&source.header) == key)
        })
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkspaceSource {
    pub header: DocumentHeader,
    pub text: String,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkspaceRestore {
    pub session: Option<WorkspaceSession>,
    pub sources: Vec<WorkspaceSource>,
    pub conflicts: Vec<String>,
    #[serde(default)]
    pub unavailable: Vec<SourceKey>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecoveredSource {
    pub source: WorkspaceSource,
    pub conflict: bool,
    #[serde(default)]
    pub draft: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceMethod {
    Workspace,
}
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum WorkspaceCommand {
    Get {
        method: WorkspaceMethod,
    },
    SourceBegin {
        method: WorkspaceMethod,
        request_id: String,
        header: DocumentHeader,
        total_bytes: u64,
    },
    SourceChunk {
        method: WorkspaceMethod,
        request_id: String,
        chunk: crate::workspace_source::SourceChunk,
    },
    StoreDraft {
        method: WorkspaceMethod,
        request_id: String,
        base: Option<crate::workspace_draft::DraftRef>,
        draft: crate::workspace_draft::DraftRef,
        edits: Vec<crate::workspace_draft::DraftEdit>,
    },
    Read {
        method: WorkspaceMethod,
        request_id: String,
        key: SourceKey,
    },
    Reset {
        method: WorkspaceMethod,
        request_id: String,
    },
    Save {
        method: WorkspaceMethod,
        request_id: String,
        #[serde(default)]
        refresh: Vec<SourceKey>,
        session: WorkspaceSession,
        sources: Vec<WorkspaceSource>,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_tabs_migrate_once_without_reopening_current_history_only_sources() {
        let item = |path: &str| WorkspaceItem::Document {
            origin: ContentOrigin::File { path: path.into() },
            source: path.into(),
        };
        let (a, b, c) = (item("/a"), item("/b"), item("/c"));
        let route = WorkspaceRoute::Content(a.clone());
        let reading = ReaderState {
            source: true,
            selection: 5..8,
            ..Default::default()
        };
        for (format, expected) in [
            ("flat", vec![a.clone(), b.clone(), c.clone()]),
            ("one-pane", vec![a.clone(), b.clone(), c.clone()]),
            ("two-pane", vec![a.clone(), c.clone()]),
            ("current", vec![a.clone()]),
        ] {
            let mut saved = serde_json::json!({"items":[a,b,c],"route":route,"other":null,"focused":"left",
                "reading":reading,"back":[],"forward":[]});
            let leaf = |id, route| serde_json::json!({"kind":"leaf","view":{"id":id,"route":route,"reading":reading}});
            match format {
                "flat" => {}
                "one-pane" => {
                    saved["panes"] =
                        serde_json::json!({"root":leaf(1, route.clone()),"focused":1,"next_id":2})
                }
                "two-pane" => {
                    saved["panes"] = serde_json::json!({"root":{"kind":"split","id":2,"axis":"horizontal","ratio":0.5,
                    "first":leaf(1,route.clone()),"second":leaf(3,WorkspaceRoute::Content(b.clone()))},"focused":1,"next_id":4})
                }
                "current" => {
                    saved["panes"] = serde_json::to_value(crate::workspace_panes::PaneLayout::new(
                        route.clone(),
                        Some(reading.clone()),
                    ))
                    .unwrap()
                }
                _ => unreachable!(),
            }
            let restored: WorkspaceSnapshot = serde_json::from_value(saved).unwrap();
            assert!(restored.valid(), "{format}");
            let layout = restored.panes.as_ref().unwrap();
            let pane = layout.leaf(layout.focused.unwrap()).unwrap();
            let items: Vec<_> = pane
                .tabs
                .items()
                .iter()
                .filter_map(|view| match &view.route {
                    WorkspaceRoute::Content(item) => Some(item.clone()),
                    _ => None,
                })
                .collect();
            assert_eq!(items, expected, "{format}");
            assert_eq!(pane.route(), Some(&route));
            assert_eq!(pane.reading(), Some(&reading));
            assert_eq!(
                serde_json::from_value::<WorkspaceSnapshot>(
                    serde_json::to_value(&restored).unwrap()
                )
                .unwrap(),
                restored
            );
        }
    }
    #[test]
    fn saved_navigation_rejects_dangling_sources_and_invalid_panes() {
        let item = WorkspaceItem::Document {
            origin: ContentOrigin::File { path: "/a".into() },
            source: "/a".into(),
        };
        for (items, route, other, focused, back, expected) in [
            (
                vec![item.clone()],
                WorkspaceRoute::Content(item.clone()),
                None,
                PaneSide::Left,
                vec![],
                true,
            ),
            (
                vec![item.clone(), item.clone()],
                WorkspaceRoute::Content(item.clone()),
                None,
                PaneSide::Left,
                vec![],
                false,
            ),
            (
                vec![],
                WorkspaceRoute::Content(item.clone()),
                None,
                PaneSide::Left,
                vec![],
                false,
            ),
            (
                vec![item.clone()],
                WorkspaceRoute::Content(item.clone()),
                Some(WorkspaceRoute::Content(item.clone())),
                PaneSide::Left,
                vec![],
                false,
            ),
            (
                vec![item.clone()],
                WorkspaceRoute::Content(item.clone()),
                None,
                PaneSide::Right,
                vec![],
                false,
            ),
            (
                vec![],
                WorkspaceRoute::Page(WorkbenchPage::Projects),
                None,
                PaneSide::Left,
                vec![WorkspaceRoute::Content(item.clone())],
                false,
            ),
        ] {
            assert_eq!(
                WorkspaceSnapshot {
                    items,
                    route,
                    other,
                    focused,
                    panes: None,
                    history: WorkspaceHistory {
                        back: back
                            .into_iter()
                            .map(|route| HistoryEntry {
                                route,
                                view_kind: Default::default(),
                                preview: false,
                                reading: None
                            })
                            .collect(),
                        ..Default::default()
                    },
                }
                .valid(),
                expected
            );
        }
    }
}
