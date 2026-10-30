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
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkspaceSnapshot {
    pub items: Vec<WorkspaceItem>,
    pub route: WorkspaceRoute,
    #[serde(default)]
    pub other: Option<WorkspaceRoute>,
    #[serde(default)]
    pub focused: PaneSide,
    #[serde(default)]
    pub panes: Option<crate::workspace_panes::PaneLayout>,
    #[serde(flatten)]
    pub history: WorkspaceHistory,
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
                    && panes.leaves().iter().all(|view| admitted(&view.route))
                    && (!matches!(
                        self.route,
                        WorkspaceRoute::Content(WorkspaceItem::Document { .. })
                    ) || panes
                        .focused
                        .and_then(|id| panes.leaf(id))
                        .is_some_and(|view| view.route == self.route))
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
                self.navigation.items.contains(&doc.item())
                    && !self.documents[..i]
                        .iter()
                        .any(|other| other.item() == doc.item())
                    && match &doc.header.source.origin {
                        ContentOrigin::File { path } => path == &doc.header.source.id,
                        _ => doc.draft.is_none(),
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
