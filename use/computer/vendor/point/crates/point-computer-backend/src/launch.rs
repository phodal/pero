//! `launch_app` 的共享流程:解析 → 拒绝 → 已运行检查 → spawn → 等窗口。
//! REF `backend.py` `run_launch`/`await_launched_window` 的移植。
//!
//! 流程在两个平台上相同,只有三个注入的函数不同(哪个目录解析名字、哪个
//! 枚举找窗口、哪个 launcher 启动进程)。按 driver 各写一遍是 ~45 行重复,
//! 它邀请的漂移不是假设:下面四段拒绝各自编码一个决定(近似建议、已运行
//! 而非第二份、无窗口算成功),必须两个平台同时成立,否则模型学到的契约
//! 取决于它跑在哪个 OS 下。这也是 [`await_launched_window`] 与 REF 同样住
//! 在缝隙层而非任何 `apps_*` 模块的原因。

use std::thread;
use std::time::Duration;

use point_computer_core::clock;
use point_computer_core::types::{
	AppRef, ComputerUseError, DriverResult, ERR_LAUNCH_ALREADY_RUNNING, ERR_LAUNCH_AMBIGUOUS, ERR_LAUNCH_FAILED,
	ERR_LAUNCH_NOT_INSTALLED, ERR_LAUNCH_NOT_INSTALLED_NEAR, LAUNCH_POLL_INTERVAL_SECS, LAUNCH_RESULT,
	LAUNCH_RESULT_NO_WINDOW, LAUNCH_WINDOW_TIMEOUT_SECS, LaunchIdentity, TOOL_GET_STATE, TOOL_LIST_APPS, fill,
};

use crate::backend::LaunchPermit;

/// 解析注入:查询名 → `(target, display_name)`;未命中报
/// [`ComputerUseError::NoSuchLaunchTarget`]/`AmbiguousLaunchTarget`。
pub type ResolveFn<'a> = &'a dyn Fn(&str) -> Result<(String, String), ComputerUseError>;
/// 窗口查找注入:display_name → 该应用的在屏窗口(无则 None)。
pub type FindFn<'a> = &'a dyn Fn(&str) -> Option<AppRef>;
/// 启动注入:已验证的 target → Ok;Err 携带失败详情(REF 的 `OSError.strerror`)。
pub type SpawnFn<'a> = &'a dyn Fn(&str) -> Result<(), String>;
/// identity 构造注入:target + display_name → 带第二拼写的启动标识。
pub type IdentityFn<'a> = &'a dyn Fn(&str, &str) -> LaunchIdentity;

/// 注入 [`run_launch`] 的平台三件套(+ 可选的 identity 构造)。
///
/// * `resolve` 把查询名解析为 `(target, display_name)`;除两个启动目标错误
///   外的变体按 Display 文本拒绝(driver 侧 `guarded()` 缝隙的等价物 ——
///   本函数不重新实现兜底)。
/// * `find` 在窗口列表里找 *display_name* 的窗口(有则返回那只 [`AppRef`])。
/// * `spawn` 启动**已验证**的 *target*,失败返回错误详情字符串。
/// * `identity` 给 *permit* 命名已解析的目标 —— 把 OS 在进程存在后会报出的
///   标识(exe key、bundle id)补进 [`LaunchIdentity`],因为操作者的 deny
///   规则写的就是那些拼写,显示名一个都匹配不上。缺席则只查显示名 —— 没有
///   第二拼写的平台正该如此。
pub struct LaunchAdapter<'a> {
	pub resolve: ResolveFn<'a>,
	pub find: FindFn<'a>,
	pub spawn: SpawnFn<'a>,
	pub identity: Option<IdentityFn<'a>>,
}

