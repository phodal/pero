use super::*;

// ── CoreGraphics:事件合成(REF event_source/post_*) ──

/// 直线拖拽的内插段数;REF `DRAG_STEPS`,对 TextEdit 实测调出 —— 没有中
/// 间 MouseDragged 事件的裸 down/up 对多数应用不是拖拽(画布记下两个孤立
/// 点、文本视图不选任何东西)。
pub const DRAG_STEPS: u16 = 6;
/// 拖拽每步之间的停顿:完全相同的时间戳会让 AppKit 的识别器把整段合并成
/// 一次位移。
pub const DRAG_STEP_DELAY_SECS: f64 = 0.02;
/// click 对内 down/up 之间的停顿,须短于双击间隔,OS 才认出重复。
pub const CLICK_PAIR_DELAY_SECS: f64 = 0.01;

/// 进程级缓存的私有事件源。`Send` 包一层:CF 对象自身线程安全(引用计数
/// 原子),REF 同样以无锁全局共享它;NonNull 默认 !Send 只是 Rust 对裸指针
/// 的一刀切。
struct EventSource(CfRef);
// SAFETY:CGEventSource 是 CoreFoundation 对象;CF 的引用计数与内部锁使
// 跨线程共享合法(与 REF 进程级缓存同义)。
unsafe impl Send for EventSource {}

static EVENT_SOURCE: OnceLock<Option<EventSource>> = OnceLock::new();

/// 缓存的**私有** `CGEventSource`(`kCGEventSourceStatePrivate`),或创建
/// 失败后的 `None`(此后每个投递函数降级为不投 —— 拒绝比半套手势好)。
///
/// 私有源是承重选择,不是偏好:HID 源的事件继承用户**活着的**修饰键状态,
/// 让活体原型敲 `abc` 会得到 `' I Abc'`(用户恰好按着键)。私有源从干净的
/// 修饰状态出发,只有 [`post_key`] 的显式 flags 会填充它。
fn event_source() -> Option<&'static CfRef> {
	EVENT_SOURCE
		.get_or_init(|| {
			// SAFETY:纯 Create 调用;常量为私有源状态 id。
			let source = unsafe { sys::CGEventSourceCreate(K_CG_EVENT_SOURCE_STATE_PRIVATE) };
			// SAFETY:Create-Rule +1。
			let source = unsafe { CfRef::from_created(source as *mut c_void) }?;
			Some(EventSource(source))
		})
		.as_ref()
		.map(|wrapper| &wrapper.0)
}

/// 一个合成键盘事件对(keycode 形态)投给 *pid*。
///
/// 三条规矩,全部实测承重、全部被直觉写法违反(REF 文档):
/// 1. 事件源是私有的([`event_source`]);
/// 2. `CGEventSetFlags` 在**每个**事件上调,**flags 为 0 时也调** —— 那个
///    显式零正是清掉继承修饰状态的东西,「没有修饰键就跳过」会把 bug 请回
///    来;
/// 3. 投递走 `CGEventPostToPid`,永不 `CGEventPost`(后者进全局 tap,即用
///    户此刻真正敲字的窗口 —— 对准后台应用的一击会落进他们的编辑器)。
pub fn post_key(pid: i32, keycode: u8, flags: u64) {
	let Some(source) = event_source() else { return };
	for is_down in [true, false] {
		// SAFETY:source 是本进程持有的合法事件源;keycode 为 u16 宽度内。
		let event = unsafe { sys::CGEventCreateKeyboardEvent(source.as_ptr(), keycode as u16, is_down) };
		// SAFETY:Create-Rule +1。
		let Some(event) = (unsafe { CfRef::from_created(event as *mut c_void) }) else { continue };
		// SAFETY:event 合法;显式 0 与非零 flags 同一条路。
		unsafe {
			sys::CGEventSetFlags(event.as_ptr(), flags);
			sys::CGEventPostToPid(pid, event.as_ptr());
		}
	}
}

