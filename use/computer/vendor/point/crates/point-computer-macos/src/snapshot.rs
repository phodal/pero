//! 无障碍走查:一个应用窗口 → 一张带索引的元素表。REF
//! `snapshot_macos.py` 的移植。
//!
//! 这里有两件真正承重的东西。
//!
//! **走查是迭代式的,显式栈。** 不是风格选择:递归走查一棵病态树会爆 C 栈
//! —— 从 FFI 调用链里溢出是进程硬崩溃,不是可捕获的异常。显式栈把深度从
//! 栈界限变成数据界限。Rust 侧再进一步:栈项是拥有所有权的 [`CfRef`],
//! `Drop` 的释放纪律由类型携带 —— 预算截断时留在栈上的引用同样被释放,
//! REF 里那两段「finally 排空」的论证在这里结构性地成立。
//!
//! **`secure` 从 `AXRole` 与 `AXSubrole` 双属性推导。** 真实的 macOS 密码
//! 框报 `AXRole='AXTextField'`(完全无害)配 `AXSubrole=
//! 'AXSecureTextField'` 且 `AXValue` **可读**。只查 role 会漏掉平台上的每一
//! 个密码框,而三重保护(渲染器的值 redaction、策略的输入拒绝、整窗截图
//! 抑制)全挂在这一面旗上 —— 推导住在 [`is_secure`] 一个函数里,测试直接
//! 钉死它。
//!
//! Electron/Chromium 应用(Slack、VS Code、Obsidian)需要先设
//! `AXManualAccessibility` 才暴露任何有用的东西,症状有两种形态 —— 都活体
//! 复现过:
//!
//! * 一切属性读硬错误 `kAXErrorCannotComplete`(-25204)(Chrome);
//! * 读**成功**但只返回 13 个节点的桩(Obsidian,自选加入之前;之后
//!   574)。
//!
//! 所以重试在「错误**或**小得可疑的树」上触发 —— 这是抓住第二种形态的唯
//! 一办法。

use std::time::Duration;

use point_computer_core::clock;
use point_computer_core::render;
use point_computer_core::types::{
	AX_CHILD_ATTRIBUTES, AX_CHILDREN, AX_DESCRIPTION, AX_ENABLED, AX_EXPANDED, AX_FOCUSED_UI_ELEMENT, AX_ROLE, AX_ROWS,
	AX_SELECTED, AX_SELECTED_TEXT, AX_SUBROLE, AX_TITLE, AX_VALUE, AX_VISIBLE_CHILDREN, AX_WINDOWS, AppRef,
	ComputerUseError, DEFAULT_SCREENSHOT_JPEG_QUALITY, DEFAULT_SCREENSHOT_MAX_PX, DEFAULT_TEXT_LIMIT, ELIDABLE_ROLES,
	ElementRec, Frame, MAX_CHILDREN_PER_NODE, MAX_TREE_DEPTH_LIMIT, MAX_TREE_NODES_LIMIT, ROW_BEARING_ROLES,
	SECURE_SUBROLE, Snapshot, SnapshotRequest, TRAIT_EDITABLE, TRAIT_EXPANDED, TRAIT_SELECTED,
};

use crate::ffi::{self, CfRef};

/// 走查的起点窗口属性。`AXWindows`(全部窗口)而非 `AXFocusedWindow`:
/// 后者对后台应用常为 NULL —— 而「背景里的应用」正是 computer use 存在
/// 的理由。
const WINDOW_ATTRIBUTE: &str = AX_WINDOWS;
/// `AXMain`:应用自认的主窗口。CG 窗口 id 无法关联时的决胜者。
const AX_MAIN: &str = "AXMain";
/// 寻找窗口列表选中的那个窗口时最多检视几个 AX 窗口。有界,免得一个开着
/// 一百个窗口的应用让关联扫描变贵;目标几乎总在前几个。
const MAX_WINDOWS_TO_INSPECT: usize = 16;
/// U+2026,CoreGraphics 截断长窗口标题时用的字符。
const TITLE_ELLIPSIS: &str = "…";
/// 信任的最短标题前缀。低于它,匹配更像巧合而非身份,`AXMain` 兜底比一次
/// 自信的错配好。
const MIN_TITLE_STEM_LEN: usize = 8;

/// 从有可见窗口的应用里走查出**这么少**的节点,是 Electron「无障碍尚未
/// 启用」的签名,不是真的简单应用:Obsidian 自选加入前报 13 个节点,之后
/// 574。真就这么小的原生应用(裸警告框)不过多付一次有界重试。
const ELECTRON_STUB_NODE_THRESHOLD: usize = 24;

/// 每节点子项上限 = core 的 `MAX_CHILDREN_PER_NODE`(512)。在全局节点预
/// 算注意到之前先界住一个病态容器(10 万行的表格),单个元素无法让一次
/// 走查物化巨大的指针列表。
///
/// 每元素读取的宣告动作名上限。参考性元数据,几个是常态;上限防一个敌意
/// 元素把走查变成平方级。
const MAX_ACTIONS_PER_NODE: usize = 16;
/// 一次走查的总墙钟预算,以及为什么节点/深度预算不够:
/// `AX_MESSAGING_TIMEOUT_SECS` 是**每次调用**的上限,而一次走查对最多
/// `MAX_TREE_NODES_LIMIT` 个节点各做 ~5 次 AX 调用 —— 一个半卡死的应用若每
/// 次读都吃满 2s 超时,可以停住工作线程几十分钟而不违反任何单次超时。只有
/// 这条总时钟能界住总量。对现实宽裕(实测 Slack 506 节点 0.025s、Chrome
/// 1475 节点 0.07s —— 三个数量级余量),健康应用永远碰不到;它只为把病态
/// 的那只切走。
const MAX_WALK_SECS: f64 = 10.0;

