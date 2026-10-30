//! The same GPUI source reader, embedded without Host or execution authority.
#[cfg(target_family = "wasm")]
mod chart;
#[cfg(target_family = "wasm")]
mod chart_lines;
#[cfg(target_family = "wasm")]
mod web;
