//! ChatPanel shell for the shared completion surface. Context I/O stays in Host.
use crate::session_state::SessionState;
use crate::{composer_picker::PickerItem, composer_state::*, panel::ChatPanel};
use base64::Engine as _;
use gpui_kit::{component::input::InlineToken, *};
use pero_contracts::{
    HostEvent,
    context::{ContextContent, ContextKind, ContextReference},
};
use serde_json::json;

impl ChatPanel {
    pub(crate) fn select_session_setting(
        &mut self,
        thread: &str,
        config_id: &str,
        value: &str,
        cx: &mut Context<Self>,
    ) {
        let Some(chat) = self.chats.iter_mut().find(|chat| chat.id == thread) else {
            return;
        };
        if chat.busy() || chat.pending_setting.is_some() || chat.pending_model.is_some() {
            return;
        }
        let Ok(pending) = chat.settings.select(config_id, value) else {
            return;
        };
        chat.pending_setting = Some(pending);
        chat.error = None;
        self.command(
            json!({"action":"configure","thread_id":thread,"config_id":config_id,"value":value}),
            cx,
        );
    }

    pub(crate) fn composer_picker_items(&self) -> Vec<PickerItem> {
        self.composer_state
            .choices
            .iter()
            .map(|choice| match choice {
                ComposerChoice::Source(kind) => PickerItem {
                    icon: Self::context_kind_icon(*kind),
                    label: self.context_kind_label(*kind).into(),
                    detail: String::new(),
                    group: self.t("composer.context").into(),
                },
                ComposerChoice::Context(candidate) => PickerItem {
                    icon: Self::context_kind_icon(candidate.kind),
                    label: candidate.label.clone(),
                    detail: candidate.detail.clone(),
                    group: self.context_kind_label(candidate.kind).into(),
                },
                ComposerChoice::Command { name, description } => PickerItem {
                    icon: "icons/terminal.svg",
                    label: name.clone(),
                    detail: description.clone(),
                    group: self.t("composer.commands").into(),
                },
            })
            .collect()
    }

    pub(crate) fn close_composer_picker(&mut self, cx: &mut Context<Self>) {
        self.composer_state.dismissed = self.composer_state.completion.clone();
        self.composer_state.open = false;
        self.composer_state.request = None;
        cx.notify();
    }

    pub(crate) fn update_composer_completion(&mut self, cx: &mut Context<Self>) {
        let editor = self.composer.read(cx);
        self.attachments = editor
            .tokens()
            .iter()
            .filter_map(|span| {
                self.composer_state
                    .references
                    .get(span.token().id().as_ref())
                    .cloned()
            })
            .collect();
        self.attachments.dedup_by(|a, b| a.id == b.id);
        let completion = CompletionQuery::at(&editor.value(), editor.cursor()).filter(|q| {
            !editor
                .tokens()
                .iter()
                .any(|span| span.range().contains(&q.range.start))
        });
        if completion == self.composer_state.completion {
            return;
        }
        self.composer_state.completion = completion.clone();
        self.composer_state.request = None;
        self.composer_state.loading = false;
        self.composer_state.error = None;
        self.composer_state.selected = 0;
        self.composer_state.choices.clear();
        let Some(completion) =
            completion.filter(|q| Some(q) != self.composer_state.dismissed.as_ref())
        else {
            self.composer_state.open = false;
            return;
        };
        self.composer_state.open = true;
        self.composer_state.query = completion.query.clone();
        match completion.kind {
            CompletionKind::Mention(None) => {
                self.composer_state.title = self.t("composer.context").into();
                let images = self
                    .active_chat
                    .and_then(|i| self.chats.get(i))
                    .is_some_and(|c| c.capabilities.images);
                self.composer_state.choices = [
                    ContextKind::File,
                    ContextKind::Directory,
                    ContextKind::Symbol,
                    ContextKind::Thread,
                    ContextKind::Skill,
                    ContextKind::Image,
                    ContextKind::Fetch,
                    ContextKind::BranchDiff,
                ]
                .into_iter()
                .filter(|kind| {
                    (*kind != ContextKind::Image || images)
                        && self
                            .context_kind_label(*kind)
                            .to_lowercase()
                            .contains(&completion.query.to_lowercase())
                })
                .map(ComposerChoice::Source)
                .collect();
                // Unqualified @foo also searches workspace files.
                if !completion.query.is_empty() {
                    self.search_composer_context(ContextKind::File, &completion.query, cx);
                }
            }
            CompletionKind::Mention(Some(kind)) => {
                self.composer_state.title = self.context_kind_label(kind).into();
                if kind == ContextKind::Image
                    && !self
                        .active_chat
                        .and_then(|i| self.chats.get(i))
                        .is_some_and(|c| c.capabilities.images)
                {
                    self.composer_state.error = Some(self.t("composer.image_unsupported").into());
                    return;
                }
                self.search_composer_context(kind, &completion.query, cx);
            }
            CompletionKind::Slash => {
                self.composer_state.title = self.t("composer.commands").into();
                self.refresh_composer_commands();
                self.search_composer_context(ContextKind::Skill, &completion.query, cx);
            }
        }
    }

