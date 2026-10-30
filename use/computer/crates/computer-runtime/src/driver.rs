use computer_core::{Window, WindowBounds, WindowImage};
use pero_contracts::{computer_runtime::*, computer_use::*};

/// A platform retains its own snapshot; the shared session never interprets it.
pub struct WindowObservation<S> {
    pub source: S,
    pub bounds: Option<WindowBounds>,
    pub elements: Vec<ComputerElement>,
    pub image: Option<WindowImage>,
    pub truncated: bool,
}

/// Port owned by the runtime consumer, implemented by the three native libraries.
pub trait DesktopDriver {
    type Snapshot;
    fn environment(&self) -> ComputerEnvironment;
    fn observations(&self) -> Vec<ComputerObservationKind>;
    fn actions(&self) -> Vec<ComputerActionSupport>;
    fn status(&self) -> ComputerDriverStatus;
    fn targets(&self) -> Result<Vec<Window>, ComputerError>;
    fn open(&self, name: &str) -> Result<(Option<Window>, String), ComputerError>;
    fn bounds(&self, window: &Window) -> Option<WindowBounds>;
    fn observe(&self, window: &Window) -> Result<WindowObservation<Self::Snapshot>, ComputerError>;
    /// Platform-specific refusals that are certain before any native input,
    /// such as parameters the adapter cannot express. Rejected, never unknown.
    fn admit(
        &self,
        _snapshot: &Self::Snapshot,
        _action: &ComputerAction,
    ) -> Result<(), ComputerError> {
        Ok(())
    }
    fn input(
        &self,
        window: &Window,
        snapshot: &Self::Snapshot,
        action: ComputerAction,
    ) -> Result<(), ComputerError>;
}
