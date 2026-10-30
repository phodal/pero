//! macOS driver:backend trait 的完整实现。REF `macos_driver.py` 的移植。
//!
//! 契约(trait 文档全量):每方法**永不 panic、永不 Err**,一切失败折成
//! `DriverResult { ok: false, text }`(不带 `Error: ` 前缀 —— dispatch 层
//! 恰好加一次);元素句柄跨调用**不缓存**,每次动作重走(snapshot::
//! resolve_element 用与快照同一个编号权威 + `_same_identity` 身份核验);
//! `ElementRec.secure` 从 role+subrole 双属性置位(snapshot::is_secure)。
//!
//! 动词分两组:
//!
//! * **观测**(list/resolve/snapshot)不碰输入,失败即读数失败;
//! * **动作**(click/drag/type_text/press_key/set_value/scroll/
//!   perform_action/launch)向活的应用投输入。四条点击路径、键盘的聚焦
//!   纪律、滚轮的行换算 —— 各自的安全论证见各方法文档。
//!
//! 双层兜底:service 的 `dispatch_with` 在 chokepoint 顶层 catch_unwind 一
//! 层,本模块每方法 [`guarded`] 再一层(REF `_guarded` 的对位)—— panic
//! 折成模型可读的拒绝,且文案不携带内部路径。

use std::panic::{AssertUnwindSafe, catch_unwind};

use point_computer_backend::backend::{ComputerUseBackend, LaunchPermit};
use point_computer_backend::launch::{LaunchAdapter, run_launch_default};
use point_computer_core::cursor_motion;
use point_computer_core::keymap;
use point_computer_core::types::{
	AX_MENU_LADDER, AX_PRESS_ACTION, AX_PRESS_LADDER, AX_VALUE, AppRef, BackendStatus, ClickMethod, ClickRequest,
	DEFAULT_DRAG_STEPS, DragPath, DragRequest, DriverResult, ERR_ACTION_FAILED, ERR_POINT_NOT_OWNED,
	ERR_POINT_REQUIRED, ERR_UNKNOWN_CLICK_METHOD, ElementRec, MAX_ANCESTOR_AREA_RATIO, MAX_ANCESTOR_PRESS_HOPS,
	MouseButton, PLATFORM_MACOS, PermissionProbe, REFUSAL_ACCESSIBILITY_NEEDS_INDEX, ScrollDirection, SnapshotRequest,
	fill,
};

#[cfg(test)]
use point_computer_core::types::Frame;

use crate::{apps, capture, ffi, launch, permissions, skylight, snapshot};

/// 元素聚焦属性(REF `AX_FOCUSED`)。type_text/press_key 先把它置真 —— 键
/// 必须落进点名的元素,而非应用此刻恰好聚焦的任何东西。
const AX_FOCUSED: &str = "AXFocused";

/// 文本选区属性。drag 的 accessibility 形态直写它。
const AX_SELECTED_TEXT_RANGE: &str = "AXSelectedTextRange";

const REASON_TEXT_DRAG_LEFT_ONLY: &str =
	"accessibility drag selects text and only exists for the left button; use mouse_button=left (the default)";
const REASON_TEXT_DRAG_STRAIGHT_ONLY: &str =
	"accessibility drag selects a character range; a curved path has no text meaning";
const REASON_TEXT_DRAG_NO_TEXT: &str =
	"the from-point is not on a writable text element of the target app; the accessibility drag form selects text only";
const REASON_TEXT_DRAG_OFF_TEXT: &str =
	"the {which} point does not fall on any character of the text; drag inside the rendered text";
/// app_post 拖拽的矩形核验失败:目标窗口已不在屏上(或换了主人)。与
/// [`REASON_SKY_WINDOW_GONE`] 同构 —— 模型必须重快照拿活的 window_id。
const REASON_DRAG_WINDOW_GONE: &str = "the target window is no longer on screen (or no longer belongs to that app), so its rectangle cannot be checked for the drag. Call computer_get_state again";
/// app_post 拖拽的端点诚实性拒绝:端点不在该 pid 任一在屏窗口矩形内。
const REASON_DRAG_OFF_WINDOW: &str = "refusing the drag: endpoint ({x}, {y}) is outside any on-screen window of '{app}', so the gesture cannot act on '{app}'. Drag between points inside its windows";

const REASON_UNSUPPORTED_TARGET: &str = "element advertises no {action} action and none succeeded";
const REASON_NO_ELEMENT: &str = "element {index} is no longer present in '{app}'";
const REASON_AX_ERROR: &str = "accessibility error {code}";
/// 键盘输入的聚焦失败。刻意 ACTIONABLE(它点出修法),因为另一条路 ——
/// 敲进应用恰好聚焦的东西 —— 正是让一键到达 `policy.check_input_target`
/// 刚拒绝过的密码框的方式。
const REASON_FOCUS_FAILED: &str = "could not focus element {index} of '{app}' (accessibility error {code}), so the keystrokes were NOT sent — they would have gone to whatever that app currently has focused, which is not the target you named. Call computer_get_state again and address a focusable control, or click it first";
/// sky_click 按窗口 id 路由,窗口消失与元素消失是不同的失败:模型必须重
/// 快照拿活的 id,说出来才拦得住它重试同一个死 id。
const REASON_SKY_WINDOW_GONE: &str = "the target window is no longer on screen (or no longer belongs to that app), so click_method 'sky_click' has no window to address. Call computer_get_state again";
/// 滚轮事件的最小页数:滚轮 delta 是整数,小数页请求**向上**取整到至少一
/// 页 —— 要滚却被答「好了」而实际没动,比多滚零点几页糟。
const MIN_WHEEL_PAGES: i64 = 1;