    pub(crate) fn refresh_composer_commands(&mut self) {
        let query = self.composer_state.query.to_lowercase();
        self.composer_state
            .choices
            .retain(|c| !matches!(c, ComposerChoice::Command { .. }));
        if let Some(chat) = self.active_chat.and_then(|i| self.chats.get(i)) {
            let commands = chat
                .commands
                .iter()
                .filter(|c| c.name.to_lowercase().contains(&query))
                .map(|c| ComposerChoice::Command {
                    name: c.name.clone(),
                    description: c.description.clone(),
                })
                .collect::<Vec<_>>();
            self.composer_state.choices.splice(0..0, commands);
        }
    }

    fn search_composer_context(&mut self, kind: ContextKind, query: &str, cx: &mut Context<Self>) {
        self.next_request += 1;
        let id = format!("context-{}", self.next_request);
        self.composer_state.request = Some(id.clone());
        self.composer_state.loading = true;
        self.command(
            json!({"action":"search_context","request_id":id,"kind":kind,"query":query}),
            cx,
        );
    }

    pub(crate) fn browse_composer_context(&mut self, kind: ContextKind, cx: &mut Context<Self>) {
        self.next_request += 1;
        let request = format!("browse-{}", self.next_request);
        self.composer_state.paste_requests.insert(request.clone());
        self.close_composer_picker(cx);
        self.command(
            json!({"action":"choose_context","kind":kind,"request_id":request}),
            cx,
        );
    }

    pub(crate) fn open_context_source(
        &mut self,
        kind: ContextKind,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if kind == ContextKind::Selection {
            return;
        }
        let name = kind.keyword();
        let range = self
            .composer_state
            .completion
            .as_ref()
            .filter(|_| self.composer_state.open)
            .map(|q| q.range.clone())
            .unwrap_or_else(|| self.composer.read(cx).selected_range());
        self.composer_state.dismissed = None;
        let prefix = if range.start > 0
            && !self.composer.read(cx).value()[..range.start].ends_with(char::is_whitespace)
        {
            " "
        } else {
            ""
        };
        self.replace_composer_range(range, &format!("{prefix}@{name} "), window, cx);
        self.update_composer_completion(cx);
        self.composer
            .update(cx, |input, cx| input.focus(window, cx));
    }

    pub(crate) fn replace_composer_range(
        &mut self,
        range: std::ops::Range<usize>,
        text: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.composer.update(cx, |input, cx| {
            let value = input.value();
            let range = value[..range.start].encode_utf16().count()
                ..value[..range.end].encode_utf16().count();
            input.replace_text_in_range(Some(range), text, window, cx);
        });
    }

    pub(crate) fn select_composer_candidate(
        &mut self,
        index: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.composer_state.loading {
            return;
        }
        let Some(choice) = self.composer_state.choices.get(index).cloned() else {
            return;
        };
        match choice {
            ComposerChoice::Source(kind) => self.open_context_source(kind, window, cx),
            ComposerChoice::Command { name, .. } => {
                if let Some(query) = self.composer_state.completion.clone() {
                    self.close_composer_picker(cx);
                    self.replace_composer_range(query.range, &format!("/{name} "), window, cx);
                }
            }
            ComposerChoice::Context(candidate) => {
                self.next_request += 1;
                let id = format!("resolve-{}", self.next_request);
                self.composer_state.request = Some(id.clone());
                self.composer_state.resolve_range = self
                    .composer_state
                    .completion
                    .as_ref()
                    .map(|q| q.range.clone());
                self.composer_state.loading = true;
                self.command(json!({"action":"resolve_context","request_id":id,"kind":candidate.kind,"source":candidate.source}),cx);
            }
        }
    }

