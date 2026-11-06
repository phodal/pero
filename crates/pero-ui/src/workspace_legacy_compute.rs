//! Saved placeholder routes now refer to the installed Compute App.
use super::{WorkspaceItem, WorkspaceNavigation, WorkspaceRoute};

impl WorkspaceNavigation {
    pub(super) fn migrate_legacy_compute(&mut self) {
        let compute = WorkspaceItem::App {
            name: "compute".into(),
            panel: "main".into(),
        };
        if !self.replace_identity(&WorkspaceItem::Compute, compute.clone()) {
            return;
        }
        let Some(layout) = &mut self.pane_layout else {
            return;
        };
        let route = WorkspaceRoute::Content(compute);
        // A saved workspace may already contain the new App beside its old
        // placeholder. Keep one retained surface, preferring the focused view.
        let keep = layout
            .focused
            .and_then(|pane| layout.leaf(pane)?.active())
            .filter(|item| item.route == route)
            .map(|item| item.id)
            .or_else(|| {
                layout
                    .items()
                    .into_iter()
                    .find(|item| item.route == route)
                    .map(|item| item.id)
            });
        let mut duplicates = Vec::new();
        for pane in layout.leaves() {
            for item in pane.tabs.items() {
                if item.route == route && Some(item.id) != keep {
                    duplicates.push((pane.id, item.id));
                }
            }
        }
        for (pane, view) in duplicates {
            // Retain the split and each pane's history and unrelated tabs.
            layout.leaf_mut(pane).unwrap().tabs.take(view);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::{ContentOrigin, ReaderState, WorkspaceSnapshot};
    use pero_contracts::workspace_panes::SplitDirection;

    #[test]
    fn saved_compute_routes_migrate_without_losing_other_workspace_state() {
        let compute = WorkspaceItem::App {
            name: "compute".into(),
            panel: "main".into(),
        };
        let document = WorkspaceItem::Document {
            origin: ContentOrigin::File {
                path: "/notes.md".into(),
            },
            source: "/notes.md".into(),
        };
        let reading = ReaderState {
            source_revision: Some(7),
            selection: 2..9,
            scroll: [0., 120.],
            query: "retained".into(),
            ..Default::default()
        };
        for scenario in [
            "active",
            "background",
            "closed",
            "split",
            "same-pane-app",
            "other-pane-app",
        ] {
            let mut navigation = WorkspaceNavigation::default();
            navigation.open(WorkspaceItem::Compute);
            let legacy_view = navigation.active_view_id().unwrap();
            navigation.open(document.clone());
            navigation.observe_reading(&document, reading.clone());
            let document_view = navigation.active_view_id().unwrap();
            match scenario {
                "active" => {
                    navigation.select(&WorkspaceItem::Compute);
                }
                "closed" => {
                    navigation.close_view(legacy_view);
                }
                "split" => {
                    let pane = navigation.pane_layout().unwrap().focused.unwrap();
                    navigation
                        .open_item_in_pane(WorkspaceItem::Compute, pane, SplitDirection::Right)
                        .unwrap();
                }
                "same-pane-app" => {
                    navigation.open(compute.clone());
                    navigation.select(&WorkspaceItem::Compute);
                }
                "other-pane-app" => {
                    navigation.open(compute.clone());
                    let pane = navigation.pane_layout().unwrap().focused.unwrap();
                    navigation
                        .open_item_in_pane(WorkspaceItem::Compute, pane, SplitDirection::Right)
                        .unwrap();
                }
                _ => {}
            }
            let saved = navigation.snapshot();
            assert!(saved.valid(), "{scenario}");
            let focused = saved.panes.as_ref().unwrap().focused;
            let pane_ids = saved
                .panes
                .as_ref()
                .unwrap()
                .leaves()
                .iter()
                .map(|pane| pane.id)
                .collect::<Vec<_>>();
            let expected_route = if saved.route == WorkspaceRoute::Content(WorkspaceItem::Compute) {
                WorkspaceRoute::Content(compute.clone())
            } else {
                saved.route.clone()
            };
            let mut restored = WorkspaceNavigation::default();
            // Exercise the same serialized recovery boundary as a saved session.
            restored.restore(
                serde_json::from_value::<WorkspaceSnapshot>(serde_json::to_value(saved).unwrap())
                    .unwrap(),
            );
            assert_eq!(restored.route(), &expected_route, "{scenario}");
            assert_eq!(
                restored.items(),
                &[compute.clone(), document.clone()],
                "{scenario}"
            );
            let layout = restored.pane_layout().unwrap();
            assert_eq!(layout.focused, focused, "{scenario}");
            assert_eq!(
                layout
                    .leaves()
                    .iter()
                    .map(|pane| pane.id)
                    .collect::<Vec<_>>(),
                pane_ids,
                "{scenario}"
            );
            assert_eq!(
                layout.view(document_view).unwrap().1.reading.as_ref(),
                Some(&reading),
                "{scenario}"
            );
            assert_eq!(
                layout
                    .items()
                    .iter()
                    .filter(|view| view.route == WorkspaceRoute::Content(compute.clone()))
                    .count(),
                usize::from(scenario != "closed"),
                "{scenario}"
            );
            let recovered = restored.snapshot();
            assert!(recovered.valid(), "{scenario}");
            assert!(
                !serde_json::to_string(&recovered)
                    .unwrap()
                    .contains("\"kind\":\"compute\""),
                "{scenario}"
            );
            let mut again = WorkspaceNavigation::default();
            again.restore(recovered.clone());
            assert_eq!(
                again.snapshot(),
                recovered,
                "{scenario}: migration is applied once"
            );
        }
    }
}
