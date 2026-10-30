//! Local execution setup carries public scope only; the shell owns credentials and processes.
use crate::app::Workbench;
use crate::workspace::WorkbenchPage;
use gpui_kit::{
    component::{
        button::*,
        input::{Input, InputEvent, InputState},
        menu::{DropdownMenu, PopupMenuItem},
        *,
    },
    prelude::*,
    *,
};
use pero_contracts::{
    HostEvent,
    local_worker::{LocalWorkerState, LocalWorkerStatus, LocalWorkerSummary},
};
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Default, Deserialize, Serialize)]
pub(crate) struct LocalExecutionSetup {
    #[serde(default)]
    pub onboarding_complete: bool,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub has_connection: bool,
    pub error: Option<String>,
    pub error_key: Option<String>,
    pub error_status: Option<u16>,
    pub configuration: Option<LocalWorkerSummary>,
}

impl LocalExecutionSetup {
    fn failed(&self) -> bool {
        self.error_key.is_some() || self.error.is_some()
    }

    fn error_message(&self, locale: &str) -> Option<String> {
        if let Some(key) = &self.error_key {
            let translated = pero_contracts::i18n::text(locale, key);
            return Some(if translated == key {
                pero_contracts::i18n::text(locale, "worker.local.error.setup_failed").into()
            } else {
                translated.into()
            });
        }
        self.error.clone().filter(|message| !message.is_empty())
    }
}

pub(crate) struct LocalExecution {
    pub setup: LocalExecutionSetup,
    pub status: LocalWorkerState,
    pub name: Entity<InputState>,
    pub workspace_key: Entity<InputState>,
    pub project_id: String,
    pub path: String,
    pub agent_id: String,
    pub editing: bool,
    pub pending: bool,
    received_setup: bool,
    pending_configuration: Option<LocalWorkerSummary>,
    _subscriptions: Vec<Subscription>,
}

impl LocalExecution {
    pub fn new(locale: &str, window: &mut Window, cx: &mut Context<Workbench>) -> Self {
        let name = cx.new(|cx| {
            InputState::new(window, cx).default_value(pero_contracts::i18n::text(
                locale,
                "worker.local.name_default",
            ))
        });
        let workspace_key = cx.new(|cx| InputState::new(window, cx).default_value("default"));
        let subscriptions = [&name, &workspace_key]
            .into_iter()
            .map(|input| cx.subscribe(input, |_, _, _: &InputEvent, cx| cx.notify()))
            .collect();
        Self {
            setup: Default::default(),
            status: Default::default(),
            name,
            workspace_key,
            project_id: String::new(),
            path: String::new(),
            agent_id: String::new(),
            editing: false,
            pending: false,
            received_setup: false,
            pending_configuration: None,
            _subscriptions: subscriptions,
        }
    }

    pub fn snapshot(&self, locale: &str, cx: &App) -> serde_json::Value {
        json!({"setup":self.setup,"status":self.status,"editing":self.editing,"pending":self.pending,
            "error_message":self.setup.error_message(locale),
            "name":self.name.read(cx).value().as_ref(),"workspace_key":self.workspace_key.read(cx).value().as_ref(),
            "project_id":self.project_id,"path":self.path,"agent_id":self.agent_id})
    }
}

impl Workbench {
    fn connect_local_execution_account(&mut self, cx: &mut Context<Self>) {
        let url = self.remote.data["connection"]["url"]
            .as_str()
            .unwrap_or("https://app.openpero.com")
            .to_string();
        self.command(json!({"action":"remote_login","url":url}), cx);
    }

    pub(crate) fn show_local_execution_onboarding(&self) -> bool {
        self.navigation.page() == WorkbenchPage::Projects
            && self.local_execution.received_setup
            && !self.local_execution.setup.onboarding_complete
    }

