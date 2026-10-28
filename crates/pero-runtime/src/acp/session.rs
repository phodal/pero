use super::AgentConfig;
use super::configuration::Configuration;
use agent_client_protocol::schema::{ProtocolVersion, v1::*};
use agent_client_protocol::{
    AcpAgent, AcpAgentConfig, Agent, Client, ConnectionTo, UntypedMessage,
};
use pero_contracts::HostEvent;
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    future::Future,
    path::PathBuf,
    sync::{Arc, Mutex, mpsc::Sender},
    time::Duration,
};
use tokio::sync::{mpsc, oneshot};

const SETUP_TIMEOUT: Duration = Duration::from_secs(if cfg!(test) { 1 } else { 45 });
const CANCEL_TIMEOUT: Duration = Duration::from_secs(if cfg!(test) { 1 } else { 5 });
const MAX_DEFERRED_COMMANDS: usize = 16;

pub enum SessionCommand {
    Prompt(String),
    Cancel,
    Model(String),
    Configure { id: String, value: String },
    Authenticate(String),
    Close,
}
type Permissions = Arc<Mutex<HashMap<String, oneshot::Sender<Option<String>>>>>;
pub struct SessionHandle {
    pub tx: mpsc::UnboundedSender<SessionCommand>,
    pub permissions: Permissions,
}

fn event(tx: &Sender<HostEvent>, thread: &str, kind: &str, text: impl Into<String>, data: Value) {
    let mut e = HostEvent::new(kind, None, text.into());
    e.thread_id = Some(thread.into());
    e.data = data;
    let _ = tx.send(e);
}

fn failure(message: &str) -> agent_client_protocol::Error {
    agent_client_protocol::Error::new(-32603, message)
}

pub fn start(
    config: AgentConfig,
    cwd: PathBuf,
    thread: String,
    tx: Sender<HostEvent>,
) -> SessionHandle {
    let (commands, rx) = mpsc::unbounded_channel();
    let permissions: Permissions = Arc::default();
    let pending = permissions.clone();
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("session runtime");
        let result = rt.block_on(run(
            config,
            cwd,
            thread.clone(),
            tx.clone(),
            rx,
            pending.clone(),
        ));
        pending.lock().unwrap().clear();
        if let Err(error) = result {
            event(&tx, &thread, "session_error", error, Value::Null);
        }
        event(&tx, &thread, "session_closed", "会话已关闭", Value::Null);
    });
    SessionHandle {
        tx: commands,
        permissions,
    }
}

/// Queue commands rather than silently losing a follow-up or model change during a turn.
fn defer(
    command: SessionCommand,
    deferred: &mut VecDeque<SessionCommand>,
    tx: &Sender<HostEvent>,
    thread: &str,
) {
    if deferred.len() >= MAX_DEFERRED_COMMANDS {
        event(
            tx,
            thread,
            "command_rejected",
            "Session command queue is full",
            Value::Null,
        );
        return;
    }
    if matches!(command, SessionCommand::Prompt(_)) {
        event(
            tx,
            thread,
            "prompt_queued",
            "Message queued",
            json!({ "position": deferred.len() + 1 }),
        );
    }
    deferred.push_back(command);
}

/// Setup operations are bounded and remain interruptible even before a session exists.
async fn setup_request<T>(
    future: impl Future<Output = agent_client_protocol::Result<T>>,
    commands: &mut mpsc::UnboundedReceiver<SessionCommand>,
    deferred: &mut VecDeque<SessionCommand>,
    tx: &Sender<HostEvent>,
    thread: &str,
    label: &str,
) -> agent_client_protocol::Result<Option<T>> {
    let request = tokio::time::timeout(SETUP_TIMEOUT, future);
    tokio::pin!(request);
    loop {
        tokio::select! {
            result = &mut request => return result.map_err(|_| failure(&format!("{label} timed out")))?.map(Some),
            command = commands.recv() => match command {
                Some(SessionCommand::Close) | None => return Ok(None),
                Some(SessionCommand::Cancel) => return Err(agent_client_protocol::Error::request_cancelled()),
                Some(command) => defer(command, deferred, tx, thread),
            }
        }
    }
}

