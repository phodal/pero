//! Pure, retained directory projection. Only listing/expansion changes rebuild rows.
use pero_contracts::workspace_files::{DirectoryListing, EntryKind, WorkspaceEntry};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Default)]
pub(crate) struct Directory {
    pub entries: Vec<WorkspaceEntry>,
    pub loaded: bool,
    pub pending: Option<String>,
    pub error: Option<String>,
    pub truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Notice {
    Loading,
    Empty,
    Failed(String),
    WorkspaceUnavailable(String),
    Truncated,
}

#[derive(Clone)]
pub(crate) struct TreeRow {
    pub path: String,
    pub depth: usize,
    pub entry: Option<WorkspaceEntry>,
    pub notice: Option<Notice>,
}

#[derive(Default)]
pub(crate) struct FileTree {
    pub workspace: String,
    pub directories: BTreeMap<String, Directory>,
    pub expanded: BTreeSet<String>,
    pub selected: Option<String>,
    pub rows: Vec<TreeRow>,
}

impl FileTree {
    pub fn begin(&mut self, path: &str, request: String) -> bool {
        let directory = self.directories.entry(path.into()).or_default();
        if directory.pending.is_some() {
            return false;
        }
        directory.pending = Some(request);
        directory.error = None;
        self.rebuild();
        true
    }

    pub fn finish(&mut self, request: &str, result: Result<DirectoryListing, String>) -> bool {
        let Some(path) = self
            .directories
            .iter()
            .find(|(_, dir)| dir.pending.as_deref() == Some(request))
            .map(|(path, _)| path.clone())
        else {
            return false;
        };
        let directory = self.directories.get_mut(&path).unwrap();
        directory.pending = None;
        match result {
            Ok(listing) => {
                self.workspace = listing.workspace;
                directory.entries = listing.entries;
                directory.loaded = true;
                directory.truncated = listing.truncated;
                directory.error = None;
                // A refreshed parent removes vanished children from the cache and expansion.
                let children: BTreeSet<_> = directory
                    .entries
                    .iter()
                    .filter(|entry| entry.kind == EntryKind::Directory)
                    .map(|entry| child_path(&path, &entry.name))
                    .collect();
                self.directories.retain(|candidate, _| {
                    if candidate == &path || !is_below(candidate, &path) {
                        return true;
                    }
                    children
                        .iter()
                        .any(|child| candidate == child || is_below(candidate, child))
                });
                self.expanded
                    .retain(|path| self.directories.contains_key(path));
            }
            Err(error) => directory.error = Some(error),
        }
        self.rebuild();
        true
    }

    pub fn fail_pending(&mut self, error: &str) {
        for directory in self.directories.values_mut() {
            if directory.pending.take().is_some() {
                directory.error = Some(error.into());
            }
        }
        self.rebuild();
    }

    pub fn toggle(&mut self, path: &str) -> bool {
        if self.expanded.remove(path) {
            self.rebuild();
            return false;
        }
        self.expanded.insert(path.into());
        let directory = self.directories.entry(path.into()).or_default();
        let load = !directory.loaded && directory.pending.is_none();
        self.rebuild();
        load
    }

    pub fn refresh_paths(&self) -> Vec<String> {
        std::iter::once(".".to_owned())
            .chain(self.rows.iter().filter_map(|row| {
                row.entry
                    .as_ref()
                    .filter(|entry| {
                        entry.kind == EntryKind::Directory && self.expanded.contains(&row.path)
                    })
                    .map(|_| row.path.clone())
            }))
            .collect()
    }

    pub fn move_selection(&mut self, direction: isize) -> Option<usize> {
        let entries: Vec<_> = self
            .rows
            .iter()
            .enumerate()
            .filter(|(_, row)| row.entry.is_some())
            .collect();
        if entries.is_empty() {
            return None;
        }
        let current = entries
            .iter()
            .position(|(_, row)| Some(&row.path) == self.selected.as_ref());
        let next = match current {
            Some(index) => ((index as isize).saturating_add(direction))
                .clamp(0, entries.len() as isize - 1) as usize,
            None => {
                if direction < 0 {
                    entries.len() - 1
                } else {
                    0
                }
            }
        };
        self.selected = Some(entries[next].1.path.clone());
        Some(entries[next].0)
    }

    pub fn selected_row(&self) -> Option<&TreeRow> {
        self.rows
            .iter()
            .find(|row| Some(&row.path) == self.selected.as_ref() && row.entry.is_some())
    }

