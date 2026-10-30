//! macos implementation of the Pero native driver port.
#[cfg(target_os = "macos")]
mod desktop;
pub mod profile;
#[cfg(target_os = "macos")]
pub use desktop::Desktop;
#[cfg(target_os = "macos")]
mod bridge;
#[cfg(target_os = "macos")]
mod capture;
#[cfg(target_os = "macos")]
mod scroll;
#[cfg(target_os = "macos")]
mod window_input;