async fn run(
    config: AgentConfig,
    cwd: PathBuf,
    thread: String,
    tx: Sender<HostEvent>,
    mut commands: mpsc::UnboundedReceiver<SessionCommand>,
    permissions: Permissions,
) -> Result<(), String> {
    event(
        &tx,
        &thread,
        "session_connecting",
        format!("正在连接 {}", config.name),
        Value::Null,
    );
    let agent = AcpAgent::new(
        AcpAgentConfig::new(&config.command)
            .args(&config.args)
            .envs(config.env),
    );
    let model_api = Arc::new(Mutex::new(ModelApi::default()));
    let notification_models = model_api.clone();
    let configuration = Arc::new(Mutex::new(Configuration::default()));
    let notification_configuration = configuration.clone();
    let notify_tx = tx.clone();
    let notify_thread = thread.clone();
    let perm_tx = tx.clone();
    let perm_thread = thread.clone();
    let permission_requests = permissions.clone();
    Client.builder()
        .on_receive_notification(
            async move |notification: UntypedMessage, _cx| {
                if notification.method != "session/update" { return Ok(()); }
                // The current typed schema removed legacy current_model_update. Preserve only
                // that known compatibility variant; modern notifications still use SDK validation.
                let update = if notification.params["update"]["sessionUpdate"] == "current_model_update" {
                    if !notification.params["sessionId"].is_string() || !notification.params["update"]["currentModelId"].is_string() {
                        return Err(agent_client_protocol::Error::invalid_params());
                    }
                    notification.params["update"].clone()
                } else {
                    let parsed: SessionNotification = serde_json::from_value(notification.params).map_err(agent_client_protocol::Error::into_internal_error)?;
                    serde_json::to_value(parsed.update).unwrap_or_default()
                };
                if update["sessionUpdate"] == "config_option_update" {
                    let advertised = ModelApi::from_session(&update);
                    *notification_models.lock().unwrap() = advertised;
                    let mut configuration = notification_configuration.lock().unwrap();
                    configuration.refresh(&update)?;
                    event(&notify_tx, &notify_thread, "configuration_changed", "", serde_json::to_value(&configuration.settings).unwrap_or_default());
                }
                if update["sessionUpdate"] == "current_mode_update" {
                    let mut configuration = notification_configuration.lock().unwrap();
                    configuration.mode_changed(update["currentModeId"].as_str().unwrap_or_default())?;
                    event(&notify_tx,&notify_thread,"configuration_changed","",serde_json::to_value(&configuration.settings).unwrap_or_default());
                }
                event(&notify_tx, &notify_thread, "session_update", "", update);
                Ok(())
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .on_receive_request(
            async move |request: RequestPermissionRequest, responder, _connection| {
                let id = next_permission_id();
                let (answer, reply) = oneshot::channel();
                permission_requests.lock().unwrap().insert(id.clone(), answer);
                let mut data = serde_json::to_value(&request).unwrap_or_default();
                data["permission_id"] = json!(id);
                event(&perm_tx, &perm_thread, "permission", "需要授权", data);
                let selected = reply.await.ok().flatten();
                permission_requests.lock().unwrap().remove(&id);
                let outcome = selected
                    .filter(|id| request.options.iter().any(|o| o.option_id.to_string() == *id))
                    .map(|id| RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(id)))
                    .unwrap_or(RequestPermissionOutcome::Cancelled);
                responder.respond(RequestPermissionResponse::new(outcome))
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(agent, move |connection: ConnectionTo<Agent>| async move {
            let mut deferred = VecDeque::new();
            let Some(initialized) = setup_request(
                connection.send_request(InitializeRequest::new(ProtocolVersion::V1)).block_task(),
                &mut commands, &mut deferred, &tx, &thread, "Agent initialization",
            ).await? else { return Ok(()); };
            let auth_methods = initialized.auth_methods.clone();
            event(&tx, &thread, "agent_info", "", serde_json::to_value(&initialized).unwrap_or_default());
            let mut session_data = loop {
                let result = setup_request(
                    connection.send_request(UntypedMessage::new("session/new", NewSessionRequest::new(cwd.clone()))?).block_task(),
                    &mut commands, &mut deferred, &tx, &thread, "Session creation",
                ).await;
                match result {
                    Ok(Some(session)) => break session,
                    Ok(None) => return Ok(()),
                    Err(error) if error.code == ErrorCode::AuthRequired => {
                        event(&tx, &thread, "session_auth_required", error.to_string(), json!({ "authMethods": auth_methods }));
                        loop {
                            match commands.recv().await {
                                Some(SessionCommand::Authenticate(method_id)) => {
                                    match auth_methods.iter().find(|method| method.id().to_string() == method_id) {
                                        Some(AuthMethod::Agent(_)) => {},
                                        Some(AuthMethod::Terminal(_)) => {
                                            event(&tx, &thread, "session_auth_error", "This login method requires an interactive terminal", json!({ "methodId": method_id }));
                                            continue;
                                        },
                                        _ => {
                                            event(&tx, &thread, "session_auth_error", "Unknown authentication method", Value::Null);
                                            continue;
                                        },
                                    }
                                    let response = setup_request(
                                        connection.send_request(AuthenticateRequest::new(method_id)).block_task(),
                                        &mut commands, &mut deferred, &tx, &thread, "Agent authentication",
                                    ).await;
                                    match response {
                                        Ok(Some(_)) => break,
                                        Ok(None) => return Ok(()),
                                        Err(error) => event(&tx, &thread, "session_auth_error", error.to_string(), Value::Null),
                                    }
                                },
                                Some(SessionCommand::Close) | None => return Ok(()),
                                Some(SessionCommand::Cancel) => return Err(agent_client_protocol::Error::request_cancelled()),
                                Some(command) => defer(command, &mut deferred, &tx, &thread),
                            }
                        }
                    },
                    Err(error) => return Err(error),
                }
            };
            // Validate the standard fields without dropping legacy `models` from the raw response.
            let session: NewSessionResponse = serde_json::from_value(session_data.clone()).map_err(agent_client_protocol::Error::into_internal_error)?;
            let session_id = session.session_id.clone();
            configuration.lock().unwrap().refresh(&session_data)?;
            session_data["peroSettings"] = serde_json::to_value(&configuration.lock().unwrap().settings).unwrap_or_default();
            *model_api.lock().unwrap() = ModelApi::from_session(&session_data);
            if let Some(model) = config.model {
                let selector = model_api.lock().unwrap().clone();
                let request = selector.request(&session_id, &model)?;
                let Some(response) = setup_request(
                    connection.send_request(request).block_task(),
                    &mut commands, &mut deferred, &tx, &thread, "Model selection",
                ).await? else { return Ok(()); };
                selector.apply_response(&mut session_data, response, &model)?;
                *model_api.lock().unwrap() = ModelApi::from_session(&session_data);
            }
            event(&tx, &thread, "session_ready", "会话已就绪", session_data.clone());
            let mut needs_authentication = false;
            loop {
                let command = if let Some(command) = deferred.pop_front() { Some(command) } else { commands.recv().await };
                match command {
                    Some(SessionCommand::Prompt(text)) => {
                        if needs_authentication {
                            event(&tx, &thread, "session_auth_required", "Provider authentication required", json!({ "authMethods": auth_methods }));
                            continue;
                        }
                        event(&tx, &thread, "turn_started", "正在思考", Value::Null);
                        let prompt = connection.send_request(PromptRequest::new(
                            session_id.clone(), vec![ContentBlock::Text(TextContent::new(text))],
                        )).block_task();
                        tokio::pin!(prompt);
                        let mut cancelled_at = None;
                        let result = loop {
                            tokio::select! {
                                result = &mut prompt => break result,
                                _ = tokio::time::sleep_until(cancelled_at.unwrap_or_else(tokio::time::Instant::now)), if cancelled_at.is_some() => {
                                    return Err(failure("Agent did not acknowledge cancellation; session closed"));
                                },
                                command = commands.recv() => match command {
                                    Some(SessionCommand::Cancel) => {
                                        permissions.lock().unwrap().clear();
                                        deferred.retain(|command| !matches!(command, SessionCommand::Prompt(_)));
                                        connection.send_notification(CancelNotification::new(session_id.clone()))?;
                                        cancelled_at.get_or_insert(tokio::time::Instant::now() + CANCEL_TIMEOUT);
                                    },
                                    Some(SessionCommand::Close) | None => {
                                        permissions.lock().unwrap().clear();
                                        connection.send_notification(CancelNotification::new(session_id.clone()))?;
                                        return Ok(());
                                    },
                                    Some(command) => defer(command, &mut deferred, &tx, &thread),
                                }
                            }
                        };
                        permissions.lock().unwrap().clear();
                        match result {
                            Ok(response) => event(&tx, &thread, "turn_finished", format!("{:?}", response.stop_reason), serde_json::to_value(response).unwrap_or_default()),
                            Err(error) if error.code == ErrorCode::AuthRequired => {
                                needs_authentication = true;
                                let before = deferred.len();
                                deferred.retain(|command| !matches!(command, SessionCommand::Prompt(_)));
                                if deferred.len() != before {
                                    event(&tx, &thread, "command_rejected", "Queued messages were not sent because provider authentication is required", json!({ "count": before - deferred.len() }));
                                }
                                event(&tx, &thread, "session_auth_required", error.to_string(), json!({ "authMethods": auth_methods }));
                            },
                            Err(error) => event(&tx, &thread, "session_error", error.to_string(), Value::Null),
                        }
                    },
                    Some(SessionCommand::Model(model)) => {
                        let selector = model_api.lock().unwrap().clone();
                        let request = match selector.request(&session_id, &model) {
                            Ok(request) => request,
                            Err(error) => { event(&tx, &thread, "session_error", error.to_string(), Value::Null); continue; },
                        };
                        let response = setup_request(
                            connection.send_request(request).block_task(),
                            &mut commands, &mut deferred, &tx, &thread, "Model selection",
                        ).await;
                        match response {
                            Ok(Some(response)) => match selector.apply_response(&mut session_data, response, &model) {
                                Ok(()) => {
                                    *model_api.lock().unwrap() = ModelApi::from_session(&session_data);
                                    configuration.lock().unwrap().refresh(&session_data)?;
                                    session_data["peroSettings"] = serde_json::to_value(&configuration.lock().unwrap().settings).unwrap_or_default();
                                    event(&tx, &thread, "model_changed", "模型已切换", session_data.clone());
                                },
                                Err(error) => event(&tx, &thread, "session_error", error.to_string(), Value::Null),
                            },
                            Ok(None) => return Ok(()),
                            Err(error) => event(&tx, &thread, "session_error", error.to_string(), Value::Null),
                        }
                    },
                    Some(SessionCommand::Configure { id, value }) => {
                        let selector = configuration.lock().unwrap().clone();
                        let (selection, request) = match selector.request(&session_id, &id, &value) {
                            Ok(request) => request,
                            Err(error) => { event(&tx,&thread,"session_error",error.to_string(),Value::Null); continue; },
                        };
                        match setup_request(connection.send_request(request).block_task(),
                            &mut commands,&mut deferred,&tx,&thread,"Session setting").await {
                            Ok(Some(response)) => {
                                let result = configuration.lock().unwrap().acknowledged(&mut session_data,response,&selection);
                                match result {
                                    Ok(()) => {
                                        *model_api.lock().unwrap() = ModelApi::from_session(&session_data);
                                        event(&tx,&thread,"configuration_changed","",serde_json::to_value(&configuration.lock().unwrap().settings).unwrap_or_default());
                                    },
                                    Err(error) => event(&tx,&thread,"session_error",error.to_string(),Value::Null),
                                }
                            },
                            Ok(None) => return Ok(()),
                            Err(error) => event(&tx,&thread,"session_error",error.to_string(),Value::Null),
                        }
                    },
                    Some(SessionCommand::Authenticate(method_id)) => {
                        if !needs_authentication {
                            event(&tx, &thread, "session_auth_error", "The session is already authenticated", Value::Null);
                            continue;
                        }
                        match auth_methods.iter().find(|method| method.id().to_string() == method_id) {
                            Some(AuthMethod::Agent(_)) => {},
                            Some(AuthMethod::Terminal(_)) => {
                                event(&tx, &thread, "session_auth_error", "This login method requires an interactive terminal", json!({ "methodId": method_id }));
                                continue;
                            },
                            _ => {
                                event(&tx, &thread, "session_auth_error", "Unknown authentication method", Value::Null);
                                continue;
                            },
                        }
                        let response = setup_request(
                            connection.send_request(AuthenticateRequest::new(method_id)).block_task(),
                            &mut commands, &mut deferred, &tx, &thread, "Agent authentication",
                        ).await;
                        match response {
                            Ok(Some(_)) => {
                                needs_authentication = false;
                                event(&tx, &thread, "session_authenticated", "Authentication complete; send a message to continue", json!({ "sessionId": session_id }));
                            },
                            Ok(None) => return Ok(()),
                            Err(error) => event(&tx, &thread, "session_auth_error", error.to_string(), Value::Null),
                        }
                    },
                    Some(SessionCommand::Cancel) => { permissions.lock().unwrap().clear(); },
                    Some(SessionCommand::Close) | None => break,
                }
            }
            Ok(())
        })
        .await
        .map_err(|error| error.to_string())
}

#[derive(Clone, Default)]
enum ModelApi {
    Config {
        id: String,
        available: HashSet<String>,
    },
    Legacy {
        available: HashSet<String>,
    },
    #[default]
    Unavailable,
}

impl ModelApi {
    fn from_session(session: &Value) -> Self {
        if let Some(config) = session["configOptions"].as_array().and_then(|options| {
            options
                .iter()
                .find(|option| option["category"] == "model" || option["id"] == "model")
        }) {
            if let Some(id) = config["id"].as_str() {
                let mut available = HashSet::new();
                collect_model_options(&config["options"], &mut available);
                return Self::Config {
                    id: id.into(),
                    available,
                };
            }
        }
        if let Some(models) = session["models"]["availableModels"].as_array() {
            let available: HashSet<_> = models
                .iter()
                .filter_map(|model| model["modelId"].as_str().map(str::to_owned))
                .collect();
            if !available.is_empty() {
                return Self::Legacy { available };
            }
        }
        Self::Unavailable
    }

    fn request(
        &self,
        session_id: &SessionId,
        model: &str,
    ) -> agent_client_protocol::Result<UntypedMessage> {
        let advertised = match self {
            Self::Config { available, .. } | Self::Legacy { available } => {
                available.contains(model)
            }
            Self::Unavailable => false,
        };
        if !advertised {
            return Err(agent_client_protocol::Error::new(
                -32602,
                "Model is not advertised by this Agent",
            ));
        }
        match self {
            Self::Config { id, .. } => UntypedMessage::new(
                "session/set_config_option",
                SetSessionConfigOptionRequest::new(
                    session_id.clone(),
                    SessionConfigId::new(id.clone()),
                    SessionConfigValueId::new(model.to_owned()),
                ),
            ),
            Self::Legacy { .. } => UntypedMessage::new(
                "session/set_model",
                json!({ "sessionId": session_id, "modelId": model }),
            ),
            Self::Unavailable => unreachable!(),
        }
    }

    fn apply_response(
        &self,
        session: &mut Value,
        response: Value,
        model: &str,
    ) -> agent_client_protocol::Result<()> {
        match self {
            Self::Config { .. } => {
                let parsed: SetSessionConfigOptionResponse = serde_json::from_value(response)
                    .map_err(agent_client_protocol::Error::into_internal_error)?;
                session["configOptions"] = serde_json::to_value(parsed.config_options)
                    .map_err(agent_client_protocol::Error::into_internal_error)?;
            }
            Self::Legacy { .. } => {
                if !response.is_object() {
                    return Err(agent_client_protocol::Error::invalid_params());
                }
                session["models"]["currentModelId"] = json!(model);
            }
            Self::Unavailable => return Err(agent_client_protocol::Error::invalid_params()),
        }
        Ok(())
    }
}

fn collect_model_options(options: &Value, available: &mut HashSet<String>) {
    if let Some(options) = options.as_array() {
        for option in options {
            if let Some(value) = option["value"].as_str() {
                available.insert(value.to_owned());
            }
            collect_model_options(&option["options"], available);
        }
    }
}

fn next_permission_id() -> String {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    format!(
        "permission-{}",
        NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    )
}

#[cfg(test)]
#[path = "../../../../tests/runtime/acp_lifecycle.rs"]
mod lifecycle_tests;