/// 把 *text* 作为 Unicode 键盘事件敲进 *pid*。
///
/// 用 `CGEventKeyboardSetUnicodeString` 配 keycode 0,而非逐字符查键码:路
/// 径因此与布局无关,且能发出 US 布局一键够不到的字符(REF 验证
/// `"Hello, KiroCrew! aA$ 123"` 往返逐字节一致)。flags 仍每事件显式置零 ——
/// Unicode 载荷替换的是**击键**,不是修饰键卫生。
///
/// REF 把「编码失败 → 敲了一半才抛」列为事故并前置编码;Rust 的 `String`
/// 本就是有效 UTF-8,**孤代理项在类型上不可表达** —— 那条失败路径结构性消
/// 失,全部字符都编码成功才发出第一个事件。astral 字符经其完整代理对在
/// **一个**事件里送达,而非两个孤立代理。
pub fn post_text(pid: i32, text: &str) {
	let Some(source) = event_source() else { return };
	for character in text.chars() {
		let mut units = [0u16; 2];
		let units = character.encode_utf16(&mut units);
		if units.is_empty() {
			continue;
		}
		for is_down in [true, false] {
			// SAFETY:source 合法;keycode 0 是 Unicode 载荷形态的约定。
			let event = unsafe { sys::CGEventCreateKeyboardEvent(source.as_ptr(), 0, is_down) };
			// SAFETY:Create-Rule +1。
			let Some(event) = (unsafe { CfRef::from_created(event as *mut c_void) }) else { continue };
			// SAFETY:event 合法;units 是 count 个 u16 的栈缓冲,调用期间有效。
			unsafe {
				sys::CGEventSetFlags(event.as_ptr(), 0);
				sys::CGEventKeyboardSetUnicodeString(event.as_ptr(), units.len() as c_long, units.as_ptr());
				sys::CGEventPostToPid(pid, event.as_ptr());
			}
		}
	}
}

/// 一个滚轮事件(行单位)投给 *pid*。
///
/// **绝不用多轴构造器。** `CGEventCreateScrollWheelEvent` 是变参函数,REF 实
/// 测 arm64 上把变参尾编组错:声明五参形态请求 `(axis1=-3, axis2=0)` 得到
/// `axis2=30416` —— 对活窗口的一次任意横滚。所以事件用 `wheelCount=1` 走
/// 固定原型构造,两轴随后都经**非**变参的 `CGEventSetIntegerValueField` 写
/// 入(该字段写法对每个输入实测精确)。
pub fn post_scroll(pid: i32, delta_y: i32, delta_x: i32) {
	let Some(source) = event_source() else { return };
	// SAFETY:固定四参原型(非变参形态);单位=行。
	let event = unsafe { sys::CGEventCreateScrollWheelEvent(source.as_ptr(), K_CG_SCROLL_EVENT_UNIT_LINE, 1, 0) };
	// SAFETY:Create-Rule +1。
	let Some(event) = (unsafe { CfRef::from_created(event as *mut c_void) }) else { return };
	// SAFETY:event 合法;两个字段编号为公开枚举值。
	unsafe {
		sys::CGEventSetIntegerValueField(event.as_ptr(), K_CG_SCROLL_DELTA_AXIS_1, delta_y as c_int64_t);
		sys::CGEventSetIntegerValueField(event.as_ptr(), K_CG_SCROLL_DELTA_AXIS_2, delta_x as c_int64_t);
		sys::CGEventSetFlags(event.as_ptr(), 0);
		sys::CGEventPostToPid(pid, event.as_ptr());
	}
}

/// 构造一个鼠标事件,或 `None`。私有事件源、flags 显式零(理由见
/// [`event_source`]/[`post_key`])。
///
/// *click_state* 仅非零时写:双击是 click-state 为 2 的**一对**,不是两对
/// (AppKit 从该字段读 `NSEvent.clickCount`)。
fn mouse_event(event_type: u32, x: f64, y: f64, button_number: u32, click_state: u32) -> Option<CfRef> {
	let source = event_source()?;
	// SAFETY:source 合法;CGPoint 按值;event_type/button_number 为 u32。
	let event = unsafe { sys::CGEventCreateMouseEvent(source.as_ptr(), event_type, CGPoint { x, y }, button_number) };
	// SAFETY:Create-Rule +1。
	let event = unsafe { CfRef::from_created(event as *mut c_void) }?;
	// SAFETY:event 合法;显式 0 清修饰状态。
	unsafe { sys::CGEventSetFlags(event.as_ptr(), 0) };
	if click_state != 0 {
		// SAFETY:同上;字段为公开的 kCGMouseEventClickState。
		unsafe {
			sys::CGEventSetIntegerValueField(event.as_ptr(), K_CG_MOUSE_EVENT_CLICK_STATE, click_state as c_int64_t)
		};
	}
	Some(event)
}