/// macOS 的 computer-use driver。
///
/// 无状态:一切 CF 引用的生命周期都住在单次方法调用内(元素句柄跨调用
/// 不缓存是安全属性,不是省事 —— 缓存的句柄指向的可能已是被复用的另一
/// 个 UI 对象)。`Send + Sync` 由构造保证:没有可变字段。
#[derive(Debug, Default)]
pub struct MacOsBackend;

impl MacOsBackend {
	pub fn new() -> Self {
		Self
	}

	/// snapshot 走查 + 按需捕获,折成 DriverResult。
	fn snapshot_result(app: &AppRef, req: SnapshotRequest) -> DriverResult {
		match snapshot::build_snapshot(app, &req) {
			Ok(snap) => {
				// want_image 置位才捕;capture 内部另有三重抑制(secure/
				// 截断/window_id),那里的注释解释为何「要了也可能没有」。
				let snap = if req.want_image {
					capture::attach_image(snap, req.image_max_px, req.image_quality)
				} else {
					snap
				};
				DriverResult { ok: true, text: String::new(), apps: Vec::new(), app: None, snapshot: Some(snap) }
			}
			Err(err) => DriverResult::refuse(err.to_string()),
		}
	}

	/// 四路 click 分派(REF `click` 的 `run()`)。
	fn click_inner(&self, app: &AppRef, rec: Option<&ElementRec>, req: ClickRequest) -> DriverResult {
		// *req.method* 在此已是具体方法 —— auto 在 dispatch chokepoint 解析
		//(`policy::resolve_click_method`),本方法永不自选,尤其永不自行
		// 选中会移动指针的那条。不认识的方法**拒绝**而非回退到
		// accessibility:回退会静默做出与调用方所求不同的手势。
		if req.method == ClickMethod::Accessibility {
			return Self::click_accessibility(app, rec, req.button);
		}
		let Some(point) = req.point else {
			return DriverResult::refuse(fill(ERR_POINT_REQUIRED, &[("{method}", req.method.as_str())]));
		};
		let (x, y) = point;
		match req.method {
			ClickMethod::AppPost => {
				// 应用限定:目标应用看到对该点的点击,操作者的物理光标
				// **不动**。
				ffi::post_mouse_click(app.pid, x, y, req.button, req.count);
				ok_for_app(click_text(&req, app), app)
			}
			ClickMethod::SkyClick => {
				// 私有后台窗口路径。只在模型**点名**时可达(auto 永不解析
				// 到这),实现整体圈禁在 skylight 模块。
				//
				// 没有 `pid_owns_point` 检查,且这是对的而非疏漏:这条路径
				// 把目标 pid 与窗口 id 写进事件本身,窗口服务器无论上面盖
				// 着什么都会路由到那只窗口。global 需要的限制 ——「像素必须
				// 属于获批应用」—— 存在是因为全局事件没有 pid 可路由;这
				// 里路由**就是**限制,`policy.check_app` 已授权这个 pid。
				let Some(bounds) = apps::window_bounds(app.window_id, app.pid) else {
					return DriverResult::refuse(REASON_SKY_WINDOW_GONE);
				};
				// 窗口服务器在这条路径上无视事件里的屏幕坐标,按写进私有
				// window-location 字段的**窗口本地**点路由 —— 屏幕点传两遍
				// 会点偏,恰偏一个窗口原点。两个都发(事件自身位置字段放
				// 屏幕点、私有字段放本地点),因为被观察接受的正是这个形状。
				match skylight::sky_click(
					app.pid,
					app.window_id,
					(x, y),
					(x - bounds.x, y - bounds.y),
					(bounds.w, bounds.h),
					req.count,
					req.button,
				) {
					Ok(()) => ok_for_app(click_text(&req, app), app),
					Err(err) => DriverResult::refuse(err.to_string()),
				}
			}
			ClickMethod::Global => {
				// 唯一移动指针的路径。两道许可已在上游查过;本 driver 不
				// 重新推导、也不放宽它们。
				//
				// 但它**必须**把点击限制在那些许可为之授予的应用上。全局
				// 事件不带 pid、落在拥有该像素的任何东西上 —— 点名一个允许
				// 的应用却把坐标传在一个被拒应用的窗口上(终端、密码管理
				// 器),会以应用 A 过策略检查、点中应用 B。其余每条输入路
				// 径都应用限定,不需要这道检查。
				if !apps::pid_owns_point(app.pid, x, y) {
					return DriverResult::refuse(fill(
						ERR_POINT_NOT_OWNED,
						&[("{app}", &app.name), ("{x}", &format!("{x:.0}")), ("{y}", &format!("{y:.0}"))],
					));
				}
				// 无特权 overlay:失败不挡投递。没有指针位置就不猜弧,只画落点。
				let _ = point_computer_overlay::decorate_global_click(None, (x, y));
				ffi::post_mouse_global(x, y, req.button, req.count);
				ok_for_app(click_text(&req, app), app)
			}
			// auto 已在 chokepoint 解析;类型上仍可能出现,按未知方法拒绝
			// 而非自作主张(见函数头)。
			ClickMethod::Auto | ClickMethod::Accessibility => {
				DriverResult::refuse(fill(ERR_UNKNOWN_CLICK_METHOD, &[("{method}", req.method.as_str())]))
			}
		}
	}

