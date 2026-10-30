//! macOS TCC 权限探测 —— **仅建议,永不设门**(REF `permissions.py` 的移
//! 植,文案对 Point 适配)。
//!
//! 本模块的存在是为了在 doctor/设置面里放一条有用的提示。它**永不**决定
//! 一个动作是否继续,任何调用方不得把 `missing` 当「不可用」—— 那不是谨
//! 慎,是复现过的事实:实测探针报两项 `missing` 的同时,一次全保真窗口捕
//! 获和一棵完整无障碍树成功返回。
//!
//! 原因在 macOS 如何归属一笔 TCC 授权:授权跟随进程树的**责任父进程**,
//! 不跟随发起询问的进程。gateway 拉起 point-computer,point-computer 再拉
//! 起 sidecar,所以授权属于启动整棵树的那个东西 —— 打包时是 app,开发时
//! 是终端,从 IDE 里启动就是 IDE。探针只检查自己进程的授权,于是对一棵
//! 完全获准的树报 `missing`。[`responsible_process_name`] 点名用户真正该
//! 授予的那个进程,因为「给 Point 授予辅助功能」在持有授权的是你的终端
//! 时是一句无法执行的建议。
//!
//! 本模块小心对待的两条相关危害:
//!
//! * `CGRequestScreenCaptureAccess` **永不**调用,连绑定都没有(见
//!   `ffi.rs` 的 sys 块):它从调用进程弹系统对话框,后台 sidecar 里的提
//!   示操作者无从归因。只用 Preflight 变体。
//! * 对进程链里任何东西做 ad-hoc 重签名会**作废既有授权**(实测对重签
//!   bundle 三次永久打断辅助功能三次)。「昨天还好好的」权限可能是一次
//!   更新弄坏的而非一次设置改动 —— 提示文案为此留了余地。
//!
//! 与 REF 的对应差异:`unknown` 态在 REF 里来自「框架加载失败/探针抛异
//! 常」;本移植的链接在编译期、探针助手是永不 panic 的安全包装,运行期
//! 没有产生 `unknown` 的路径 —— 词表常量留在 core 供 doctor 的形状使用。

use point_computer_core::types::{PERMISSION_GRANTED, PERMISSION_MISSING, PermissionProbe};

use crate::ffi;

/// 设置面板里的建议文案。刻意说「not detected」而非「missing/denied」:
/// 探针真的无法区分「未授予」与「授予给了我们看不见的祖先」,在这里过
/// 度声称会把用户送去系统设置修一个没坏的东西。
pub const HINT_RESPONSIBLE: &str = "macOS attributes Accessibility and Screen Recording grants to the process that launched Point, not to Point itself. Grant them to {process} — and note that 'not detected' does not always mean unavailable.";
pub const HINT_UNSUPPORTED: &str = "computer use requires macOS; there is nothing to grant on this platform.";
pub const HINT_UNKNOWN: &str = "the permission state could not be read. Computer use may still work: grants follow the launching process, which a probe cannot inspect.";

/// 系统设置深链(设置面板的「去授予」按钮)。
pub const SETTINGS_URL_ACCESSIBILITY: &str =
	"x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
pub const SETTINGS_URL_SCREEN_RECORDING: &str =
	"x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";

/// 责任进程无法命名时的兜底说法。
const UNKNOWN_PROCESS: &str = "the application that launched Point";

/// 祖先走查的层数上限。真实链(launcher → gateway → point-computer →
/// sidecar)远短于此;无论一条敌意或异常的进程树报告什么,走查都有界。
const WALK_LIMIT: usize = 8;

/// 探测两笔 TCC 授权。**建议性**;永不失败。
///
/// 探针助手是安全包装、链接在编译期完成,故 `unknown` 不可达(见模块文
/// 档);`missing` 带着常设告戒:它不是权威结论。
pub fn probe() -> PermissionProbe {
	PermissionProbe {
		accessibility: if ffi::ax_is_process_trusted() { PERMISSION_GRANTED } else { PERMISSION_MISSING },
		screen_recording: if ffi::preflight_screen_capture() { PERMISSION_GRANTED } else { PERMISSION_MISSING },
		responsible_hint: fill_responsible_hint(&responsible_process_name()),
	}
}

/// HINT_RESPONSIBLE 的 {process} 填充(测试也用它做往返)。
fn fill_responsible_hint(process: &str) -> String {
	point_computer_core::types::fill(HINT_RESPONSIBLE, &[("{process}", process)])
}

