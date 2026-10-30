//! One conversion boundary from the pinned Point platform driver to Pero values.
use crate::platform::Desktop;
use base64::{Engine, engine::general_purpose::STANDARD};
use pero_contracts::{computer_runtime::*, computer_use::*};
use point_computer_core::types as native;
use std::{collections::HashMap, num::NonZeroU32};
use uuid::Uuid;

fn reference() -> ComputerRef {
    Uuid::new_v4().to_string().try_into().unwrap()
}
pub fn error(code: ComputerErrorCode, message: impl Into<String>) -> ComputerError {
    ComputerError {
        code,
        message: message.into(),
    }
}

struct Observation {
    public: ComputerObservation,
    native: native::Snapshot,
}
pub struct ComputerRuntime {
    driver: Desktop,
    capabilities: ComputerCapabilities,
    targets: HashMap<ComputerRef, native::AppRef>,
    observations: HashMap<ComputerRef, Observation>,
    host_pid: i32,
}
impl ComputerRuntime {
    pub fn new() -> Self {
        let driver = Desktop::new();
        let actions = driver.actions();
        let observations = driver.observations();
        Self {
            driver,
            capabilities: ComputerCapabilities {
                protocol: ComputerProtocol::V1,
                runtime_id: reference(),
                observations,
                actions,
            },
            targets: HashMap::new(),
            observations: HashMap::new(),
            host_pid: std::env::var("PERO_COMPUTER_HOST_PID")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(std::process::id() as i32),
        }
    }
    pub fn call(
        &mut self,
        thread: ComputerRef,
        request: ComputerRequest,
    ) -> Result<ComputerResponse, ComputerError> {
        match request {
            ComputerRequest::Status {} => Ok(ComputerResponse::Status {
                status: self.driver.status(),
            }),
            ComputerRequest::Targets {} => {
                let apps = self.driver.targets()?;
                let host_pid = self.host_pid;
                let targets = apps
                    .into_iter()
                    .filter(|app| app.pid != host_pid && app.window_id != 0)
                    .map(|app| self.remember(app))
                    .collect();
                Ok(ComputerResponse::Targets {
                    capabilities: self.capabilities.clone(),
                    targets,
                })
            }
            ComputerRequest::Open { application } => {
                let (app, message) = self.driver.open(application.as_str())?;
                let target = app
                    .filter(|app| app.pid != self.host_pid)
                    .map(|app| self.remember(app));
                Ok(ComputerResponse::Opened { target, message })
            }
            ComputerRequest::Observe { target } => self.observe(thread, target),
            ComputerRequest::Act { action } => Ok(ComputerResponse::Receipt {
                receipt: self.act(&thread, action),
            }),
            ComputerRequest::Stop {} => {
                self.observations.remove(&thread);
                Ok(ComputerResponse::Stopped {})
            }
            ComputerRequest::Receipt { .. } => Err(error(
                ComputerErrorCode::Unsupported,
                "Execution receipts are owned by the Desktop",
            )),
        }
    }
    fn remember(&mut self, app: native::AppRef) -> ComputerTarget {
        let id = self
            .targets
            .iter()
            .find(|(_, previous)| previous.window_key() == app.window_key())
            .map(|(id, _)| id.clone())
            .unwrap_or_else(reference);
        let target = ComputerTarget {
            reference: ComputerTargetRef {
                runtime_id: self.capabilities.runtime_id.clone(),
                target_id: id.clone(),
            },
            kind: ComputerTargetKind::Window,
            title: app.window_title.clone(),
            application: Some(app.name.clone()),
        };
        self.targets.insert(id, app);
        target
    }
    fn target(&self, target: &ComputerTargetRef) -> Result<native::AppRef, ComputerError> {
        if target.runtime_id != self.capabilities.runtime_id {
            return Err(error(
                ComputerErrorCode::TargetUnavailable,
                "The native runtime restarted; list targets again",
            ));
        }
        let app = self.targets.get(&target.target_id).ok_or_else(|| {
            error(
                ComputerErrorCode::TargetUnavailable,
                "List and select a current target",
            )
        })?;
        if app.pid == self.host_pid
            || !self.driver.targets()?.iter().any(|live| {
                live.pid == app.pid
                    && live.window_id == app.window_id
                    && live.bundle_id == app.bundle_id
            })
        {
            return Err(error(
                ComputerErrorCode::TargetUnavailable,
                "The target window no longer belongs to this application",
            ));
        }
        Ok(app.clone())
    }
    fn observe(
        &mut self,
        thread: ComputerRef,
        target: ComputerTargetRef,
    ) -> Result<ComputerResponse, ComputerError> {
        self.observations.remove(&thread);
        let app = self.target(&target)?;
        let snap = self.driver.observe(&app)?;
        let elements = snap
            .elements
            .iter()
            .map(|element| {
                let mut actions = Vec::new();
                if element.enabled && !element.secure {
                    if element.actions.iter().any(|action| action == "AXPress")
                        || element.role.contains("Button")
                    {
                        actions.push(ComputerActionKind::Click);
                    }
                    if element.role.contains("TextField")
                        || element.role == "Edit"
                        || element.role.contains("TextArea")
                        || element.role.contains("ComboBox")
                    {
                        actions
                            .extend([ComputerActionKind::TypeText, ComputerActionKind::PressKey]);
                    }
                    if element.role.contains("Scroll") {
                        actions.push(ComputerActionKind::Scroll);
                    }
                }
                ComputerElement {
                    id: format!("element-{}", element.index).try_into().unwrap(),
                    role: element.role.clone(),
                    label: element.title.clone(),
                    value: (!element.secure && !element.value.is_empty())
                        .then(|| element.value.clone()),
                    depth: element.depth,
                    actions,
                }
            })
            .collect();
        let screenshot = if snap.image_jpeg.is_empty() {
            None
        } else {
            NonZeroU32::new(snap.image_width)
                .zip(NonZeroU32::new(snap.image_height))
                .map(|(width, height)| ComputerScreenshot {
                    id: reference(),
                    media_type: ComputerImageType::Jpeg,
                    width,
                    height,
                })
        };
        let image = screenshot.as_ref().map(|_| ComputerImageContent {
            media_type: ComputerImageType::Jpeg,
            data: STANDARD.encode(&snap.image_jpeg),
        });
        let observation = ComputerObservation {
            id: reference(),
            target,
            elements,
            screenshot,
            truncated: snap.truncated || snap.depth_truncated,
        };
        self.observations.insert(
            thread,
            Observation {
                public: observation.clone(),
                native: snap,
            },
        );
        Ok(ComputerResponse::Observation { observation, image })
    }
    fn act(&mut self, thread: &ComputerRef, action: ComputerAction) -> ComputerActionReceipt {
        let mut receipt = ComputerActionReceipt {
            request_id: action.request_id.clone(),
            target: action.target.clone(),
            observation_id: action.observation_id.clone(),
            outcome: ComputerActionOutcome::Executed {},
        };
        let prepared = (|| {
            let observation = self.observations.remove(thread).ok_or_else(|| {
                error(
                    ComputerErrorCode::StaleObservation,
                    "Observe this target in the current conversation first",
                )
            })?;
            let app = self.target(&action.target)?;
            let action = action
                .prepare(&observation.public, &self.capabilities)?
                .into_action();
            let current = self.driver.bounds(&app);
            if current != observation.native.window_bounds {
                return Err(error(
                    ComputerErrorCode::StaleObservation,
                    "The window moved or resized; observe again",
                ));
            }
            Ok((action, observation, app))
        })();
        match prepared {
            Err(error) => receipt.outcome = ComputerActionOutcome::Rejected { error },
            Ok((action, observation, app)) => {
                // Input dispatch has begun. Any native failure is conservatively unknown.
                if let Err(error) = self.driver.input(&app, &observation.native, action) {
                    receipt.outcome = ComputerActionOutcome::Unknown { error };
                }
            }
        }
        receipt
    }
}
