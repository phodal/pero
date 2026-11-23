//! Discovery combines the current shell targets with the Agent's negotiated tools.
use crate::{
    composer_picker::PickerItem,
    composer_state::{CompletionKind, ComposerChoice},
    panel::ChatPanel,
    session_state::SessionState,
};
use gpui_kit::*;
use pero_contracts::{
    HostEvent,
    capability_selection::{
        CapabilitySelection as Sel, CapabilitySetup, ComposerCapability, ScienceLanguage,
    },
    context::{ContextContent, ContextKind, ContextReference},
};
use serde_json::json;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Section {
    Capabilities,
    Remote,
    Apps,
    Connectors,
}

impl Section {
    fn of(choice: &ComposerChoice) -> Self {
        match choice {
            ComposerChoice::RemoteTask(_) | ComposerChoice::OpenCompute => Self::Remote,
            ComposerChoice::Capability(cap) => match &cap.selection {
                Sel::RemoteDesktop { .. } => Self::Remote,
                Sel::AppData { .. } | Sel::AppPanel { .. } => Self::Apps,
                Sel::Connector { .. } => Self::Connectors,
                _ => Self::Capabilities,
            },
            _ => Self::Capabilities,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Capabilities => "composer.controls",
            Self::Remote => "composer.remote",
            Self::Apps => "nav.apps",
            Self::Connectors => "composer.connectors",
        }
    }
}

impl ChatPanel {
    pub(crate) fn open_composer_add(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.composer_state.open {
            self.close_composer_picker(cx);
            return;
        }
        self.composer
            .update(cx, |input, cx| input.focus(window, cx));
        let input = self.composer.read(cx);
        let cursor = input.cursor();
        let value = input.value();
        self.composer_state.add_anchor = Some((value[..cursor].into(), value[cursor..].into()));
        self.composer_state.completion = None;
        self.update_composer_completion(cx);
        cx.notify();
    }

    pub fn set_composer_destinations(
        &mut self,
        project: Option<String>,
        compute: bool,
        cx: &mut Context<Self>,
    ) {
        if self.remote_project == project && self.compute_available == compute {
            return;
        }
        self.remote_project = project;
        self.compute_available = compute;
        self.refresh_composer_shortcuts();
        cx.notify();
    }

