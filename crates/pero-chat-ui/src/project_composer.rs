use crate::{
    conversation::ComposerDraft,
    panel::{ChatAction, ChatPanel},
};
use gpui_kit::{component::input::InputContent, *};
use std::collections::HashMap;

/// The project workspace and admission state come from the Workbench.
pub struct ProjectComposerScope {
    pub project_id: String,
    pub workspace: Option<String>,
    pub ready: bool,
}

#[derive(Default)]
pub(crate) struct ProjectComposer {
    pub(crate) scope: Option<ProjectComposerScope>,
    drafts: HashMap<String, ComposerDraft>,
    starting: HashMap<String, ComposerDraft>,
}

impl ChatPanel {
    /// Show the shared composer before the project has an ACP conversation.
    pub fn set_project_composer(
        &mut self,
        scope: Option<ProjectComposerScope>,
        cx: &mut Context<Self>,
    ) -> bool {
        let previous = self.project_composer.scope.take();
        let next = scope.as_ref().map(|scope| scope.project_id.as_str());
        if previous.as_ref().map(|scope| scope.project_id.as_str()) == next {
            let changed = previous
                .as_ref()
                .zip(scope.as_ref())
                .is_some_and(|(previous, next)| {
                    previous.ready != next.ready || previous.workspace != next.workspace
                });
            self.project_composer.scope = scope;
            if changed {
                cx.notify();
            }
            return false;
        }
        let leaving = scope.is_none();
        if let Some(previous) = previous {
            let draft = self.current_composer_draft(cx);
            if !draft.content.text().is_empty() || !draft.references.is_empty() {
                self.project_composer
                    .drafts
                    .insert(previous.project_id, draft);
            }
        } else {
            if let Some(chat) = self.active_chat.and_then(|index| self.chats.get(index)) {
                self.scope_selection
                    .insert(self.scope.clone(), chat.id.clone());
            }
            self.focus_chat(None, cx);
        }
        let draft = next.and_then(|id| self.project_composer.drafts.remove(id));
        self.composer_state = Default::default();
        self.attachments.clear();
        if self.connected {
            self.error = None;
        }
        self.composer_restore = Some(if let Some(draft) = draft {
            self.composer_state.references = draft.references;
            draft.content
        } else {
            InputContent::new("")
        });
        self.project_composer.scope = scope;
        cx.notify();
        leaving
    }

    pub(crate) fn current_composer_draft(&self, cx: &App) -> ComposerDraft {
        ComposerDraft {
            content: self
                .composer_restore
                .clone()
                .unwrap_or_else(|| self.composer.read(cx).content()),
            references: self.composer_state.references.clone(),
        }
    }

    pub(crate) fn can_start_project(&self) -> bool {
        self.project_composer.scope.as_ref().is_some_and(|scope| {
            scope.ready
                && !self
                    .project_composer
                    .starting
                    .contains_key(&scope.project_id)
        })
    }

    pub(crate) fn project_starting(&self) -> bool {
        self.project_composer.scope.as_ref().is_some_and(|scope| {
            self.project_composer
                .starting
                .contains_key(&scope.project_id)
        })
    }

    pub(crate) fn start_project_from_composer(
        &mut self,
        draft: ComposerDraft,
        cx: &mut Context<Self>,
    ) {
        if !self.connected || !self.can_start_project() {
            return;
        }
        let Some(agent) = self
            .agents
            .get(self.agent_index)
            .filter(|agent| agent.available)
        else {
            return;
        };
        let project_id = self
            .project_composer
            .scope
            .as_ref()
            .unwrap()
            .project_id
            .clone();
        self.project_composer
            .starting
            .insert(project_id.clone(), draft);
        self.error = None;
        cx.emit(ChatAction::StartProjectAgent {
            project_id,
            agent_id: agent.id.clone(),
        });
        cx.notify();
    }

    pub fn project_start_failed(&mut self, project_id: &str, cx: &mut Context<Self>) {
        if self.project_composer.starting.remove(project_id).is_some() {
            cx.notify();
        }
    }

    /// Move the first draft to the acknowledged Project session and use its normal
    /// submit/queue path. A provider that still needs sign-in keeps the editable draft.
    pub fn finish_project_start(
        &mut self,
        project_id: &str,
        thread_id: &str,
        cx: &mut Context<Self>,
    ) {
        let Some(draft) = self.project_composer.starting.remove(project_id) else {
            return;
        };
        let Some(index) = self.chats.iter().position(|chat| {
            chat.id == thread_id
                && chat.project_agent.as_ref().is_some_and(|binding| {
                    binding.project_id == project_id && binding.parent_thread.is_none()
                })
        }) else {
            return;
        };
        let current = self
            .project_composer
            .scope
            .as_ref()
            .is_some_and(|scope| scope.project_id == project_id);
        if current {
            self.project_composer.scope = None;
            self.composer_restore = Some(InputContent::new(""));
            self.composer_state = Default::default();
            self.attachments.clear();
        }
        self.project_composer.drafts.remove(project_id);
        let text = draft.content.text().trim_end().to_owned();
        let contexts = ComposerDraft::contexts(&draft.content, &draft.references);
        if self.submit_prompt_to(index, text, contexts, cx) {
            if self.chats[index].queued.is_some() {
                self.chats[index].queued_draft = Some(draft);
            }
        } else {
            self.chats[index].draft = draft.content;
            self.chats[index].draft_references = draft.references;
        }
        cx.notify();
    }

    pub(crate) fn composer_placeholder(&self) -> &'static str {
        let chat = self.active_chat.and_then(|index| self.chats.get(index));
        self.t(if self.project_composer.scope.is_some() {
            "project.agent.first_prompt"
        } else if let Some(chat) = chat.filter(|chat| chat.project_agent.is_some()) {
            if chat.messages.is_empty() {
                "project.agent.first_prompt"
            } else {
                "project.agent.followup_prompt"
            }
        } else {
            "chat.placeholder"
        })
    }
}