/// 一次走查的诊断 —— 访问了几个节点、哪条预算停的。
///
/// `saw_secure` 与「返回元素里有 secure 记录」**刻意分离**。截图抑制不得
/// 依赖**报告**预算:躺在 `max_nodes` 之后的密码框(登录表单的 secure 输
/// 入常是最后一个子节点;实测 Chromium 窗口 1431–1475 节点对 1200 默认)
/// 否则会让 `has_secure` 为假、整窗像素被捕走。更糟的是 schema 允许模型
/// **自选** `max_tree_nodes`,它可以挑一个藏起那个字段的预算。这面旗对走
/// 查分类过的每个节点置位,无论它是否挤进了报告。
#[derive(Clone, Debug, Default, PartialEq)]
pub struct WalkStats {
	pub visited: usize,
	pub truncated: bool,
	pub depth_truncated: bool,
	pub saw_secure: bool,
	/// 总时钟 [`MAX_WALK_SECS`] 停住了本次走查。与 `truncated`(它也置位
	/// —— 树确实不完整)分开报告,诊断才能分清「应用卡死了」与「模型要的
	/// 预算小」。
	pub time_truncated: bool,
}

/// 走查 *app* 的最前窗口成一张 [`Snapshot`]。失败的两种文案都点名原始
/// AX 错误码 —— 那是让一条支持线程可诊断的唯一东西。
///
/// 操作顺序,每一步都承重:
///
/// 1. 创建 application 元素 —— [`ffi::ax_app_element`] 在里面**立即**设好
///    单次调用的消息超时。注意「单次」:它界住一次无障碍往返,不是本函
///    数;本函数做几千次往返,总界是 [`MAX_WALK_SECS`],在 [`walk`] 里执法;
/// 2. 读 `AXWindows`;
/// 3. 在 `-25204` **或**小得可疑的树上设 `AXManualAccessibility`,以
///    0.25s 步长轮询至多 2s,重试**恰好一次**;
/// 4. 仍无可用窗口 → 错误。
///
/// 图**不**在这里捕 —— capture 模块管那个,调用方在树里有 secure 字段时
/// 抑制它。分开正是「任何 secure 节点 → 一像素都没有」能在一处执法的原
/// 因,而非一条穿进走查的参数。
pub fn build_snapshot(app: &AppRef, req: &SnapshotRequest) -> Result<Snapshot, ComputerUseError> {
	let Some(app_elem) = ffi::ax_app_element(app.pid) else {
		return Err(ComputerUseError::Unsupported(format!(
			"could not open an accessibility connection to '{}' (pid {}); the process may have exited",
			app.name, app.pid
		)));
	};

	let (mut window, mut err) = frontmost_window(&app_elem, app.window_id, &app.window_title);
	// `-25204`(kAXErrorCannotComplete)是瞬态:繁忙、退出中、窗口正在
	// 关闭的应用对窗口枚举偶发答它 —— 本 crate 的常量表自己写着「重试
	// 信号,非致命」。两个短间隔再读,把毫秒级竞态折叠回正常路径;仍
	// 是它才继续(错误文案随后如实归因,不再断言「无窗口」)。
	if window.is_none() && err == ffi::AX_ERR_CANNOT_COMPLETE {
		for delay in [0.1, 0.25] {
			std::thread::sleep(Duration::from_secs_f64(delay));
			let (win, retry_err) = frontmost_window(&app_elem, app.window_id, &app.window_title);
			if win.is_some() {
				window = win;
				err = ffi::AX_ERR_SUCCESS;
				break;
			}
			err = retry_err;
			if retry_err != ffi::AX_ERR_CANNOT_COMPLETE {
				break;
			}
		}
	}
	let mut elements: Vec<ElementRec> = Vec::new();
	let mut stats = WalkStats::default();

	// 每快照只读**一次**,然后向下传给走查。二者回答的都是对整棵树只有
	// 一个答案的问题,按节点读会给最多 ~1400 个节点的每一个加一次 AX 往
	// 返回。
	let focused = focused_element(&app_elem);
	let mut bounds = window_bounds_of(window.as_ref());

	if let Some(win) = window.as_ref() {
		let (els, st, _) = walk(win, req, bounds, focused.as_ref(), None);
		elements = els;
		stats = st;
	}

	if needs_manual_accessibility(window.is_none(), err, &stats) {
		let (retried, retry_err, retry_elements, retry_stats) =
			retry_with_manual_accessibility(&app_elem, app, req, focused.as_ref());
		window = retried;
		err = retry_err;
		elements = retry_elements;
		stats = retry_stats;
		// 同一个元素回来也重读:重试的走查是对**它**读到的 bounds 定框
		// 的,报告的 `window_bounds` 必须是那些 frame 真正相对的原点。
		// Electron 窗口在加载完成时会改尺寸,这不是假设。
		bounds = window_bounds_of(window.as_ref());
	}

	let Some(win) = window.as_ref() else {
		// 归因分岔:-25204 重试过仍失败 → 「没能应答」(瞬态过载/退出
		// 中,建议重试);其余 → 「无窗口」(含 Electron 冷启动的诚实读数)。
		return Err(ComputerUseError::Unsupported(if err == ffi::AX_ERR_CANNOT_COMPLETE {
			format!(
				"'{}' (pid {}) did not answer accessibility in time (AX error {err}); it may be busy, closing, or mid-transition — retry computer_get_state",
				app.name, app.pid
			)
		} else {
			format!(
				"'{}' (pid {}) exposed no accessible window (AX error {}). Electron apps may need a moment after launch.",
				app.name, app.pid, err
			)
		}));
	};

	let selected = selected_text(focused.as_ref(), req.text_limit);
	// 独立于**报告**预算:`stats.saw_secure` 盖住走查分类过的每个节点 ——
	// 含节点预算丢掉的与 `max_depth` 之下的。elements 项冗余,留作一个便宜
	// 而显然的本地核验。
	let has_secure = stats.saw_secure || elements.iter().any(|rec| rec.secure);
	Ok(Snapshot {
		app: app.clone(),
		elements,
		window_title: ffi::ax_str(win, AX_TITLE),
		// 单调钟,绝非墙上钟:时钟调整不能让旧快照显新(或新快照显旧)。
		captured_at: clock::now(),
		truncated: stats.truncated,
		depth_truncated: stats.depth_truncated,
		has_secure,
		window_bounds: bounds,
		selected_text: selected,
		..Snapshot::default()
	})
}

