//! Persistent native session; platform snapshots remain opaque to this owner.
use crate::{DesktopDriver, WindowObservation, access::ApplicationAccess, error, ocr::WindowOcr};
use base64::{Engine, engine::general_purpose::STANDARD};
use computer_core::{Window, WindowBounds};
use pero_contracts::{computer_runtime::*, computer_use::*};
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};
use uuid::Uuid;

fn reference() -> ComputerRef {
    Uuid::new_v4().to_string().try_into().unwrap()
}
struct Observation<S> {
    public: Arc<ComputerObservation>,
    native: S,
    bounds: Option<WindowBounds>,
}
#[derive(PartialEq, Eq)]
struct TreeProjection {
    max_nodes: ComputerNodeBudget,
    max_depth: ComputerDepthBudget,
    include_containers: bool,
}
struct WholeWindowBaseline {
    public: Arc<ComputerObservation>,
    projection: TreeProjection,
}
impl WholeWindowBaseline {
    fn delta(
        &self,
        base: &ComputerRef,
        projection: &TreeProjection,
        next: &mut ComputerObservation,
    ) -> Option<ComputerObservationDelta> {
        let old = &self.public;
        if old.id != *base
            || old.target != next.target
            || &self.projection != projection
            || old.truncated
            || next.truncated
        {
            return None;
        }
        let current_ids: HashSet<_> = next.elements.iter().map(|node| &node.id).collect();
        let element_order = old
            .elements
            .iter()
            .map(|node| &node.id)
            .ne(next.elements.iter().map(|node| &node.id))
            .then(|| next.elements.iter().map(|node| node.id.clone()).collect());
        let removed_element_ids = old
            .elements
            .iter()
            .filter(|node| !current_ids.contains(&node.id))
            .map(|node| node.id.clone())
            .collect();
        let previous: HashMap<_, _> = old.elements.iter().map(|node| (&node.id, node)).collect();
        next.elements
            .retain(|node| previous.get(&node.id).is_none_or(|old| *old != node));
        Some(ComputerObservationDelta {
            base_observation_id: base.clone(),
            removed_element_ids,
            element_order,
        })
    }
}
struct Observations<S> {
    window: Observation<S>,
    subtree: Option<Observation<S>>,
}
impl<S> Observations<S> {
    fn basis(&self, target: &ComputerTargetRef, root: &ComputerSubtree) -> Option<&S> {
        self.subtree
            .iter()
            .chain(std::iter::once(&self.window))
            .find(|observation| {
                observation.public.id == root.observation_id
                    && &observation.public.target == target
                    && observation
                        .public
                        .elements
                        .iter()
                        .any(|element| element.id == root.element_id)
            })
            .map(|observation| &observation.native)
    }
}
enum ObservationMode {
    Tree,
    Screenshot { recognize_text: bool },
}
pub struct ComputerRuntime<D: DesktopDriver> {
    driver: D,
    capabilities: ComputerCapabilities,
    targets: HashMap<ComputerRef, Window>,
    observations: HashMap<ComputerRef, Observations<D::Snapshot>>,
    // Public state remains available for a diff after input consumes native handles.
    last_windows: HashMap<ComputerRef, WholeWindowBaseline>,
    ocr: WindowOcr,
    host_pid: i32,
    pub(crate) cancellation: crate::Cancellation,
}
impl<D: DesktopDriver> ComputerRuntime<D> {
    /// Capture the window of a local user gesture without creating an agent target or anchor.
    pub(crate) fn appshot(&self, pid: i32) -> Result<ComputerAppshotResponse, ComputerError> {
        let window = self.driver.focused_window(pid)?;
        let observation = self
            .driver
            .observe(&window, &ComputerObserveOptions::default(), None)?;
        let image = observation.image.map_err(|status| {
            let (code, message) = match status {
                ComputerCaptureStatus::ScreenRecordingRequired => (
                    ComputerErrorCode::PermissionRequired,
                    "Allow Pero Computer Use in System Settings → Privacy & Security → Screen & System Audio Recording, then reopen Pero.",
                ),
                ComputerCaptureStatus::IncompleteScan => (
                    ComputerErrorCode::Failed,
                    "Appshot could not finish reading the window. Try again when the window is responsive.",
                ),
                ComputerCaptureStatus::SecureContent => (
                    ComputerErrorCode::PermissionRequired,
                    "Appshot could not capture a window containing secure input.",
                ),
                _ => (ComputerErrorCode::TargetUnavailable, "Appshot could not capture this window."),
            };
            error(code, message)
        })?;
        if self.driver.focused_window(pid)?.identity() != window.identity() {
            return Err(error(
                ComputerErrorCode::TargetUnavailable,
                "The focused window changed during Appshot. Try again.",
            ));
        }
        let mut seen = HashSet::new();
        let text: String = observation
            .elements
            .into_iter()
            .flat_map(|element| [Some(element.label), element.value].into_iter().flatten())
            .filter_map(|line| {
                let line = line.replace('\0', "");
                (!line.trim().is_empty() && seen.insert(line.clone())).then_some(line)
            })
            .collect::<Vec<_>>()
            .join("\n")
            .chars()
            .take(6000)
            .collect();
        Ok(ComputerAppshotResponse::Appshot {
            id: reference(),
            title: if window.title.is_empty() {
                window.name
            } else {
                window.title
            },
            image: ComputerImageContent {
                media_type: image.media_type,
                data: STANDARD.encode(image.bytes),
            },
            text,
        })
    }
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
            last_windows: HashMap::new(),
            ocr: WindowOcr::default(),
            host_pid,
            cancellation: crate::Cancellation::default(),
        }
    }
    pub fn call(
        &mut self,
        thread: ComputerRef,
        request: ComputerRequest,
    ) -> Result<ComputerResponse, ComputerError> {
        self.call_with_access(thread, request, ApplicationAccess::Unrestricted)
    }

    pub(crate) fn call_with_access(
        &mut self,
        thread: ComputerRef,
        request: ComputerRequest,
        access: ApplicationAccess<'_>,
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
                    .filter(|app| {
                        app.pid != host_pid
                            && app.window_id != 0
                            && access.allows(&app.application_id)
                    })
                    .map(|app| self.remember(app))
                    .collect();
                Ok(ComputerResponse::Targets {
                    capabilities: self.capabilities.clone(),
                    targets,
                })
            }
            ComputerRequest::Open { application } => {
                access.require_open(&application)?;
                let (app, message) = self.driver.open(&application)?;
                let target = app
                    .filter(|app| app.pid != self.host_pid && access.allows(&app.application_id))
                    .map(|app| self.remember(app));
                Ok(ComputerResponse::Opened { target, message })
            }
            ComputerRequest::Observe { target, options } => {
                self.observe(thread, target, options, ObservationMode::Tree, access)
            }
            ComputerRequest::Screenshot {
                target,
                recognize_text,
            } => self.observe(
                thread,
                target,
                ComputerObserveOptions::default(),
                ObservationMode::Screenshot { recognize_text },
                access,
            ),
            ComputerRequest::ReadOcr { screenshot_id } => {
                self.ocr.read(&thread, screenshot_id, access)
            }
            ComputerRequest::Act { action } => Ok(ComputerResponse::Receipt {
                receipt: self.act(&thread, action, access),
            }),
            ComputerRequest::Stop {} => {
                self.observations.remove(&thread);
                self.last_windows.remove(&thread);
                self.ocr.stop(&thread);
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
            application_id: (!app.application_id.is_empty()).then(|| app.application_id.clone()),
        };
        self.targets.insert(id, app);
        target
    }
    fn target(
        &self,
        target: &ComputerTargetRef,
        access: ApplicationAccess<'_>,
    ) -> Result<Window, ComputerError> {
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
        access.require(&app.application_id)?;
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
        options: ComputerObserveOptions,
        mode: ObservationMode,
        access: ApplicationAccess<'_>,
    ) -> Result<ComputerResponse, ComputerError> {
        let app = self.target(&target, access)?;
        let basis = if let Some(root) = &options.root {
            Some(
                self.observations
                    .get(&thread)
                    .and_then(|current| current.basis(&target, root))
                    .ok_or_else(|| {
                        error(
                            ComputerErrorCode::StaleObservation,
                            "Expand a control from the latest observation or the current whole-window observation",
                        )
                    })?,
            )
        } else {
            None
        };
        let WindowObservation {
            source,
            bounds,
            elements,
            image,
            truncated,
        } = self.driver.observe(&app, &options, basis)?;
        let screenshot_only = matches!(mode, ObservationMode::Screenshot { .. });
        let recognize_text = !matches!(
            mode,
            ObservationMode::Screenshot {
                recognize_text: false
            }
        ) && options.want_image
            && options.root.is_none();
        let capture_status = image
            .as_ref()
            .err()
            .copied()
            .unwrap_or(ComputerCaptureStatus::Captured);
        let image = image.ok();
        let screenshot = image.as_ref().map(|image| ComputerScreenshot {
            id: reference(),
            media_type: image.media_type,
            width: image.width,
            height: image.height,
        });
        let (ocr_status, recognized_text) = if !recognize_text {
            (ComputerOcrStatus::NotRequested, None)
        } else if let (Some(image), Some(screenshot)) = (&image, &screenshot) {
            if let Some(recognize) = self.driver.text_recognizer() {
                self.ocr.start(
                    &thread,
                    &screenshot.id,
                    &app.application_id,
                    recognize,
                    &image.bytes,
                )
            } else {
                (ComputerOcrStatus::Unsupported, None)
            }
        } else {
            (ComputerOcrStatus::NoImage, None)
        };
        let image = image.map(|image| ComputerImageContent {
            media_type: image.media_type,
            data: STANDARD.encode(image.bytes),
        });
        let mut observation = ComputerObservation {
            id: reference(),
            target,
            elements: if screenshot_only {
                Vec::new()
            } else {
                elements
            },
            screenshot,
            truncated,
        };
        let public = Arc::new(observation.clone());
        let snapshot = Observation {
            public: public.clone(),
            native: source,
            bounds,
        };
        let delta = if screenshot_only {
            // Pixel input uses this frame. AX follow-ups still use the last tree.
            self.observations.insert(
                thread,
                Observations {
                    window: snapshot,
                    subtree: None,
                },
            );
            None
        } else if options.root.is_some() {
            self.observations.get_mut(&thread).unwrap().subtree = Some(snapshot);
            None
        } else {
            let projection = TreeProjection {
                max_nodes: options.max_nodes,
                max_depth: options.max_depth,
                include_containers: options.include_containers,
            };
            let delta = self
                .last_windows
                .get(&thread)
                .filter(|_| !options.disable_diffing)
                .and_then(|previous| {
                    let base = options
                        .since_observation_id
                        .as_ref()
                        .unwrap_or(&previous.public.id);
                    previous.delta(base, &projection, &mut observation)
                });
            self.last_windows
                .insert(thread.clone(), WholeWindowBaseline { public, projection });
            self.observations.insert(
                thread,
                Observations {
                    window: snapshot,
                    subtree: None,
                },
            );
            delta
        };
        Ok(ComputerResponse::Observation {
            observation,
            image,
            capture_status: Some(capture_status),
            ocr_status: Some(ocr_status),
            recognized_text,
            delta,
        })
    }
    fn act(
        &mut self,
        thread: &ComputerRef,
        action: ComputerAction,
        access: ApplicationAccess<'_>,
    ) -> ComputerActionReceipt {
        let mut receipt = ComputerActionReceipt {
            request_id: action.request_id.clone(),
            target: action.target.clone(),
            observation_id: action.observation_id.clone(),
            outcome: ComputerActionOutcome::Executed { execution: None },
        };
        let prepared = (|| {
            let app = self.target(&action.target, access)?;
            let observations = self.observations.remove(thread).ok_or_else(|| {
                error(
                    ComputerErrorCode::StaleObservation,
                    "Observe this target in the current conversation first",
                )
            })?;
            let observation = observations.subtree.unwrap_or(observations.window);
            let action = action
                .prepare(&observation.public, &self.capabilities)?
                .into_action();
            let current = self.driver.bounds(&app);
            if current != observation.bounds {
                return Err(error(
                    ComputerErrorCode::StaleObservation,
                    format!(
                        "The window moved or resized; observe again (observed {:?}, current {:?})",
                        observation.bounds, current
                    ),
                ));
            }
            self.driver.admit(&observation.native, &action)?;
            Ok((action, observation, app))
        })();
        match prepared {
            Err(error) => receipt.outcome = ComputerActionOutcome::Rejected { error },
            Ok((action, observation, app)) => {
                // Input dispatch has begun. Any native failure is conservatively unknown.
                receipt.outcome =
                    match self
                        .driver
                        .input(&app, &observation.native, action, &self.cancellation)
                    {
                        Ok(execution) => ComputerActionOutcome::Executed { execution },
                        Err(error) => ComputerActionOutcome::Unknown { error },
                    };
            }
        }
        receipt
    }
}