    pub(crate) fn catalog_item(&self, choice: &ComposerChoice) -> PickerItem {
        let (icon, label, detail) = match choice {
            ComposerChoice::Capability(cap) => {
                let (icon, label, detail) = match &cap.selection {
                    Sel::Browser => (
                        "icons/globe.svg",
                        "Browser Use".into(),
                        "composer.browser_use_detail",
                    ),
                    Sel::BrowserTab { tab_id, origin } => {
                        return PickerItem {
                            icon: "icons/globe.svg",
                            label: format!(
                                "Browser Use · {}",
                                cap.target.as_deref().unwrap_or(tab_id)
                            ),
                            detail: origin.clone(),
                            group: self.t("composer.controls").into(),
                        };
                    }
                    Sel::Computer => (
                        "icons/devices.svg",
                        "Computer Use".into(),
                        "composer.computer_use_detail",
                    ),
                    Sel::RemoteDesktop { .. } => (
                        "icons/devices.svg",
                        "Remote Use · Linux Desktop".into(),
                        "composer.linux_detail",
                    ),
                    Sel::AppData { app, panel } | Sel::AppPanel { app, panel, .. } => {
                        let name = app
                            .split('-')
                            .map(|word| {
                                let mut chars = word.chars();
                                chars.next().map_or(String::new(), |c| {
                                    c.to_uppercase().collect::<String>() + chars.as_str()
                                })
                            })
                            .collect::<Vec<_>>()
                            .join(" ");
                        let panel = if panel == "main" {
                            String::new()
                        } else {
                            format!(" · {panel}")
                        };
                        let data = matches!(&cap.selection, Sel::AppData { .. });
                        let kind = self.t(if data {
                            "composer.app_data"
                        } else {
                            "composer.app_panel"
                        });
                        (
                            "icons/code.svg",
                            format!("App Use · {name}{panel} · {kind}"),
                            if data {
                                "composer.app_data_detail"
                            } else {
                                "composer.app_panel_detail"
                            },
                        )
                    }
                    Sel::Connector { connector_id } => (
                        "icons/globe.svg",
                        connector_id.clone(),
                        "composer.connector_detail",
                    ),
                    Sel::ProjectDelegate => (
                        "icons/devices.svg",
                        self.t("composer.delegate").into(),
                        "composer.delegate_detail",
                    ),
                    Sel::Science { language } => (
                        "icons/terminal.svg",
                        match language {
                            ScienceLanguage::Python => "Python",
                            ScienceLanguage::R => "R",
                        }
                        .into(),
                        "composer.science_detail",
                    ),
                };
                (
                    icon,
                    label,
                    self.t(match cap.needs {
                        Some(CapabilitySetup::TabGrant) => "composer.tab_grant",
                        Some(CapabilitySetup::ComputerEnabled) => "composer.enable_computer",
                        Some(CapabilitySetup::PanelVisible) => "composer.show_panel",
                        None => detail,
                    })
                    .into(),
                )
            }
            ComposerChoice::RemoteTask(project) => (
                "icons/devices.svg",
                self.t("composer.remote_task").into(),
                format!("{} · {project}", self.t("composer.remote_task_detail")),
            ),
            ComposerChoice::OpenCompute => (
                "icons/terminal.svg",
                self.t("composer.remote_compute").into(),
                self.t("composer.remote_compute_detail").into(),
            ),
            ComposerChoice::Browse(kind) => {
                return PickerItem {
                    icon: Self::context_kind_icon(*kind),
                    label: self
                        .t(match kind {
                            ContextKind::Image => "composer.browse_image",
                            ContextKind::Directory => "composer.browse_directory",
                            _ => "composer.browse",
                        })
                        .into(),
                    detail: String::new(),
                    group: self.t("composer.context").into(),
                };
            }
            _ => unreachable!("only catalog entries have capability labels"),
        };
        PickerItem {
            icon,
            label,
            detail,
            group: self.t(Section::of(choice).label()).into(),
        }
    }

    pub(crate) fn request_composer_catalog(&mut self, cx: &mut Context<Self>) {
        let Some(chat) = self.active_chat.and_then(|i| self.chats.get(i)) else {
            return;
        };
        if chat.state == SessionState::Closed {
            return;
        }
        self.next_request += 1;
        let request = format!("capabilities-{}", self.next_request);
        self.composer_state.catalog_request = Some(request.clone());
        self.command(
            json!({"action":"composer_catalog","thread_id":chat.id,"request_id":request}),
            cx,
        );
    }

    fn available_capabilities(&self) -> Vec<ComposerCapability> {
        let Some(chat) = self.active_chat.and_then(|i| self.chats.get(i)) else {
            return vec![];
        };
        if chat.state == SessionState::Closed {
            return vec![];
        }
        let mut entries = self.composer_state.catalog.clone();
        if chat
            .project_agent
            .as_ref()
            .is_some_and(|binding| binding.parent_thread.is_none())
        {
            entries.push(ComposerCapability {
                selection: Sel::ProjectDelegate,
                target: None,
                needs: None,
            });
        }
        if chat
            .scope
            .as_ref()
            .is_some_and(|scope| scope.app == "notebook")
        {
            entries.extend(
                [ScienceLanguage::Python, ScienceLanguage::R].map(|language| ComposerCapability {
                    selection: Sel::Science { language },
                    target: None,
                    needs: None,
                }),
            );
        }
        entries.retain(|cap| {
            cap.selection
                .mounted(chat.mcp.as_ref(), chat.capabilities.science_session)
        });
        entries
    }

