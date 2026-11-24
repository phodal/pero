//! Shared native session, driver port and private NDJSON transport.
mod access;
mod driver;
mod ocr;
mod runtime;
mod stdio;
mod unsupported;
pub use driver::{DesktopDriver, WindowObservation};
pub use ocr::{TextRecognizer, WindowText};
pub use runtime::ComputerRuntime;
pub use stdio::{serve, serve_stream};
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

mod cancellation;
pub use cancellation::Cancellation;