/// 动作前的漂移核验走查:全量重走而非只读单个元素 —— 索引只相对完整走查
/// 有意义,核验「index 7 仍是保存按钮」就要复现产出 index 7 的编号。
/// `want_image` 被忽略:核验走查永不捕像素。
pub fn refresh_fingerprints(app: &AppRef, req: &SnapshotRequest) -> Result<Snapshot, ComputerUseError> {
	build_snapshot(app, req)
}

/// 走查的寻址预算:schema 允许的最宽节点/深度上限,让任何合法快照的索引
/// 都可达。`keep_index` 让 [`walk`] 在那个索引一记录就停,且不捕图 —— 这
/// 次走查只为定位一个元素而存在。
pub const ADDRESSING_REQUEST: SnapshotRequest = SnapshotRequest {
	max_nodes: MAX_TREE_NODES_LIMIT,
	max_depth: MAX_TREE_DEPTH_LIMIT,
	text_limit: DEFAULT_TEXT_LIMIT,
	want_image: false,
	image_max_px: DEFAULT_SCREENSHOT_MAX_PX,
	image_quality: DEFAULT_SCREENSHOT_JPEG_QUALITY,
};

/// 寻址走查永不捕像素 —— 编译期钉死:want_image 是常量,这面旗翻 true 的
/// 那天让构建红,而不是等一次多余的截图落进 spool。
const _: () = assert!(!ADDRESSING_REQUEST.want_image, "the addressing walk never captures pixels");

/// `(app_elem, AX_WINDOWS)` → `(窗口元素, ax 错误码)`。
///
/// **不是简单取 `AXWindows[0]`。** AX 窗口序与 CoreGraphics 窗口列表**各自
/// 独立**,混了是一次静默的错观测:在 Notes 上实测,`AXWindows[0]` 是一个
/// 空标题、3 节点的 `AXDialog`,而最前的 CG 窗口 —— capture 会拍的那个 ——
/// 是 `AXWindows[1]` 里真正的 103 节点文档窗。模型会收到一棵 3 节点的树,
/// 配一张完全不同窗口的截图,无从分辨。
///
/// 选择序:
///
/// 1. `_AXUIElementGetWindow` 的窗口 id 等于目标 id 的 AX 窗口 —— 权威关
///    联,窗口 id 正是 capture 用的那个;
/// 2. 对窗口**标题的前缀**匹配(私有符号可能在未来 macOS 缺席)。前缀而非
///    相等:两个命名空间对同一窗口报不同字符串 —— 实测 CoreGraphics 用省
///    略号截断(`'fix(ci): keep GHCR package priv…est #621'`)而 AX 给全标
///    题加应用名后缀(`'… - Google Chrome'`);CoreGraphics 说
///    `'All on My Mac'` 时 AX 说 `'All on My Mac – 6 notes'`。相等测试一
///    个都配不上;
/// 3. 应用自标 `AXMain` 的窗口;
/// 4. `AXWindows[0]`,最后的手段。
fn frontmost_window(app_elem: &CfRef, window_id: u32, window_title: &str) -> (Option<CfRef>, i32) {
	let windows = ffi::ax_retained_elements(app_elem, WINDOW_ATTRIBUTE, MAX_WINDOWS_TO_INSPECT);
	if windows.is_empty() {
		// 空列表既可能是 AX 错误也可能是应用真的没窗口;只在此时重读错误
		// 码,调用方才能区分「-25204,需要 Electron 自选加入」与「没开
		// 窗口」。
		let err = match ffi::ax_attr(app_elem, WINDOW_ATTRIBUTE) {
			Err(err) => err,
			// 属性读得动但列表为空:没有窗口,而非没有权限。
			Ok(_) => ffi::AX_ERR_NO_VALUE,
		};
		return (None, err);
	}
	let chosen = select_window(&windows, window_id, window_title);
	// 未选中的窗口随 Vec 的 Drop 释放 —— 每个都是 +1。
	(Some(chosen), ffi::AX_ERR_SUCCESS)
}

fn select_window(windows: &[CfRef], window_id: u32, window_title: &str) -> CfRef {
	if window_id > 0 {
		for window in windows {
			if ffi::ax_window_id(window) == window_id {
				return window.retain();
			}
		}
	}
	let stem = title_stem(window_title);
	if !stem.is_empty() {
		for window in windows {
			if ffi::ax_str(window, AX_TITLE).starts_with(&stem) {
				return window.retain();
			}
		}
	}
	for window in windows {
		if ffi::ax_bool(window, AX_MAIN, false) {
			return window.retain();
		}
	}
	windows[0].retain()
}

/// CoreGraphics 窗口标题里**靠前的、未被截断的**部分。
///
/// CoreGraphics 用 U+2026 截断长标题的中段(实测:`'fix(ci): keep GHCR
/// package priv…est #621 · kirodotdev/KiroCrew'`),只有省略号**之前**的文
/// 本是 AX 标题的可靠前缀。太短的前缀 → 空:一个 3 字符前缀配错窗口的次
/// 数会多于配对,`AXMain` 兜底比自信的错配好。
fn title_stem(window_title: &str) -> String {
	let stem = window_title.split(TITLE_ELLIPSIS).next().unwrap_or_default().trim();
	if stem.chars().count() >= MIN_TITLE_STEM_LEN { stem.to_string() } else { String::new() }
}

/// *role* 的子集合读取序(合并序)。
///
/// `ROW_BEARING_ROLES` 容器(表格、大纲、列表、浏览器)把行集合放在**最
/// 前**:顺序决定谁拿低索引,而模型寻址的是靠前的那些 —— 把电子表格的行
/// 排在它自己的表头/滚动条脚手架后面,埋掉的就是模型真正在找的内容,截断
/// 走查时干脆整个丢掉。其余角色保持 `AXChildren` 在前 —— 内容真在那里,
/// 备选集合此后的意义纯是补充覆盖。
fn child_attribute_order(role: &str) -> &'static [&'static str] {
	if ROW_BEARING_ROLES.contains(&role) { &[AX_ROWS, AX_VISIBLE_CHILDREN, AX_CHILDREN] } else { AX_CHILD_ATTRIBUTES }
}