/// 实际持有 TCC 授权的那个进程的名字,尽力而为。
///
/// 沿父链(经 `proc_pidinfo`,绝不裸读 /proc、不 shell-out ps)走到还能
/// 识别的最外层祖先,报它的显示名。那个祖先就是 macOS 认为对这棵树负责
/// 的进程,也就是用户必须授予的进程。
///
/// 尽力而为是刻意的:走查有界、每步容忍失败、解不开的链给一句通用短
/// 语。错误的提示是化妆问题;在这里抛错会为一个诊断弄坏整个 doctor。
pub fn responsible_process_name() -> String {
	let mut pid = std::process::id() as i32;
	let mut best = String::new();
	for _ in 0..WALK_LIMIT {
		let name = identity_name(pid);
		if !name.is_empty() {
			best = name;
		}
		let parent = ffi::ppid_of(pid);
		if parent <= 1 || parent == pid {
			break;
		}
		pid = parent;
	}
	if !best.is_empty() {
		return best;
	}
	// 链上哪层都没解出名字:裸可执行启动。点出可执行文件仍好过什么都没
	// 有。
	std::env::current_exe()
		.ok()
		.and_then(|path| path.file_name().map(|n| n.to_string_lossy().into_owned()))
		.filter(|name| !name.is_empty())
		.unwrap_or_else(|| UNKNOWN_PROCESS.to_string())
}

/// *pid* 的显示名:bundle 显示名(`.app` 外壳的 Info.plist,经 apps 的硬
/// 化读 + 缓存),退回可执行路径的 basename。提示是给人读的句子 ——
/// "Terminal" 比 "zsh" 更接近用户在系统设置里认识的名字,而无 bundle 的
/// 裸可执行(从 IDE、开发脚本启动)仍叫得出名。
fn identity_name(pid: i32) -> String {
	let identity = crate::apps::resolve_identity(pid);
	if !identity.display_name.is_empty() {
		return identity.display_name;
	}
	std::path::Path::new(&identity.executable).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// 两笔授权的系统设置深链(macOS 之外为空 —— 本 crate 即 macOS)。
pub fn settings_urls() -> Vec<(&'static str, &'static str)> {
	vec![("accessibility", SETTINGS_URL_ACCESSIBILITY), ("screen_recording", SETTINGS_URL_SCREEN_RECORDING)]
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn hint_fills_the_process_name() {
		let hint = fill_responsible_hint("Terminal.app");
		assert!(hint.contains("Grant them to Terminal.app"), "{hint}");
		// 建议性的措辞:「not detected」不是「missing/denied」。
		assert!(hint.contains("'not detected' does not always mean unavailable"), "{hint}");
	}

	#[test]
	fn responsible_process_name_always_names_something() {
		// 真实祖先走查:走查本身不失败,产物非空,且不含路径分隔符
		//(basename,不是全路径 —— 提示是给人读的句子)。
		let name = responsible_process_name();
		assert!(!name.is_empty());
		assert!(!name.contains('/'), "{name}");
	}

	#[test]
	fn probe_readings_are_from_the_closed_vocabulary() {
		let probe = probe();
		assert!(["granted", "missing"].contains(&probe.accessibility));
		assert!(["granted", "missing"].contains(&probe.screen_recording));
		assert!(probe.responsible_hint.contains("Grant them to"), "{}", probe.responsible_hint);
	}

	/// 冒烟:打印本机真实读数(仅诊断;`missing` 不构成失败)。
	#[test]
	#[ignore = "prints this machine's advisory TCC readings"]
	fn probe_smoke() {
		println!("{:?}", probe());
	}

	/// 冒烟:祖先走查逐级打点 —— 责任进程提示不对时,看链在哪一跳断掉。
	#[test]
	#[ignore = "prints this process's ancestry chain"]
	fn responsible_walk_trace() {
		let mut pid = std::process::id() as i32;
		for _ in 0..WALK_LIMIT {
			println!(
				"pid {pid}: name={:?} exe={:?}",
				identity_name(pid),
				crate::apps::resolve_identity(pid).executable
			);
			let parent = ffi::ppid_of(pid);
			println!("  ppid_of({pid}) = {parent}");
			if parent <= 1 || parent == pid {
				break;
			}
			pid = parent;
		}
	}
}