    pub(crate) fn receive_composer(&mut self, event: &HostEvent, cx: &mut Context<Self>) -> bool {
        if !matches!(
            event.kind.as_str(),
            "context_candidates" | "context_resolved" | "context_error"
        ) {
            return false;
        }
        if event
            .request_id
            .as_ref()
            .is_some_and(|id| self.composer_state.paste_requests.remove(id))
        {
            if event.kind == "context_resolved" {
                match serde_json::from_value(event.data.clone()) {
                    Ok(reference) => self.composer_state.pending_files.push(reference),
                    Err(error) => self.error = Some(error.to_string()),
                }
            } else {
                self.error = Some(event.text.clone());
            }
            cx.notify();
            return true;
        }
        if event.request_id != self.composer_state.request {
            return true;
        }
        self.composer_state.loading = false;
        match event.kind.as_str() {
            "context_candidates" => match serde_json::from_value::<
                Vec<pero_contracts::context::ContextCandidate>,
            >(event.data.clone())
            {
                Ok(candidates) => {
                    self.composer_state
                        .choices
                        .retain(|c| !matches!(c, ComposerChoice::Context(_)));
                    self.composer_state
                        .choices
                        .extend(candidates.into_iter().map(ComposerChoice::Context));
                }
                Err(error) => self.composer_state.error = Some(error.to_string()),
            },
            "context_resolved" => {
                // The selected text has not changed: its exact completion request is still active.
                match serde_json::from_value::<ContextReference>(event.data.clone()) {
                    Ok(reference) => {
                        self.composer_state.resolved = Some(reference);
                    }
                    Err(error) => self.composer_state.error = Some(error.to_string()),
                }
            }
            _ => {
                self.composer_state.error = Some(event.text.clone());
                if !self.composer_state.open {
                    self.error = Some(event.text.clone());
                }
            }
        }
        cx.notify();
        true
    }

    pub(crate) fn composer_key_down(
        &mut self,
        event: &KeyDownEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if event.keystroke.modifiers.shift {
            return;
        }
        self.composer_action(&event.keystroke.key, window, cx);
    }

    pub(crate) fn composer_action(
        &mut self,
        key: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if !self.composer_state.open {
            return false;
        }
        if self.composer.update(cx, |input, cx| {
            input.marked_text_range(window, cx).is_some()
        }) {
            return false;
        }
        match key {
            "up" | "down" => {
                let count = self.composer_state.choices.len();
                if count > 0 {
                    self.composer_state.selected = if key == "down" {
                        (self.composer_state.selected + 1) % count
                    } else {
                        (self.composer_state.selected + count - 1) % count
                    };
                }
            }
            "enter" | "tab" => {
                self.select_composer_candidate(self.composer_state.selected, window, cx)
            }
            "escape" => self.close_composer_picker(cx),
            _ => return false,
        }
        self.composer_picker_scroll
            .scroll_to_item(self.composer_state.selected);
        window.prevent_default();
        cx.stop_propagation();
        cx.notify();
        true
    }

    pub(crate) fn remove_composer_context(
        &mut self,
        index: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(reference) = self.attachments.get(index) else {
            return;
        };
        let ranges = self
            .composer
            .read(cx)
            .tokens()
            .iter()
            .filter(|span| span.token().id().as_ref() == reference.id)
            .map(|s| s.range())
            .collect::<Vec<_>>();
        self.attachments.remove(index);
        for range in ranges.into_iter().rev() {
            self.replace_composer_range(range, "", window, cx);
        }
        cx.notify();
    }

    pub(crate) fn apply_composer_context(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(draft) = self.composer_restore.take() {
            self.composer
                .update(cx, |input, cx| input.set_value(draft, window, cx));
            self.update_composer_completion(cx);
        }
        if let Some(reference) = self.composer_state.resolved.take() {
            let range = self
                .composer_state
                .resolve_range
                .take()
                .unwrap_or_else(|| self.composer.read(cx).selected_range());
            self.insert_composer_reference(reference, range, window, cx);
        }
        let pending = std::mem::take(&mut self.composer_state.pending_files);
        for reference in pending {
            self.insert_composer_reference(
                reference,
                self.composer.read(cx).selected_range(),
                window,
                cx,
            );
        }
    }