/// 轮询 *find* 直到报出窗口。返回 `(app 或 None, 等待秒数)`。
///
/// 住在这里(缝隙层)而非任何 `apps_*` 模块,因为它是 launch_app 契约的
/// 第三条要求 —— **以找到窗口确认,而非 launcher 的退出状态** —— 而该
/// 要求在两个平台相同、finder 不同。写两遍必然漂移;某个 driver 会用上与
/// 契约文档不同的超时。
///
/// 为什么轮询而非读 spawn 进程的结果:launcher 在它启动的应用有窗口之前就
/// 退出。Windows 实测 `explorer.exe` 2.9s 后返回 rc=1,而 MS Paint 的窗口
/// 9.9s 才出现;macOS 的 `/usr/bin/open` 在 LaunchServices 受理请求时即返回。
/// 读任一退出状态都会把成功的冷启动报成失败。
///
/// 单调钟(绝不用墙上钟),冷启动期间的时钟调整既不能提前结束等待,也不能
/// 把它无限拉长。等待时长**返回**而非记日志:它属于模型读的结果 —— 10s 的
/// 启动与 0.3s 的启动结果相同,但对机器正在做什么是截然不同的信息。
pub fn await_launched_window(find: &dyn Fn() -> Option<AppRef>, timeout: f64, interval: f64) -> (Option<AppRef>, f64) {
	let started = clock::now();
	let deadline = started + timeout.max(0.0);
	// 轮询间隔钳到正数:0 会变成忙等,热循环吃满一个核只为反复问一个
	// 9.9s 后才出现的窗口。
	let interval = interval.max(0.001);
	loop {
		if let Some(found) = find() {
			return (Some(found), clock::now() - started);
		}
		let now = clock::now();
		if now >= deadline {
			return (None, now - started);
		}
		thread::sleep(Duration::from_secs_f64(interval.min(deadline - now)));
	}
}