	/// 经无障碍激活寻址元素 —— 完全不碰指针(REF `_click_accessibility`)。
	///
	/// 试**一整条动作阶梯**而非只 `AXPress`。单次 press 是 driver 里最大的
	/// 可避免拒绝源:`AXPress` 在折叠三角、Finder 行与许多网页控件上返回
	/// `-25206`(动作不支持),而它们全都应答 `AXConfirm` 或 `AXOpen` ——
	/// 于是模型被告知「点击失败」,对象其实完全可点,它剩下的唯一动作只
	/// 有猜坐标。
	///
	/// 右键走另一条阶梯(仅 `AXShowMenu`)且**永不**回退到 press:把「打
	/// 开上下文菜单」悄悄变成「激活控件」会做出与模型所求不同的动作 ——
	/// 与 `keymap::parse_key` 拒绝未知修饰键是同一类缺陷。
	///
	/// 取胜的动作**写进结果**:看到 `AXOpen` 的模型学会了这个元素应答什
	/// 么,而非下一回合重新推导。
	fn click_accessibility(app: &AppRef, rec: Option<&ElementRec>, button: MouseButton) -> DriverResult {
		let Some(rec) = rec else {
			return DriverResult::refuse(REFUSAL_ACCESSIBILITY_NEEDS_INDEX);
		};
		let ladder: &[&str] = if button == MouseButton::Right { AX_MENU_LADDER } else { AX_PRESS_LADDER };
		let Some((element, _)) = addressed(app, rec) else {
			return missing_element(app, rec);
		};
		// *advertised* 是元素**自称**支持的动作。优于盲试(不支持的动作
		// 免一次往返),但宣告过的动作仍可能失败 —— 定成败的是结果码,
		// 不是宣告。
		let advertised: Vec<&str> = rec.actions.iter().map(String::as_str).collect();
		let mut last_action = ladder[0];
		let mut last_err = ffi::AX_ERR_ACTION_UNSUPPORTED;
		let mut real_failure = false;
		for action in ladder {
			if !advertised.is_empty() && !advertised.contains(action) {
				continue;
			}
			let err = ffi::ax_perform(&element, action);
			if err == ffi::AX_ERR_SUCCESS {
				return ok_for_app(pressed_text(rec.index, action), app);
			}
			(last_action, last_err) = (action, err);
			if err != ffi::AX_ERR_ACTION_UNSUPPORTED {
				// 真实失败(卡死的应用、已销毁的控件),不是「动词不对」
				// —— 换下一个动词会把原因报错。
				real_failure = true;
				break;
			}
		}
		// 阶梯里没有任何一个在宣告列表里:仍然盲试首选动词。宣告在网页
		// 内容上不可靠 —— 一个节点可以执行它从未列出的 press。
		if !real_failure && !ladder.iter().any(|action| advertised.contains(action)) {
			last_action = ladder[0];
			last_err = ffi::ax_perform(&element, ladder[0]);
			if last_err == ffi::AX_ERR_SUCCESS {
				return ok_for_app(pressed_text(rec.index, last_action), app);
			}
		}
		// 最后一档:元素本身不可按,那就试在视觉上**就是**它的容器。网页
		// 把可点行渲染成包在可按祖先里的纯文本节点 —— 整行对元素点击是
		// 死的,对它上面坐标点击却好好的,而坐标正是这条路径要避免的东
		// 西。仅左键、且元素带 frame 可比时才走(无几何就无法区分行与页
		// 面,按页面会激活模型从未寻址的东西);两条界线的论证见
		// [`ancestor_press`]。
		if button != MouseButton::Right
			&& (last_err == ffi::AX_ERR_ACTION_UNSUPPORTED || last_err == ffi::AX_ERR_ATTRIBUTE_UNSUPPORTED)
			&& ancestor_press(&element, rec)
		{
			return ok_for_app(ancestor_pressed_text(rec.index), app);
		}
		action_failed(app, rec, last_action, last_err)
	}

	/// 拖拽(REF `drag` 的 `run()`)。
	fn drag_inner(&self, app: &AppRef, req: DragRequest) -> DriverResult {
		// auto 必须在此命中测试:chokepoint 没有 AX。文本落点走 accessibility;
		// 其余保持 app_post。auto 永不解析到 global。
		let method = match req.method {
			ClickMethod::Auto if Self::drag_hits_own_text(app, req.start) => ClickMethod::Accessibility,
			ClickMethod::Auto => ClickMethod::AppPost,
			other => other,
		};
		if method == ClickMethod::Accessibility {
			return Self::drag_text_selection(app, req);
		}
		// FFI 自己的内插是**下限**,调用方的路径只在更密时才替代它。
		// macOS 合成 `DRAG_STEPS` 个中间 MouseDragged 事件,点数比那少的
		// 路径不是细化,是让手势不再被认成拖拽的降级。`max` 而非「调用
		// 方是否要了形状」的布尔:问题是调用方的路径是否至少与平台自家
		// 的一样密,只有 steps 回答它。
		let steps = req.steps.max(ffi::DRAG_STEPS);
		let shaped = steps > DEFAULT_DRAG_STEPS || req.path != DragPath::Straight;
		let points = shaped.then(|| cursor_motion::drag_points(req.start, req.end, steps, req.path));
		match method {
			ClickMethod::Global => {
				// **每一个**点,不止端点。拖拽还是直线弦时两个授权端点
				// 足够 —— 一矩形内两点的线段留在矩形内 —— 但 `curved`
				// 路径从弦上**弓出**最多 110px,贴边的笔画可以按着键划过
				// 旁边应用的窗口上。默认请求没有路径,两个端点就是整
				// 个手势。
				let endpoints = [req.start, req.end];
				let chord: &[(f64, f64)] = points.as_deref().unwrap_or(endpoints.as_slice());
				for &(x, y) in chord {
					if !apps::pid_owns_point(app.pid, x, y) {
						return DriverResult::refuse(fill(
							ERR_POINT_NOT_OWNED,
							&[("{app}", &app.name), ("{x}", &format!("{x:.0}")), ("{y}", &format!("{y:.0}"))],
						));
					}
				}
				let _ = point_computer_overlay::decorate_global_drag(chord, 200);
				ffi::post_mouse_drag_global(req.start, req.end, req.button, points.as_deref());
			}
			ClickMethod::AppPost => {
				// 投递给 pid,与像素无关。端点须落在该 pid 任意在屏窗口矩形
				// 内 —— 第二扇窗/sheet 合法;被遮挡不误拒。
				for (x, y) in [req.start, req.end] {
					match apps::pid_window_contains(app.pid, x, y) {
						None => return DriverResult::refuse(REASON_DRAG_WINDOW_GONE),
						Some(false) => {
							return DriverResult::refuse(fill(
								REASON_DRAG_OFF_WINDOW,
								&[("{x}", &format!("{x:.0}")), ("{y}", &format!("{y:.0}")), ("{app}", &app.name)],
							));
						}
						Some(true) => {}
					}
				}
				ffi::post_mouse_drag(app.pid, req.start, req.end, req.button, points.as_deref());
			}
			// accessibility 已在上方分支处理;sky_click 没有拖拽形态 ——
			// 不可用的方法**拒绝**而非近似。
			_ => return DriverResult::refuse(fill(ERR_UNKNOWN_CLICK_METHOD, &[("{method}", method.as_str())])),
		}
		ok_for_app(
			format!(
				"dragged with the {} button from ({:.0}, {:.0}) to ({:.0}, {:.0}) in '{}' ({})",
				req.button.as_str(),
				req.start.0,
				req.start.1,
				req.end.0,
				req.end.1,
				app.name,
				method.as_str(),
			),
			app,
		)
	}