/// *found* 里不在 *seen* 中的条目(有界);被拒条目就地释放。
///
/// 身份经 [`ffi::same_element`](CFEqual)比较。只有当一个节点真的在多个集
/// 合里暴露子项时才走到这里 —— 不常见的形态;单集合路径完全跳过这个扫描。
fn dedup_against(seen: &[CfRef], found: Vec<CfRef>) -> Vec<CfRef> {
	let mut kept: Vec<CfRef> = Vec::new();
	for child in found {
		if seen.len() + kept.len() >= MAX_CHILDREN_PER_NODE
			|| seen.iter().chain(kept.iter()).any(|other| ffi::same_element(child.as_ptr(), other.as_ptr()))
		{
			continue; // child 在此 drop → CFRelease
		}
		kept.push(child);
	}
	kept
}

/// 窗口元素自身的屏幕矩形。从 AX 元素读而非经 CoreGraphics 窗口列表关联回
/// 去:它与元素 frame 来自**同一个源**(相减不会混进两个差一个标题栏高度
/// 的坐标系),而且不需要窗口 id —— Electron 重试路径可能还没有它。
///
/// `None` 是寻常答案:某些窗口元素对 `AXPosition` 答 -25205,所有元素
/// frame 随之为 `None`,正确的降级(见 [`local_frame`])。
fn window_bounds_of(window: Option<&CfRef>) -> Option<Frame> {
	let (x, y, w, h) = ffi::ax_frame(window?)?;
	Some(Frame { x, y, w, h })
}

/// 应用自己的 `AXFocusedUIElement`,或 `None`。
///
/// 从**应用**元素读,不是系统级的:系统级焦点跟随操作者正在用的东西,目
/// 标应用碰巧在最前时,它会把背景应用的一个元素标成聚焦 —— 其余时间什么
/// 都不报。应用级属性回答的是「这个应用的插入点在哪」,那才是模型在问
/// 的,而且对后台应用也答。
///
/// 无聚焦(常见 —— 无键窗口的后台应用)或属性不支持 → `None`,调用方按
/// 「无聚焦标记」处理。
fn focused_element(app_elem: &CfRef) -> Option<CfRef> {
	// ax_attr 的返回即 Create-Rule 的 +1 所有权 —— 直接持有,无需再 retain。
	let value = ffi::ax_attr(app_elem, AX_FOCUSED_UI_ELEMENT).ok()??;
	ffi::cf_is(value.as_ptr(), ffi::type_ids().ax_element).then_some(value)
}

/// 操作者在 *focused* 里当前的文本选区,或空。
///
/// 值得每快照一次 AX 读:它是「有个文本框」与「用户高亮了**这段**」的差
/// 别 —— 「重写我选中的内容」指的就是它,树走查多少步都追不回来。
///
/// **对 secure 元素永不读。** 选中的密码也是密码,既定规则是 secure 节点
/// 只披露其存在。检查针对**聚焦的**元素(不是树的 `has_secure`):那是本
/// 函数读选区的元素 —— 窗口里合法地有个密码框、插入点却在普通搜索框里
/// 时,为它拒绝整个窗口的选区会扣下一个不敏感的值。
///
/// 与每个字符串过同一把 `text_limit` 剪刀并折叠换行 —— 选区是任意用户内
/// 容,同样能携带换行(防伪造树行的论证见 `render::clip`)。
fn selected_text(focused: Option<&CfRef>, text_limit: usize) -> String {
	let Some(focused) = focused else { return String::new() };
	let role = ffi::ax_str(focused, AX_ROLE);
	let subrole = ffi::ax_str(focused, AX_SUBROLE);
	if is_secure(&role, &subrole) {
		return String::new();
	}
	render::clip(&ffi::ax_str(focused, AX_SELECTED_TEXT), text_limit)
}

/// 是否应尝试 Electron 自选加入。两个触发器,因为症状有两种形态:
///
/// * 窗口为 `None` 且错误非零 —— Chrome 的行为,一切属性读硬错误
///   (-25204 就是典型);
/// * 走查少于 [`ELECTRON_STUB_NODE_THRESHOLD`] 个节点的窗口 —— Obsidian
///   的行为,一次**成功**的 13 节点桩读。只查错误会整个漏掉它,Electron
///   应用就此长成一个「没有控件的工作应用」。
fn needs_manual_accessibility(window_none: bool, err: i32, stats: &WalkStats) -> bool {
	if window_none {
		return err != ffi::AX_ERR_SUCCESS;
	}
	stats.visited < ELECTRON_STUB_NODE_THRESHOLD
}

/// 设 `AXManualAccessibility`、轮询、重走**一次**。
///
/// 两轴都有界:至多 `WAIT/POLL` 次轮询、恰好一次重试 —— 永不循环,否则一
/// 个永不应答的应用可以永远占住工作线程。轮询里见到的最好结果被保留:
/// 应用还在热身时,半填充的树好过没有。
///
/// 设属性的失败既不致命也不值得警告:没有这个属性的原生应用回一个错误,
/// 意思只是「这不是 Electron 应用」,原结果照旧。
///
/// 每个候选窗口的 bounds 为**它自己的**走查重读,不从调用方继承:轮询可
/// 以选中不同的窗口(应用开完了真正的那个),对前一个窗口原点定框的
/// frame 会偏移两窗之间的距离 —— 看着可信的数字指着错的地方。
fn retry_with_manual_accessibility(
	app_elem: &CfRef,
	app: &AppRef,
	req: &SnapshotRequest,
	focused: Option<&CfRef>,
) -> (Option<CfRef>, i32, Vec<ElementRec>, WalkStats) {
	let _set_err = ffi::ax_set_true(app_elem, ffi::AX_MANUAL_ACCESSIBILITY);
	let deadline = clock::now() + ffi::ELECTRON_OPT_IN_WAIT_SECS;
	let mut best: Option<(CfRef, Vec<ElementRec>, WalkStats)> = None;
	// 未初始化:循环体在任何 break/return 之前先赋值,初值无处可读。
	let mut err;
	loop {
		std::thread::sleep(Duration::from_secs_f64(ffi::ELECTRON_OPT_IN_POLL_SECS));
		let (window, poll_err) = frontmost_window(app_elem, app.window_id, &app.window_title);
		err = poll_err;
		if let Some(win) = window {
			let bounds = window_bounds_of(Some(&win));
			let (elements, stats, _) = walk(&win, req, bounds, focused, None);
			if stats.visited >= ELECTRON_STUB_NODE_THRESHOLD {
				return (Some(win), ffi::AX_ERR_SUCCESS, elements, stats);
			}
			let improvement = best.as_ref().is_none_or(|(_, _, bs)| stats.visited > bs.visited);
			if improvement {
				best = Some((win, elements, stats));
			}
			// 非改进的窗口在此 drop → 释放,慢热的应用吃满八次轮询也不
			// 泄漏七个窗口引用。
		}
		if clock::now() >= deadline {
			break;
		}
	}
	match best {
		Some((win, elements, stats)) => (Some(win), err, elements, stats),
		None => (None, err, Vec::new(), WalkStats::default()),
	}
}