    pub(crate) fn receive_local_execution(
        &mut self,
        event: &HostEvent,
        cx: &mut Context<Self>,
    ) -> bool {
        match event.kind.as_str() {
            "local_worker_setup" => {
                match serde_json::from_value::<LocalExecutionSetup>(event.data.clone()) {
                    Ok(setup) => {
                        let newly_configured = (self.local_execution.setup.configuration.is_none()
                            || !self.local_execution.setup.enabled)
                            && setup.configuration.is_some()
                            && setup.enabled
                            && !setup.failed();
                        let finishing_welcome = self.show_local_execution_onboarding()
                            && setup.onboarding_complete
                            && setup.enabled
                            && !setup.failed();
                        if self.local_execution.setup.configuration.is_none() {
                            self.local_execution.pending_configuration =
                                setup.configuration.clone();
                        }
                        self.local_execution.setup = setup;
                        self.local_execution.received_setup = true;
                        self.local_execution.pending = false;
                        if self.local_execution.setup.enabled
                            && !self.local_execution.setup.failed()
                        {
                            self.local_execution.editing = false;
                        }
                        if finishing_welcome {
                            self.navigate(WorkbenchPage::Workers, cx);
                        }
                        if newly_configured && self.remote.configured() {
                            self.command(json!({"action":"remote_refresh"}), cx);
                        }
                    }
                    Err(error) => self.local_execution.setup.error = Some(error.to_string()),
                }
            }
            "local_worker_state" => {
                match serde_json::from_value::<LocalWorkerState>(event.data.clone()) {
                    Ok(state) => {
                        self.local_execution.status = state;
                        self.local_execution.pending = false;
                    }
                    Err(error) => self.local_execution.setup.error = Some(error.to_string()),
                }
            }
            "local_worker_workspace" => {
                let path = event.data["path"].as_str().unwrap_or(&event.text);
                if !path.is_empty() {
                    self.local_execution.path = path.to_string();
                }
            }
            _ => return false,
        }
        cx.notify();
        true
    }

    pub(crate) fn apply_local_execution(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(configuration) = self.local_execution.pending_configuration.take() else {
            return;
        };
        self.local_execution.name.update(cx, |input, cx| {
            input.set_value(configuration.name, window, cx)
        });
        if let Some(binding) = configuration.bindings.first() {
            self.local_execution.project_id = binding.project_id.clone();
            self.local_execution.path = binding.path.clone();
            self.local_execution.agent_id = binding.agent_ids.first().cloned().unwrap_or_default();
            self.local_execution.workspace_key.update(cx, |input, cx| {
                input.set_value(binding.workspace_key.clone(), window, cx)
            });
        }
    }

