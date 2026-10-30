//! computer-use 的 KEYSTONE 主使能 —— REF `enable_state.py` 的移植。
//!
//! 状态住在 `~/.point/computer_use.json` —— **不在**主配置里。这是有先例的
//! 安全决定:完整桌面观测 + 输入合成的主使能是安全上限,放在 agent 可写
//! 的文件里会被 prompt injection 翻转。Go harness 的家目录是 `~/.dsh`,
//! 刻意不复用:computer-use 的 keystone 独立成目录,将来任何「敏感叶子」
//! 的路径 fencing(对应 REF `security._SENSITIVE_HOME_DIRS`)只需看住一处。
//!
//! 让 agent 翻不动它的机制:唯一写者是操作者(手工 / 未来的 dashboard,
//! 不经 agent 工具门);每个读方向都 **fail-soft 到禁用** —— 文件缺失、
//! 不可读、截断、手编坏了一律视为关。门的开位交出的是操作者的整个桌面,
//! 损坏的 ceiling 文件不许被慷慨解读。
//!
//! 与 REF 的差异:REF 的 `save_state`(dashboard PUT 的原子写,0600)没有
//! 移植 —— 本范围没有 dashboard,README 指导操作者手工 `echo`;读方向是
//! 唯一 fail-soft 方向,写方向由此根本不存在。`env:POINT_COMPUTER_USE_STATE`
//! 是测试缝与 CLI 显式指向口。

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use crate::json::Json;
use crate::types::{ComputerUseError, PolicyConfig, STATE_FILE_ENV, STATE_FILE_NAME, STATE_KEY_ENABLED};

/// keystone 路径。env 覆盖优先(测试缝/CLI 显式指向),否则 `~/.point/`
/// 下。纯函数 [`resolve_state_path`] 承载决策,本函数只采集 env/home ——
/// 这让路径决议可以不碰进程全局状态地测。
pub fn computer_use_state_path() -> PathBuf {
	resolve_state_path(env::var(STATE_FILE_ENV).ok().as_deref(), env::home_dir().as_deref())
}

/// 路径决议本体:*env_value* 非空白即全量胜出(连「看起来不像路径」也照用
/// —— 测试缝要的就是字面直通);否则 *home* 下 `.point/computer_use.json`;
/// home 也不可得时退化为相对路径(读必然失败 → 禁用,方向安全)。
pub fn resolve_state_path(env_value: Option<&str>, home: Option<&Path>) -> PathBuf {
	if let Some(value) = env_value.map(str::trim).filter(|v| !v.is_empty()) {
		return PathBuf::from(value);
	}
	match home {
		Some(home) => home.join(".point").join(STATE_FILE_NAME),
		None => PathBuf::from(format!(".point/{STATE_FILE_NAME}")),
	}
}

/// 读 keystone 状态(fail-soft 到 `Json::Null`,读作禁用)。非 JSON 对象的
/// 任何东西同样归零。
pub fn load_state() -> Json {
	load_state_from(&computer_use_state_path())
}

/// [`load_state`] 的可注入路径版(测试用;同一 fail-soft 契约)。
pub fn load_state_from(path: &Path) -> Json {
	let Ok(raw) = fs::read_to_string(path) else {
		return Json::Null;
	};
	match crate::json::parse(&raw) {
		Ok(value @ Json::Obj(_)) => value,
		_ => Json::Null,
	}
}

/// 仅当 keystone 明说 `enabled: true` 时为真。
///
/// 对 JSON `true` 严格恒等而非真值测试:手编的 `"enabled": "false"`(非空
/// 字符串,真值)或 `"enabled": 1` 不得打开桌面控制。唯一能开的拼法是真正
/// 的 JSON `true`。*state* 让已读过文件的调用方在一次 dispatch 内免二读。
pub fn is_enabled(state: Option<&Json>) -> bool {
	let loaded;
	let data = match state {
		Some(data) => data,
		None => {
			loaded = load_state();
			&loaded
		}
	};
	data.get(STATE_KEY_ENABLED).is_some_and(|value| value.is_true())
}

