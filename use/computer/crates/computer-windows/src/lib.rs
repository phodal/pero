//! windows implementation of the Pero native driver port.
#[cfg(target_os = "windows")]
mod desktop;
pub mod profile;
#[cfg(target_os = "windows")]
pub use desktop::Desktop;
#[cfg(target_os = "windows")]
mod bridge;
