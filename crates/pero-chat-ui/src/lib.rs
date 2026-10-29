//! GPUI conversation components shared by the Workbench and standalone chat.
#[cfg(any(target_family = "wasm", feature = "native"))]
pub mod assets;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod chat;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod composer;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod composer_actions;
#[cfg(any(target_family = "wasm", feature = "native"))]
pub mod composer_picker;
#[cfg_attr(not(any(target_family = "wasm", feature = "native")), allow(dead_code))]
pub mod composer_state;
#[cfg(any(target_family = "wasm", feature = "native"))]
pub mod conversation;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod panel;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod session_controls;
pub mod stream;
pub mod artifact_read;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod content_reader;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod view_bounds;
#[cfg(any(target_family = "wasm", feature = "native"))]
pub use pero_theme as theme;
#[cfg_attr(not(any(target_family = "wasm", feature = "native")), allow(dead_code))]
mod tool_ui;
#[cfg(any(target_family = "wasm", feature = "native"))]
pub use panel::{ChatAction, ChatPanel};

#[cfg(any(target_family = "wasm", feature = "native"))]
pub use conversation::{AgentChoice, Conversation};

#[cfg(any(target_family = "wasm", feature = "native"))]
pub mod usage;

pub mod session_state;
pub mod authentication;

pub mod conversation_title;
pub mod thinking;
pub mod tool_transcript;

#[cfg(any(target_family = "wasm", feature = "native"))]
mod approvals;
