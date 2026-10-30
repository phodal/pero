//! Pero's native window values. No platform SDK, process, environment or transport.
#![forbid(unsafe_code)]
mod accessibility;
pub use accessibility::ObservedControl;
use pero_contracts::computer_use::*;
use std::num::NonZeroU32;

#[derive(Clone, Debug)]
pub struct Window {
    pub pid: i32,
    pub window_id: u32,
    pub application_id: String,
    pub name: String,
    pub title: String,
}

#[derive(Eq, PartialEq)]
pub struct WindowIdentity<'a> {
    process: i32,
    window: u32,
    application: &'a str,
}

impl Window {
    pub fn identity(&self) -> WindowIdentity<'_> {
        WindowIdentity {
            process: self.pid,
            window: self.window_id,
            application: &self.application_id,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WindowBounds {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

pub struct WindowImage {
    pub bytes: Vec<u8>,
    pub width: NonZeroU32,
    pub height: NonZeroU32,
    pub media_type: ComputerImageType,
}