    pub(crate) fn insert_composer_reference(
        &mut self,
        reference: ContextReference,
        range: std::ops::Range<usize>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if reference.kind == ContextKind::Image
            && !self
                .active_chat
                .and_then(|i| self.chats.get(i))
                .is_some_and(|c| c.state == SessionState::Draft || c.capabilities.images)
        {
            self.error = Some(self.t("composer.image_unsupported").into());
            self.close_composer_picker(cx);
            return;
        }
        let mut next = self.attachments.clone();
        if !next.iter().any(|r| r.id == reference.id) {
            next.push(reference.clone());
        }
        if let Err(error) = ContextReference::validate_all(&next) {
            self.composer_state.error = Some(error.into());
            self.error = Some(error.into());
            cx.notify();
            return;
        }
        let token = InlineToken::new(
            reference.id.clone(),
            format!("@{}", reference.label.replace(['\n', '\r', '\t'], " ")),
        )
        .with_label(reference.label.clone());
        self.composer_state
            .references
            .insert(reference.id.clone(), reference);
        self.close_composer_picker(cx);
        let result = self.composer.update(cx, |input, cx| {
            input.replace_range_with_token(range, token, window, cx)
        });
        if let Err(error) = result {
            self.error = Some(error.to_string());
        } else {
            self.composer.update(cx, |input, cx| {
                input.insert(" ", window, cx);
                input.focus(window, cx);
            });
        }
        self.update_composer_completion(cx);
    }

    pub fn queue_composer_image(
        &mut self,
        data: String,
        mime_type: String,
        cx: &mut Context<Self>,
    ) {
        if !self
            .active_chat
            .and_then(|i| self.chats.get(i))
            .is_some_and(|c| c.capabilities.images)
        {
            self.error = Some(self.t("composer.image_unsupported").into());
            cx.notify();
            return;
        }
        self.next_request += 1;
        let reference = ContextReference {
            id: format!("clipboard-{}", self.next_request),
            kind: ContextKind::Image,
            label: self.t("composer.image").into(),
            source: "clipboard:image".into(),
            content: ContextContent::Image { data, mime_type },
        };
        let mut next = self.attachments.clone();
        next.push(reference.clone());
        match ContextReference::validate_all(&next) {
            Ok(()) => self.composer_state.pending_files.push(reference),
            Err(error) => self.error = Some(error.into()),
        }
        cx.notify();
    }

    pub(crate) fn composer_paste(
        &mut self,
        clipboard: &ClipboardItem,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let mut consumed = false;
        for entry in clipboard.entries() {
            match entry {
                ClipboardEntry::Image(image) => {
                    consumed = true;
                    if !self
                        .active_chat
                        .and_then(|i| self.chats.get(i))
                        .is_some_and(|c| c.capabilities.images)
                    {
                        self.error = Some(self.t("composer.image_unsupported").into());
                        continue;
                    }
                    let mime = match image.format() {
                        ImageFormat::Png => "image/png",
                        ImageFormat::Jpeg => "image/jpeg",
                        ImageFormat::Gif => "image/gif",
                        ImageFormat::Webp => "image/webp",
                        _ => {
                            self.error = Some(self.t("composer.image_format").into());
                            continue;
                        }
                    };
                    self.next_request += 1;
                    let reference = ContextReference {
                        id: format!("clipboard-{}", self.next_request),
                        kind: ContextKind::Image,
                        label: "Image".into(),
                        source: "clipboard:image".into(),
                        content: ContextContent::Image {
                            data: base64::engine::general_purpose::STANDARD.encode(image.bytes()),
                            mime_type: mime.into(),
                        },
                    };
                    let mut next = self.attachments.clone();
                    next.push(reference.clone());
                    if let Err(error) = ContextReference::validate_all(&next) {
                        self.error = Some(error.into());
                        continue;
                    }
                    self.insert_composer_reference(
                        reference,
                        self.composer.read(cx).selected_range(),
                        window,
                        cx,
                    );
                }
                ClipboardEntry::ExternalPaths(paths) => {
                    consumed = true;
                    for path in paths.paths() {
                        self.next_request += 1;
                        let request = format!("paste-file-{}", self.next_request);
                        self.composer_state.paste_requests.insert(request.clone());
                        let image = path.extension().and_then(|s| s.to_str()).is_some_and(|s| {
                            matches!(
                                s.to_ascii_lowercase().as_str(),
                                "png" | "jpg" | "jpeg" | "gif" | "webp"
                            )
                        });
                        self.command(json!({"action":"resolve_context","request_id":request,"kind":if image {ContextKind::Image} else {ContextKind::File},"source":path}),cx);
                    }
                }
                _ => {}
            }
        }
        consumed
    }
}