/// 整条 `launch_app` 流程,只写一遍,每个平台复用。
///
/// 四段拒绝的理由浓缩在各自注释里;*window_timeout*/*window_poll_interval*
/// 约束 spawn 后的窗口等待,默认生产值,存在是为了测试能缩短无窗口等待。
pub fn run_launch(
	query: &str,
	adapter: &LaunchAdapter<'_>,
	permit: LaunchPermit<'_>,
	window_timeout: f64,
	window_poll_interval: f64,
) -> DriverResult {
	let (target, name) = match (adapter.resolve)(query) {
		Ok(pair) => pair,
		Err(ComputerUseError::AmbiguousLaunchTarget { names, count }) => {
			return DriverResult::refuse(fill(
				ERR_LAUNCH_AMBIGUOUS,
				&[("{query}", query), ("{count}", &count.to_string()), ("{names}", &names)],
			));
		}
		Err(ComputerUseError::NoSuchLaunchTarget { near, .. }) => {
			// 近似命中把死路变成可恢复的拒绝:解析只认前缀,敲了真名碎片的
			// 模型需要被告知真名,而不是留它自己发明路径 —— 那是永远无法
			// 服务的重试。
			return if !near.is_empty() {
				DriverResult::refuse(fill(ERR_LAUNCH_NOT_INSTALLED_NEAR, &[("{query}", query), ("{near}", &near)]))
			} else {
				DriverResult::refuse(fill(ERR_LAUNCH_NOT_INSTALLED, &[("{query}", query), ("{tool}", TOOL_LIST_APPS)]))
			};
		}
		Err(other) => return DriverResult::refuse(other.to_string()),
	};

	// 策略复查:在**每个**已解析的标识上、任何进程存在之前。
	//
	// dispatcher 已查过调用方的原始字符串,那不够 —— 两个独立的原因,都实
	// 测过,都以被拒的应用启动收场:
	//
	// * 前缀会解析:拒了 `notepad` 的操作者被 `note` 的请求绕过 —— 原名检查
	//   看到的是没有规则匹配的字符串,解析器随后返回被拒的应用;
	// * 标识不同。启动以显示名请求(`notepad`),其余每个 computer-use 拒绝
	//   点名的是 OS 身份(`notepad.exe`)—— 操作者 `extra_denied_apps` 条目
	//   自然携带的拼写 —— 只知显示名的检查既匹配不上它,也匹配不上 bundle
	//   id 规则。
	//
	// 在这里复查而非收紧解析器是刻意的:前缀匹配正是让这个动词可用的东西
	// (「paint」指 mspaint),缺陷不在前缀解析 —— 在策略对着与被启动者不同
	// 的字符串求值。所以检查移到已解析标识已知之处、应用到它的**全部**拼写
	// 上,这也是 spawn 之前最后一点。脱离进程的 spawn 无法撤销,必须先于它。
	if let Some(permit) = permit.permit {
		let who = match adapter.identity {
			Some(identity) => identity(&target, &name),
			None => LaunchIdentity { display: name.clone(), key: String::new() },
		};
		if let Some(refusal) = permit(&who) {
			return DriverResult::refuse(refusal);
		}
	}

	if let Some(existing) = (adapter.find)(&name) {
		// 拒绝而非再启动:编辑器的第二份是第二篇未保存文档,而模型的实际
		// 目标 —— 一个可驾驶的窗口 —— 已经满足,有用的回复点名窗口并把
		// 模型指向读取工具。
		return DriverResult::refuse(fill(
			ERR_LAUNCH_ALREADY_RUNNING,
			&[("{app}", &name), ("{title}", &existing.window_title), ("{tool}", TOOL_GET_STATE)],
		));
	}

	if let Err(detail) = (adapter.spawn)(&target) {
		return DriverResult::refuse(fill(ERR_LAUNCH_FAILED, &[("{app}", &name), ("{detail}", &detail)]));
	}

	let (appeared, waited) = await_launched_window(&|| (adapter.find)(&name), window_timeout, window_poll_interval);
	let Some(appeared) = appeared else {
		// 带告白的**成功**,不是失败。进程确实启动了;报失败正是让模型再启
		// 动一次的东西,第二次尝试才是两份应用的来路。
		return DriverResult::ok_text(fill(
			LAUNCH_RESULT_NO_WINDOW,
			&[("{app}", &name), ("{secs:.0}", &format!("{waited:.0}")), ("{tool}", TOOL_LIST_APPS)],
		));
	};
	// 第三次检查,对 OS 实际公布的身份 —— 覆盖 spawn 前的检查在结构上够不
	// 着的东西:窗口标题。
	//
	// 打包应用以标题命名,目录里没有这个名字。有时标题**就是**身份
	// (apps_windows 把它同时发布为 name 与 bundle id,因为 broker 的映像名
	// 不标识任何应用),有时它只是 window_title(实测:截图工具报自己的
	// `SnippingTool.exe`,仅以 "Snipping Tool" 为标题)。无论哪种,标题在窗口
	// 存在之前不存在:spawn 前目录只给 `SnippingTool.exe`,操作者写
	// `Snipping Tool` 的规则匹配不到任何 pre-spawn 标识。
	//
	// 整只 `appeared` 传入而非用两个字段重建,让标题规则 —— window_title 上
	// 的子串测试,也是 policy 拒绝规则读该字段的全部原因 —— 看见它需要的
	// 东西。重建会丢掉它,这条拒绝在真机上就不触发了。
	//
	// 它防不住进程启动,也不声称防。它防的是启动**报告成功**:driver 返回
	// 拒绝而非 AppRef,下游没有东西去快照或驾驶那个窗口,随后的每个动词
	// 重新解析同一标题、同样拒绝。残留 —— 被拒的打包应用可以被启动一次、
	// 然后什么都不做 —— 写在规格里。
	if let Some(refuse_launched) = permit.refuse_launched
		&& let Some(refusal) = refuse_launched(&appeared)
	{
		return DriverResult::refuse(refusal);
	}
	DriverResult {
		ok: true,
		app: Some(appeared.clone()),
		text: fill(
			LAUNCH_RESULT,
			&[("{app}", &name), ("{title}", &appeared.window_title), ("{secs:.1}", &format_secs(waited))],
		),
		..DriverResult::default()
	}
}

/// 生产默认超时/间隔的便捷入口(driver 不必复述常量)。
pub fn run_launch_default(adapter: &LaunchAdapter<'_>, permit: LaunchPermit<'_>, query: &str) -> DriverResult {
	run_launch(query, adapter, permit, LAUNCH_WINDOW_TIMEOUT_SECS, LAUNCH_POLL_INTERVAL_SECS)
}