/// 两个拖拽函数共用的投递计划:down、动效、up。
///
/// 共享一份计划使两条路径在「手势长什么样」上不可能漂移 —— 二者唯一应不同
/// 的是**每个事件投到哪**,写两遍的计划就是会漂的计划。
///
/// *points* 是调用方给的含两端点的整条路径(cursor_motion::drag_points);
/// `None` 时把端点内插成 *steps* 段直线 —— 滑块扫选与范围选择要的形状。端
/// 点取自 *start*/*end* 而非路径自身两端:这两个点是约束检查为按下与释放
/// 授权的点,而释放点决定落点。纯函数,可离线单测。
pub fn drag_plan(
	start: (f64, f64),
	end: (f64, f64),
	down_type: u32,
	up_type: u32,
	dragged_type: u32,
	steps: u16,
	points: Option<&[(f64, f64)]>,
) -> Vec<(u32, f64, f64)> {
	let (x0, y0) = start;
	let (x1, y1) = end;
	let motion: Vec<(f64, f64)> = match points {
		Some(points) if points.len() >= 2 => points[1..points.len() - 1].to_vec(),
		_ => {
			let total = steps.max(1);
			(1..total)
				.map(|index| {
					let t = f64::from(index) / f64::from(total);
					(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)
				})
				.collect()
		}
	};
	let mut plan = Vec::with_capacity(motion.len() + 2);
	plan.push((down_type, x0, y0));
	plan.extend(motion.into_iter().map(|(px, py)| (dragged_type, px, py)));
	plan.push((up_type, x1, y1));
	plan
}

/// 在 *pid* 内点击 *count* 次。**指针不动。**
///
/// 这是 `app_post` 方法:事件带位置、经 `CGEventPostToPid` 投递,目标应用看
/// 到对该点的点击,而操作者的物理光标停在原处(REF 活体验证:前后读数逐一
/// 相同)。这个性质正是该方法存在、并作为坐标点击默认值的全部理由;
/// [`post_mouse_global`] 是会动指针的显式另选。
///
/// *count* 表达为事件的 **click-state** 而非重复的对(见 [`mouse_event`]);
/// 每对仍各自投出 —— 跟踪 down/up 迁移的应用才看得见,对间停顿短于双击间
/// 隔,OS 才认出重复。
pub fn post_mouse_click(pid: i32, x: f64, y: f64, button: MouseButton, count: u8) {
	let (button_number, down_type, up_type, _) = mouse_button_codes(button);
	for click_index in 0..count.max(1) {
		let click_state = u32::from(click_index) + 1;
		for event_type in [down_type, up_type] {
			let Some(event) = mouse_event(event_type, x, y, button_number, click_state) else {
				continue;
			};
			// SAFETY:event 是本进程创建的合法事件;pid 为进程 id。
			unsafe { sys::CGEventPostToPid(pid, event.as_ptr()) };
			std::thread::sleep(std::time::Duration::from_secs_f64(CLICK_PAIR_DELAY_SECS));
		}
	}
}

/// 在 *pid* 内从 *start* 拖到 *end*。**指针不动。**
///
/// start 处 down、内插的 MouseDragged 序列、end 处 up —— 全部应用内定向。
/// 中间事件不是填充:对多数应用,裸 down/up 对不是拖拽,手势是从端点之间
/// 的**运动**识别出来的(REF 对 TextEdit 实测,没有内插它不登记任何选
/// 区)。*points* 给出整条路径(弯曲笔划);缺省内插 *steps* 段直线。
/// 每步停顿的理由见 [`DRAG_STEP_DELAY_SECS`]。
pub fn post_mouse_drag(
	pid: i32,
	start: (f64, f64),
	end: (f64, f64),
	button: MouseButton,
	points: Option<&[(f64, f64)]>,
) {
	let (button_number, down_type, up_type, dragged_type) = mouse_button_codes(button);
	let plan = drag_plan(start, end, down_type, up_type, dragged_type, DRAG_STEPS, points);
	for (event_type, px, py) in plan {
		// click-state 1(单击)贯穿 down/dragged/up:AppKit 从该字段读
		// `NSEvent.clickCount`,0 不是任何真实手势的取值 —— NSTextView 的
		// 选区逻辑对它不认账,拖选会无痕失效(实测:TextEdit 记 AXValue
		// 却不记 AXSelectedText)。与 click 路径的 click_state 对齐。
		let Some(event) = mouse_event(event_type, px, py, button_number, 1) else {
			continue;
		};
		// SAFETY:event 合法;pid 为进程 id。
		unsafe { sys::CGEventPostToPid(pid, event.as_ptr()) };
		std::thread::sleep(std::time::Duration::from_secs_f64(DRAG_STEP_DELAY_SECS));
	}
}

