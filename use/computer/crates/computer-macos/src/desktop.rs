//! macOS AX, ScreenCaptureKit and window-scoped input implementation.
use crate::{bridge, profile};

use computer_core::{Window, WindowBounds};
use computer_runtime::{DesktopDriver, WindowObservation, error};
use pero_contracts::{computer_runtime::*, computer_use::*};
use point_computer_backend::backend::{ComputerUseBackend, LaunchPermit};
use point_computer_macos::driver::MacOsBackend;
use point_computer_macos::ffi;
use std::cell::RefCell;

pub struct Desktop {
    driver: MacOsBackend,
    ids: RefCell<crate::observation::ElementIds>,
}
impl Desktop {
    pub fn connect() -> Self {
        Self {
            driver: MacOsBackend::new(),
            ids: RefCell::default(),
        }
    }
}
impl DesktopDriver for Desktop {
    type Snapshot = crate::observation::Snapshot;
    fn environment(&self) -> ComputerEnvironment {
        profile::environment()
    }
    fn observations(&self) -> Vec<ComputerObservationKind> {
        profile::observations()
    }
    fn actions(&self) -> Vec<ComputerActionSupport> {
        profile::actions()
    }
    fn status(&self) -> ComputerDriverStatus {
        let probe = self.driver.probe_permissions();
        let state = |value: &str| {
            if value == "granted" {
                ComputerPermissionState::Granted
            } else {
                ComputerPermissionState::NotDetected
            }
        };
        ComputerDriverStatus {
            environment: Some(self.environment()),
            available: true,
            accessibility: state(probe.accessibility),
            screen_recording: state(probe.screen_recording),
            message: format!(
                "Permission owner: {}. Preflight is advisory; observing a window checks actual access.",
                point_computer_macos::permissions::responsible_process_name()
            ),
        }
    }
    fn targets(&self) -> Result<Vec<Window>, ComputerError> {
        let windows: Vec<_> = point_computer_macos::ffi::window_list()
            .into_iter()
            .filter(|info| {
                info.layer == 0
                    && info.pid > 0
                    && info.window_id != 0
                    && !info.owner_name.is_empty()
            })
            .map(|info| Window {
                pid: info.pid,
                window_id: info.window_id,
                application_id: crate::applications::identity(info.pid),
                name: info.owner_name,
                title: info.title,
            })
            .collect();
        self.ids.borrow_mut().retain_windows(&windows);
        Ok(windows)
    }
    fn open(
        &self,
        application: &ComputerApplicationSelector,
    ) -> Result<(Option<Window>, String), ComputerError> {
        match application {
            ComputerApplicationSelector::Name(name) => {
                let result = self.driver.launch_app(name.as_str(), LaunchPermit::none());
                if result.ok {
                    Ok((result.app.map(bridge::window), result.text))
                } else {
                    Err(error(ComputerErrorCode::Failed, result.text))
                }
            }
            ComputerApplicationSelector::Bundle(ComputerBundleSelector::BundleId { bundle_id }) => {
                crate::applications::open(self, bundle_id.as_str())
            }
        }
    }
    fn focused_window(&self, pid: i32) -> Result<Window, ComputerError> {
        let unavailable = || {
            error(
                ComputerErrorCode::TargetUnavailable,
                "Appshot needs a focused application window. Bring the window forward and try again.",
            )
        };
        if pid <= 0 || crate::applications::frontmost_pid() != pid {
            return Err(unavailable());
        }
        let app = ffi::ax_app_element(pid).ok_or_else(unavailable)?;
        let window = crate::observation::read_element_attribute(&app, "AXFocusedWindow")
            .map_err(|code| {
                if code == ffi::AX_ERR_API_DISABLED {
                    crate::observation::accessibility_required()
                } else {
                    unavailable()
                }
            })?
            .ok_or_else(unavailable)?;
        let id = ffi::ax_window_id(&window);
        self.targets()?
            .into_iter()
            .find(|window| window.pid == pid && window.window_id == id)
            .ok_or_else(unavailable)
    }
    fn bounds(&self, app: &Window) -> Option<WindowBounds> {
        crate::observation::bounds(app)
    }
    fn observe(
        &self,
        app: &Window,
        options: &ComputerObserveOptions,
        basis: Option<&Self::Snapshot>,
    ) -> Result<WindowObservation<Self::Snapshot>, ComputerError> {
        crate::observation::observe(app, options, basis, &mut self.ids.borrow_mut())
    }
    fn text_recognizer(&self) -> Option<computer_runtime::TextRecognizer> {
        Some(crate::capture::recognize_text)
    }
    fn input(
        &self,
        app: &Window,
        observation: &Self::Snapshot,
        action: ComputerAction,
        cancellation: &computer_runtime::Cancellation,
    ) -> Result<Option<ComputerExecution>, ComputerError> {
        crate::input::execute(app, observation, action, cancellation)
    }
}
