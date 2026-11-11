//! GPUI conversation components shared by the Workbench and standalone chat.
pub mod app_links;
#[cfg_attr(not(any(target_family = "wasm", feature = "native")), allow(dead_code))]
mod message_attachments;
#[cfg(any(target_family = "wasm", feature = "native"))]
pub mod assets;
#[cfg(any(target_family = "wasm", feature = "native"))]
pub mod icon_theme;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod chat;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod composer;
#[cfg_attr(not(any(target_family = "wasm", feature = "native")), allow(dead_code))]
mod composer_workspace;
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
#[cfg(any(target_family = "wasm", feature = "native"))]
pub mod comparison;
pub mod scientific_math;
pub mod scientific_citation;
mod scientific_source;
pub mod inline_images;
pub mod image_references;
pub mod artifact_read;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod session_artifacts;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod artifact_panel;
#[cfg(any(target_family = "wasm", feature = "native"))]
pub use artifact_panel::{ResourceColumn, ResourcePrimary};
#[cfg(any(target_family = "wasm", feature = "native"))]
mod pane_toolbar;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod artifact_surface;
#[cfg(target_family = "wasm")]
pub mod web_platform;
#[cfg(any(target_family = "wasm", feature = "native"))]
pub mod content_reader;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod source_syntax;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod content_table;
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
pub mod brief_conversation;
pub mod thinking;
pub mod process;
pub mod tool_activity;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod transcript_view;
pub mod tool_transcript;
pub mod tool_body;
#[cfg(any(target_family="wasm",feature="native"))]
mod tool_body_view;

#[cfg(any(target_family = "wasm", feature = "native"))]
mod approvals;

#[cfg(any(target_family = "wasm", feature = "native"))]
mod user_questions;

#[cfg(any(target_family = "wasm", feature = "native"))]
pub mod chart;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod chart_lines;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod chart_view;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod control_result;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod molecule_view;

#[cfg(any(target_family = "wasm", feature = "native"))]
mod table_view;

#[cfg_attr(not(any(target_family = "wasm", feature = "native")), allow(dead_code))]
mod file_tree;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod workspace_files;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod file_panel;
#[cfg(any(target_family="wasm",feature="native"))]
mod changes_view;