/// 把窗口的无障碍子树摊平成带索引的记录。
///
/// **唯一的编号权威。** 快照路径与 driver 的元素寻址重走都调这一个函数:
/// 「哪个节点是 index 7」的两份实现一旦漂移,就是一次静默的点错目标 ——
/// 本特性能产出的最坏的失败类别。
///
/// 迭代式 —— 显式 `(元素, 深度)` 栈,永不递归。子项**逆序**入栈,出栈序
/// 即从左到右,模型看到的索引与渲染器打印的顺序一致。
///
/// 三条预算分开报告,因为它们对模型意味着不同的东西:`truncated` 说「这棵
/// 树还有更多」,`depth_truncated` 说「你可见的之下还有更多」,
/// `time_truncated` 说「这个应用慢得走不完」。
///
/// **时间预算与节点预算不冗余**(见 [`MAX_WALK_SECS`]):节点与深度预算界
/// 住的是工作量,不是时间;只有循环顶部的这条总时钟界得住总量。
///
/// 无自身文本的结构性容器被**省略** —— 既不占索引也不占渲染行,但其子项
/// 仍在父的深度被访问。真实的 Finder 树大半是 `AXGroup` 脚手架,把索引花
/// 在它上面既浪费节点预算,又让模型推理的编号变稀疏而混乱。
///
/// *keep_index* 额外返回那个索引的活元素(寻址路径要的),并把走查就地结
/// 束 —— 寻址元素 3 不必走 1400 个节点。
///
/// *win_bounds* 存在时,每条记录的几何存成**窗口相对**;不存在时干脆不存
/// frame 而非存屏幕绝对的 —— 消费方分不清两者,而它们意思不同。
///
/// *focused* 是调用方**读一次**的 `AXFocusedUIElement` —— 走查只对它做指
/// 针比较。按节点读会给每棵树的每个节点(Chrome 上 ~1400)加一次 AX 往
/// 返回,回答一个只有一个答案的问题。
///
/// 栈上的 [`CfRef`] 携带 +1 所有权,`Drop` 即释放 —— 预算截断时留在栈上的、
/// keep_index 提前返回时没入栈的,全部由 RAII 排空;REF 里手写的两段
/// 「finally drain」论证在此结构性成立。
#[allow(clippy::too_many_lines)]
fn walk(
	window: &CfRef,
	req: &SnapshotRequest,
	win_bounds: Option<Frame>,
	focused: Option<&CfRef>,
	keep_index: Option<u32>,
) -> (Vec<ElementRec>, WalkStats, Option<CfRef>) {
	let mut records: Vec<ElementRec> = Vec::new();
	let mut stats = WalkStats::default();
	// 根窗口走查不拥有:retain 一份计入本栈,Drop 对称释放 —— 调用方的
	// 引用不受影响。
	let mut stack: Vec<(CfRef, u16)> = vec![(window.retain(), 0)];
	// 单调钟,绝非墙上钟:走查中途的时钟调整不能让预算瞬间到期(或永不
	// 到期)。
	let deadline = clock::now() + MAX_WALK_SECS;

	loop {
		if clock::now() >= deadline {
			// 在 pop 之前查,栈上引用仍由 Drop 拥有。truncated 一并置位:
			// 无论原因,模型见到的树不完整,必须说出来。
			stats.time_truncated = true;
			stats.truncated = true;
			break;
		}
		let Some((element, depth)) = stack.pop() else { break };

		// 分类先于预算检查。saw_secure 必须反映**整个窗口**,而非挤进报
		// 告的那部分(见 WalkStats)。role+subrole 是两次便宜的 AX 读;
		// 昂贵的部分(value、动作、子项)仍只对过预算的节点做。
		let role = ffi::ax_str(&element, AX_ROLE);
		let subrole = ffi::ax_str(&element, AX_SUBROLE);
		let secure = is_secure(&role, &subrole);
		if secure {
			stats.saw_secure = true;
		}

		if depth as usize > req.max_depth {
			// 与下方节点预算分支同一个推理、同一个坑:裸 continue 只停止
			// **下潜**,max_depth 之下的密码框永不被分类、saw_secure 留假
			// —— 而模型自选 max_tree_depth=1 就能藏起密码框、让整窗像素
			// 可捕。继续便宜地走(role+subrole,不建记录),secure 扫描仍
			// 盖住整个窗口。
			stats.depth_truncated = true;
			if stats.visited >= MAX_TREE_NODES_LIMIT {
				continue;
			}
			stats.visited += 1;
			for child in read_children(&element, &role, &mut stats).into_iter().rev() {
				stack.push((child, depth.saturating_add(1)));
			}
			continue;
		}
		if records.len() >= req.max_nodes {
			// **报告**满了,但走查不停:继续(便宜地)下潜 —— role+subrole
			// 而已,不读 value/动作、不建记录 —— 让 saw_secure 仍盖住没挤
			// 进来的那部分窗口。在这里停下,正是 max_nodes 之外的密码框
			// 让整窗像素可捕的那个洞。以 MAX_TREE_NODES_LIMIT 为界,敌意
			// 的树不能把这场扫描变无界。
			stats.truncated = true;
			if stats.visited >= MAX_TREE_NODES_LIMIT {
				break;
			}
			stats.visited += 1;
			for child in read_children(&element, &role, &mut stats).into_iter().rev() {
				stack.push((child, depth.saturating_add(1)));
			}
			continue;
		}
		stats.visited += 1;
		let title = ffi::ax_str(&element, AX_TITLE);
		// secure 字段的值**根本不读**。不是读了再掩码:字节从不进入进程,
		// 之后任何 bug —— 日志、错误消息、序列化 —— 都泄不了从未取来的
		// 东西。
		let value = if secure { String::new() } else { first_text(&element) };
		let actions = if secure { Vec::new() } else { ffi::ax_actions(&element, MAX_ACTIONS_PER_NODE) };

		let children = read_children(&element, &role, &mut stats);
		if is_elidable(&role, &title, &value, &actions, children.len()) {
			// 省略:子项继承父的深度,可见的树不为一个谁也看不见的节点
			// 多一层缩进。
			for child in children.into_iter().rev() {
				stack.push((child, depth));
			}
			continue;
		}

		let index = records.len() as u32;
		records.push(ElementRec {
			index,
			role,
			subrole,
			title,
			value,
			actions,
			depth,
			secure,
			// AXEnabled 在很多元素上 unsupported(窗口对它答 -25205),
			// 缺席必须读作启用 —— 把这类节点全渲染成「(禁用)」既错又吵。
			enabled: ffi::ax_bool(&element, AX_ENABLED, true),
			frame: local_frame(&element, win_bounds),
			traits: element_traits(&element, secure),
			// 与调用方读的那**一个**焦点元素比指针身份。
			focused: focused.is_some_and(|f| ffi::same_element(element.as_ptr(), f.as_ptr())),
		});
		if let Some(keep) = keep_index
			&& keep == index
		{
			// 所有权经返回值让渡给调用方;children 已 retain,随 Drop 释放
			//(REF 在此需要显式排空 —— 每个变更动作都跑一次寻址重走,漏的
			// 是每动作一整份子列表);栈上剩余由 Drop 排空。
			drop(children);
			return (records, stats, Some(element));
		}
		for child in children.into_iter().rev() {
			stack.push((child, depth.saturating_add(1)));
		}
	}
	// stack 在此 drop:预算截断留下的每个引用各得一次 CFRelease。
	(records, stats, None)
}

