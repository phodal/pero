//! Retained Files view and UI-only transport; no Agent tool calls.
use crate::{
    content_reader::{ContentReader, ReaderAction},
    file_tree::FileTree,
    panel::{ChatAction, ChatPanel},
};
use gpui_kit::{prelude::*, *};
use pero_contracts::{
    HostEvent,
    content_document::{ContentDocument, DocumentHeader},
    workspace_files::*,
};
use std::collections::HashMap;

pub(crate) struct FileBrowser {
    pub tree: FileTree,
    pub focus: FocusHandle,
    pub scroll: UniformListScrollHandle,
    pub preview_path: Option<String>,
    pub preview_open: bool,
    pub pending: Option<(String, String)>,
    pub document: Option<ContentDocument>,
    pub reader: Option<Entity<ContentReader>>,
    reader_subscription: Option<Subscription>,
    pub error: Option<String>,
    pub bounds: HashMap<String, crate::view_bounds::ViewBounds>,
}

#[derive(Default)]
pub(crate) struct SessionFiles {
    pub selection: crate::file_tree::ResourceSelection,
    pub conversations: HashMap<String, FileBrowser>,
}

impl ChatPanel {
    pub fn set_resource_tab(
        &mut self,
        tab: pero_contracts::workbench::ResourceTab,
        cx: &mut Context<Self>,
    ) -> pero_contracts::workbench::ResourceTab {
        self.files.selection.observe(tab);
        cx.notify();
        self.files.selection.tab
    }

    pub fn fail_file_reads(&mut self, cx: &mut Context<Self>) {
        let error = self.t("error.connection").to_owned();
        for browser in self.files.conversations.values_mut() {
            browser.tree.fail_pending(&error);
            if browser.pending.take().is_some() {
                browser.error = Some(error.clone());
            }
        }
        cx.notify();
    }

    pub(crate) fn choose_resource_tab(
        &mut self,
        thread: &str,
        tab: pero_contracts::workbench::ResourceTab,
        cx: &mut Context<Self>,
    ) {
        self.files.selection.choose(tab);
        cx.notify();
        self.artifacts
            .conversations
            .entry(thread.into())
            .or_default()
            .open = true;
        cx.emit(ChatAction::ResourceTab { tab });
        if tab == pero_contracts::workbench::ResourceTab::Files {
            self.ensure_files(thread, cx);
        }
    }

    pub(crate) fn init_files(&mut self, thread: &str, cx: &mut Context<Self>) {
        self.files
            .conversations
            .entry(thread.into())
            .or_insert_with(|| FileBrowser {
                tree: Default::default(),
                focus: cx.focus_handle(),
                scroll: UniformListScrollHandle::new(),
                preview_path: None,
                preview_open: false,
                pending: None,
                document: None,
                reader: None,
                reader_subscription: None,
                error: None,
                bounds: HashMap::new(),
            });
        let browser = self.files.conversations.get_mut(thread).unwrap();
        for key in [
            "files-tab",
            "artifacts-tab",
            "refresh",
            "back",
            "copy",
            "preview-refresh",
            "close",
        ] {
            browser.bounds.entry(key.into()).or_default();
        }
    }

    pub(crate) fn ensure_files(&mut self, thread: &str, cx: &mut Context<Self>) {
        self.init_files(thread, cx);
        if self.files.conversations[thread].tree.directories.is_empty() {
            self.list_files(thread, ".", cx);
        }
    }

    fn files_request(
        &mut self,
        thread: &str,
        path: &str,
        action: FilesAction,
    ) -> WorkspaceFilesRequest {
        self.next_request += 1;
        WorkspaceFilesRequest {
            method: FilesMethod::WorkspaceFiles,
            action,
            request_id: format!("files-{}", self.next_request),
            thread_id: thread.into(),
            path: path.into(),
        }
    }

    pub(crate) fn list_files(&mut self, thread: &str, path: &str, cx: &mut Context<Self>) {
        let request = self.files_request(thread, path, FilesAction::List);
        let Some(browser) = self.files.conversations.get_mut(thread) else {
            return;
        };
        if browser.tree.begin(path, request.request_id.clone()) {
            cx.emit(ChatAction::WorkspaceFiles(request));
        }
        cx.notify();
    }