	/// from 点是否命中属于 *app.pid* 且可写 `AXSelectedTextRange` 的元素
	///(含可写祖先)。pid 校验承重:全局命中不挑进程。
	fn drag_hits_own_text(app: &AppRef, point: (f64, f64)) -> bool {
		Self::drag_text_element(app, point).is_some()
	}

	/// 命中点下属于 *app.pid* 且可写选区的元素。最深节点常是不可写的
	/// `AXStaticText`,可写祖先才是属性所在 —— 跳数同 [`ancestor_press`]。
	fn drag_text_element(app: &AppRef, point: (f64, f64)) -> Option<ffi::CfRef> {
		let hit = ffi::ax_element_at_point(point.0, point.1)?;
		if ffi::ax_pid(&hit) != Some(app.pid) {
			return None;
		}
		let mut current = hit;
		if ffi::ax_is_settable(&current, AX_SELECTED_TEXT_RANGE) {
			return Some(current);
		}
		for _ in 0..MAX_ANCESTOR_PRESS_HOPS {
			let parent = ffi::ax_parent(&current)?;
			ffi::ax_set_messaging_timeout(&parent);
			if ffi::ax_pid(&parent) != Some(app.pid) {
				return None;
			}
			current = parent;
			if ffi::ax_is_settable(&current, AX_SELECTED_TEXT_RANGE) {
				return Some(current);
			}
		}
		None
	}

	/// 文本选择的 accessibility 形态:两点 → 字符索引(`AXBoundsForRange`
	/// 二分)→ 直写 `AXSelectedTextRange`。System Events 的 AppleScript 桥
	/// 接对本属性静默无效,C API 直调有效(冒烟
	/// `ax_selected_text_range_setter_smoke` 钉住)。
	fn drag_text_selection(app: &AppRef, req: DragRequest) -> DriverResult {
		if req.button != MouseButton::Left {
			return DriverResult::refuse(REASON_TEXT_DRAG_LEFT_ONLY);
		}
		if req.path != DragPath::Straight {
			return DriverResult::refuse(REASON_TEXT_DRAG_STRAIGHT_ONLY);
		}
		let Some(element) = Self::drag_text_element(app, req.start) else {
			return DriverResult::refuse(REASON_TEXT_DRAG_NO_TEXT);
		};
		let Some(count) = text_length(&element) else {
			return DriverResult::refuse(REASON_TEXT_DRAG_NO_TEXT);
		};
		let mut char_bounds = |location: isize| {
			ffi::ax_bounds_for_range(&element, location, 1)
				.map(|rect| (rect.origin.x, rect.origin.y, rect.size.width, rect.size.height))
		};
		let Some(from) = point_to_index(count, req.start.0, req.start.1, &mut char_bounds) else {
			return DriverResult::refuse(fill(REASON_TEXT_DRAG_OFF_TEXT, &[("{which}", "from")]));
		};
		let Some(to) = point_to_index(count, req.end.0, req.end.1, &mut char_bounds) else {
			return DriverResult::refuse(fill(REASON_TEXT_DRAG_OFF_TEXT, &[("{which}", "to")]));
		};
		let (lo, hi) = (from.min(to), from.max(to));
		let written =
			ffi::ax_set_range(&element, AX_SELECTED_TEXT_RANGE, ffi::CFRange { location: lo, length: hi - lo + 1 });
		if written != ffi::AX_ERR_SUCCESS {
			return DriverResult::refuse(format!("AXSelectedTextRange write failed with AX error {written}"));
		}
		ok_for_app(
			format!("selected characters {}..{} ({} chars) in '{}' (accessibility)", lo, hi + 1, hi - lo + 1, app.name),
			app,
		)
	}
}