    pub(crate) fn local_execution_setup_view(
        &self,
        first_run: bool,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        let local = &self.local_execution;
        let connected = self.remote.configured();
        let authenticating = self.remote.data["connection"]["authenticating"]
            .as_bool()
            .unwrap_or(false);
        let restoring = local.setup.has_connection && !connected && self.remote.loading();
        let busy = local.pending
            || matches!(
                local.status.status,
                LocalWorkerStatus::Starting | LocalWorkerStatus::Stopping
            );
        let show_form = connected && (first_run || local.editing);
        let mut project_ids = self.remote.data["identity"]["projects"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|project| project.as_str().map(str::to_string))
            .collect::<Vec<_>>();
        if self.remote.operator() {
            project_ids.extend(
                self.project_catalog(cx)
                    .into_iter()
                    .filter_map(|project| project.shared_id),
            );
            project_ids.sort();
            project_ids.dedup();
        }
        let no_projects = project_ids.is_empty();
        let agents = self
            .chat
            .read(cx)
            .agents
            .iter()
            .filter(|agent| agent.available)
            .cloned()
            .collect::<Vec<_>>();
        let agent_label = agents
            .iter()
            .find(|agent| agent.id == local.agent_id)
            .map(|agent| agent.name.clone())
            .unwrap_or_else(|| self.t("worker.local.select_agent").into());
        let project_label = if local.project_id.is_empty() {
            self.t("worker.local.select_project").into()
        } else {
            local.project_id.clone()
        };
        let path_label = if local.path.is_empty() {
            self.t("worker.local.choose_directory").into()
        } else {
            local.path.clone()
        };
        let ready = !busy
            && !local.name.read(cx).value().trim().is_empty()
            && !local.workspace_key.read(cx).value().trim().is_empty()
            && !local.path.is_empty()
            && project_ids.contains(&local.project_id)
            && agents.iter().any(|agent| agent.id == local.agent_id);
        let field = |label: &str, element: AnyElement| {
            div()
                .flex()
                .flex_col()
                .gap(px(5.))
                .child(
                    div()
                        .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption))
                        .text_color(p.text_muted)
                        .child(label.to_string()),
                )
                .child(element)
        };
        let project_workbench = cx.entity().downgrade();
        let agent_workbench = cx.entity().downgrade();
        let status_key = match local.status.status {
            LocalWorkerStatus::Stopped => "worker.local.stopped",
            LocalWorkerStatus::Starting => "worker.local.starting",
            LocalWorkerStatus::Idle => "worker.local.idle",
            LocalWorkerStatus::Running => "worker.local.running",
            LocalWorkerStatus::Offline => "worker.local.offline",
            LocalWorkerStatus::Stopping => "worker.local.stopping",
            LocalWorkerStatus::NeedsAttention => "worker.local.needs_attention",
            LocalWorkerStatus::Unavailable => "worker.local.unavailable",
        };
        div().id("local-execution").flex().flex_col().gap(px(pero_theme::WorkbenchStyle::SECTION)).max_w(px(720.))
            .when(first_run,|el|el.p(px(pero_theme::WorkbenchStyle::PAGE)).w_full())
            .child(div().flex().items_center().gap(px(8.))
                .child(Icon::default().path("icons/devices.svg"))
                .child(div().flex_1().text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Heading)).font_weight(FontWeight::SEMIBOLD)
                    .child(self.t(if first_run {"worker.local.first_title"}else{"worker.local.title"})))
                .when(!first_run,|el|el.child(div().text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption)).text_color(p.text_muted).child(self.t(status_key)))))
            .when(first_run,|el|el.child(div().whitespace_normal().text_color(p.text_muted).child(self.t("worker.local.first_hint"))))
            .when(!connected,|el|el.child(div().flex().flex_col().gap(px(8.))
                .child(div().whitespace_normal().child(self.t("worker.local.restore_hint")))
                .child(Button::new("local-worker-connect").primary().label(self.t(if restoring {"worker.local.restoring"}else{"worker.local.connect"}))
                    .loading(authenticating || restoring).disabled(authenticating || restoring)
                    .on_click(cx.listener(|this,_,_,cx|this.connect_local_execution_account(cx))))
                .when(authenticating,|el|el.child(Button::new("local-worker-login-cancel").ghost().label(self.t("connector.login_cancel"))
                    .on_click(cx.listener(|this,_,_,cx|this.command(json!({"action":"remote_login_cancel"}),cx)))))))
            .when(connected && first_run,|el|el.child(div().text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption)).text_color(p.text_muted)
                .child(format!("{} · {}",self.t("worker.local.connected"),self.remote.data["identity"]["name"].as_str().unwrap_or_default()))))
            .when_some(local.setup.error_message(&self.locale),|el,error|el.child(div().id("local-worker-error").role(Role::Alert)
                .text_color(p.error).whitespace_normal().child(error)
                .when_some(local.setup.error_status,|el,status|el.child(div().text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption)).text_color(p.text_muted).child(format!("HTTP {status}"))))))
            .when(connected && local.setup.error_key.as_deref() == Some("worker.local.error.reauthenticate"),|el|el.child(Button::new("local-worker-reauthenticate").outline()
                .label(self.t("worker.local.connect")).loading(authenticating).disabled(authenticating)
                .on_click(cx.listener(|this,_,_,cx|this.connect_local_execution_account(cx)))))
            .when_some(self.remote.data["error"].as_str().filter(|error|!error.is_empty()),|el,error|el.child(div().id("local-worker-connection-error").role(Role::Alert)
                .text_color(p.error).whitespace_normal().child(error.to_string())))
            .when(!local.status.message.is_empty() && !matches!(local.status.status,LocalWorkerStatus::Idle|LocalWorkerStatus::Stopped),|el| {
                el.child(div().whitespace_normal().text_color(p.color(if matches!(local.status.status,LocalWorkerStatus::NeedsAttention|LocalWorkerStatus::Unavailable){"warning"}else{"text-muted"})).child(local.status.message.clone()))
            })
            .when(!show_form,|el| {
                if let Some(configuration)=&local.setup.configuration {
                    el.child(div().text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption)).text_color(p.text_muted).whitespace_normal()
                        .child(configuration.bindings.iter().map(|binding|format!("{} / {} · {} · {}",binding.project_id,binding.workspace_key,binding.path,binding.agent_ids.join(", "))).collect::<Vec<_>>().join("\n")))
                } else {el}
            })
            .when(show_form,|el|el.child(div().flex().flex_col().gap(px(12.))
                .child(field(self.t("worker.local.name"),pero_theme::WorkbenchStyle::input(Input::new(&local.name), cx).accessibility_id("local-worker-name").aria_label(self.t("worker.local.name")).disabled(busy).into_any_element()))
                .child(field(self.t("worker.local.project"),Button::new("local-worker-project").outline().w_full().justify_start().label(project_label)
                    .dropdown_caret(true).disabled(busy || project_ids.is_empty())
                    .dropdown_menu_with_anchor(Anchor::BottomLeft,move|menu,_,_|project_ids.iter().fold(menu.min_w(px(220.)),|menu,id|{
                        let id=id.clone();let workbench=project_workbench.clone();
                        menu.item(PopupMenuItem::new(id.clone()).on_click(move|_,_,cx|{let _=workbench.update(cx,|this,cx|{this.local_execution.project_id=id.clone();cx.notify();});}))
                    })).into_any_element()))
                .when(no_projects,|el|el.child(div().text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption)).text_color(p.warning).child(self.t("worker.local.no_projects"))))
                .child(field(self.t("worker.local.workspace_key"),pero_theme::WorkbenchStyle::input(Input::new(&local.workspace_key), cx).accessibility_id("local-worker-workspace-key").aria_label(self.t("worker.local.workspace_key")).disabled(busy).into_any_element()))
                .child(div().text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption)).whitespace_normal().text_color(p.text_muted).child(self.t("worker.local.workspace_hint")))
                .child(field(self.t("worker.local.directory"),Button::new("local-worker-directory").outline().w_full().justify_start().icon(IconName::Folder)
                    .label(path_label).tooltip(local.path.clone()).disabled(busy).on_click(cx.listener(|this,_,_,cx|this.command(json!({"action":"choose_worker_workspace"}),cx))).into_any_element()))
                .child(field(self.t("worker.local.agent"),Button::new("local-worker-agent").outline().w_full().justify_start().label(agent_label)
                    .dropdown_caret(true).disabled(busy || agents.is_empty())
                    .dropdown_menu_with_anchor(Anchor::BottomLeft,move|menu,_,_|agents.iter().fold(menu.min_w(px(220.)),|menu,agent|{
                        let id=agent.id.clone();let workbench=agent_workbench.clone();
                        menu.item(PopupMenuItem::new(agent.name.clone()).on_click(move|_,_,cx|{let _=workbench.update(cx,|this,cx|{this.local_execution.agent_id=id.clone();cx.notify();});}))
                    })).into_any_element()))
                .when(self.chat.read(cx).agents.iter().all(|agent|!agent.available),|el|el.child(div().text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption)).text_color(p.warning).child(self.t("worker.local.no_agents"))))
                .child(div().whitespace_normal().text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption)).text_color(p.text_muted).child(self.t("worker.local.enable_hint")))
                .child(Button::new("local-worker-enable").primary().label(self.t("worker.local.enable")).loading(local.pending).disabled(!ready)
                    .on_click(cx.listener(|this,_,_,cx|{
                        this.local_execution.pending=true;
                        this.command(json!({"action":"local_worker_enroll","name":this.local_execution.name.read(cx).value().trim(),
                            "project_id":this.local_execution.project_id,"workspace_key":this.local_execution.workspace_key.read(cx).value().trim(),
                            "path":this.local_execution.path,"agent_id":this.local_execution.agent_id}),cx);
                    })))))
            .when(!first_run && local.editing,|el|el.child(Button::new("local-worker-configure-cancel").ghost().label(self.t("worker.local.cancel"))
                .disabled(busy).on_click(cx.listener(|this,_,_,cx|{this.local_execution.editing=false;cx.notify();}))))
            .when(!first_run && !local.editing,|el|el.child(div().flex().flex_wrap().gap(px(8.))
                .when(connected && local.setup.configuration.is_none(),|el|el.child(Button::new("local-worker-setup").primary().label(self.t("worker.local.enable"))
                    .on_click(cx.listener(|this,_,_,cx|{this.local_execution.editing=true;cx.notify();}))))
                .when(local.setup.configuration.is_some(),|el|el
                    .child(Button::new("local-worker-toggle").outline().label(self.t(if local.setup.enabled{"worker.local.stop"}else{"worker.local.resume"}))
                        .loading(busy).disabled(busy || !connected && !local.setup.enabled)
                        .on_click(cx.listener(|this,_,_,cx|{this.local_execution.pending=true;this.command(json!({"action":if this.local_execution.setup.enabled{"local_worker_disable"}else{"local_worker_resume"}}),cx);})))
                    .child(Button::new("local-worker-configure").ghost().label(self.t("worker.local.configure")).disabled(busy)
                        .on_click(cx.listener(|this,_,window,cx|{this.local_execution.pending_configuration=this.local_execution.setup.configuration.clone();this.apply_local_execution(window,cx);this.local_execution.editing=true;cx.notify();}))))))
            .when(first_run,|el|el.child(Button::new("local-worker-skip").ghost().label(self.t("worker.local.skip")).disabled(busy)
                .on_click(cx.listener(|this,_,_,cx|this.command(json!({"action":"local_worker_skip"}),cx)))))
    }
}
