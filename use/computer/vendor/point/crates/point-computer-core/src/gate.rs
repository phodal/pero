//! computer-use 的使能检查与「允许了什么」的审计 —— REF `gate.py` 的移植
//! (audit-only 桩)。刻意小。
//!
//! REF 模块文档里的那段历史在此同样适用:更早的修订在这里放过完整治理
//! 模型 —— 八行 SCOPE_CATALOG、无人值守面拒绝、交互批准下限、按应用披露
//! 过滤 —— 全部移除。产品决定:computer use 是**一次**操作者 opt-in,之后
//! agent 像操作者本人一样驾驶桌面。
//!
//! 真正活着的保护一处都不在本文件:
//!
//! * **主使能**在 keystone `computer_use.json`([`crate::enable_state`]),
//!   dispatch chokepoint(service/tools)检查 —— 「agent 无法打开自己的
//!   桌面自动化」由它保证;
//! * **Point 自身的窗口**由 [`crate::policy`] 拒绝 —— 驾驶自家设置面会
//!   绕过上面的 keystone;
//! * **密码框**永不读、永不拍(`ElementRec.secure` → renderer 出占位符,
//!   含其一的窗口无截图)。这是隐私 floor,不是策略旋钮;
//! * **凭据 redaction** 在出站方向(policy::redact_result),与其余每条
//!   出站路径相同的 repo 级控制。
//!
//! 与 REF 的差异:REF 的审计经 kiro_crew SEL(进程外审计面);Point 侧尚无
//! 对应物,这里保留**同签名桩** —— 调用点与 chokepoint 顺序先行,审计汇
//! 接入是纯增量。另:REF 的 `PAYLOAD_*` / `apply_observation_ceiling` 服务
//! MCP 字典载荷;本移植的传输只产文本(截图以路径中继),无字典载荷可言,
//! 故不移植。

use crate::types::{
	ALL_OBSERVATION_CHANNELS, AUDIT_POINTER_ITEM, AUDIT_TOOL_PREFIX, ClickMethod, MUTATING_TOOLS,
	REFUSAL_POINTER_NOT_ENABLED, fill,
};

/// 恒 `None`(放行),并审计这次调用。
///
/// 签名保留使 tools 的有序 chokepoint 读起来与 REF 相同,未来的版本可以
/// 在此重引入决策而不动每个调用点 —— 但这里没有治理决策可做:keystone
/// 主使能(上游 tools 检查)就是整个门。*action* 之后的参数接受并被忽略
/// 是刻意的:它们是审计记录的身份,删掉只会让审计行更穷。
pub fn require_computer_use(action: &str, session_key: &str, app_label: &str) -> Option<&'static str> {
	audit_allowed(session_key, action, app_label);
	None
}

/// 特性开着时恒 `None`。真指针路径不需要第二个 opt-in,也不需要自己的治理
/// 许可:一个 enable 盖全特性;`policy::resolve_click_method` 仍要求模型
/// **显式点名** `click_method: "global"` —— auto 永不解析到它,指针永不
/// 被意外弯曲。`pointer_enabled` 保留(默认开)仅供进程内调用方本地退出
/// —— 这是 audit 桩之外唯一可达的本地退出。
pub fn require_pointer_move(
	action: &str,
	method: ClickMethod,
	session_key: &str,
	pointer_enabled: bool,
) -> Option<String> {
	let _ = (action, method, session_key);
	if !pointer_enabled {
		return Some(REFUSAL_POINTER_NOT_ENABLED.to_string());
	}
	None
}

/// 审计一次真指针手势。best-effort,永不失败。
///
/// 治理层移除后仍保留:这是唯一一条说「操作者的物理指针被动过」的记录 ——
/// 他们事后最想在日志里找到的东西。REF 里 `tool_kind` 用独立的
/// `computer_use_pointer`(而非其他调用共用的 `computer_use`):这让
/// 「agent 有没有碰过我的鼠标?」可以用一个过滤回答,而不必逐行解析
/// resources。Point 侧审计汇接入前为无操作桩。
pub fn audit_pointer_move(action: &str, method: ClickMethod, session_key: &str, app_label: &str) {
	let _ = (action, session_key, fill(AUDIT_POINTER_ITEM, &[("{method}", method.as_str())]), app_label);
}

