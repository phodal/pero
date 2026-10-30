use crate::{DesktopDriver, WindowObservation, error};
use computer_core::{Window, WindowBounds};
use pero_contracts::{computer_runtime::*, computer_use::*};

pub struct UnsupportedDesktop;
impl UnsupportedDesktop {
    pub fn connect() -> Self {
        Self
    }
}
impl DesktopDriver for UnsupportedDesktop {
    type Snapshot = ();
    fn environment(&self) -> ComputerEnvironment {
        ComputerEnvironment {
            platform: ComputerPlatform::Other,
            display: ComputerDisplay::Unavailable,
            desktop: None,
        }
    }
    fn observations(&self) -> Vec<ComputerObservationKind> {
        Vec::new()
    }
    fn actions(&self) -> Vec<ComputerActionSupport> {
        Vec::new()
    }
    fn status(&self) -> ComputerDriverStatus {
        ComputerDriverStatus {
            environment: Some(self.environment()),
            available: false,
            accessibility: ComputerPermissionState::Unsupported,
            screen_recording: ComputerPermissionState::Unsupported,
            message: "Native Computer Use is unsupported on this operating system".into(),
        }
    }
    fn targets(&self) -> Result<Vec<Window>, ComputerError> {
        Err(error(
            ComputerErrorCode::Unsupported,
            "No native window backend",
        ))
    }
    fn open(&self, _: &str) -> Result<(Option<Window>, String), ComputerError> {
        Err(error(
            ComputerErrorCode::Unsupported,
            "No native launch backend",
        ))
    }
    fn bounds(&self, _: &Window) -> Option<WindowBounds> {
        None
    }
    fn observe(&self, _: &Window) -> Result<WindowObservation<()>, ComputerError> {
        Err(error(
            ComputerErrorCode::Unsupported,
            "No native observation backend",
        ))
    }
    fn input(&self, _: &Window, _: &(), _: ComputerAction) -> Result<(), ComputerError> {
        Err(error(
            ComputerErrorCode::Unsupported,
            "No native input backend",
        ))
    }
}
