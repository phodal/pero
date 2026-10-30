//! macOS 平台实现(REF `macos_ffi.py`/`macos_skylight.py`/`permissions.py`
//! 及 driver 侧文件的移植)。
//!
//! 本 crate 是 macOS 上唯一接触原生代码的单元,`extern "C"` 圈禁在两处:
//!
//! * [`ffi`] —— 唯一的 extern 块模块(公开框架:CoreFoundation/
//!   ApplicationServices/CoreGraphics/ImageIO/libproc/libSystem);
//! * [`skylight`] —— dlopen 的私有框架,唯一例外(见其模块文档的隔离理
//!   由)。
//!
//! 其余模块经 ffi 的类型化助手到达系统:
//!
//! * [`apps`] —— 窗口列表发现 + OS 解析身份(硬化 Info.plist 读);
//! * [`snapshot`] —— 无障碍走查(唯一的元素编号权威);
//! * [`capture`] —— 窗口像素 → 尺寸有界的落盘 JPEG;
//! * [`permissions`] —— 建议性 TCC 探针(永不设门);
//! * [`launch`] —— bundle 目录 + 四层可写性验证 + `/usr/bin/open`;
//! * [`driver`] —— backend trait 的完整实现(观测 + 动作)。

#![deny(unsafe_op_in_unsafe_fn)]

pub mod apps;
pub mod capture;
pub mod driver;
pub mod ffi;
pub mod launch;
pub mod permissions;
pub mod skylight;
pub mod snapshot;