impl ComputerUseBackend for MacOsBackend {
	fn platform_id(&self) -> &'static str {
		PLATFORM_MACOS
	}

	fn status(&self) -> BackendStatus {
		BackendStatus { supported: true, platform_id: PLATFORM_MACOS.to_string(), reason: String::new() }
	}

	fn probe_permissions(&self) -> PermissionProbe {
		// 建议性,永不设门(见 permissions 模块文档)。
		permissions::probe()
	}

	fn list_apps(&self) -> DriverResult {
		guarded("list_apps", || DriverResult::apps(apps::list_apps()))
	}

	fn resolve_app(&self, query: &str) -> DriverResult {
		guarded("resolve_app", || match apps::resolve_app(query) {
			Ok(app) => DriverResult { ok: true, text: String::new(), apps: Vec::new(), app: Some(app), snapshot: None },
			Err(err) => DriverResult::refuse(err.to_string()),
		})
	}

	fn launch_app(&self, query: &str, permit: LaunchPermit<'_>) -> DriverResult {
		guarded("launch_app", || {
			// 平台注入齐装:目录解析(含四层可写性验证)、按应用自身名
			// 字找已运行窗口、`/usr/bin/open -a <路径>`、Info.plist 的
			// bundle id 作启动标识。流程本体(已运行拒绝/窗口轮询/复查)
			// 在缝隙层写一次,两个平台复用。
			let adapter = LaunchAdapter {
				resolve: &launch::resolve_target,
				find: &running_app,
				spawn: &launch::spawn_detached,
				identity: Some(&launch::target_identity),
			};
			run_launch_default(&adapter, permit, query)
		})
	}

	fn snapshot(&self, app: &AppRef, req: SnapshotRequest) -> DriverResult {
		guarded("snapshot", || Self::snapshot_result(app, req))
	}

	fn click(&self, app: &AppRef, rec: Option<&ElementRec>, req: ClickRequest) -> DriverResult {
		guarded("click", || self.click_inner(app, rec, req))
	}

	fn drag(&self, app: &AppRef, req: DragRequest) -> DriverResult {
		guarded("drag", || self.drag_inner(app, req))
	}

	fn type_text(&self, app: &AppRef, rec: Option<&ElementRec>, text: &str) -> DriverResult {
		guarded("type_text", || {
			if let Some(rec) = rec {
				let Some((element, _)) = addressed(app, rec) else {
					return missing_element(app, rec);
				};
				// 先聚焦寻址元素,键才落在模型瞄准的地方,而非目标应用上
				// 一次恰好聚焦的地方。
				let focus_err = ffi::ax_set_true(&element, AX_FOCUSED);
				// 聚焦失败**拒绝** —— 不落到应用限定输入。
				// `policy.check_input_target` 检查的是模型**寻址**的元素
				//(`ElementRec.secure` 正来自它);聚焦没移动时,
				// `post_text` 投给应用既有聚焦 —— 那可以是检查刚拒绝写入
				// 的密码框。瞄不准还盲打,是「尽力而为」击穿 secure 字段
				// 底线的唯一情形。
				if focus_err != ffi::AX_ERR_SUCCESS {
					return focus_failed(app, rec, focus_err);
				}
			}
			// Unicode 键事件而非逐字符查键码:与布局无关,且能发出 US 布
			// 局一键够不到的字符(REF 验证往返逐字节一致)。
			ffi::post_text(app.pid, text);
			let target = match rec {
				Some(rec) => format!("element {}", rec.index),
				None => "the focused element".to_string(),
			};
			ok_for_app(format!("typed {} character(s) into {target}", text.chars().count()), app)
		})
	}

	fn press_key(&self, app: &AppRef, rec: Option<&ElementRec>, key: &str) -> DriverResult {
		guarded("press_key", || {
			// `parse_key` 对未知键/修饰键报 KeyParse —— 响亮地拒绝是对的:
			// 静默丢掉一个不认识的修饰键,会把一次**不同的**击键送进活的
			// 应用。
			let (keycode, flags) = match keymap::parse_key(key) {
				Ok(parsed) => parsed,
				Err(err) => return DriverResult::refuse(err.to_string()),
			};
			if let Some(rec) = rec {
				let Some((element, _)) = addressed(app, rec) else {
					return missing_element(app, rec);
				};
				let focus_err = ffi::ax_set_true(&element, AX_FOCUSED);
				// 同一个洞,同一个修法,另一个键盘动词 —— 送到模型未寻址
				// 的聚焦上的一键,可以到达策略检查刚把我们挪开的 secure
				// 字段。
				if focus_err != ffi::AX_ERR_SUCCESS {
					return focus_failed(app, rec, focus_err);
				}
			}
			ffi::post_key(app.pid, keycode, flags);
			ok_for_app(format!("sent {key}"), app)
		})
	}

	fn set_value(&self, app: &AppRef, rec: &ElementRec, value: &str) -> DriverResult {
		guarded("set_value", || {
			let Some((element, _)) = addressed(app, rec) else {
				return missing_element(app, rec);
			};
			let err = ffi::ax_set_str(&element, AX_VALUE, value);
			if err != ffi::AX_ERR_SUCCESS {
				return action_failed(app, rec, &format!("set {AX_VALUE}"), err);
			}
			ok_for_app(format!("set element {}", rec.index), app)
		})
	}

	fn scroll(&self, app: &AppRef, rec: &ElementRec, direction: ScrollDirection, pages: f64) -> DriverResult {
		guarded("scroll", || {
			let action = scroll_action(direction);
			let whole_pages = (pages.round() as i64).max(MIN_WHEEL_PAGES);
			let Some((element, _)) = addressed(app, rec) else {
				return missing_element(app, rec);
			};
			// 先试 AX 动作 —— 它按元素限定。但**永不**信宣告列表:实测
			// 真 AXScrollArea 列了 `AXScrollDownByPage`、被要求执行时却答
			// -25206。宣告列表连查都不查,直接试、看结果。
			let mut err = ffi::AX_ERR_SUCCESS;
			for _ in 0..whole_pages {
				err = ffi::ax_perform(&element, action);
				if err != ffi::AX_ERR_SUCCESS {
					break;
				}
			}
			if err == ffi::AX_ERR_SUCCESS {
				return ok_for_app(
					format!("scrolled element {} {} {} page(s)", rec.index, direction.as_str(), whole_pages),
					app,
				);
			}
			// 回退到合成滚轮事件,以私有事件源投给目标 pid。滚轮事件是
			// **行**单位(`CGScrollEventUnit` 只有 Pixel 与 Line,没有页)
			// —— 请求的页要折成行数。把页数原样发只滚一行、却报「滚了 1
			// 页」,正是让 agent 打转的静默 no-op。
			// (deltas 的符号:macOS 滚轮 delta 与阅读方向相反 —— 负的
			// axis-1 把内容向下滚,即「把轮子推离自己」的手势。)
			let (delta_y, delta_x) = scroll_deltas(direction);
			let lines = whole_pages * i64::from(ffi::CG_SCROLL_LINES_PER_PAGE);
			ffi::post_scroll(app.pid, (delta_y * lines) as i32, (delta_x * lines) as i32);
			ok_for_app(
				format!(
					"scrolled '{}' {} {} page(s) with a wheel event (the accessibility action was refused with error {err})",
					app.name,
					direction.as_str(),
					whole_pages
				),
				app,
			)
		})
	}

	fn perform_action(&self, app: &AppRef, rec: &ElementRec, action: &str) -> DriverResult {
		guarded("perform_action", || {
			let Some((element, _)) = addressed(app, rec) else {
				return missing_element(app, rec);
			};
			let err = ffi::ax_perform(&element, action);
			if err != ffi::AX_ERR_SUCCESS {
				return action_failed(app, rec, action, err);
			}
			ok_for_app(format!("performed {action} on element {}", rec.index), app)
		})
	}

	fn close(&self) {
		// 无可释放的进程级资源;身份缓存是纯优化,留给 TTL。
	}
}

