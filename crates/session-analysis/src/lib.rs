//! Session analysis is a pure fold of one transcript.
//!
//! The harness executes an agent. This crate does not. A later Pulse view can
//! compose the result. Git ahead/behind, dirty paths, and commits stay outside;
//! [`Session::git_branch`] and [`Session::repository`] are facts the caller
//! already resolved.
//!
//! Turn boundaries are sequential, because an inferred turn depends on the
//! records before it. Classifying one bounded turn is pure and independent.
//! [`schedule`] runs that classification concurrently, then reduces in
//! transcript order.

mod checkpoint;
mod classify;
mod partition;
mod reduce;
mod schedule;
mod types;

pub use checkpoint::Checkpoint;
pub use classify::classify_turn;
pub use partition::{Partition, partition};
pub use reduce::{Prepared, ReduceState, analyze, finish, prepare, reduce};
pub use schedule::{Budget, Step, analyze_concurrent, resume};
pub use types::*;

#[cfg(test)]
mod test_support;