/// *element* 跨全部子集合的子项,去重后合并。
///
/// **`AXChildren` 不是整棵树。** 表格、大纲、列表 routinely 只经 `AXRows`
/// 暴露行(滚动列表只经 `AXVisibleChildren` 暴露在屏的那些),报一个空的
/// 或只有脚手架的 `AXChildren`。只读 Children 的走查会把电子表格、Finder
/// 列表、收件箱渲染成空容器 —— 模型读作「此应用无内容」,以猜坐标回应。
/// 三个都读再合并,这些应用才可寻址。
///
/// 按**元素身份**去重(CFEqual,非句柄相等):一行常同时在 `AXRows` 与
/// `AXVisibleChildren` 里,每次读取都为它铸出一个新引用。比地址会把同一行
/// 放过两次,而重复的行比缺的行更糟 —— 模型会当 index 7 和 index 9 是两
/// 行不同的东西去寻址。被拒的引用就地释放,去重不是泄漏。
///
/// 碰到 [`MAX_CHILDREN_PER_NODE`] 置 `truncated` 而非静默丢尾巴:否则子项
/// 超过上限的容器会让 saw_secure 只反映前 512 个而 truncated 仍为假 —— 走
/// 查自称完整且无 secure,capture 的 fail-closed 检查(拒捕截断走查)没有
/// 什么可拒的,密码框作为第 513 个子项让整窗像素可捕。truncated 恰是正确
/// 信号:它本来就说「这棵树比你见到的多」,capture 门也恰好把它读作
/// 「未知 ⇒ 视为有」。
///
/// 以 `len(merged) >= limit` 判定而非问真实数量:上限的存在就是不让一个病
/// 态容器物化 10 万个指针,再读一遍数组去数等于把那笔开销请回来。恰有上限
///那么多子项的节点因此也算截断 —— 假阳性花一张被抑制的截图,假阴性是泄
/// 露。
fn read_children(element: &CfRef, role: &str, stats: &mut WalkStats) -> Vec<CfRef> {
	let mut merged: Vec<CfRef> = Vec::new();
	for name in child_attribute_order(role) {
		if merged.len() >= MAX_CHILDREN_PER_NODE {
			// 合并上限已到,余下集合连读都不读。truncated 由下方置位。
			break;
		}
		let found = ffi::ax_retained_elements(element, name, MAX_CHILDREN_PER_NODE);
		if merged.is_empty() {
			// 第一个非空集合:没有可比对象,去重扫描整个跳过。这是压倒性
			// 的常见形态 —— 几乎每个节点的子项恰在一个集合里 —— 下面的
			// 成对比较因此不在热路径上。ax_retained_elements 的 limit 已
			// 封顶,无需再切。
			merged = found;
			continue;
		}
		merged.extend(dedup_against(&merged, found));
	}
	if merged.len() >= MAX_CHILDREN_PER_NODE {
		stats.truncated = true;
	}
	merged
}

/// **安全承重的谓词**:这个元素是不是安全文本框?
///
/// 对 [`SECURE_SUBROLE`] 同时查 **role 与 subrole 两处**。真机探测一个真实
/// macOS 密码框报:
///
/// ```text
/// AXRole    = 'AXTextField'          <- 无害
/// AXSubrole = 'AXSecureTextField'    <- 唯一可靠信号
/// AXValue   = 可读
/// ```
///
/// 直觉的 `role == "AXSecureTextField"` 检查漏掉平台上每一个密码框。role 侧
/// 仍然查,因为某些工具集确实把它报在那里;任一处命中即够,严格安全于要
/// 求特定位置。
///
/// 尽管只有一条表达式仍是独立函数:值 redaction、输入拒绝、截图抑制三重保
/// 护都挂在这个结果上,它配得上一个测试能钉住的名字,和一段解释这个不平
/// 凡不对称的注释。
pub(crate) fn is_secure(role: &str, subrole: &str) -> bool {
	role == SECURE_SUBROLE || subrole == SECURE_SUBROLE
}

