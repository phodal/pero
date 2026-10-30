//! Shared native session, driver port and private NDJSON transport.
mod driver;
mod runtime;
mod stdio;
mod unsupported;
pub use driver::{DesktopDriver, WindowObservation};
pub use runtime::ComputerRuntime;
pub use stdio::serve;
pub use unsupported::UnsupportedDesktop;
#[cfg(test)]
mod tests;

pub fn error(
    code: pero_contracts::computer_use::ComputerErrorCode,
    message: impl Into<String>,
) -> pero_contracts::computer_use::ComputerError {
    pero_contracts::computer_use::ComputerError {
        code,
        message: message.into(),
    }
}