/// *action*(工具名)是否向其他应用合成输入。读代码持有的
/// [`MUTATING_TOOLS`] 表 —— 「哪些动词是变更的」只有一处定义。
pub fn is_mutating_action(action: &str) -> bool {
	MUTATING_TOOLS.contains(&action)
}

/// 每个观测通道;无通道再被扣留。保持为函数(而非把常量内联到调用点),
/// 截图中继与 renderer 共享同一个答案,未来想再收窄观测时有唯一落点。
pub fn permitted_observation_channels() -> &'static [&'static str] {
	ALL_OBSERVATION_CHANNELS
}

/// `computer_list_apps` 是否可以点名这个应用。只问「到底有没有身份」 ——
/// bundle id 与显示名皆无的应用被丢弃,是因为没有可展示的,不是因为策略
/// 不许。
pub fn app_is_disclosable(bundle_id: &str, display_name: &str) -> bool {
	!bundle_id.is_empty() || !display_name.is_empty()
}

/// 审计一次被允许的 computer-use 调用(桩)。best-effort,永不失败。
/// 每次调用都审计而非只审计有趣的:治理层移除后,这条轨迹是操作者关于
/// 「agent 对我的桌面做了什么」的首要记录。工具名带
/// [`AUDIT_TOOL_PREFIX`] 前缀,与 REF 相同地让 computer-use 行可整体过滤。
///
/// `pub`:dispatch chokepoint(tools.rs)在策略过问**之后**、driver 调用
/// **之前**调用它 —— 记录必须先于任何无障碍/捕获调用存在(哪怕 driver
/// 随即失败),这是 REF `_audit_allowed` 的时序契约。
pub fn audit_allowed(session_key: &str, action: &str, app_label: &str) {
	let _ = (session_key, action, app_label, AUDIT_TOOL_PREFIX);
}

/// 审计一次被拒绝的 computer-use 调用(桩)。best-effort,永不失败。
///
/// 与 [`audit_allowed`] 分开而非共用一个「outcome」参数:被拒流里有的
/// 拒绝发生在工具名尚不确定是否有效时(未知工具、schema 校验失败),那
/// 些点没有 app 标签也不该有 —— 两个入口让「记录到的形状」各自与调用
/// 点的真实信息量一致。审计汇接入前为无操作桩;REF `_audit_refused` 的
/// 注释是这里的理由:一串畸形/被拒尝试恰是调查最想看到的信号,审计轨迹
/// 在这个位置留洞是错的形状。
pub fn audit_refused(session_key: &str, action: &str, app_label: &str) {
	let _ = (session_key, action, app_label);
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn require_computer_use_always_allows() {
		assert!(require_computer_use("computer_click", "s1", "com.apple.Calculator").is_none());
	}

	#[test]
	fn pointer_move_optout_is_the_only_local_exit() {
		assert!(require_pointer_move("computer_click", ClickMethod::Global, "s1", true).is_none());
		let refusal = require_pointer_move("computer_click", ClickMethod::Global, "s1", false).unwrap();
		assert!(refusal.contains("switched off"), "{refusal}");
	}

	#[test]
	fn mutating_classification() {
		assert!(is_mutating_action("computer_click"));
		assert!(is_mutating_action("computer_launch_app"));
		assert!(!is_mutating_action("computer_get_state"));
		assert!(!is_mutating_action("computer_end_turn"));
	}

	#[test]
	fn channels_and_disclosability() {
		assert!(permitted_observation_channels().contains(&"screenshot"));
		assert!(app_is_disclosable("com.apple.x", ""));
		assert!(app_is_disclosable("", "Calculator"));
		assert!(!app_is_disclosable("", ""));
	}
}