/// *element* 的矩形,表达为相对 *win_bounds*;不可用时 `None`。
///
/// win_bounds 不可用时返回 `None` 而非屏幕矩形,两个独立的理由:
///
/// * 无标注的坐标比没有坐标糟 —— 消费方分不清窗口本地的 `(12, 40)` 与屏
///   幕绝对的,而那点差别就是窗口的整个位置;
/// * 模型可能同时在读的截图是**这个窗口的裁剪**,屏幕绝对的数与它看得见
///   的任何像素都对不上。
///
/// 窗口相对还让这个值在窗口拖动中保持稳定 —— 模型可能在下一回合推理上一
/// 回合见过的 frame。
fn local_frame(element: &CfRef, win_bounds: Option<Frame>) -> Option<Frame> {
	let bounds = win_bounds?;
	let (x, y, w, h) = ffi::ax_frame(element)?;
	Some(Frame { x: x - bounds.x, y: y - bounds.y, w, h })
}

/// *element* 的观察特质(selected / expanded / editable)。
///
/// 每个源属性按**三态**读,只有明确的真值产出一个词:`AXSelected` 在绝大
/// 多数元素上缺席,把缺席翻成「未选中」会给树里每个节点挂一个特质。
///
/// `editable` 来自 settability 而非 `AXEnabled`,二者回答不同的问题:只读
/// 文本框(禁用的表单输入、日志窗格)报 `AXEnabled=true` 且带可读值,敲字
/// 静默无效。这个特质把那条死路变成模型行动前**看得见**的东西。
///
/// secure 元素**没有**特质。不为整洁:editable 等于确认密码框接受输入,而
/// secure 节点的既定规则是只披露其存在 —— 与它的标题和值被扣下同一个理
/// 由。
fn element_traits(element: &CfRef, secure: bool) -> Vec<String> {
	if secure {
		return Vec::new();
	}
	let mut words = Vec::new();
	if ffi::ax_bool_opt(element, AX_SELECTED) == Some(true) {
		words.push(TRAIT_SELECTED.to_string());
	}
	if ffi::ax_bool_opt(element, AX_EXPANDED) == Some(true) {
		words.push(TRAIT_EXPANDED.to_string());
	}
	if ffi::ax_is_settable(element, AX_VALUE) {
		words.push(TRAIT_EDITABLE.to_string());
	}
	words
}

/// *element* 的第一个非空文本属性(value,然后 description)。
///
/// title 不在本函数的候选里:调用方已单独读过它(记录的字段顺序需要它),
/// 同一串报两遍没有意义。`AXDescription` 殿后:只有图标的按钮把含义**只**
/// 放在那里,少了它模型看见的是一个无法推理的无名按钮。
fn first_text(element: &CfRef) -> String {
	for name in [AX_VALUE, AX_DESCRIPTION] {
		let text = ffi::ax_str(element, name);
		if !text.is_empty() {
			return text;
		}
	}
	String::new()
}

/// 这个节点是否纯结构、不应占索引。
///
/// 全部成立才省略:role 在 [`ELIDABLE_ROLES`] 里、无文本、无宣告动作、且至
/// 少一个子项。「有子项」要紧 —— 空组是真正的叶子,静默丢弃它会让树声称
/// 一个容器没有内容,而实际是没报告。「无动作」也要紧:可点击的 `AXGroup`
/// 是真目标,无论它的 role 看起来多结构。
fn is_elidable(role: &str, title: &str, value: &str, actions: &[String], child_count: usize) -> bool {
	if !ELIDABLE_ROLES.contains(&role) {
		return false;
	}
	if !title.is_empty() || !value.is_empty() || !actions.is_empty() {
		return false;
	}
	child_count > 0
}

// ── 寻址(driver 的元素寻址原语,M6 消费) ──

/// 为 `rec.index` 重走 *app* 的窗口,返回 `(活元素, 它现在的记录)`。
///
/// 编号来自产出模型所见快照的**同一个** [`walk`],不是一份私有拷贝:两份
/// 「哪个节点是 index 7」的实现一旦漂移,就是一次静默的点错目标。
///
/// 记录随元素一并返回,调用方才能确认那个索引上的控件仍是模型寻址的那个
/// —— 正是这一步把寻址从「貌似」变成「检查」,因为寻址走查用最宽预算,
/// 其编号不保证与截断的原快照一致。
///
/// 元素由 [`CfRef`] 携带所有权,调用方 drop 即释放 —— 没有任何 CF 引用逃出
/// 本模块的生命周期管理。
pub fn resolve_element(app: &AppRef, rec: &ElementRec) -> Option<(CfRef, ElementRec)> {
	let app_elem = ffi::ax_app_element(app.pid)?;
	let (window, _) = frontmost_window(&app_elem, app.window_id, &app.window_title);
	let window = window?;
	let (records, _, element) =
		walk(&window, &ADDRESSING_REQUEST, window_bounds_of(Some(&window)), None, Some(rec.index));
	let found = records.into_iter().find(|record| record.index == rec.index)?;
	let element = element?;
	Some((element, found))
}