    pub(crate) fn refresh_files(&mut self, thread: &str, cx: &mut Context<Self>) {
        let paths = self
            .files
            .conversations
            .get(thread)
            .map(|b| b.tree.refresh_paths())
            .unwrap_or_default();
        for path in paths {
            self.list_files(thread, &path, cx);
        }
    }

    pub(crate) fn activate_file(&mut self, thread: &str, path: &str, cx: &mut Context<Self>) {
        let Some(browser) = self.files.conversations.get_mut(thread) else {
            return;
        };
        browser.tree.selected = Some(path.into());
        let directory = browser
            .tree
            .selected_row()
            .and_then(|row| row.entry.as_ref())
            .is_some_and(|entry| entry.kind == EntryKind::Directory);
        if directory {
            if browser.tree.toggle(path) {
                self.list_files(thread, path, cx);
            }
        } else if browser.preview_path.as_deref() == Some(path) && browser.reader.is_some() {
            browser.preview_open = true;
        } else {
            self.read_workspace_file(thread, path, cx);
        }
        cx.notify();
    }

    pub(crate) fn read_workspace_file(&mut self, thread: &str, path: &str, cx: &mut Context<Self>) {
        let request = self.files_request(thread, path, FilesAction::Read);
        let Some(browser) = self.files.conversations.get_mut(thread) else {
            return;
        };
        if browser.preview_path.as_deref() != Some(path) {
            browser.reader = None;
            browser.reader_subscription = None;
            browser.document = None;
            browser.preview_path = Some(path.into());
        }
        browser.pending = Some((request.request_id.clone(), path.into()));
        browser.error = None;
        browser.preview_open = true;
        cx.emit(ChatAction::WorkspaceFiles(request));
        cx.notify();
    }

    pub(crate) fn receive_files(&mut self, event: &HostEvent, cx: &mut Context<Self>) -> bool {
        if event.kind == "disconnected" {
            self.fail_file_reads(cx);
            return false;
        }
        if event.kind == "turn_finished" {
            if let Some(thread) = event.thread_id.as_deref().filter(|thread| {
                self.files
                    .conversations
                    .get(*thread)
                    .is_some_and(|browser| !browser.tree.directories.is_empty())
            }) {
                self.refresh_files(thread, cx);
            }
            return false;
        }
        if !event.kind.starts_with("workspace_files_") {
            return false;
        }
        let Some(browser) = event
            .thread_id
            .as_deref()
            .and_then(|thread| self.files.conversations.get_mut(thread))
        else {
            return true;
        };
        let request = event.request_id.as_deref().unwrap_or_default();
        if browser
            .pending
            .as_ref()
            .is_some_and(|(pending, _)| pending == request)
        {
            let (_, path) = browser.pending.take().unwrap();
            if event.kind == "workspace_files_document" {
                match serde_json::from_value::<DocumentHeader>(event.data.clone()) {
                    Ok(header) => {
                        browser.document = Some(header.into_document(event.text.clone()));
                        browser.preview_path = Some(path);
                        browser.error = None;
                    }
                    Err(error) => browser.error = Some(error.to_string()),
                }
            } else {
                browser.error = Some(event.text.clone());
            }
        } else {
            let result = if event.kind == "workspace_files_list" {
                serde_json::from_value::<DirectoryListing>(event.data.clone())
                    .map_err(|e| e.to_string())
            } else {
                Err(event.text.clone())
            };
            browser.tree.finish(request, result);
        }
        cx.notify();
        true
    }

