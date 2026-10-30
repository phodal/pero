//! A pane is a view identity; source identity and navigation remain separate.
use crate::{
    pane_tabs::{OpenIntent, OpenTab, PaneItem, PaneTabSet, ViewId},
    reader_state::ReaderState,
    workspace_session::{WorkspaceItem, WorkspaceRoute},
};
use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PaneId(pub u64);
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SplitDirection {
    Left,
    Right,
    Up,
    Down,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaneAxis {
    Horizontal,
    Vertical,
}
impl SplitDirection {
    pub fn axis(self) -> PaneAxis {
        match self {
            Self::Left | Self::Right => PaneAxis::Horizontal,
            Self::Up | Self::Down => PaneAxis::Vertical,
        }
    }
    pub fn before(self) -> bool {
        matches!(self, Self::Left | Self::Up)
    }
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PaneLeaf {
    pub id: PaneId,
    pub tabs: PaneTabSet,
}
impl PaneLeaf {
    pub fn active(&self) -> Option<&PaneItem> {
        self.tabs.active()
    }
    pub fn route(&self) -> Option<&WorkspaceRoute> {
        self.active().map(|item| &item.route)
    }
    pub fn reading(&self) -> Option<&ReaderState> {
        self.active().and_then(|item| item.reading.as_ref())
    }
}
impl<'de> Deserialize<'de> for PaneLeaf {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Current {
            id: PaneId,
            tabs: PaneTabSet,
        }
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Legacy {
            id: PaneId,
            route: WorkspaceRoute,
            #[serde(default)]
            reading: Option<ReaderState>,
        }
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Saved {
            Current(Current),
            Legacy(Legacy),
        }
        Ok(match Saved::deserialize(deserializer)? {
            Saved::Current(saved) => Self {
                id: saved.id,
                tabs: saved.tabs,
            },
            Saved::Legacy(saved) => {
                let mut tabs = PaneTabSet::default();
                tabs.open(
                    PaneItem {
                        id: ViewId(saved.id.0),
                        route: saved.route,
                        reading: saved.reading,
                    },
                    OpenIntent::Permanent,
                )
                .map_err(|error| serde::de::Error::custom(format!("{error:?}")))?;
                Self { id: saved.id, tabs }
            }
        })
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum PaneNode {
    Leaf {
        view: PaneLeaf,
    },
    Split {
        id: u64,
        axis: PaneAxis,
        ratio: f32,
        first: Box<PaneNode>,
        second: Box<PaneNode>,
    },
}
impl PaneNode {
    fn leaves<'a>(&'a self, output: &mut Vec<&'a PaneLeaf>) {
        match self {
            Self::Leaf { view } => output.push(view),
            Self::Split { first, second, .. } => {
                first.leaves(output);
                second.leaves(output);
            }
        }
    }
    fn leaf_mut(&mut self, id: PaneId) -> Option<&mut PaneLeaf> {
        match self {
            Self::Leaf { view } => (&view.id == &id).then_some(view),
            Self::Split { first, second, .. } => first.leaf_mut(id).or_else(|| second.leaf_mut(id)),
        }
    }
    fn insert(
        &mut self,
        target: PaneId,
        view: PaneLeaf,
        split: u64,
        direction: SplitDirection,
    ) -> bool {
        match self {
            Self::Leaf { view: previous } if previous.id == target => {
                let original = Self::Leaf {
                    view: previous.clone(),
                };
                let added = Self::Leaf { view };
                let (first, second) = if direction.before() {
                    (added, original)
                } else {
                    (original, added)
                };
                *self = Self::Split {
                    id: split,
                    axis: direction.axis(),
                    ratio: 0.5,
                    first: Box::new(first),
                    second: Box::new(second),
                };
                true
            }
            Self::Split { first, second, .. } => {
                first.insert(target, view.clone(), split, direction)
                    || second.insert(target, view, split, direction)
            }
            _ => false,
        }
    }
    fn remove(self, id: PaneId) -> (Option<Self>, Option<PaneLeaf>) {
        match self {
            Self::Leaf { view } if view.id == id => (None, Some(view)),
            Self::Leaf { .. } => (Some(self), None),
            Self::Split {
                id: split,
                axis,
                ratio,
                first,
                second,
            } => {
                let (first, removed) = first.remove(id);
                if let Some(removed) = removed {
                    return (
                        Some(if let Some(first) = first {
                            Self::Split {
                                id: split,
                                axis,
                                ratio,
                                first: Box::new(first),
                                second,
                            }
                        } else {
                            *second
                        }),
                        Some(removed),
                    );
                }
                let (second, removed) = second.remove(id);
                (
                    Some(if let Some(second) = second {
                        Self::Split {
                            id: split,
                            axis,
                            ratio,
                            first: Box::new(first.expect("unmodified subtree")),
                            second: Box::new(second),
                        }
                    } else {
                        first.expect("unmodified subtree")
                    }),
                    removed,
                )
            }
        }
    }
    fn geometry(&self, bounds: PaneBounds, output: &mut Vec<(PaneId, PaneBounds)>) {
        match self {
            Self::Leaf { view } => output.push((view.id, bounds)),
            Self::Split {
                axis,
                ratio,
                first,
                second,
                ..
            } => {
                let (a, b) = match axis {
                    PaneAxis::Horizontal => (
                        PaneBounds {
                            width: bounds.width * ratio,
                            ..bounds
                        },
                        PaneBounds {
                            x: bounds.x + bounds.width * ratio,
                            width: bounds.width * (1. - ratio),
                            ..bounds
                        },
                    ),
                    PaneAxis::Vertical => (
                        PaneBounds {
                            height: bounds.height * ratio,
                            ..bounds
                        },
                        PaneBounds {
                            y: bounds.y + bounds.height * ratio,
                            height: bounds.height * (1. - ratio),
                            ..bounds
                        },
                    ),
                };
                first.geometry(a, output);
                second.geometry(b, output);
            }
        }
    }
}
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct PaneLayout {
    pub root: Option<PaneNode>,
    pub focused: Option<PaneId>,
    pub next_id: u64,
    next_view_id: u64,
}
impl<'de> Deserialize<'de> for PaneLayout {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::deserialize_snapshot(deserializer).map(|(layout, _)| layout)
    }
}
impl PaneLayout {
    pub(crate) fn deserialize_snapshot<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<(Self, bool), D::Error> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Saved {
            root: Option<PaneNode>,
            focused: Option<PaneId>,
            next_id: u64,
            #[serde(default)]
            next_view_id: Option<u64>,
        }
        let saved = Saved::deserialize(deserializer)?;
        let mut layout = Self {
            root: saved.root,
            focused: saved.focused,
            next_id: saved.next_id,
            next_view_id: saved.next_view_id.unwrap_or(1),
        };
        if saved.next_view_id.is_none() {
            layout.next_view_id = layout
                .items()
                .iter()
                .map(|item| item.id.0)
                .max()
                .unwrap_or(0)
                + 1;
        }
        Ok((layout, saved.next_view_id.is_none()))
    }
}
impl WorkspaceRoute {
    pub fn supports_pane(&self) -> bool {
        matches!(
            self,
            Self::Content(
                WorkspaceItem::Document { .. }
                    | WorkspaceItem::App { .. }
                    | WorkspaceItem::Web(_)
                    | WorkspaceItem::Conversation(_)
            )
        )
    }
    pub fn can_clone_pane(&self) -> bool {
        matches!(self, Self::Content(WorkspaceItem::Document { .. }))
    }
    /// Conversation routes share one retained chat entity across thread selection.
    pub fn shares_pane_instance(&self, other: &Self) -> bool {
        self == other
            || matches!(
                (self, other),
                (
                    Self::Content(WorkspaceItem::Conversation(_)),
                    Self::Content(WorkspaceItem::Conversation(_))
                )
            )
    }
}
impl PaneLayout {
    pub fn conversation(&self) -> Option<&str> {
        self.active_items()
            .into_iter()
            .find_map(|item| match &item.route {
                WorkspaceRoute::Content(WorkspaceItem::Conversation(id)) => Some(id.as_str()),
                _ => None,
            })
    }
    pub fn active_items(&self) -> Vec<&PaneItem> {
        self.leaves()
            .into_iter()
            .filter_map(PaneLeaf::active)
            .collect()
    }
    pub fn items(&self) -> Vec<&PaneItem> {
        self.leaves()
            .into_iter()
            .flat_map(|leaf| leaf.tabs.items())
            .collect()
    }
    pub fn view(&self, id: ViewId) -> Option<(PaneId, &PaneItem)> {
        self.leaves()
            .into_iter()
            .find_map(|leaf| leaf.tabs.item(id).map(|item| (leaf.id, item)))
    }
    pub fn allocate_view_id(&mut self) -> ViewId {
        let id = self.next_view_id.max(1);
        self.next_view_id = id + 1;
        ViewId(id)
    }
    pub fn open_tab(
        &mut self,
        pane: PaneId,
        route: WorkspaceRoute,
        reading: Option<ReaderState>,
        intent: OpenIntent,
    ) -> Option<(PaneId, OpenTab)> {
        if !route.can_clone_pane() {
            if let Some((owner, view, old_route)) = self
                .items()
                .into_iter()
                .find(|item| item.route.shares_pane_instance(&route))
                .and_then(|item| {
                    self.view(item.id)
                        .map(|(pane, _)| (pane, item.id, item.route.clone()))
                })
            {
                let tabs = &mut self.leaf_mut(owner)?.tabs;
                let result = if old_route == route {
                    tabs.activate(view);
                    if intent == OpenIntent::Permanent {
                        tabs.promote(view);
                    }
                    OpenTab {
                        active: view,
                        inserted: false,
                        replaced: None,
                    }
                } else {
                    let old = tabs.take(view)?;
                    let mut result = tabs
                        .open(
                            PaneItem {
                                id: view,
                                route,
                                reading,
                            },
                            intent,
                        )
                        .ok()?;
                    result.replaced = Some(old);
                    result
                };
                self.focused = Some(owner);
                return Some((owner, result));
            }
        }
        let id = self.allocate_view_id();
        let tab = self
            .leaf_mut(pane)?
            .tabs
            .open(PaneItem { id, route, reading }, intent)
            .ok()?;
        self.focused = Some(pane);
        Some((pane, tab))
    }
    pub fn activate_view(&mut self, view: ViewId) -> Option<WorkspaceRoute> {
        let (pane, route) = self
            .view(view)
            .map(|(pane, item)| (pane, item.route.clone()))?;
        self.leaf_mut(pane)?.tabs.activate(view);
        self.focused = Some(pane);
        Some(route)
    }
    pub fn close_tab(&mut self, view: ViewId) -> Option<PaneItem> {
        let pane = self.view(view)?.0;
        self.leaf_mut(pane)?.tabs.close(view)
    }
    pub fn move_tab(&mut self, view: ViewId, target: PaneId, index: usize) -> Option<ViewId> {
        let source = self.view(view)?.0;
        if source == target {
            return self
                .leaf_mut(target)?
                .tabs
                .move_tab(view, index)
                .then_some(view);
        }
        self.leaf(target)?;
        let item = self.leaf_mut(source)?.tabs.take(view)?;
        let opened = self
            .leaf_mut(target)?
            .tabs
            .open(item, OpenIntent::Permanent)
            .ok()?;
        self.leaf_mut(target)?.tabs.move_tab(opened.active, index);
        self.focused = Some(target);
        if self
            .leaf(source)
            .is_some_and(|leaf| leaf.tabs.items().is_empty())
        {
            self.close(source);
            self.focused = Some(target);
        }
        Some(opened.active)
    }
    pub fn is_active(&self, route: &WorkspaceRoute) -> bool {
        self.focused
            .and_then(|id| self.leaf(id))
            .is_some_and(|leaf| {
                leaf.route().map_or(
                    *route
                        == WorkspaceRoute::Page(crate::workspace_session::WorkbenchPage::Document),
                    |active| active == route,
                )
            })
    }
    pub fn new(route: WorkspaceRoute, reading: Option<ReaderState>) -> Self {
        let mut tabs = PaneTabSet::default();
        tabs.open(
            PaneItem {
                id: ViewId(1),
                route,
                reading,
            },
            OpenIntent::Permanent,
        )
        .expect("initial pane item");
        Self {
            root: Some(PaneNode::Leaf {
                view: PaneLeaf {
                    id: PaneId(1),
                    tabs,
                },
            }),
            focused: Some(PaneId(1)),
            next_id: 2,
            next_view_id: 2,
        }
    }
    pub fn place(
        &mut self,
        target: PaneId,
        direction: SplitDirection,
        route: WorkspaceRoute,
        reading: Option<ReaderState>,
    ) -> Option<PaneId> {
        if !route.can_clone_pane() {
            if let Some((pane, view)) = self
                .items()
                .into_iter()
                .find(|item| item.route.shares_pane_instance(&route))
                .and_then(|item| self.view(item.id).map(|(pane, _)| (pane, item.id)))
            {
                let mut item = self.leaf_mut(pane)?.tabs.take(view)?;
                item.route = route;
                let id = self.insert_leaf(target, direction, Some(item))?;
                if pane != target
                    && self
                        .leaf(pane)
                        .is_some_and(|leaf| leaf.tabs.items().is_empty())
                {
                    self.close(pane);
                    self.focus(id);
                }
                return Some(id);
            }
        }
        let view = self.allocate_view_id();
        self.insert_leaf(
            target,
            direction,
            Some(PaneItem {
                id: view,
                route,
                reading,
            }),
        )
    }
    fn insert_leaf(
        &mut self,
        target: PaneId,
        direction: SplitDirection,
        item: Option<PaneItem>,
    ) -> Option<PaneId> {
        if self.leaf(target).is_none() {
            return None;
        }
        let mut tabs = PaneTabSet::default();
        if let Some(item) = item {
            tabs.open(item, OpenIntent::Permanent).ok()?;
        }
        let view = PaneLeaf {
            id: PaneId(self.next_id),
            tabs,
        };
        self.next_id += 2;
        if self
            .root
            .as_mut()?
            .insert(target, view.clone(), self.next_id - 1, direction)
        {
            self.focused = Some(view.id);
            Some(view.id)
        } else {
            None
        }
    }
    pub fn split_empty(&mut self, target: PaneId, direction: SplitDirection) -> Option<PaneId> {
        self.insert_leaf(target, direction, None)
    }
    pub fn leaves(&self) -> Vec<&PaneLeaf> {
        let mut leaves = vec![];
        if let Some(root) = &self.root {
            root.leaves(&mut leaves);
        }
        leaves
    }
    pub fn leaf(&self, id: PaneId) -> Option<&PaneLeaf> {
        self.leaves().into_iter().find(|view| view.id == id)
    }
    pub fn leaf_mut(&mut self, id: PaneId) -> Option<&mut PaneLeaf> {
        self.root.as_mut()?.leaf_mut(id)
    }
    pub fn focus(&mut self, id: PaneId) -> Option<WorkspaceRoute> {
        let route = self
            .leaf(id)?
            .route()
            .cloned()
            .unwrap_or(WorkspaceRoute::Page(
                crate::workspace_session::WorkbenchPage::Document,
            ));
        self.focused = Some(id);
        Some(route)
    }
    pub fn split(
        &mut self,
        target: PaneId,
        direction: SplitDirection,
        route: WorkspaceRoute,
        reading: Option<ReaderState>,
    ) -> Option<PaneId> {
        if self.leaf(target).is_none()
            || (!route.can_clone_pane()
                && self
                    .items()
                    .iter()
                    .any(|item| item.route.shares_pane_instance(&route)))
        {
            return None;
        }
        let id = self.allocate_view_id();
        self.insert_leaf(target, direction, Some(PaneItem { id, route, reading }))
    }
    pub fn close(&mut self, id: PaneId) -> bool {
        let Some(root) = self.root.take() else {
            return false;
        };
        let (root, removed) = root.remove(id);
        self.root = root;
        if self.focused == Some(id) {
            self.focused = self.leaves().first().map(|view| view.id);
        }
        removed.is_some()
    }
    pub fn move_to(&mut self, id: PaneId, target: PaneId, direction: SplitDirection) -> bool {
        if id == target || self.leaf(id).is_none() || self.leaf(target).is_none() {
            return false;
        }
        let (root, view) = self.root.take().expect("pane root").remove(id);
        self.root = root;
        let split = self.next_id;
        self.next_id += 1;
        self.root.as_mut().expect("target survives").insert(
            target,
            view.expect("source view"),
            split,
            direction,
        );
        self.focused = Some(id);
        true
    }
    pub fn neighbor(&self, id: PaneId, direction: SplitDirection) -> Option<PaneId> {
        let mut geometry = vec![];
        self.root.as_ref()?.geometry(
            PaneBounds {
                x: 0.,
                y: 0.,
                width: 1.,
                height: 1.,
            },
            &mut geometry,
        );
        let center = |b: &PaneBounds| (b.x + b.width / 2., b.y + b.height / 2.);
        let origin = center(&geometry.iter().find(|(pane, _)| *pane == id)?.1);
        geometry
            .into_iter()
            .filter(|(pane, bounds)| {
                let (x, y) = center(bounds);
                *pane != id
                    && match direction {
                        SplitDirection::Left => x < origin.0,
                        SplitDirection::Right => x > origin.0,
                        SplitDirection::Up => y < origin.1,
                        SplitDirection::Down => y > origin.1,
                    }
            })
            .min_by(|(_, a), (_, b)| {
                let distance = |bounds: &PaneBounds| {
                    let (x, y) = center(bounds);
                    let main = if direction.axis() == PaneAxis::Horizontal {
                        (x - origin.0).abs()
                    } else {
                        (y - origin.1).abs()
                    };
                    let cross = if direction.axis() == PaneAxis::Horizontal {
                        (y - origin.1).abs()
                    } else {
                        (x - origin.0).abs()
                    };
                    main + cross * 2.
                };
                distance(a).total_cmp(&distance(b))
            })
            .map(|(id, _)| id)
    }
    pub fn resize(&mut self, split: u64, value: f32) -> bool {
        fn resize(node: &mut PaneNode, split: u64, value: f32) -> bool {
            match node {
                PaneNode::Split { id, ratio, .. } if *id == split => {
                    *ratio = value;
                    true
                }
                PaneNode::Split { first, second, .. } => {
                    resize(first, split, value) || resize(second, split, value)
                }
                _ => false,
            }
        }
        value.is_finite()
            && (0.05..=0.95).contains(&value)
            && self
                .root
                .as_mut()
                .is_some_and(|root| resize(root, split, value))
    }
    pub fn valid(&self) -> bool {
        fn admit(node: &PaneNode, ids: &mut Vec<u64>) -> bool {
            let id = match node {
                PaneNode::Leaf { view } => view.id.0,
                PaneNode::Split { id, .. } => *id,
            };
            if id == 0 || ids.contains(&id) {
                return false;
            }
            ids.push(id);
            match node {
                PaneNode::Leaf { view } => view.tabs.valid(),
                PaneNode::Split {
                    ratio,
                    first,
                    second,
                    ..
                } => {
                    ratio.is_finite()
                        && (0.05..=0.95).contains(ratio)
                        && admit(first, ids)
                        && admit(second, ids)
                }
            }
        }
        let mut ids = vec![];
        self.root.as_ref().is_none_or(|root| admit(root, &mut ids))
            && self.focused == self.focused.filter(|id| self.leaf(*id).is_some())
            && (self.root.is_some() == self.focused.is_some())
            && ids.iter().all(|id| *id < self.next_id)
            && self.items().iter().enumerate().all(|(index, item)| {
                item.id.0 > 0
                    && item.id.0 < self.next_view_id
                    && !self.items()[..index]
                        .iter()
                        .any(|previous| previous.id == item.id)
                    && (item.route.can_clone_pane()
                        || !self.items()[..index]
                            .iter()
                            .any(|previous| previous.route.shares_pane_instance(&item.route)))
            })
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct PaneBounds {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PaneSurface {
    pub id: PaneId,
    pub route: WorkspaceRoute,
    pub bounds: PaneBounds,
    pub focused: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::content_origin::ContentOrigin;
    #[test]
    fn shared_surfaces_move_without_cloning_chat_or_app_state() {
        let app = WorkspaceRoute::Content(WorkspaceItem::App {
            name: "data".into(),
            panel: "main".into(),
        });
        let web = WorkspaceRoute::Content(WorkspaceItem::Web("https://example.org".into()));
        let chat = WorkspaceRoute::Content(WorkspaceItem::Conversation("first".into()));
        let other_chat = WorkspaceRoute::Content(WorkspaceItem::Conversation("second".into()));
        let mut layout = PaneLayout::new(app.clone(), None);
        let first = layout.focused.unwrap();
        let browser = layout
            .place(first, SplitDirection::Right, web.clone(), None)
            .unwrap();
        let conversation = layout
            .place(browser, SplitDirection::Down, chat, None)
            .unwrap();
        assert!(
            layout
                .split(browser, SplitDirection::Left, other_chat.clone(), None)
                .is_none()
        );
        let chat_view = layout.leaf(conversation).unwrap().active().unwrap().id;
        let web_view = layout.leaf(browser).unwrap().active().unwrap().id;
        let moved = layout
            .place(first, SplitDirection::Left, other_chat.clone(), None)
            .unwrap();
        assert_eq!(layout.view(chat_view).unwrap().0, moved);
        assert_eq!(layout.leaf(moved).unwrap().route(), Some(&other_chat));
        let browser = layout.place(moved, SplitDirection::Up, web, None).unwrap();
        assert_eq!(layout.view(web_view).unwrap().0, browser);
        assert_eq!(layout.leaves().len(), 3);
        assert!(layout.valid());
        assert!(layout.is_active(layout.leaf(browser).unwrap().route().unwrap()));
        let restored: PaneLayout =
            serde_json::from_str(&serde_json::to_string(&layout).unwrap()).unwrap();
        assert_eq!(restored, layout);
        assert!(layout.close(moved));
        assert!(layout.valid());
        assert!(
            layout
                .leaves()
                .iter()
                .any(|view| view.route() == Some(&app))
        );
    }

    #[test]
    fn pane_tree_keeps_view_identity_through_split_move_resize_close_and_restart() {
        let route = WorkspaceRoute::Content(WorkspaceItem::Document {
            origin: ContentOrigin::File { path: "/a".into() },
            source: "/a".into(),
        });
        let mut layout = PaneLayout::new(
            route.clone(),
            Some(ReaderState {
                selection: 3..9,
                ..Default::default()
            }),
        );
        let first = layout.focused.unwrap();
        for direction in [
            SplitDirection::Left,
            SplitDirection::Right,
            SplitDirection::Up,
            SplitDirection::Down,
        ] {
            let id = layout
                .split(
                    first,
                    direction,
                    route.clone(),
                    Some(ReaderState {
                        selection: 20..30,
                        ..Default::default()
                    }),
                )
                .unwrap();
            assert_ne!(id, first);
            assert!(layout.valid());
            assert_eq!(
                layout.leaf(first).unwrap().reading().unwrap().selection,
                3..9
            );
        }
        let focused = layout.focused.unwrap();
        let other = layout.neighbor(focused, SplitDirection::Up).unwrap();
        assert!(layout.move_to(focused, other, SplitDirection::Left));
        let PaneNode::Split { id, .. } = layout.root.as_ref().unwrap() else {
            panic!("split")
        };
        let split = *id;
        assert!(layout.resize(split, 0.7));
        assert!(!layout.resize(split, 1.));
        let restored: PaneLayout =
            serde_json::from_value(serde_json::to_value(&layout).unwrap()).unwrap();
        assert_eq!(restored, layout);
        for id in layout
            .leaves()
            .iter()
            .map(|view| view.id)
            .collect::<Vec<_>>()
        {
            assert!(layout.close(id));
            assert!(layout.valid());
        }
        assert!(layout.root.is_none());
        let app = WorkspaceRoute::Content(WorkspaceItem::App {
            name: "fixture".into(),
            panel: "main".into(),
        });
        let mut layout = PaneLayout::new(app.clone(), None);
        assert!(
            layout
                .split(layout.focused.unwrap(), SplitDirection::Right, app, None)
                .is_none()
        );
    }
}