// ── 纯测(判定与编号规则离线钉死;真树走查在 #[ignore] 冒烟里) ──

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn secure_derives_from_both_role_and_subrole() {
		// REF 的活体探测形态:无害 role + secure subrole + 可读值。只查
		// role 漏掉平台上每一个密码框。
		assert!(is_secure("AXTextField", "AXSecureTextField"));
		assert!(is_secure("AXSecureTextField", ""));
		assert!(!is_secure("AXTextField", "AXTextField"));
		assert!(!is_secure("", ""));
	}

	#[test]
	fn title_stem_trusts_only_the_untruncated_prefix() {
		// CoreGraphics 的中段省略截断:省略号之后不可信。
		assert_eq!(title_stem("fix(ci): keep GHCR package priv…est #621"), "fix(ci): keep GHCR package priv");
		// 全标题无省略号:整串即前缀。
		assert_eq!(title_stem("All on My Mac"), "All on My Mac");
		// 过短的前缀配错窗口多于配对 —— 交回 AXMain 兜底。
		assert_eq!(title_stem("abc…defghi"), "");
		assert_eq!(title_stem(""), "");
	}

	#[test]
	fn row_bearing_containers_read_rows_first() {
		assert_eq!(child_attribute_order("AXTable"), &[AX_ROWS, AX_VISIBLE_CHILDREN, AX_CHILDREN]);
		assert_eq!(child_attribute_order("AXOutline"), &[AX_ROWS, AX_VISIBLE_CHILDREN, AX_CHILDREN]);
		// 其余角色:AXChildren 在前,内容真在那里。
		assert_eq!(child_attribute_order("AXButton"), AX_CHILD_ATTRIBUTES);
		assert_eq!(child_attribute_order("AXGroup"), AX_CHILD_ATTRIBUTES);
	}

	#[test]
	fn elision_requires_structure_textlessness_actionslessness_and_children() {
		let no_text: Vec<String> = Vec::new();
		// 全部成立 → 省略。
		assert!(is_elidable("AXGroup", "", "", &no_text, 3));
		// 无子项的组是真叶子,不省。
		assert!(!is_elidable("AXGroup", "", "", &no_text, 0));
		// 带文本的结构角色是内容。
		assert!(!is_elidable("AXGroup", "Title", "", &no_text, 3));
		assert!(!is_elidable("AXGroup", "", "value", &no_text, 3));
		// 宣告过动作的组是真目标。
		let actions = vec!["AXPress".to_string()];
		assert!(!is_elidable("AXGroup", "", "", &actions, 3));
		// 非结构角色永不省略。
		assert!(!is_elidable("AXButton", "", "", &no_text, 3));
	}

	#[test]
	fn addressing_request_is_the_widest_budget_without_image() {
		assert_eq!(ADDRESSING_REQUEST.max_nodes, MAX_TREE_NODES_LIMIT);
		assert_eq!(ADDRESSING_REQUEST.max_depth, MAX_TREE_DEPTH_LIMIT);
	}

	/// 冒烟:真实应用的一棵稠密树(Calculator 无弹窗、树小而稳定)。
	#[test]
	#[ignore = "needs a desktop session with accessibility granted"]
	fn calculator_snapshot_smoke() {
		let apps = crate::apps::list_apps();
		let calc = apps.into_iter().find(|app| app.bundle_id == "com.apple.calculator");
		let Some(calc) = calc else {
			eprintln!("calculator not running; open it first");
			return;
		};
		let snap = build_snapshot(&calc, &SnapshotRequest::default()).expect("walk succeeds");
		assert!(!snap.elements.is_empty(), "a live window yields a non-empty tree");
		assert!(snap.captured_at > 0.0);
		// 索引稠密:先序编号无空洞。
		for (position, rec) in snap.elements.iter().enumerate() {
			assert_eq!(rec.index as usize, position, "indices are dense pre-order");
		}
	}

	/// 冒烟:寻址重走对刚产出的快照逐索引可解析(编号权威的一致性)。
	#[test]
	#[ignore = "needs a desktop session with accessibility granted"]
	fn resolve_element_round_trip_smoke() {
		let apps = crate::apps::list_apps();
		let Some(calc) = apps.into_iter().find(|app| app.bundle_id == "com.apple.calculator") else {
			eprintln!("calculator not running; open it first");
			return;
		};
		let snap = build_snapshot(&calc, &SnapshotRequest::default()).expect("walk succeeds");
		let target = snap.elements.last().expect("non-empty tree").clone();
		let (element, found) = resolve_element(&calc, &target).expect("addressing re-walk resolves");
		assert_eq!(found.index, target.index);
		assert_eq!(found.role, target.role, "same node, same classification");
		drop(element);
	}

	/// 冒烟:C API 直写 AXSelectedTextRange 能否真的建立选区。合成鼠标手势
	/// 对应用层全路径无效(postToPid/HID/session tap 实测),属性写是文本
	/// 选区仅存的实现通道 —— 本测试钉住它在本机 macOS 上成立。
	#[test]
	#[ignore = "needs TextEdit with text and accessibility granted"]
	fn ax_selected_text_range_setter_smoke() {
		let apps = crate::apps::list_apps();
		let Some(ted) = apps.into_iter().find(|app| app.bundle_id == "com.apple.TextEdit") else {
			eprintln!("TextEdit not running; open it with a line of text first");
			return;
		};
		let snap = build_snapshot(&ted, &SnapshotRequest::default()).expect("walk succeeds");
		let rec = snap.elements.iter().find(|rec| rec.role == "AXTextArea").expect("a text area").clone();
		let (element, _) = resolve_element(&ted, &rec).expect("addressing resolves the text area");
		let err = ffi::ax_set_range(&element, "AXSelectedTextRange", ffi::CFRange { location: 4, length: 15 });
		assert_eq!(err, ffi::AX_ERR_SUCCESS, "range setter succeeds");
		let selected = ffi::ax_str(&element, "AXSelectedText");
		let range = ffi::ax_range(&element, "AXSelectedTextRange");
		eprintln!("selected=[{selected}] range={range:?}");
		assert_eq!(
			range,
			Some(ffi::CFRange { location: 4, length: 15 }),
			"AX character range is live (not UTF-8 byte length)"
		);
		assert_eq!(selected.chars().count(), 15, "selection of the requested length is live");
		// 坐标系对拍:AXBoundsForRange 的矩形须与元素 AXPosition/AXSize
		//(屏幕)相交 —— point_to_index 的点来自屏幕,矩形若在本地区则全错。
		let (fx, fy, fw, fh) = ffi::ax_frame(&element).expect("text area has a frame");
		for &(loc, len) in &[(0, 1), (0, 5), (10, 1)] {
			let bounds = ffi::ax_bounds_for_range(&element, loc, len).expect("range has a rect");
			let overlaps = bounds.origin.x < fx + fw
				&& bounds.origin.x + bounds.size.width > fx
				&& bounds.origin.y < fy + fh
				&& bounds.origin.y + bounds.size.height > fy;
			assert!(overlaps, "bounds({loc},+{len})={bounds:?} should overlap frame ({fx}, {fy}, {fw}, {fh})");
		}
	}
}