// ── prose 与寻址助手(REF 模块级函数) ──

/// 每方法兜底(REF `_guarded`):panic 折成模型可读的拒绝。
///
/// `ComputerUseError` 的等价物在各 inner 里显式 `to_string()` 透传(不带
/// `Error: ` 前缀 —— dispatch 层恰好加一次);这里兜的是 panic。意外异常
/// 的字符串可携带内部路径,模型从 stack 形状的消息里得不到任何好处 ——
/// 泛化上报。ctypes 式的 SEGFAULT 当然不可捕获;`ffi.rs` 的签名纪律与
/// 先读 count 的数组读取防的就是它,这里处理的是**可表达**的失败。
fn guarded(label: &str, run: impl FnOnce() -> DriverResult) -> DriverResult {
	match catch_unwind(AssertUnwindSafe(run)) {
		Ok(result) => result,
		Err(payload) => DriverResult::refuse(format!("{label} failed unexpectedly ({})", panic_message(payload))),
	}
}

/// panic payload 的人话形态(仅用于上面的泛化拒绝;不带内部路径)。
///
/// 按 value 收 `Box<dyn Any + Send>` 并用 Box 自身的 `downcast_ref` —— 它
/// 转发到内部 dyn。曾写成 `&(dyn Any + Send)` 参数:调用处的
/// `&Box<dyn…>` 会按 unsize 路径 coerce 成「装着 Box 的 dyn」(Box 自身满
/// 足 Any+Send),虚分派的 TypeId 变成 Box 的,两个 downcast 全 None、恒答
/// "panic" —— 一个只在真机上现形的静默 no-op,这里钉住不重蹈。
fn panic_message(payload: Box<dyn std::any::Any + Send>) -> String {
	if let Some(text) = payload.downcast_ref::<&str>() {
		(*text).to_string()
	} else if let Some(text) = payload.downcast_ref::<String>() {
		text.clone()
	} else {
		"panic".to_string()
	}
}

/// `ok: true` + 文案 + 一只 [`AppRef`](各动作结果都带回应用)。
fn ok_for_app(text: impl Into<String>, app: &AppRef) -> DriverResult {
	DriverResult { ok: true, text: text.into(), apps: Vec::new(), app: Some(app.clone()), snapshot: None }
}

/// 寻址 `rec.index` 处的活元素 + 身份核验;解析不出或身份已变 → `None`。
///
/// 每次调用重解析而非跨工具调用缓存句柄:存下的 `AXUIElement` 可以指向目
/// 标应用此后销毁的控件,对它执行动作是另一个进程地址空间里的
/// use-after-free,而非一个 Rust 错误。CF 引用的簿记由
/// `snapshot::resolve_element` 拥有([`ffi::CfRef`] 携带所有权);本函数只
/// 加身份核验 —— 寻址走查用最宽预算,截断过的原快照编号不保证一致,使
/// 寻址安全的正是身份检查而非索引本身。这也是第二道防线:dispatch
/// chokepoint 已对指纹漂移拒绝在先。
fn addressed(app: &AppRef, rec: &ElementRec) -> Option<(ffi::CfRef, ElementRec)> {
	let (element, found) = snapshot::resolve_element(app, rec)?;
	if same_identity(&found, rec) { Some((element, found)) } else { None }
}

/// 记录仍是模型寻址的那个控件吗?role、subrole、title 三项 —— 刻意**不
/// 含 value**:文本框的 value 随用户打字而变、控件的身份证毫发未动,把它
/// 折进来会拒掉几乎每个正当动作。与 `render::fingerprint` 的字段选择互为
/// 镜像,理由相同,且二者都不读 secure 记录的字节。
fn same_identity(found: &ElementRec, expected: &ElementRec) -> bool {
	found.role == expected.role && found.subrole == expected.subrole && found.title == expected.title
}

