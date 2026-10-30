//! Changed drafts travel as bounded ordered edits; reading-only checkpoints carry references.
use crate::{app::Workbench, workspace::WorkspaceItem};
use gpui_kit::*;
use pero_contracts::{
    content_document::ContentDocument,
    content_origin::ContentOrigin,
    workspace_draft::{DraftEdit, DraftRef, DraftUpdate},
    workspace_session::SourceKey,
};
const DRAFT_BATCH_BYTES: usize = 256 * 1024;
const DRAFT_BATCH_EDITS: usize = 256;
pub(crate) struct DraftUpload {
    pub source: SourceKey,
    pub reference: Option<DraftRef>,
    edits: Vec<DraftEdit>,
    pending: Vec<(String, DraftUpdate)>,
    save_tail: Option<Vec<DraftEdit>>,
}
impl DraftUpload {
    fn new(source: SourceKey, reference: Option<DraftRef>) -> Self {
        Self {
            source,
            reference,
            edits: vec![],
            pending: vec![],
            save_tail: None,
        }
    }
    fn edit(&mut self, edit: DraftEdit) {
        if let Some(tail) = &mut self.save_tail {
            tail.push(edit.clone());
        }
        self.edits.push(edit);
    }
}
impl Workbench {
    pub(crate) fn restore_workspace_draft(
        &mut self,
        source: SourceKey,
        reference: Option<DraftRef>,
        legacy: Option<&str>,
        baseline_len: usize,
    ) {
        self.recovery.drafts.retain(|draft| draft.source != source);
        let mut state = DraftUpload::new(source, reference);
        if state.reference.is_none() {
            if let Some(text) = legacy {
                state.edit(DraftEdit {
                    old: 0..baseline_len,
                    inserted: text.to_owned(),
                });
            }
        }
        self.recovery.drafts.push(state);
    }
    pub(crate) fn record_workspace_draft_edit(
        &mut self,
        item: &WorkspaceItem,
        old: std::ops::Range<usize>,
        inserted: &str,
        cx: &App,
    ) {
        let Some(source) = self
            .documents
            .iter()
            .find(|open| &open.item == item)
            .map(|open| SourceKey::of(&open.view.read(cx).document.header()))
        else {
            return;
        };
        if !matches!(source.origin, ContentOrigin::File { .. }) {
            return;
        }
        let index = if let Some(index) = self
            .recovery
            .drafts
            .iter()
            .position(|draft| draft.source == source)
        {
            index
        } else {
            self.recovery.drafts.push(DraftUpload::new(source, None));
            self.recovery.drafts.len() - 1
        };
        self.recovery.drafts[index].edit(DraftEdit {
            old,
            inserted: inserted.to_owned(),
        });
    }
    pub(crate) fn flush_workspace_draft(
        &mut self,
        document: &ContentDocument,
        dirty: bool,
        cx: &mut Context<Self>,
    ) -> Option<DraftRef> {
        let key = SourceKey::of(&document.header());
        let index = self
            .recovery
            .drafts
            .iter()
            .position(|draft| draft.source == key)?;
        if !dirty {
            let draft = &mut self.recovery.drafts[index];
            draft.reference = None;
            draft.edits.clear();
            draft.pending.clear();
            return None;
        }
        let state = &mut self.recovery.drafts[index];
        let mut split = vec![];
        for edit in state.edits.drain(..) {
            if edit.inserted.len() <= DRAFT_BATCH_BYTES {
                split.push(edit);
                continue;
            }
            let mut offset = 0;
            let mut first = true;
            while offset < edit.inserted.len() {
                let mut end = (offset + DRAFT_BATCH_BYTES).min(edit.inserted.len());
                while !edit.inserted.is_char_boundary(end) {
                    end -= 1;
                }
                split.push(DraftEdit {
                    old: if first {
                        edit.old.clone()
                    } else {
                        (edit.old.start + offset)..(edit.old.start + offset)
                    },
                    inserted: edit.inserted[offset..end].to_owned(),
                });
                first = false;
                offset = end;
            }
        }
        let mut batch = vec![];
        let mut bytes = 0;
        let mut batches = vec![];
        for edit in split {
            if !batch.is_empty()
                && (batch.len() >= DRAFT_BATCH_EDITS
                    || bytes + edit.inserted.len() > DRAFT_BATCH_BYTES)
            {
                batches.push(std::mem::take(&mut batch));
                bytes = 0;
            }
            bytes += edit.inserted.len();
            batch.push(edit);
        }
        if !batch.is_empty() {
            batches.push(batch);
        }
        for edits in batches {
            let base = state.reference.clone();
            let draft = DraftRef {
                source: key.clone(),
                version: base.as_ref().map_or(1, |reference| reference.version + 1),
            };
            let update = DraftUpdate {
                base,
                draft: draft.clone(),
                edits,
            };
            self.recovery.sequence += 1;
            let request = format!("workspace-draft:{}", self.recovery.sequence);
            state.pending.push((request, update));
            state.reference = Some(draft);
        }
        let reference = state.reference.clone();
        let pending = state.pending.clone();
        for (request, update) in pending {
            self.command(serde_json::json!({"method":"workspace","action":"store_draft","request_id":request,"base":update.base,"draft":update.draft,"edits":update.edits}),cx);
        }
        reference
    }
    pub(crate) fn acknowledge_workspace_draft(&mut self, request: &str) {
        for state in &mut self.recovery.drafts {
            state.pending.retain(|(id, _)| id != request);
        }
    }
    pub(crate) fn begin_workspace_file_save(
        &mut self,
        item: &WorkspaceItem,
        cx: &mut Context<Self>,
    ) -> Option<DraftRef> {
        let view = self.active_document_view(item)?;
        let document = view.read(cx).document.clone();
        let dirty = view.read(cx).dirty();
        if self
            .recovery
            .drafts
            .iter()
            .find(|draft| draft.source == SourceKey::of(&document.header()))
            .is_some_and(|state| state.save_tail.is_some())
        {
            return None;
        }
        let reference = self.flush_workspace_draft(&document, dirty, cx)?;
        if let Some(state) = self
            .recovery
            .drafts
            .iter_mut()
            .find(|state| state.source == reference.source)
        {
            state.save_tail = Some(vec![]);
        }
        Some(reference)
    }
    pub(crate) fn workspace_file_busy(&self, source: &SourceKey) -> bool {
        self.recovery
            .drafts
            .iter()
            .any(|state| &state.source == source && state.save_tail.is_some())
    }
    pub(crate) fn begin_workspace_file_copy(&mut self, source: SourceKey) {
        if let Some(state) = self
            .recovery
            .drafts
            .iter_mut()
            .find(|state| state.source == source)
        {
            state.save_tail = Some(vec![]);
        } else {
            let mut state = DraftUpload::new(source, None);
            state.save_tail = Some(vec![]);
            self.recovery.drafts.push(state);
        }
    }
    pub(crate) fn copied_workspace_file(
        &mut self,
        original: &WorkspaceItem,
        document: &ContentDocument,
    ) {
        let WorkspaceItem::Document { source, .. } = original else {
            return;
        };
        let mut tail = vec![];
        self.recovery.drafts.retain_mut(|state| {
            if state.source.source == *source {
                tail = state.save_tail.take().unwrap_or_default();
                false
            } else {
                true
            }
        });
        let mut state = DraftUpload::new(SourceKey::of(&document.header()), None);
        state.edits = tail;
        self.recovery.drafts.push(state);
    }
    pub(crate) fn saved_workspace_file(&mut self, old_source: &str, document: &ContentDocument) {
        let mut tail = vec![];
        self.recovery.drafts.retain_mut(|state| {
            if state.source.source == old_source {
                tail = state.save_tail.take().unwrap_or_default();
                false
            } else {
                true
            }
        });
        let mut state = DraftUpload::new(SourceKey::of(&document.header()), None);
        state.edits = tail;
        self.recovery.drafts.push(state);
    }
    pub(crate) fn failed_workspace_file_save(&mut self, source: &str) {
        for state in &mut self.recovery.drafts {
            if state.source.source == source {
                state.save_tail = None;
            }
        }
    }
}
