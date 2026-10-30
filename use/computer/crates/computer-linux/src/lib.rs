//! linux implementation of the Pero native driver port.
#[cfg(target_os = "linux")]
mod desktop;
pub mod profile;
#[cfg(target_os = "linux")]
pub use desktop::Desktop;
