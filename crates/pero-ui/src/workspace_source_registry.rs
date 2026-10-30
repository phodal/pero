//! Retained source descriptors follow open views and bounded navigation history.
use super::*;

impl WorkspaceNavigation {
    pub(crate) fn prune_document_registry(&mut self) -> Vec<WorkspaceItem> {
        // Legacy snapshots have a flat tab list; their migration owns its admission.
        let Some(layout) = &self.pane_layout else {
            return vec![];
        };
        let mut reachable = Vec::new();
        let mut remember = |route: &WorkspaceRoute| {
            if let WorkspaceRoute::Content(item @ WorkspaceItem::Document { .. }) = route {
                if !reachable.contains(item) {
                    reachable.push(item.clone());
                }
            }
        };
        remember(&self.route);
        if let Some(other) = &self.other {
            remember(other);
        }
        for entry in self.history.back.iter().chain(&self.history.forward) {
            remember(&entry.route);
        }
        for pane in layout.leaves() {
            for item in pane.tabs.items() {
                remember(&item.route);
            }
            for entry in pane
                .tabs
                .history()
                .back
                .iter()
                .chain(&pane.tabs.history().forward)
                .chain(pane.tabs.closed_items())
            {
                remember(&entry.route);
            }
        }
        let mut removed = vec![];
        self.items.retain(|item| {
            let keep = !matches!(item, WorkspaceItem::Document { .. }) || reachable.contains(item);
            if !keep {
                removed.push(item.clone());
            }
            keep
        });
        removed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pero_contracts::{
        pane_tabs::{OpenIntent, PaneItem, PaneTabSet, ViewId},
        workspace_panes::PaneLayout,
    };
    #[test]
    fn descriptors_survive_closed_and_navigation_history_then_expire_with_the_last_reference() {
        let document = |name: &str| WorkspaceItem::Document {
            origin: ContentOrigin::File { path: name.into() },
            source: name.into(),
        };
        let a = document("/a");
        let b = document("/b");
        let c = document("/c");
        let dead = document("/expired");
        let mut navigation = WorkspaceNavigation::default();
        let route = WorkspaceRoute::Content(a.clone());
        navigation.items = vec![a.clone(), b.clone(), c.clone(), dead.clone()];
        navigation.route = route.clone();
        let mut layout = PaneLayout::new(route, None);
        let pane = layout.focused.unwrap();
        layout
            .leaf_mut(pane)
            .unwrap()
            .tabs
            .open(
                PaneItem {
                    id: ViewId(20),
                    route: WorkspaceRoute::Content(b.clone()),
                    reading: None,
                    kind: Default::default(),
                },
                OpenIntent::Permanent,
            )
            .unwrap();
        layout.leaf_mut(pane).unwrap().tabs.close(ViewId(20));
        navigation.pane_layout = Some(layout);
        navigation.history.back.push(HistoryEntry {
            route: WorkspaceRoute::Content(c.clone()),
            preview: false,
            view_kind: Default::default(),
            reading: None,
        });
        assert_eq!(navigation.prune_document_registry(), vec![dead]);
        assert_eq!(navigation.items, vec![a.clone(), b.clone(), c.clone()]);
        navigation.history.back.clear();
        assert_eq!(navigation.prune_document_registry(), vec![c]);
        let mut fresh = PaneTabSet::default();
        fresh
            .open(
                PaneItem {
                    id: ViewId(21),
                    route: WorkspaceRoute::Content(a.clone()),
                    reading: None,
                    kind: Default::default(),
                },
                OpenIntent::Permanent,
            )
            .unwrap();
        navigation
            .pane_layout
            .as_mut()
            .unwrap()
            .leaf_mut(pane)
            .unwrap()
            .tabs = fresh;
        assert_eq!(navigation.prune_document_registry(), vec![b]);
        assert_eq!(navigation.items, vec![a]);
    }
}