    fn rebuild(&mut self) {
        let mut rows = Vec::new();
        // An explicit work stack avoids recursion for deeply nested directories.
        enum Work<'a> {
            Directory(&'a str, usize),
            Entry(&'a str, &'a WorkspaceEntry, usize),
        }
        let mut work = vec![Work::Directory(".", 0)];
        while let Some(item) = work.pop() {
            match item {
                Work::Directory(path, depth) => {
                    if let Some(dir) = self.directories.get(path) {
                        let notice = if let Some(error) = &dir.error {
                            Some(if path == "." {
                                Notice::WorkspaceUnavailable(error.clone())
                            } else {
                                Notice::Failed(error.clone())
                            })
                        } else if dir.pending.is_some() {
                            Some(Notice::Loading)
                        } else if dir.truncated {
                            Some(Notice::Truncated)
                        } else if dir.loaded && dir.entries.is_empty() {
                            Some(Notice::Empty)
                        } else {
                            None
                        };
                        if let Some(notice) = notice {
                            rows.push(TreeRow {
                                path: path.into(),
                                depth,
                                entry: None,
                                notice: Some(notice),
                            });
                        }
                        for entry in dir.entries.iter().rev() {
                            work.push(Work::Entry(path, entry, depth));
                        }
                    }
                }
                Work::Entry(parent, entry, depth) => {
                    let path = child_path(parent, &entry.name);
                    if entry.kind == EntryKind::Directory && self.expanded.contains(&path) {
                        if let Some((key, _)) = self.directories.get_key_value(&path) {
                            work.push(Work::Directory(key, depth + 1));
                        }
                    }
                    rows.push(TreeRow {
                        path,
                        depth,
                        entry: Some(entry.clone()),
                        notice: None,
                    });
                }
            }
        }
        if self.selected.as_ref().is_some_and(|selected| {
            !rows
                .iter()
                .any(|row| &row.path == selected && row.entry.is_some())
        }) {
            let mut path = self.selected.take().unwrap();
            while let Some((parent, _)) = path.rsplit_once('/') {
                path = parent.into();
                if rows
                    .iter()
                    .any(|row| row.path == path && row.entry.is_some())
                {
                    self.selected = Some(path);
                    break;
                }
            }
        }
        self.rows = rows;
    }
}

fn child_path(parent: &str, name: &str) -> String {
    if parent == "." {
        name.into()
    } else {
        format!("{parent}/{name}")
    }
}
fn is_below(path: &str, parent: &str) -> bool {
    parent == "." && path != "."
        || path
            .strip_prefix(parent)
            .is_some_and(|suffix| suffix.starts_with('/'))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn retained_tree_handles_refresh_failure_and_collapsed_selection() {
        let mut tree = FileTree::default();
        let listing = |path: &str, entries: Vec<(&str, EntryKind)>| DirectoryListing {
            workspace: "/work".into(),
            path: path.into(),
            entries: entries
                .into_iter()
                .map(|(name, kind)| WorkspaceEntry {
                    name: name.into(),
                    kind,
                })
                .collect(),
            truncated: false,
        };
        assert!(tree.begin(".", "root".into()));
        assert!(!tree.begin(".", "duplicate".into()));
        assert!(!tree.finish("stale", Err("stale".into())));
        tree.finish(
            "root",
            Ok(listing(
                ".",
                vec![
                    ("dir", EntryKind::Directory),
                    ("request.json", EntryKind::File),
                ],
            )),
        );
        assert!(tree.toggle("dir"));
        tree.begin("dir", "child".into());
        tree.finish(
            "child",
            Ok(listing("dir", vec![("result.json", EntryKind::File)])),
        );
        assert_eq!(
            tree.rows
                .iter()
                .map(|row| row.path.as_str())
                .collect::<Vec<_>>(),
            vec!["dir", "dir/result.json", "request.json"]
        );
        tree.selected = Some("dir/result.json".into());
        tree.toggle("dir");
        assert_eq!(tree.selected.as_deref(), Some("dir"));
        assert!(!tree.toggle("dir")); // cached contents need no network request
        tree.begin("dir", "refresh".into());
        tree.finish("refresh", Err("unavailable".into()));
        assert!(tree.rows.iter().any(|row| row.path == "dir/result.json"));
        tree.begin(".", "remove".into());
        tree.finish(
            "remove",
            Ok(listing(".", vec![("request.json", EntryKind::File)])),
        );
        assert!(!tree.directories.contains_key("dir"));
        assert!(!tree.expanded.contains("dir"));
        assert_eq!(tree.move_selection(1), Some(0));
        assert_eq!(tree.selected.as_deref(), Some("request.json"));
        tree.begin(".", "interrupted".into());
        tree.fail_pending("Host disconnected");
        assert!(matches!(
            tree.rows[0].notice,
            Some(Notice::WorkspaceUnavailable(_))
        ));
        assert!(!tree.finish("interrupted", Ok(listing(".", vec![]))));
        assert!(tree.begin(".", "retry".into()));
    }
}

/// A local tab selection wins over older settings echoes until acknowledged.
#[derive(Default)]
pub(crate) struct ResourceSelection {
    pub tab: pero_contracts::workbench::ResourceTab,
    pending: Option<pero_contracts::workbench::ResourceTab>,
}
impl ResourceSelection {
    pub fn choose(&mut self, tab: pero_contracts::workbench::ResourceTab) {
        self.tab = tab;
        self.pending = Some(tab);
    }
    pub fn observe(&mut self, tab: pero_contracts::workbench::ResourceTab) {
        if self.pending.is_some_and(|pending| pending != tab) {
            return;
        }
        self.tab = tab;
        self.pending = None;
    }
}
#[cfg(test)]
mod selection_tests {
    use super::*;
    use pero_contracts::workbench::ResourceTab::{Artifacts, Files};
    #[test]
    fn newer_selection_wins_until_acknowledged() {
        let mut selection = ResourceSelection::default();
        selection.observe(Files);
        selection.choose(Files);
        selection.choose(Artifacts);
        selection.observe(Files);
        assert_eq!(selection.tab, Artifacts);
        selection.observe(Artifacts);
        selection.observe(Files);
        assert_eq!(selection.tab, Files);
    }
}
