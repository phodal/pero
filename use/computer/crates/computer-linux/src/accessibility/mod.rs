//! AT-SPI observation and element actions for X11 sessions.
//! The value rules here are platform-free; only `bus` talks to D-Bus.
#[cfg(target_os = "linux")]
mod bus;
mod model;

#[cfg(target_os = "linux")]
pub use bus::{Accessibility, AccessibleTree, ElementTarget};
pub use model::*;