    pub(crate) fn prepare_file_reader(
        &mut self,
        thread: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.ensure_files(thread, cx);
        let browser = self.files.conversations.get_mut(thread).unwrap();
        if let Some(mut document) = browser.document.take() {
            if let Some(reader) = browser
                .reader
                .as_ref()
                .filter(|reader| reader.read(cx).document.id == document.id)
            {
                // Host reads are fresh snapshots with revision 1. Reuse this
                // reader with a new view revision so reload preserves scroll.
                document.revision = reader.read(cx).document.revision + 1;
                reader.update(cx, |reader, cx| reader.replace(document, cx));
                return;
            }
            let locale = self.locale.clone();
            let origin = document.origin.clone();
            let workspace = browser.tree.workspace.clone();
            let link_thread = thread.to_owned();
            let reader =
                cx.new(|cx| ContentReader::new(document, locale, window, cx).workspace(window, cx));
            browser.reader_subscription = Some(cx.subscribe_in(
                &reader,
                window,
                move |this, _, action, _, cx| {
                    let ReaderAction::Link(href) = action else {
                        return;
                    };
                    let link = pero_contracts::content_link::ContentLink::resolve(&origin, href);
                    if let Some(path) = link.workspace_file(&origin, &workspace) {
                        this.read_workspace_file(&link_thread, &path, cx);
                    } else if let pero_contracts::content_link::ContentLink::External(url) = link {
                        cx.open_url(&url);
                    } else {
                        let error = this.t("content.link_unavailable").to_owned();
                        if let Some(browser) = this.files.conversations.get_mut(&link_thread) {
                            browser.error = Some(error);
                        }
                        cx.notify();
                    }
                },
            ));
            browser.reader = Some(reader);
        }
    }

    pub(crate) fn file_key(
        &mut self,
        thread: &str,
        event: &KeyDownEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(browser) = self.files.conversations.get_mut(thread) else {
            return;
        };
        if event.keystroke.modifiers.platform
            || event.keystroke.modifiers.control
            || event.keystroke.modifiers.alt
        {
            return;
        }
        let key = event.keystroke.key.as_str();
        match key {
            "up" | "down" | "home" | "end" => {
                if let Some(index) = browser.tree.move_selection(match key {
                    "up" => -1,
                    "home" => isize::MIN,
                    "end" => isize::MAX,
                    _ => 1,
                }) {
                    browser
                        .scroll
                        .scroll_to_item(index, ScrollStrategy::Nearest);
                }
            }
            "enter" | "space" => {
                if let Some(path) = browser.tree.selected.clone() {
                    self.activate_file(thread, &path, cx);
                }
            }
            "right" => {
                if let Some(row) = browser.tree.selected_row().cloned() {
                    if row
                        .entry
                        .is_some_and(|entry| entry.kind == EntryKind::Directory)
                    {
                        if !browser.tree.expanded.contains(&row.path) {
                            self.activate_file(thread, &row.path, cx);
                        } else {
                            browser.tree.move_selection(1);
                        }
                    }
                }
            }
            "left" => {
                if let Some(path) = browser.tree.selected.clone() {
                    if browser.tree.expanded.contains(&path) {
                        browser.tree.toggle(&path);
                    } else if let Some((parent, _)) = path.rsplit_once('/') {
                        browser.tree.selected = Some(parent.into());
                    }
                }
            }
            "escape" => {
                self.artifacts
                    .conversations
                    .entry(thread.into())
                    .or_default()
                    .open = false;
                self.composer.focus_handle(cx).focus(window, cx);
            }
            _ => return,
        }
        if let Some(browser) = self.files.conversations.get(thread) {
            if let Some(index) = browser
                .tree
                .rows
                .iter()
                .position(|row| Some(&row.path) == browser.tree.selected.as_ref())
            {
                browser
                    .scroll
                    .scroll_to_item(index, ScrollStrategy::Nearest);
            }
        }
        cx.stop_propagation();
        cx.notify();
    }

    pub(crate) fn files_snapshot(&self, cx: &App) -> serde_json::Value {
        let thread = self
            .active_chat
            .and_then(|index| self.chats.get(index))
            .map(|chat| chat.id.as_str());
        let browser = thread.and_then(|thread| self.files.conversations.get(thread));
        serde_json::json!({"tab":self.files.selection.tab,"thread":thread,"browser":browser.map(|b|serde_json::json!({
            "workspace":b.tree.workspace,"selected":b.tree.selected,"expanded":b.tree.expanded,"previewPath":b.preview_path,"previewOpen":b.preview_open,
            "pending":b.pending,"error":b.error,"rows":b.tree.rows.iter().map(|row|serde_json::json!({"path":row.path,"depth":row.depth,"entry":row.entry,"notice":format!("{:?}",row.notice)})).collect::<Vec<_>>(),
            "reader":b.reader.as_ref().map(|reader|reader.read(cx).snapshot(cx)),"bounds":b.bounds.iter().map(|(key,bounds)|(key,bounds.snapshot())).collect::<std::collections::BTreeMap<_,_>>()
        }))})
    }
}
