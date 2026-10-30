//! Settings edits only the Host-owned, secret-free MCP configuration projection.
use crate::{
    app::Workbench,
    settings_view::{SettingsAction, SettingsPanel},
};
use gpui_kit::{
    component::{
        button::*,
        input::{Input, InputState, Textarea, TextareaState},
        menu::{DropdownMenu, PopupMenuItem},
        *,
    },
    prelude::*,
    *,
};
use pero_chat_ui::conversation::AgentChoice;
use pero_contracts::{
    HostEvent,
    mcp::{McpConfiguration, McpServerConfig, McpSettingsProjection, McpTransport},
};
use pero_theme::UiAppearance;
use serde_json::json;

pub(crate) struct McpEditor {
    pub agents: Vec<AgentChoice>,
    agent: Option<String>,
    config: Option<McpConfiguration>,
    request: Option<String>,
    serial: u64,
    saving: bool,
    needs_reload: bool,
    error: Option<String>,
    saved: bool,
    editing: bool,
    selected: Option<usize>,
    http: bool,
    inputs: [Entity<InputState>; 3],
    import: Entity<TextareaState>,
    importing: bool,
    controls: std::rc::Rc<std::cell::RefCell<std::collections::BTreeMap<String, Bounds<Pixels>>>>,
    confirm: Option<(usize, bool)>, // true: enable with server-wide grant; false: remove
}
impl McpEditor {
    pub fn new(window: &mut Window, cx: &mut Context<SettingsPanel>) -> Self {
        Self {
            agents: vec![],
            agent: None,
            config: None,
            request: None,
            serial: 0,
            saving: false,
            needs_reload: false,
            error: None,
            saved: false,
            editing: false,
            selected: None,
            http: false,
            import: cx.new(|cx| TextareaState::new(window, cx)),
            importing: false,
            controls: Default::default(),
            inputs: std::array::from_fn(|_| cx.new(|cx| InputState::new(window, cx))),
            confirm: None,
        }
    }
    fn measured(&self, key: String, button: impl IntoElement) -> Div {
        let controls = self.controls.clone();
        // Observe the button-sized wrapper, not a percentage-sized canvas inside
        // Button's label container. Diagnostics must not enter intrinsic sizing.
        div()
            .flex()
            .flex_none()
            .self_start()
            .on_prepaint(move |bounds, _, _| {
                controls.borrow_mut().insert(key.clone(), bounds);
            })
            .child(button)
    }
    #[cfg(target_family = "wasm")]
    pub fn snapshot(&self, cx: &App) -> serde_json::Value {
        json!({"controls":self.controls.borrow().iter().map(|(key,b)| (key.clone(),json!({"x":f32::from(b.origin.x),"y":f32::from(b.origin.y),"width":f32::from(b.size.width),"height":f32::from(b.size.height)}))).collect::<std::collections::BTreeMap<_,_>>(),"agent":self.agent,"config":self.config,"pending":self.request.is_some(),"request_id":self.request,"saving":self.saving,"needs_reload":self.needs_reload,
            "error":self.error,"saved":self.saved,"editing":self.editing,"selected":self.selected,"http":self.http,"confirm":self.confirm,
            "importing":self.importing,"inputs":self.inputs.iter().map(|input| {let input=input.read(cx);let b=input.input_bounds();json!({"value":input.value().as_ref(),"x":f32::from(b.origin.x),"y":f32::from(b.origin.y),"width":f32::from(b.size.width),"height":f32::from(b.size.height)})}).chain(std::iter::once({let input=self.import.read(cx);let b=input.input_bounds();json!({"value":input.value().as_ref(),"x":f32::from(b.origin.x),"y":f32::from(b.origin.y),"width":f32::from(b.size.width),"height":f32::from(b.size.height)})})).collect::<Vec<_>>()})
    }
}
impl Workbench {
    pub(crate) fn receive_mcp(&mut self, event: &HostEvent, cx: &mut Context<Self>) -> bool {
        if event.kind == "agents" {
            if let (Some(panel), Ok(agents)) = (
                &self.settings_panel,
                serde_json::from_value::<Vec<AgentChoice>>(event.data.clone()),
            ) {
                panel.update(cx, |panel, cx| {
                    panel.mcp.agents = agents;
                    panel.mcp_select_first(cx);
                    cx.notify();
                });
            }
        }
        if matches!(event.kind.as_str(), "error" | "disconnected") {
            if let Some(panel) = &self.settings_panel {
                panel.update(cx, |panel, cx| {
                    let state = &mut panel.mcp;
                    let interrupted = if event.kind == "disconnected" {
                        state.agent.is_some()
                    } else {
                        state.request.is_some() && state.request == event.request_id
                    };
                    if interrupted {
                        // A transport error does not establish whether a write committed.
                        // Keep the draft, but require an explicit reload before another write.
                        state.error = Some(if state.saving
                            || state.error.as_deref() == Some("mcp.error.interrupted_save")
                        {
                            "mcp.error.interrupted_save"
                        } else {
                            "mcp.error.interrupted"
                        }.into());
                        state.request = None;
                        state.saving = false;
                        state.saved = false;
                        state.needs_reload = true;
                        cx.notify();
                    }
                });
            }
        }
        if !matches!(event.kind.as_str(), "mcp_settings" | "mcp_settings_error") {
            return false;
        }
        if let Some(panel) = &self.settings_panel {
            panel.update(cx, |panel, cx| {
                let state = &mut panel.mcp;
                if state.request.is_none()
                    || state.agent.as_deref() != event.data["agent_id"].as_str()
                    || state.request.as_deref() != event.request_id.as_deref()
                {
                    return;
                }
                state.request = None;
                if event.kind == "mcp_settings_error" {
                    state.error = Some(format!(
                        "mcp.error.{}",
                        event.data["reason"].as_str().unwrap_or("unavailable")
                    ));
                } else {
                    match serde_json::from_value::<McpSettingsProjection>(event.data.clone()) {
                        Ok(config) => {
                            state.config = Some(McpConfiguration {
                                revision: config.revision,
                                servers: config.servers,
                            });
                            state.error = None;
                            state.needs_reload = false;
                            state.saved = state.saving;
                            if state.saving {
                                state.editing = false;
                                state.importing = false;
                                state.confirm = None;
                            }
                        }
                        Err(_) => state.error = Some("mcp.error.unavailable".into()),
                    }
                }
                state.saving = false;
                cx.notify();
            });
        }
        true
    }
}
impl SettingsPanel {
    pub(crate) fn mcp_select_first(&mut self, cx: &mut Context<Self>) {
        if self.mcp.agent.is_none() {
            self.mcp.agent = self.mcp.agents.first().map(|a| a.id.clone());
            if self.mcp.agent.is_some() {
                self.mcp_load(cx);
            }
        }
    }
    fn mcp_load(&mut self, cx: &mut Context<Self>) {
        self.mcp.confirm = None;
        self.mcp.selected = None;
        self.mcp.editing = false;
        self.mcp.importing = false;
        self.mcp.serial += 1;
        let id = format!("mcp-settings-{}", self.mcp.serial);
        self.mcp.request = Some(id.clone());
        self.mcp.error = None;
        self.mcp.saved = false;
        cx.emit(SettingsAction::Mcp(
            json!({"method":"settings.mcp.get","request_id":id,"agent_id":self.mcp.agent}),
        ));
        cx.notify();
    }
    fn mcp_save(&mut self, servers: Vec<McpServerConfig>, cx: &mut Context<Self>) {
        if self.mcp.needs_reload {
            return;
        }
        let Some(config) = &self.mcp.config else {
            return;
        };
        self.mcp.serial += 1;
        let id = format!("mcp-settings-{}", self.mcp.serial);
        self.mcp.request = Some(id.clone());
        self.mcp.saving = true;
        self.mcp.error = None;
        self.mcp.saved = false;
        cx.emit(SettingsAction::Mcp(json!({"method":"settings.mcp.set","request_id":id,"agent_id":self.mcp.agent,"revision":config.revision,"servers":servers})));
        cx.notify();
    }
    fn mcp_edit(&mut self, selected: Option<usize>, window: &mut Window, cx: &mut Context<Self>) {
        let server = selected.and_then(|i| self.mcp.config.as_ref()?.servers.get(i));
        let (name, endpoint, args, http) = match server {
            Some(server) => match &server.transport {
                McpTransport::Stdio { command, args } => (
                    server.name.clone(),
                    command.clone(),
                    serde_json::to_string(args).unwrap(),
                    false,
                ),
                McpTransport::Http { url } => (server.name.clone(), url.clone(), "[]".into(), true),
            },
            None => (String::new(), String::new(), "[]".into(), false),
        };
        self.mcp.selected = selected;
        self.mcp.http = http;
        self.mcp.editing = true;
        self.mcp.confirm = None;
        self.mcp.saved = false;
        for (input, value) in self.mcp.inputs.iter().zip([name, endpoint, args]) {
            input.update(cx, |input, cx| input.set_value(value, window, cx));
        }
        self.mcp.inputs[0].update(cx, |input, cx| input.focus(window, cx));
        cx.notify();
    }
    fn mcp_submit(&mut self, cx: &mut Context<Self>) {
        let value = |i: usize| self.mcp.inputs[i].read(cx).value().to_string();
        let transport = if self.mcp.http {
            McpTransport::Http { url: value(1) }
        } else {
            let Ok(args) = serde_json::from_str::<Vec<String>>(&value(2)) else {
                self.mcp.error = Some("mcp.error.args".into());
                cx.notify();
                return;
            };
            McpTransport::Stdio {
                command: value(1),
                args,
            }
        };
        let mut servers = self.mcp.config.as_ref().unwrap().servers.clone();
        // Edits are disabled again: changed endpoints must receive a fresh explicit grant.
        let server = McpServerConfig {
            name: value(0),
            enabled: false,
            transport,
        };
        if let Some(i) = self.mcp.selected {
            servers[i] = server;
        } else {
            servers.push(server);
        }
        self.mcp_save(servers, cx);
    }
    // Render each form independently: one monolithic builder reserved 767,856 bytes
    // of debug-Wasm stack even for the empty state and trapped on first render.
    pub(crate) fn mcp_settings(&self, cx: &mut Context<Self>) -> AnyElement {
        self.mcp.controls.borrow_mut().clear();
        let p = UiAppearance::global(cx).palette.clone();
        let busy = self.mcp.request.is_some();
        let mut body = div()
            .id("mcp-settings")
            .flex()
            .flex_col()
            .min_w_0()
            .gap(px(12.))
            .pt(px(12.))
            .child(self.mcp_agent_controls(cx))
            .child(
                div()
                    .whitespace_normal()
                    .text_color(p.text_muted)
                    .child(self.t("mcp.new_sessions")),
            )
            .child(
                div()
                    .whitespace_normal()
                    .text_color(p.text_muted)
                    .child(self.t("mcp.internal")),
            );
        if let Some(error) = &self.mcp.error {
            body = body.child(
                div()
                    .id("mcp-error")
                    .role(Role::Alert)
                    .text_color(p.error)
                    .whitespace_normal()
                    .child(self.t(error)),
            );
        }
        if busy {
            body = body.child(self.t(if self.mcp.saving {
                "settings.saving"
            } else {
                "mcp.loading"
            }));
        }
        if self.mcp.saved {
            body = body.child(self.t("mcp.saved"));
        }
        if let Some(config) = &self.mcp.config {
            if config.servers.is_empty() {
                body = body.child(self.t("mcp.empty"));
            }
            for (index, server) in config.servers.iter().enumerate() {
                body = body.child(self.mcp_server_row(index, server, cx));
            }
            if let Some((index, enable)) = self.mcp.confirm {
                body = body.child(self.mcp_confirmation(index, enable, cx));
            }
            if self.mcp.importing {
                body = body.child(self.mcp_import_form(cx));
            } else if !self.mcp.editing {
                body = body
                    .child(
                        self.mcp.measured(
                            "mcp-add".into(),
                            Button::new("mcp-add")
                                .small()
                                .outline()
                                .label(self.t("mcp.add"))
                                .disabled(busy || self.mcp.needs_reload)
                                .on_click(cx.listener(|this, _, window, cx| {
                                    this.mcp_edit(None, window, cx)
                                })),
                        ),
                    )
                    .child(
                        self.mcp.measured(
                            "mcp-import".into(),
                            Button::new("mcp-import")
                                .small()
                                .ghost()
                                .label(self.t("mcp.import"))
                                .disabled(busy || self.mcp.needs_reload)
                                .on_click(cx.listener(|this, _, window, cx| {
                                    this.mcp.importing = true;
                                    this.mcp.confirm = None;
                                    this.mcp
                                        .import
                                        .update(cx, |input, cx| input.focus(window, cx));
                                    cx.notify();
                                })),
                        ),
                    );
            } else {
                body = body.child(self.mcp_editor(cx));
            }
        }
        body.into_any_element()
    }
    fn mcp_agent_controls(&self, cx: &mut Context<Self>) -> AnyElement {
        let busy = self.mcp.request.is_some();
        let target = cx.entity().downgrade();
        let agents = self.mcp.agents.clone();
        let selected = self.mcp.agent.clone();
        div()
            .flex()
            .flex_wrap()
            .gap(px(8.))
            .items_center()
            .child(self.t("mcp.agent"))
            .child(
                self.mcp.measured(
                    "mcp-agent".into(),
                    Button::new("mcp-agent")
                        .small()
                        .outline()
                        .label(
                            self.mcp
                                .agents
                                .iter()
                                .find(|a| Some(&a.id) == self.mcp.agent.as_ref())
                                .map(|a| a.name.clone())
                                .unwrap_or_else(|| self.t("mcp.no_agents").into()),
                        )
                        .disabled(busy || self.mcp.editing || self.mcp.importing)
                        .dropdown_caret(false)
                        .dropdown_menu(move |menu, _, _| {
                            agents.iter().fold(menu, |menu, agent| {
                                let target = target.clone();
                                let id = agent.id.clone();
                                menu.item(
                                    PopupMenuItem::new(agent.name.clone())
                                        .checked(selected.as_ref() == Some(&agent.id))
                                        .on_click(move |_, _, cx| {
                                            let _ = target.update(cx, |this, cx| {
                                                this.mcp.agent = Some(id.clone());
                                                this.mcp.config = None;
                                                this.mcp.confirm = None;
                                                this.mcp_load(cx);
                                            });
                                        }),
                                )
                            })
                        }),
                ),
            )
            .child(
                self.mcp.measured(
                    "mcp-refresh".into(),
                    Button::new("mcp-refresh")
                        .small()
                        .ghost()
                        .label(self.t("mcp.refresh"))
                        .disabled(
                            busy || self.mcp.agent.is_none()
                                || self.mcp.editing
                                || self.mcp.importing,
                        )
                        .on_click(cx.listener(|this, _, _, cx| this.mcp_load(cx))),
                ),
            )
            .into_any_element()
    }
    fn mcp_server_row(
        &self,
        index: usize,
        server: &McpServerConfig,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let p = UiAppearance::global(cx).palette.clone();
        let busy = self.mcp.request.is_some();
        let label = format!(
            "{} — {}",
            server.name,
            self.t(if server.enabled {
                "mcp.enabled"
            } else {
                "mcp.disabled"
            })
        );
        div()
            .id(("mcp-server", index))
            .flex()
            .flex_wrap()
            .items_center()
            .gap(px(8.))
            .border_b(px(0.5))
            .border_color(p.border)
            .pb(px(8.))
            .child(
                div()
                    .flex_1()
                    .min_w(px(120.))
                    .whitespace_normal()
                    .child(label)
                    .child(
                        div()
                            .text_color(p.text_muted)
                            .child(self.t("mcp.not_observed")),
                    ),
            )
            .child(
                self.mcp.measured(
                    format!("mcp-edit-{index}"),
                    Button::new(("mcp-edit", index))
                        .small()
                        .ghost()
                        .label(self.t("mcp.edit"))
                        .disabled(busy || self.mcp.needs_reload || self.mcp.editing || self.mcp.importing)
                        .on_click(cx.listener(move |this, _, window, cx| {
                            this.mcp_edit(Some(index), window, cx)
                        })),
                ),
            )
            .child(
                self.mcp.measured(
                    format!("mcp-toggle-{index}"),
                    Button::new(("mcp-toggle", index))
                        .small()
                        .outline()
                        .label(self.t(if server.enabled {
                            "mcp.disable"
                        } else {
                            "mcp.enable"
                        }))
                        .disabled(busy || self.mcp.needs_reload || self.mcp.editing || self.mcp.importing)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            let mut servers = this.mcp.config.as_ref().unwrap().servers.clone();
                            if servers[index].enabled {
                                servers[index].enabled = false;
                                this.mcp_save(servers, cx);
                            } else {
                                this.mcp.confirm = Some((index, true));
                                cx.notify();
                            }
                        })),
                ),
            )
            .child(
                self.mcp.measured(
                    format!("mcp-remove-{index}"),
                    Button::new(("mcp-remove", index))
                        .small()
                        .ghost()
                        .label(self.t("mcp.remove"))
                        .disabled(busy || self.mcp.needs_reload || self.mcp.editing || self.mcp.importing)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.mcp.confirm = Some((index, false));
                            cx.notify();
                        })),
                ),
            )
            .into_any_element()
    }
    fn mcp_confirmation(&self, index: usize, enable: bool, cx: &mut Context<Self>) -> AnyElement {
        let busy = self.mcp.request.is_some();
        div()
            .id("mcp-confirmation")
            .flex()
            .flex_col()
            .gap(px(8.))
            .child(div().whitespace_normal().child(self.t(if enable {
                "mcp.grant"
            } else {
                "mcp.remove_confirm"
            })))
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap(px(8.))
                    .child(
                        self.mcp.measured(
                            "mcp-confirm".into(),
                            Button::new("mcp-confirm")
                                .small()
                                .primary()
                                .label(self.t(if enable {
                                    "mcp.grant_enable"
                                } else {
                                    "mcp.remove"
                                }))
                                .disabled(busy || self.mcp.needs_reload)
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    let mut servers =
                                        this.mcp.config.as_ref().unwrap().servers.clone();
                                    if enable {
                                        servers[index].enabled = true;
                                    } else {
                                        servers.remove(index);
                                    }
                                    this.mcp_save(servers, cx);
                                })),
                        ),
                    )
                    .child(
                        self.mcp.measured(
                            "mcp-cancel-confirm".into(),
                            Button::new("mcp-cancel-confirm")
                                .small()
                                .ghost()
                                .label(self.t("mcp.cancel"))
                                .disabled(busy)
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.mcp.confirm = None;
                                    cx.notify();
                                })),
                        ),
                    ),
            )
            .into_any_element()
    }
    fn mcp_import_form(&self, cx: &mut Context<Self>) -> AnyElement {
        let busy = self.mcp.request.is_some();
        div()
            .flex()
            .flex_col()
            .gap(px(12.))
            .child(div().whitespace_normal().child(self.t("mcp.import_hint")))
            .child(
                Textarea::new(&self.mcp.import)
                    .aria_label(self.t("mcp.import"))
                    .h(px(96.))
                    .disabled(busy),
            )
            .child(
                self.mcp.measured(
                    "mcp-import-save".into(),
                    Button::new("mcp-import-save")
                        .small()
                        .primary()
                        .label(self.t("mcp.import_save"))
                        .disabled(busy || self.mcp.needs_reload)
                        .on_click(cx.listener(|this, _, _, cx| {
                            match serde_json::from_str::<Vec<McpServerConfig>>(
                                this.mcp.import.read(cx).value().as_ref(),
                            ) {
                                Ok(mut added) => {
                                    for server in &mut added {
                                        server.enabled = false;
                                    }
                                    let mut servers =
                                        this.mcp.config.as_ref().unwrap().servers.clone();
                                    servers.extend(added);
                                    this.mcp_save(servers, cx);
                                }
                                Err(_) => {
                                    this.mcp.error = Some("mcp.error.import".into());
                                    cx.notify();
                                }
                            }
                        })),
                ),
            )
            .child(
                self.mcp.measured(
                    "mcp-import-cancel".into(),
                    Button::new("mcp-import-cancel")
                        .small()
                        .ghost()
                        .label(self.t("mcp.cancel"))
                        .disabled(busy)
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.mcp.importing = false;
                            cx.notify();
                        })),
                ),
            )
            .into_any_element()
    }
    fn mcp_editor(&self, cx: &mut Context<Self>) -> AnyElement {
        let p = UiAppearance::global(cx).palette.clone();
        let busy = self.mcp.request.is_some();
        let mut editor = div()
            .id("mcp-editor")
            .flex()
            .flex_col()
            .min_w_0()
            .gap(px(8.))
            .child(
                div()
                    .flex()
                    .gap(px(8.))
                    .child(
                        self.mcp.measured(
                            "mcp-stdio".into(),
                            Button::new("mcp-stdio")
                                .small()
                                .outline()
                                .label("stdio")
                                .selected(!self.mcp.http)
                                .disabled(busy)
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.mcp.http = false;
                                    cx.notify();
                                })),
                        ),
                    )
                    .child(
                        self.mcp.measured(
                            "mcp-http".into(),
                            Button::new("mcp-http")
                                .small()
                                .outline()
                                .label("HTTP")
                                .selected(self.mcp.http)
                                .disabled(busy)
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.mcp.http = true;
                                    cx.notify();
                                })),
                        ),
                    ),
            );
        for (index, key) in [
            (0, "mcp.name"),
            (
                1,
                if self.mcp.http {
                    "mcp.url"
                } else {
                    "mcp.command"
                },
            ),
            (2, "mcp.args"),
        ] {
            if index == 2 && self.mcp.http {
                continue;
            }
            editor = editor.child(
                div().child(self.t(key)).child(
                    Input::new(&self.mcp.inputs[index])
                        .aria_label(self.t(key))
                        .small()
                        .disabled(busy)
                        .w_full(),
                ),
            );
        }
        editor
            .child(
                div()
                    .whitespace_normal()
                    .text_color(p.text_muted)
                    .child(self.t("mcp.no_secrets")),
            )
            .child(
                div()
                    .flex()
                    .gap(px(8.))
                    .child(
                        self.mcp.measured(
                            "mcp-save".into(),
                            Button::new("mcp-save")
                                .small()
                                .primary()
                                .label(self.t("mcp.save_disabled"))
                                .disabled(busy || self.mcp.needs_reload)
                                .on_click(cx.listener(|this, _, _, cx| this.mcp_submit(cx))),
                        ),
                    )
                    .child(
                        self.mcp.measured(
                            "mcp-cancel-edit".into(),
                            Button::new("mcp-cancel-edit")
                                .small()
                                .ghost()
                                .label(self.t("mcp.cancel"))
                                .disabled(busy)
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.mcp.editing = false;
                                    if !this.mcp.needs_reload {
                                        this.mcp.error = None;
                                    }
                                    cx.notify();
                                })),
                        ),
                    ),
            )
            .into_any_element()
    }
}