    pub(crate) fn refresh_composer_shortcuts(&mut self) {
        let Some(completion) = self.composer_state.completion.as_ref() else {
            return;
        };
        if !self.composer_state.open || matches!(completion.kind, CompletionKind::Mention(Some(_)))
        {
            return;
        }
        let query = completion.query.to_lowercase().replace(['-', '_'], " ");
        let mut choices: Vec<_> = self
            .available_capabilities()
            .into_iter()
            .map(ComposerChoice::Capability)
            .collect();
        if let Some(project) = &self.remote_project {
            choices.push(ComposerChoice::RemoteTask(project.clone()));
        }
        if self.compute_available {
            choices.push(ComposerChoice::OpenCompute);
        }
        let app_scoped = self
            .active_chat
            .and_then(|i| self.chats.get(i))
            .is_some_and(|chat| chat.scope.is_some());
        choices.sort_by_key(|choice| {
            let section = Section::of(choice);
            (app_scoped && section != Section::Apps, section)
        });
        choices.retain(|choice| {
            let item = self.catalog_item(choice);
            format!("{} {} {}", item.group, item.label, item.detail)
                .to_lowercase()
                .replace(['-', '_'], " ")
                .contains(&query)
        });
        if completion.kind == CompletionKind::Slash {
            if let Some(chat) = self.active_chat.and_then(|i| self.chats.get(i)) {
                choices.extend(
                    chat.commands
                        .iter()
                        .filter(|c| {
                            c.name
                                .to_lowercase()
                                .contains(&completion.query.to_lowercase())
                        })
                        .map(|c| ComposerChoice::Command {
                            name: c.name.clone(),
                            description: c.description.clone(),
                        }),
                );
            }
        }
        let previous = &mut self.composer_state.choices;
        let selected = previous.get(self.composer_state.selected).cloned();
        let first_load = !self.composer_state.navigated;
        previous.retain(|c| {
            matches!(
                c,
                ComposerChoice::Source(_) | ComposerChoice::Context(_) | ComposerChoice::Browse(_)
            )
        });
        previous.splice(0..0, choices);
        self.composer_state.selected = if first_load {
            0
        } else {
            selected
                .and_then(|c| previous.iter().position(|x| *x == c))
                .unwrap_or(0)
        };
    }

    pub(crate) fn verify_composer_selection(
        &mut self,
        text: &str,
        contexts: &[ContextReference],
        cx: &mut Context<Self>,
    ) -> bool {
        if std::mem::take(&mut self.composer_state.validated) {
            return self
                .composer_state
                .verifying
                .take()
                .is_some_and(|(original, refs)| original == text && refs == contexts);
        }
        if !contexts
            .iter()
            .any(|r| matches!(r.content, ContextContent::Capability { .. }))
        {
            return true;
        }
        if self.composer_state.verifying.is_none() {
            self.composer_state.verifying = Some((text.into(), contexts.to_vec()));
            self.request_composer_catalog(cx);
            if self.composer_state.catalog_request.is_none() {
                self.composer_state.verifying = None;
                self.error = Some(self.t("composer.target_changed").into());
                cx.notify();
            }
        }
        false
    }

    pub(crate) fn receive_composer_catalog(&mut self, event: &HostEvent, cx: &mut Context<Self>) {
        let thread = self
            .active_chat
            .and_then(|i| self.chats.get(i))
            .map(|chat| &chat.id);
        if event.request_id.is_none()
            || self.composer_state.catalog_request != event.request_id
            || thread != event.thread_id.as_ref()
        {
            return;
        }
        self.composer_state.catalog_request = None;
        self.composer_state.catalog =
            serde_json::from_value(event.data.clone()).unwrap_or_default();
        self.refresh_composer_shortcuts();
        if !event.text.is_empty() {
            self.composer_state.error = Some(event.text.clone());
        }
        if let Some((_, refs)) = &self.composer_state.verifying {
            let available = self.available_capabilities();
            let blocker = refs.iter().find_map(|r| {
                let ContextContent::Capability { selection } = &r.content else {
                    return None;
                };
                match available.iter().find(|cap| &cap.selection == selection) {
                    None => Some("composer.target_changed"),
                    Some(cap) => match cap.needs {
                        Some(CapabilitySetup::ComputerEnabled) => Some("composer.enable_computer"),
                        Some(CapabilitySetup::PanelVisible) => Some("composer.show_panel"),
                        _ => None,
                    },
                }
            });
            if let Some(reason) = blocker {
                self.composer_state.verifying = None;
                self.composer_state.error = Some(self.t(reason).into());
                self.error = self.composer_state.error.clone();
            } else {
                if self.error == self.composer_state.error {
                    self.error = None;
                }
                self.composer_state.error = None;
                self.composer_state.validated = true;
            }
        }
        cx.notify();
    }
}
