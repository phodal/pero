//! Persistent native session; platform snapshots remain opaque to this owner.
use crate::{DesktopDriver, WindowObservation, error};
use base64::{Engine, engine::general_purpose::STANDARD};
use computer_core::{Window, WindowBounds};
use pero_contracts::{computer_runtime::*, computer_use::*};
use std::collections::HashMap;
use uuid::Uuid;

fn reference() -> ComputerRef {
    Uuid::new_v4().to_string().try_into().unwrap()
}
struct Observation<S> {
    public: ComputerObservation,
    native: S,
    bounds: Option<WindowBounds>,
}
pub struct ComputerRuntime<D: DesktopDriver> {
    driver: D,
    capabilities: ComputerCapabilities,
    targets: HashMap<ComputerRef, Window>,
    observations: HashMap<ComputerRef, Observation<D::Snapshot>>,
    host_pid: i32,
}
impl<D: DesktopDriver> ComputerRuntime<D> {
    pub fn new(driver: D, host_pid: i32) -> Self {
        let actions = driver.actions();
        let observations = driver.observations();
        let environment = driver.environment();
        Self {
            driver,
            capabilities: ComputerCapabilities {
                protocol: ComputerProtocol::V1,
                runtime_id: reference(),
                environment,
                observations,
                actions,
            },
            targets: HashMap::new(),
            observations: HashMap::new(),
            host_pid,
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
    fn remember(&mut self, app: Window) -> ComputerTarget {
        let id = self
            .targets
            .iter()
            .find(|(_, previous)| previous.identity() == app.identity())
            .map(|(id, _)| id.clone())
            .unwrap_or_else(reference);
        let target = ComputerTarget {
            reference: ComputerTargetRef {
                runtime_id: self.capabilities.runtime_id.clone(),
                target_id: id.clone(),
            },
            kind: ComputerTargetKind::Window,
            title: app.title.clone(),
            application: Some(app.name.clone()),
        };
        self.targets.insert(id, app);
        target
    }
    fn target(&self, target: &ComputerTargetRef) -> Result<Window, ComputerError> {
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
            || !self
                .driver
                .targets()?
                .iter()
                .any(|live| live.identity() == app.identity())
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
        let WindowObservation {
            source,
            bounds,
            elements,
            image,
            truncated,
        } = self.driver.observe(&app)?;
        let screenshot = image.as_ref().map(|image| ComputerScreenshot {
            id: reference(),
            media_type: image.media_type,
            width: image.width,
            height: image.height,
        });
        let image = image.map(|image| ComputerImageContent {
            media_type: image.media_type,
            data: STANDARD.encode(image.bytes),
        });
        let observation = ComputerObservation {
            id: reference(),
            target,
            elements,
            screenshot,
            truncated,
        };
        self.observations.insert(
            thread,
            Observation {
                public: observation.clone(),
                native: source,
                bounds,
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
            if current != observation.bounds {
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
