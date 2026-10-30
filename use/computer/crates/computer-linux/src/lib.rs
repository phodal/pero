//! linux implementation of the Pero native driver port.
#[cfg(target_os = "linux")]
mod desktop;
#[cfg(target_os = "linux")]
mod interrupt;
pub mod profile;
#[cfg(target_os = "linux")]
pub use desktop::Desktop;
