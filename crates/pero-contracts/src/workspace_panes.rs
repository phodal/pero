//! A pane is a view identity; source identity and navigation remain separate.
use crate::{
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
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaneLeaf {
    pub id: PaneId,
    pub route: WorkspaceRoute,
    pub reading: Option<ReaderState>,
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
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaneLayout {
    pub root: Option<PaneNode>,
    pub focused: Option<PaneId>,
    pub next_id: u64,
}
impl PaneLayout {
    pub fn new(route: WorkspaceRoute, reading: Option<ReaderState>) -> Self {
        Self {
            root: Some(PaneNode::Leaf {
                view: PaneLeaf {
                    id: PaneId(1),
                    route,
                    reading,
                },
            }),
            focused: Some(PaneId(1)),
            next_id: 2,
        }
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
        let route = self.leaf(id)?.route.clone();
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
            || (!matches!(
                route,
                WorkspaceRoute::Content(WorkspaceItem::Document { .. })
            ) && self.leaves().iter().any(|view| view.route == route))
        {
            return None;
        }
        let view = PaneLeaf {
            id: PaneId(self.next_id),
            route,
            reading,
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
                PaneNode::Leaf { view } => {
                    view.reading.is_none()
                        || matches!(
                            view.route,
                            WorkspaceRoute::Content(WorkspaceItem::Document { .. })
                        )
                }
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
            && self.leaves().iter().enumerate().all(|(index, view)| {
                matches!(
                    view.route,
                    WorkspaceRoute::Content(WorkspaceItem::Document { .. })
                ) || !self.leaves()[..index]
                    .iter()
                    .any(|previous| previous.route == view.route)
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
    use crate::{content_origin::ContentOrigin, workspace_session::WorkbenchPage};
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
                layout
                    .leaf(first)
                    .unwrap()
                    .reading
                    .as_ref()
                    .unwrap()
                    .selection,
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
        let app = WorkspaceRoute::Page(WorkbenchPage::Apps);
        let mut layout = PaneLayout::new(app.clone(), None);
        assert!(
            layout
                .split(layout.focused.unwrap(), SplitDirection::Right, app, None)
                .is_none()
        );
    }
}
