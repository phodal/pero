//! Windows native Computer Use (ADR-0118): bounded UIA, focused Unicode/logical
//! keys, JPEG and explicitly requested global pointer. Unsupported patterns
//! and macOS-only routes refuse without a coordinate fallback.
//! Native UIA/Win32 execution is cfg(windows); offline tests cannot certify it.

pub mod apps;
pub mod capture;
pub mod driver;
pub mod execution;
pub mod ffi;
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) mod jpeg;
pub mod keys;
pub mod launch;
pub mod snapshot;
pub mod stop;
pub mod text;
pub mod uia;
#[cfg(windows)]
mod wgc;

pub use driver::WindowsBackend;