/// 按下视觉上**就是** *rec* 所指控件的最近祖先(REF `_ancestor_press`)。
///
/// 点击阶梯的最后一档,救回网页内容的那一档。WebArea 里的可点行常常是包
/// 在可按包装器里的纯 `AXStaticText`:文本节点不宣告任何动作、拒绝每个动
/// 词,元素点击对一报行就失败 —— 而人随手就能点中,模型剩下的唯一动作只
/// 有猜坐标,坐标正是这条路径要避免的东西。
///
/// **两条界线,因为没有它们的版本是错点击发生器。**
///
/// * *有界跳数*(`MAX_ANCESTOR_PRESS_HOPS`):一路走到顶总会找到可按的
///   —— 页面、窗口 —— 然后按下去。
/// * *有界面积*(`MAX_ANCESTOR_AREA_RATIO`):祖先是「同一控件」的真信号
///   是它尺寸相仿。包着文本节点的行是它面积的小倍数;滚动区或页面 body
///   大出数量级。目标自己没有 frame 就没有可比的基准 —— 回退谢绝而非瞎
///   猜。
///
/// 只试 `AXPress`,不试完整阶梯:容器上的 `AXOpen` 可以意味着与激活其中
/// 的行相当不同的东西(打开文件夹 vs 选中文件),而这一档已是启发式 ——
/// 再叠一个只会扩大爆炸半径,没有明确收益。
fn ancestor_press(element: &ffi::CfRef, rec: &ElementRec) -> bool {
	let Some(frame) = rec.frame.as_ref() else { return false };
	let target_area = area((frame.x, frame.y, frame.w, frame.h));
	if target_area <= 0.0 {
		// 零面积目标使比值检验失去意义(一切都「无穷大」),无法给走查
		// 设界。谢绝。
		return false;
	}
	// 引用逐级替换:AXUIElement 引用各自独立保留,上一级释放不使下一级
	// 失效(REF 收集整条链后统一释放,效果相同)。retain 取得 +1 所有权,
	// 每次赋值释放上一级。
	let mut current: ffi::CfRef = element.retain();
	for _ in 0..MAX_ANCESTOR_PRESS_HOPS {
		let Some(parent) = ffi::ax_parent(&current) else { return false };
		current = parent;
		let Some(frame) = ffi::ax_frame(&current) else {
			// 没有几何可判:继续爬而非瞎按。网页内容里没有 frame 的包装
			// 器很常见,它自己的父级多半有。
			continue;
		};
		if area(frame) > target_area * MAX_ANCESTOR_AREA_RATIO {
			// 大到不可能是模型寻址的控件,且再往上的祖先只更大 —— 停,
			// 不再爬。
			return false;
		}
		if ffi::ax_perform(&current, AX_PRESS_ACTION) == ffi::AX_ERR_SUCCESS {
			return true;
		}
	}
	false
}

/// `(x, y, w, h)` 的面积,钳在 0:AX 偶尔对离屏/折叠元素报负的尺寸,而负
/// 面积会比较成「比一切都小」,把祖先界线放行过去。
fn area(frame: (f64, f64, f64, f64)) -> f64 {
	frame.2.max(0.0) * frame.3.max(0.0)
}

/// 点是否落在窗口矩形内(含左上缘、不含右下缘 —— 与 `apps::owns_point`
/// 同界约定)。
#[cfg(test)]
fn frame_contains(frame: &Frame, x: f64, y: f64) -> bool {
	x >= frame.x && x < frame.x + frame.w && y >= frame.y && y < frame.y + frame.h
}

/// 元素的字符数(`AXNumberOfCharacters`)。
fn text_length(element: &ffi::CfRef) -> Option<isize> {
	ffi::ax_attr(element, "AXNumberOfCharacters")
		.ok()
		.flatten()
		.and_then(|value| ffi::cf_number_int(value.as_ptr()).map(i64::from).map(|count| count as isize))
}

/// 点 → 字符索引。*char_bounds* 给出单字符矩形(注入以便离线单测;线上
/// 是 `AXBoundsForRange(i, 1)`)。
///
/// 三段二分,全部依赖文档序的单调性:字符的行顶 y 不减(找行),行内
/// LTR 文本的左缘 x 不减(找列)。行顶同值判定带 0.5px 容差 —— 同行字符
/// 的 y 理论相等,实测见亚像素抖动。点落在行首左/行尾右/末行下方的空白:
/// 夹到该行边界(「拖过头」选到文末)。行间 leading 落在上一行(最大
/// `top <= py`)。RTL 文本行内 x 单调性不成立,首版以 LTR 为限 —— 夹边
/// 行为对 RTL 最多选错行内位置,不会失控。
fn point_to_index(
	count: isize,
	px: f64,
	py: f64,
	char_bounds: &mut dyn FnMut(isize) -> Option<(f64, f64, f64, f64)>,
) -> Option<isize> {
	if count <= 0 {
		return None;
	}
	// 行定位:行顶 y 不减 → 二分最大的 i 使 top(i) <= py。
	let (mut lo, mut hi) = (0isize, count - 1);
	while lo < hi {
		let mid = (lo + hi + 1) / 2;
		if char_bounds(mid)?.1 <= py {
			lo = mid;
		} else {
			hi = mid - 1;
		}
	}
	let (_, row_top, _, _) = char_bounds(lo)?;
	// 行边界:y_top 与 row_top 同值(±0.5)的连续段 [row_lo, row_hi]。
	// 末行下方 / 行间 leading:夹到最大 top<=py 的那一行,不拒。
	let same_row = |top: f64| (top - row_top).abs() <= 0.5;
	let (mut a, mut b) = (0isize, lo);
	while a < b {
		let mid = (a + b) / 2;
		if same_row(char_bounds(mid)?.1) {
			b = mid;
		} else {
			a = mid + 1;
		}
	}
	let row_lo = a;
	let (mut a, mut b) = (lo, count - 1);
	while a < b {
		let mid = (a + b + 1) / 2;
		if same_row(char_bounds(mid)?.1) {
			a = mid;
		} else {
			b = mid - 1;
		}
	}
	let row_hi = a;
	// 行内定位:左缘 x 不减(LTR)→ 二分最大的 c 使 left(c) <= px。
	let (mut a, mut b) = (row_lo, row_hi);
	while a < b {
		let mid = (a + b + 1) / 2;
		if char_bounds(mid)?.0 <= px {
			a = mid;
		} else {
			b = mid - 1;
		}
	}
	Some(a)
}

