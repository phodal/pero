//! 平台中立契约层 —— REF `kiro_crew/computer_use` 纯层(types/render/policy/
//! gate/enable_state/keymap/cursor_motion)的 Rust 移植。
//!
//! 本 crate 是 L1:零第三方依赖、`#![forbid(unsafe_code)]`、绝不接触平台
//! API。所有常量、拒绝文案、安全谓词的唯一居所(对照 REF types.py 的
//! “single home” 原则)。
//!
//! 与 REF 的一处小偏离:REF 用 Python stdlib 的 json;Rust 侧为保持零依赖,
//! 自带一个极小的 JSON 解析模块 [`json`](仅服务 keystone 状态文件),任何
//! 解析失败一律 fail-soft 为「禁用」,解析缺陷不可能打开开关。

#![forbid(unsafe_code)]

pub mod clock;
pub mod cursor_motion;
pub mod enable_state;
pub mod gate;
pub mod json;
pub mod keymap;
pub mod policy;
pub mod render;
pub mod types;
