//! macOS AX, ScreenCaptureKit and window-scoped input implementation.
use crate::{bridge, profile};

use computer_core::{Window, WindowBounds};
use computer_runtime::{DesktopDriver, WindowObservation, error};
use pero_contracts::{computer_runtime::*, computer_use::*};
use point_computer_backend::backend::{ComputerUseBackend, LaunchPermit};
use point_computer_macos::driver::MacOsBackend;

pub struct Desktop {
    driver: MacOsBackend,
}
impl Desktop {
    pub fn connect() -> Self {
        Self {
            driver: MacOsBackend::new(),
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
        Ok(point_computer_macos::ffi::window_list()
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
            .collect())
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
    fn bounds(&self, app: &Window) -> Option<WindowBounds> {
        crate::observation::bounds(app)
    }
    fn observe(
        &self,
        app: &Window,
        options: &ComputerObserveOptions,
        basis: Option<&Self::Snapshot>,
    ) -> Result<WindowObservation<Self::Snapshot>, ComputerError> {
        crate::observation::observe(app, options, basis)
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
