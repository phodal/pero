//! Driver trait 层(REF `backend.py` 的移植)。
//!
//! [`backend::ComputerUseBackend`] 是随 OS 变化的唯一类型;其上的一切
//! (policy、渲染、索引生命周期、dispatch)平台无关。异常不穿缝:每方法
//! 返回 `DriverResult`,永不 Err、永不 panic。本 crate 不接触 FFI —— 平台
//! crate 由 service 的 platform.rs 惰性选择,在任何 OS 上加载本包不触碰
//! 原生库。

pub mod backend;
pub mod launch;
pub mod registry;
pub mod unsupported;

pub use backend::{ComputerUseBackend, LaunchPermit};
pub use launch::{LaunchAdapter, await_launched_window, run_launch, run_launch_default};
pub use registry::{BackendFactory, register_backend, reset_shared_backend, shared_backend};
pub use unsupported::{
	DRIVER_IMPORT_REASON, LINUX_REASON, UNKNOWN_PLATFORM_REASON, UnsupportedBackend, WINDOWS_REASON,
	unsupported_snapshot,
};