/// keystone 里的操作者目标策略(allow 名单 / 追加拒绝)。
///
/// 恰一种情况报 [`ComputerUseError::PolicyState`]:present-but-malformed 的
/// `allowed_apps`。其余一律宽容折算 —— 空的 `extra_denied_apps` 只意味着
/// 「无追加拒绝」(自身 fail-closed),而空的 `allowed_apps` 意味着「未拒
/// 即允」:静默折算一个坏掉的 allow 名单,等于把操作者的限制无声转成无
/// 限制。dispatcher 捕获并点名文件拒绝;对一个显然**意在收窄**的值,拒绝
/// 是安全方向。缺席的 `allowed_apps` 仍是文档化的「无名单」情形,不是错。
pub fn load_policy_config(state: Option<&Json>) -> Result<PolicyConfig, ComputerUseError> {
	let loaded;
	let data = match state {
		Some(data) => data,
		None => {
			loaded = load_state();
			&loaded
		}
	};
	PolicyConfig::from_state(data)
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::json::parse;
	use std::process::id;

	fn temp_state(name: &str, body: &str) -> PathBuf {
		let path = env::temp_dir().join(format!("point-cu-state-{}-{name}.json", id()));
		fs::write(&path, body).unwrap();
		path
	}

	#[test]
	fn path_resolution_env_wins_then_home() {
		assert_eq!(resolve_state_path(Some("/tmp/x.json"), Some(Path::new("/home/u"))), PathBuf::from("/tmp/x.json"));
		assert_eq!(
			resolve_state_path(Some("   "), Some(Path::new("/home/u"))),
			PathBuf::from("/home/u/.point/computer_use.json")
		);
		assert_eq!(
			resolve_state_path(None, Some(Path::new("/home/u"))),
			PathBuf::from("/home/u/.point/computer_use.json")
		);
		assert_eq!(resolve_state_path(None, None), PathBuf::from(".point/computer_use.json"));
	}

	#[test]
	fn strict_true_is_the_only_enabling_spelling() {
		let on = temp_state("on", r#"{"enabled": true}"#);
		assert!(is_enabled(Some(&load_state_from(&on))));

		for body in [
			r#"{"enabled": "true"}"#,
			r#"{"enabled": 1}"#,
			r#"{"enabled": "yes"}"#,
			r#"{}"#,
			"not json at all",
			r#"["enabled"]"#,
		] {
			let path = temp_state("off", body);
			assert!(!is_enabled(Some(&load_state_from(&path))), "{body} must not enable");
		}

		// 缺失文件:禁用。
		let missing = env::temp_dir().join(format!("point-cu-state-{}-missing.json", id()));
		assert!(!is_enabled(Some(&load_state_from(&missing))));

		let _ = fs::remove_file(&on);
	}

	#[test]
	fn policy_config_via_state_file() {
		let path =
			temp_state("policy", r#"{"enabled": true, "allowed_apps": ["Preview"], "extra_denied_apps": ["term"]}"#);
		let state = load_state_from(&path);
		assert!(is_enabled(Some(&state)));
		let cfg = load_policy_config(Some(&state)).unwrap();
		assert_eq!(cfg.allowed_apps, vec!["preview"]);
		assert_eq!(cfg.extra_denied_apps, vec!["term"]);

		// 坏 allow 名单:拒绝并点名修法方向。
		let bad = temp_state("bad", r#"{"enabled": true, "allowed_apps": "Preview"}"#);
		let bad_state = load_state_from(&bad);
		assert!(load_policy_config(Some(&bad_state)).is_err());
		let _ = (fs::remove_file(&path), fs::remove_file(&bad));
	}

	#[test]
	fn default_state_disabled_and_unrestricted() {
		// Json::Null(= 任何 fail-soft 结果):禁用 + 无限制名单。
		assert!(!is_enabled(Some(&Json::Null)));
		assert!(load_policy_config(Some(&Json::Null)).unwrap().allowed_apps.is_empty());

		// 已解析对象的直通路径与 parse 集成。
		let direct = parse(r#"{"enabled": true}"#).unwrap();
		assert!(is_enabled(Some(&direct)));
	}
}
