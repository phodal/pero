//! 进程级唯一 backend,运行时可换。REF `backend.py` registry 三函数的移植。
//!
//! 一个进程一个实例:driver 持缓存的框架句柄与一个事件源,建第二个只会把
//! 两样都翻倍。factory 可换是测试与未来平台的交换缝 —— 注册 FakeBackend
//! 后整个进程不加载原生框架、不捕获真实窗口、不触碰真实应用。
//!
//! 与 REF 的一处结构差异(ADR 已记录):REF 的 `reset_shared_backend` 同时
//! 丢弃快照缓存(index);本移植的 index 住在 service crate(依赖方向:它
//! 要过 dispatch chokepoint 的策略),这里**只**重置 backend。完整重置走
//! service 的 `reset_computer_use()`(= 本模块 reset + index reset)。
//!
//! 测试提示:Rust 测试并行跑在同一进程,会争这个全局。service 层的测试用
//! 显式传入的 `Arc<dyn ComputerUseBackend>` 注入(dispatcher 把 backend 作为
//! 字段),不逐测试改全局 registry;registry 本身由单条测试顺序覆盖。

use std::sync::{Arc, Mutex, OnceLock};

use crate::backend::ComputerUseBackend;

/// backend 工厂:返回新的 backend 实例(单例由 registry 建,不归 factory 管)。
pub type BackendFactory = fn() -> Arc<dyn ComputerUseBackend>;

static FACTORY: OnceLock<Mutex<Option<BackendFactory>>> = OnceLock::new();
static SHARED: OnceLock<Mutex<Option<Arc<dyn ComputerUseBackend>>>> = OnceLock::new();

fn factory_cell() -> &'static Mutex<Option<BackendFactory>> {
	FACTORY.get_or_init(|| Mutex::new(None))
}

fn shared_cell() -> &'static Mutex<Option<Arc<dyn ComputerUseBackend>>> {
	SHARED.get_or_init(|| Mutex::new(None))
}

/// 覆盖 backend(测试与未来平台的交换缝)。
///
/// 传入返回 [`ComputerUseBackend`] 的工厂;下一次 [`shared_backend`] 经它构
/// 造。传 `None` 恢复平台默认(即调用方传入的 *default*)。之后调用
/// [`reset_shared_backend`],让已建的单例 —— 连同它填过的快照缓存 —— 被换掉。
pub fn register_backend(factory: Option<BackendFactory>) {
	*factory_cell().lock().expect("computer-use registry poisoned") = factory;
}

/// 进程级 backend 单例;未建时经注册的 factory(无则 *default*)构造。
///
/// *default* 是 service::platform 的 `select_default_backend` —— REF 把它
/// 放在本模块,本移植因依赖环(service 依赖 backend、平台 crate 的构造在
/// service)由调用方注入;它仍是全包唯一的平台分派点。
pub fn shared_backend(default: BackendFactory) -> Arc<dyn ComputerUseBackend> {
	// factory 指针是 Copy:拷出即释放锁,构造期间不持任何锁(构造可能加载
	// 框架、耗时;且实现若回调本函数不得自锁)。
	let factory = *factory_cell().lock().expect("computer-use registry poisoned");

	let mut shared = shared_cell().lock().expect("computer-use registry poisoned");
	if let Some(backend) = shared.as_ref() {
		return Arc::clone(backend);
	}
	let backend = factory.unwrap_or(default)();
	*shared = Some(Arc::clone(&backend));
	backend
}

/// 丢弃单例(factory 保留:测试注册的 FakeBackend 在 reset 后仍然生效)。
///
/// 对旧实例调用 `close()`,close 失败不阻止换装 —— 释放句柄失败的 driver
/// 卡住交换,比泄漏它持有的东西更糟。close 在锁外调用(见上,防自锁)。
///
/// 快照缓存的重置不在此处(见模块文档);调用方需要 `service::reset`。
pub fn reset_shared_backend() {
	let previous = shared_cell().lock().expect("computer-use registry poisoned").take();
	if let Some(backend) = previous {
		backend.close();
	}
}

/// 仅诊断/测试:当前单例是否已建、是谁。不构造。
pub fn installed_platform_id() -> Option<&'static str> {
	shared_cell().lock().expect("computer-use registry poisoned").as_ref().map(|backend| backend.platform_id())
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::unsupported::UnsupportedBackend;
	use point_computer_core::types::{BackendStatus, DriverResult, PLATFORM_FAKE};

	// 全局 registry 的唯一持有者测试:一条测试顺序走完 register/shared/reset,
	// 避免并行测试互踩全局。静态计数器证明「单例只构造一次」与 reset 后重建。
	static CONSTRUCTIONS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

	fn counting_fake() -> Arc<dyn ComputerUseBackend> {
		CONSTRUCTIONS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
		Arc::new(UnsupportedBackend::new(PLATFORM_FAKE, "registry test fake"))
	}

	fn default_unsupported() -> Arc<dyn ComputerUseBackend> {
		Arc::new(UnsupportedBackend::new("unsupported", "test default"))
	}

	#[test]
	fn singleton_builds_once_via_factory_and_reset_rebuilds() {
		register_backend(Some(counting_fake));
		reset_shared_backend(); // 清掉其他测试/首次状态

		let a = shared_backend(default_unsupported);
		let b = shared_backend(default_unsupported);
		assert!(Arc::ptr_eq(&a, &b), "singleton must be the same instance");
		assert_eq!(a.platform_id(), PLATFORM_FAKE);
		assert_eq!(CONSTRUCTIONS.load(std::sync::atomic::Ordering::SeqCst), 1);

		assert_eq!(installed_platform_id(), Some(PLATFORM_FAKE));

		// reset 丢弃单例;factory 保留 → 重建仍是 fake,构造计数 +1。
		reset_shared_backend();
		assert_eq!(installed_platform_id(), None);
		let c = shared_backend(default_unsupported);
		assert_eq!(c.platform_id(), PLATFORM_FAKE);
		assert_eq!(CONSTRUCTIONS.load(std::sync::atomic::Ordering::SeqCst), 2);

		// register(None) 恢复默认:reset 后重建走 default 工厂。
		register_backend(None);
		reset_shared_backend();
		let d = shared_backend(default_unsupported);
		assert_eq!(d.platform_id(), "unsupported");
		let status: BackendStatus = d.status();
		assert!(!status.supported);

		// 收尾清全局,不给后续(同进程)测试留 fake。
		register_backend(None);
		reset_shared_backend();
	}

	// 让 UnsupportedBackend 的其余 trait 方法在测试类型里可见可用(防御
	// 「trait 对象方法未派发」的哑编译)。
	#[allow(dead_code)]
	fn trait_object_is_dispatchable(backend: &dyn ComputerUseBackend) -> DriverResult {
		backend.list_apps()
	}
}