/// launch 的两问用的非抛式应用查找:「已运行了吗」与「出现了吗」。
///
/// 按应用**自身的名字**匹配而非窗口标题:刚启动的窗口标题是它打开的什么
/// 文档(`Untitled`),而目录解析出的是 bundle 名。枚举失败折 `None`:
/// 启动轮询里瞬时失败与「还没出现」无法区分,轮询的超时自会兜底。
fn running_app(name: &str) -> Option<AppRef> {
	let wanted = name.trim().to_lowercase();
	if wanted.is_empty() {
		return None;
	}
	apps::list_apps()
		.into_iter()
		.find(|app| wanted == app.name.to_lowercase() || wanted == app.bundle_id.to_lowercase())
}

/// 每个滚动方向先试的 AX 动作(元素限定),再回退合成滚轮。
fn scroll_action(direction: ScrollDirection) -> &'static str {
	match direction {
		ScrollDirection::Up => "AXScrollUpByPage",
		ScrollDirection::Down => "AXScrollDownByPage",
		ScrollDirection::Left => "AXScrollLeftByPage",
		ScrollDirection::Right => "AXScrollRightByPage",
	}
}

/// 每方向的滚轮 delta( `(axis1, axis2)`;符号见 [`MacOsBackend::scroll`]
/// 的回退段注释)。
fn scroll_deltas(direction: ScrollDirection) -> (i64, i64) {
	match direction {
		ScrollDirection::Up => (1, 0),
		ScrollDirection::Down => (-1, 0),
		ScrollDirection::Left => (0, 1),
		ScrollDirection::Right => (0, -1),
	}
}

/// 元素点击的结果文案 —— **点名**取胜的动作(REF `_pressed_text`)。
///
/// 动词写进去,需要过 `AXOpen` 的模型从结果里学到它,而非在同类下一个元
/// 素上重新发现阶梯。
fn pressed_text(index: u32, action: &str) -> String {
	let verb = if action == AX_PRESS_ACTION { "pressed" } else { "activated via {action}" };
	fill(verb, &[("{action}", action)]) + &format!(" element {index}")
}

/// 祖先回退的结果文案 —— **说出**按下的是容器(REF `_ancestor_pressed_text`)。
///
/// 不报成普通的「pressed element N」:模型必须知道 press 落在包裹控件而
/// 非它寻址的节点上 —— 那是「我的点击生效了」与「我点击附近什么生效
/// 了」的差别。可观察结果错了的话,这句话是唯一的线索;没有它,模型会
/// 重试一个已在错误目标上成功的动作。
fn ancestor_pressed_text(index: u32) -> String {
	format!(
		"element {index} could not be activated directly; pressed its enclosing control instead — verify the result is what you intended"
	)
}

/// 坐标点击的确认文案,点名所用方法(REF `_click_text`)。
///
/// 方法写进文案是刻意的:要了 `auto` 的模型需要知道实际跑的是哪条路径
/// —— 那决定后续该重新瞄准(accessibility 的 press 落在控件上)还是重
/// 新测量(坐标点击落在像素上)。它也是操作者在 transcript 里看到 agent
/// 拿走鼠标的那一行。
fn click_text(req: &ClickRequest, app: &AppRef) -> String {
	let (x, y) = req.point.unwrap_or((0.0, 0.0));
	let times = if req.count == 1 { String::new() } else { format!(" x{}", req.count) };
	format!("{} click{times} at ({:.0}, {:.0}) in '{}' ({})", req.button.as_str(), x, y, app.name, req.method.as_str(),)
}

/// 索引解析不出元素的拒绝(REF `_missing_element`;应用点名用 bundle id
/// 优先的拼写)。
fn missing_element(app: &AppRef, rec: &ElementRec) -> DriverResult {
	let app_name = if app.bundle_id.is_empty() { &app.name } else { &app.bundle_id };
	DriverResult::refuse(fill(REASON_NO_ELEMENT, &[("{index}", &rec.index.to_string()), ("{app}", app_name)]))
}

/// 键盘输入聚焦失败的拒绝(REF `_focus_failed`;fail-CLOSED 的论证见
/// type_text 的调用点)。
fn focus_failed(app: &AppRef, rec: &ElementRec, err: ffi::c_int32_t) -> DriverResult {
	let app_name = if app.bundle_id.is_empty() { &app.name } else { &app.bundle_id };
	DriverResult::refuse(fill(
		REASON_FOCUS_FAILED,
		&[("{index}", &rec.index.to_string()), ("{app}", app_name), ("{code}", &err.to_string())],
	))
}

/// AX 动作返回非零码的拒绝(REF `_action_failed`)。
///
/// 带**原始** AX 码:支持论坛里的 `-25205` 立刻可诊断(「元素拒绝了自己
/// 宣告过的动作」),「点击失败」不行。
fn action_failed(app: &AppRef, rec: &ElementRec, action: &str, err: ffi::c_int32_t) -> DriverResult {
	let detail = if err == ffi::AX_ERR_ACTION_UNSUPPORTED {
		fill(REASON_UNSUPPORTED_TARGET, &[("{action}", action)])
	} else {
		fill(REASON_AX_ERROR, &[("{code}", &err.to_string())])
	};
	let app_name = if app.bundle_id.is_empty() { &app.name } else { &app.bundle_id };
	DriverResult::refuse(fill(
		ERR_ACTION_FAILED,
		&[("{action}", action), ("{index}", &rec.index.to_string()), ("{app}", app_name), ("{detail}", &detail)],
	))
}

#[cfg(test)]
mod tests;