/// `{secs:.1}` —— 模板带格式 spec 的占位符由调用点预先格式化(见
/// core::types::fill 的约定)。
fn format_secs(secs: f64) -> String {
	format!("{secs:.1}")
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::cell::RefCell;
	use std::rc::Rc;

	/// 记录调用顺序的剧本驱动器:每个注入函数可选地返回预设结果,并把
	/// 「发生了什么」记进共享日志,断言流程**顺序**而非只断言结果。
	#[derive(Default)]
	struct Script {
		log: RefCell<Vec<String>>,
		resolve: Option<Result<(String, String), ComputerUseError>>,
		/// 每次 find 弹出一个预设;耗尽后永远 None(窗口不出现的剧本)。
		found: RefCell<Vec<Option<AppRef>>>,
		spawn_result: Option<String>,
	}

	/// 装好的三个注入函数(boxed、持 Rc 克隆),测试体里借出引用组
	/// LaunchAdapter —— 闭包活过 run_launch 调用。
	type BoxedResolve = Box<dyn Fn(&str) -> Result<(String, String), ComputerUseError>>;
	type BoxedFind = Box<dyn Fn(&str) -> Option<AppRef>>;
	type BoxedSpawn = Box<dyn Fn(&str) -> Result<(), String>>;

	struct Kit {
		resolve: BoxedResolve,
		find: BoxedFind,
		spawn: BoxedSpawn,
	}

	fn kit_for(script: &Rc<Script>) -> Kit {
		let resolver = Rc::clone(script);
		let finder = Rc::clone(script);
		let spawner = Rc::clone(script);
		Kit {
			resolve: Box::new(move |q: &str| {
				resolver.log.borrow_mut().push("resolve".into());
				resolver.resolve.clone().unwrap_or_else(|| Ok((String::new(), q.to_string())))
			}),
			find: Box::new(move |_name: &str| {
				finder.log.borrow_mut().push("find".into());
				let mut found = finder.found.borrow_mut();
				if found.is_empty() { None } else { found.remove(0) }
			}),
			spawn: Box::new(move |_target: &str| {
				spawner.log.borrow_mut().push("spawn".into());
				match &spawner.spawn_result {
					Some(detail) => Err(detail.clone()),
					None => Ok(()),
				}
			}),
		}
	}

	fn app_named(name: &str, title: &str) -> AppRef {
		AppRef { name: name.into(), pid: 7, window_title: title.into(), ..AppRef::default() }
	}

	#[test]
	fn resolve_errors_map_to_their_refusals() {
		// 歧义:点名数量与全部名字,拒绝不猜。
		let script = Rc::new(Script {
			resolve: Some(Err(ComputerUseError::AmbiguousLaunchTarget {
				names: "Calculator, Calendar".into(),
				count: 2,
			})),
			..Script::default()
		});
		let kit = kit_for(&script);
		let adapter = LaunchAdapter { resolve: &*kit.resolve, find: &*kit.find, spawn: &*kit.spawn, identity: None };
		let out = run_launch("cal", &adapter, LaunchPermit::none(), 0.01, 0.001);
		assert!(!out.ok);
		assert!(out.text.contains("'cal' matches 2 installed applications"), "{}", out.text);
		assert!(out.text.contains("Calculator, Calendar"));

		// 未命中带近似:报真名,可恢复。
		let script = Rc::new(Script {
			resolve: Some(Err(ComputerUseError::NoSuchLaunchTarget {
				query: "calc".into(),
				near: "Calculator".into(),
			})),
			..Script::default()
		});
		let kit = kit_for(&script);
		let adapter = LaunchAdapter { resolve: &*kit.resolve, find: &*kit.find, spawn: &*kit.spawn, identity: None };
		let out = run_launch("calc", &adapter, LaunchPermit::none(), 0.01, 0.001);
		assert!(out.text.contains("Did you mean: Calculator?"), "{}", out.text);

		// 未命中无近似:指向 list_apps,绝不提示路径。
		let script = Rc::new(Script {
			resolve: Some(Err(ComputerUseError::NoSuchLaunchTarget { query: "zzz".into(), near: String::new() })),
			..Script::default()
		});
		let kit = kit_for(&script);
		let adapter = LaunchAdapter { resolve: &*kit.resolve, find: &*kit.find, spawn: &*kit.spawn, identity: None };
		let out = run_launch("zzz", &adapter, LaunchPermit::none(), 0.01, 0.001);
		assert!(out.text.contains("no installed application matches 'zzz'"), "{}", out.text);
		assert!(out.text.contains(TOOL_LIST_APPS));

		// 其他错误变体:按 Display 文本拒绝(不 panic、不 Err)。
		let script =
			Rc::new(Script { resolve: Some(Err(ComputerUseError::Denied("boom".into()))), ..Script::default() });
		let kit = kit_for(&script);
		let adapter = LaunchAdapter { resolve: &*kit.resolve, find: &*kit.find, spawn: &*kit.spawn, identity: None };
		let out = run_launch("x", &adapter, LaunchPermit::none(), 0.01, 0.001);
		assert!(!out.ok && out.text.contains("boom"), "{}", out.text);
	}

	#[test]
	fn permit_runs_before_spawn_on_every_spelling() {
		let script = Rc::new(Script {
			resolve: Some(Ok(("/Applications/Calculator.app".into(), "Calculator".into()))),
			found: RefCell::new(vec![Some(app_named("Calculator", "Calculator"))]),
			..Script::default()
		});
		let kit = kit_for(&script);
		let seen: RefCell<Vec<LaunchIdentity>> = RefCell::new(Vec::new());
		let permit = |who: &LaunchIdentity| {
			seen.borrow_mut().push(who.clone());
			Some("operator refused".into())
		};
		let identity = |target: &str, display: &str| LaunchIdentity { display: display.into(), key: target.into() };
		let adapter =
			LaunchAdapter { resolve: &*kit.resolve, find: &*kit.find, spawn: &*kit.spawn, identity: Some(&identity) };
		let out =
			run_launch("calc", &adapter, LaunchPermit { permit: Some(&permit), refuse_launched: None }, 0.01, 0.001);
		assert!(!out.ok);
		assert_eq!(out.text, "operator refused");
		// permit 拿到的是 identity 钩子构造的双拼写标识(display + key)。
		assert_eq!(seen.borrow().len(), 1);
		assert_eq!(seen.borrow()[0].display, "Calculator");
		assert_eq!(seen.borrow()[0].key, "/Applications/Calculator.app");
		// spawn 从未发生:拒绝先于一切进程创建;已运行检查也没跑(拒绝更早)。
		assert!(!script.log.borrow().iter().any(|l| l == "spawn"));
		assert!(!script.log.borrow().iter().any(|l| l == "find"));
	}

	#[test]
	fn already_running_refuses_rather_than_seconds_copy() {
		let script = Rc::new(Script {
			resolve: Some(Ok(("target".into(), "Notes".into()))),
			found: RefCell::new(vec![Some(app_named("Notes", "groceries.txt"))]),
			..Script::default()
		});
		let kit = kit_for(&script);
		let adapter = LaunchAdapter { resolve: &*kit.resolve, find: &*kit.find, spawn: &*kit.spawn, identity: None };
		let out = run_launch("notes", &adapter, LaunchPermit::none(), 0.01, 0.001);
		assert!(!out.ok);
		assert!(out.text.contains("'Notes' already has a window on screen"), "{}", out.text);
		assert!(out.text.contains("groceries.txt"));
		assert!(out.text.contains(TOOL_GET_STATE));
		assert!(!script.log.borrow().iter().any(|l| l == "spawn"));
	}

	#[test]
	fn spawn_failure_names_the_detail() {
		let script = Rc::new(Script {
			resolve: Some(Ok(("target".into(), "Broken".into()))),
			spawn_result: Some("permission denied".into()),
			..Script::default()
		});
		let kit = kit_for(&script);
		let adapter = LaunchAdapter { resolve: &*kit.resolve, find: &*kit.find, spawn: &*kit.spawn, identity: None };
		let out = run_launch("broken", &adapter, LaunchPermit::none(), 0.01, 0.001);
		assert!(!out.ok);
		assert!(out.text.contains("could not launch 'Broken'"), "{}", out.text);
		assert!(out.text.contains("permission denied"));
	}

	#[test]
	fn no_window_is_success_with_caveat() {
		// find 永远返回 None:进程启动、窗口不出现。
		let script = Rc::new(Script { resolve: Some(Ok(("target".into(), "Ghost".into()))), ..Script::default() });
		let kit = kit_for(&script);
		let adapter = LaunchAdapter { resolve: &*kit.resolve, find: &*kit.find, spawn: &*kit.spawn, identity: None };
		let out = run_launch("ghost", &adapter, LaunchPermit::none(), 0.05, 0.005);
		assert!(out.ok, "{}", out.text);
		assert!(out.text.contains("launched Ghost, but no window appeared"), "{}", out.text);
		assert!(out.text.contains("do NOT launch it again"), "{}", out.text);
		assert!(out.app.is_none());
		// 无窗口文案的 {secs:.0}:0.05s 超时渲染为整秒 "0s"。
		assert!(out.text.contains("within 0s"), "{}", out.text);
	}

	#[test]
	fn success_after_window_and_title_refusal_check() {
		// 窗口出现;refuse_launched 收到整只 AppRef(含标题)。
		let script = Rc::new(Script {
			resolve: Some(Ok(("target".into(), "Snip".into()))),
			found: RefCell::new(vec![None, None, Some(app_named("SnippingTool", "Snipping Tool"))]),
			..Script::default()
		});
		let kit = kit_for(&script);
		let seen: RefCell<Vec<AppRef>> = RefCell::new(Vec::new());
		let refuse = |app: &AppRef| {
			seen.borrow_mut().push(app.clone());
			None // 放行
		};
		let adapter = LaunchAdapter { resolve: &*kit.resolve, find: &*kit.find, spawn: &*kit.spawn, identity: None };
		let out =
			run_launch("snip", &adapter, LaunchPermit { permit: None, refuse_launched: Some(&refuse) }, 1.0, 0.001);
		assert!(out.ok, "{}", out.text);
		assert!(out.text.contains("launched Snip; its window 'Snipping Tool' is on screen"), "{}", out.text);
		assert_eq!(out.app.as_ref().map(|a| a.window_title.as_str()), Some("Snipping Tool"));
		let seen = seen.borrow();
		assert_eq!(seen.len(), 1);
		assert_eq!(seen[0].window_title, "Snipping Tool"); // 标题幸存,规则可见

		// 同一钩子拒绝时:ok=false、AppRef 不出;spawn 已发生(防不住)但
		// 成功不被报告。
		let script = Rc::new(Script {
			resolve: Some(Ok(("target".into(), "Snip".into()))),
			found: RefCell::new(vec![None, Some(app_named("SnippingTool", "Snipping Tool"))]),
			..Script::default()
		});
		let kit = kit_for(&script);
		let refuse = |_app: &AppRef| Some("blocked by title rule".into());
		let adapter = LaunchAdapter { resolve: &*kit.resolve, find: &*kit.find, spawn: &*kit.spawn, identity: None };
		let out =
			run_launch("snip", &adapter, LaunchPermit { permit: None, refuse_launched: Some(&refuse) }, 1.0, 0.001);
		assert!(!out.ok);
		assert_eq!(out.text, "blocked by title rule");
		assert!(out.app.is_none());
		assert!(script.log.borrow().iter().any(|l| l == "spawn")); // 进程已启动(残留如实)
	}

	#[test]
	fn order_is_resolve_permit_find_spawn_poll() {
		// 全通路径:顺序钉死。
		let script = Rc::new(Script {
			resolve: Some(Ok(("target".into(), "Calc".into()))),
			found: RefCell::new(vec![None, Some(app_named("Calc", "Calc"))]),
			..Script::default()
		});
		let kit = kit_for(&script);
		let script_for_permit = Rc::clone(&script);
		let permit = move |_who: &LaunchIdentity| {
			script_for_permit.log.borrow_mut().push("permit".into());
			None
		};
		let adapter = LaunchAdapter { resolve: &*kit.resolve, find: &*kit.find, spawn: &*kit.spawn, identity: None };
		let out =
			run_launch("calc", &adapter, LaunchPermit { permit: Some(&permit), refuse_launched: None }, 1.0, 0.001);
		assert!(out.ok);
		let log = script.log.borrow();
		assert_eq!(
			log.iter().map(String::as_str).collect::<Vec<_>>(),
			vec!["resolve", "permit", "find", "spawn", "find"],
			"order must be resolve → permit → find(already-running) → spawn → find(poll)"
		);
	}

	#[test]
	fn await_window_returns_immediately_when_found() {
		let (found, waited) = await_launched_window(&|| Some(app_named("X", "X")), 1.0, 0.001);
		assert!(found.is_some());
		assert!(waited < 0.5, "immediate find must not wait: {waited}");
		// 超时路径:等待时长如实返回,且真的等了。
		let started = clock::now();
		let (found, waited) = await_launched_window(&|| None, 0.03, 0.005);
		assert!(found.is_none());
		assert!((waited - 0.03).abs() < 0.02, "waited {waited}");
		assert!(clock::now() - started >= 0.028, "must actually wait the timeout");
	}
}