/// **移动操作者真实指针**到 *(x, y)* 并在该处点击。
///
/// 全包唯一接管物理鼠标的函数,`CGWarpMouseCursorPosition` 与 `CGEventPost`
/// 的唯一调用点;其余每条输入路径都应用内定向、不碰光标。只经
/// `click_method: "global"` 可达 —— 模型必须**点名**它,chokepoint 的
/// `resolve_click_method` 永不把 auto 解析到这。别加第二个调用点:那等于绕
/// 过点名要求。
///
/// 存在的理由(应用内定向已够用时为何还要它):有些 UI 只有真实物理点击够
/// 得着 —— Dock 项、菜单栏 extras、拒绝接收投递事件的进程的窗口、Space 切
/// 换器。先 warp 再点:全局事件投给**光标之下**的东西,不 warp 就点在操作者
/// 恰好留下的位置。warp 返回码仅告警 —— 被拒的 warp 仍留下(原光标处的)一
/// 次自洽点击,为此拒绝整个动作比一次可从刷新树核验的点击更糟。
pub fn post_mouse_global(x: f64, y: f64, button: MouseButton, count: u8) {
	let (button_number, down_type, up_type, _) = mouse_button_codes(button);
	// SAFETY:CGPoint 按值;返回码告警级(见上)。
	let _warped = unsafe { sys::CGWarpMouseCursorPosition(CGPoint { x, y }) };
	for click_index in 0..count.max(1) {
		let click_state = u32::from(click_index) + 1;
		for event_type in [down_type, up_type] {
			let Some(event) = mouse_event(event_type, x, y, button_number, click_state) else {
				continue;
			};
			// SAFETY:event 合法;kCGHIDEventTap 是全局事件 tap(仅此一处)。
			unsafe { sys::CGEventPost(K_CG_HID_EVENT_TAP, event.as_ptr()) };
			std::thread::sleep(std::time::Duration::from_secs_f64(CLICK_PAIR_DELAY_SECS));
		}
	}
}

/// [`post_mouse_drag`] 的指针移动对应物:沿路径**移动操作者真实指针**。
///
/// 每个事件**之前**都 warp,而非只在首个之前:全局拖拽只有在物理光标跟随
/// 合成运动时才自洽,warp 一次会让 OS 把中间事件投给 start 点之下当时的东
/// 西。
pub fn post_mouse_drag_global(start: (f64, f64), end: (f64, f64), button: MouseButton, points: Option<&[(f64, f64)]>) {
	let (button_number, down_type, up_type, dragged_type) = mouse_button_codes(button);
	let plan = drag_plan(start, end, down_type, up_type, dragged_type, DRAG_STEPS, points);
	for (event_type, px, py) in plan {
		// SAFETY:同 post_mouse_global —— 本函数是 warp 的第二个也是最后一
		// 个调用点(REF 同样两处:click 与 drag 各一)。
		unsafe { sys::CGWarpMouseCursorPosition(CGPoint { x: px, y: py }) };
		// click-state 1 与 app_post 路径同理由(见 post_mouse_drag)。
		let Some(event) = mouse_event(event_type, px, py, button_number, 1) else {
			continue;
		};
		// SAFETY:event 合法;全局 tap 投递。
		unsafe { sys::CGEventPost(K_CG_HID_EVENT_TAP, event.as_ptr()) };
		std::thread::sleep(std::time::Duration::from_secs_f64(DRAG_STEP_DELAY_SECS));
	}
}
