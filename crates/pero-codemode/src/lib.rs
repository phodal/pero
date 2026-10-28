//! Supervised code runs.
//!
//! [`run`] is the fold: one workspace write at a time, and a receipt that
//! survives a restart. This crate also spawns the allowlisted interpreter.
//! The Host only forwards `run_code` and `cancel_code`.

pub mod run;

mod exec;
mod process;

pub use exec::{CodeMode, CodeNotice, Paths, paths_from_env};
