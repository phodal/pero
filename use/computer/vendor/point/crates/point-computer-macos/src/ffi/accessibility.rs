use super::*;

// ── Accessibility 助手 ──

/// 为 *pid* 创建 application 级 `AXUIElement`,**立即**设消息超时(唯一
/// 能保证每个后续 AX 调用都带上限的位置)。
pub fn ax_app_element(pid: i32) -> Option<CfRef> {
	// SAFETY:纯 Create 调用;pid 是进程 id。
	let ptr = unsafe { sys::AXUIElementCreateApplication(pid) };
	// SAFETY:Create-Rule +1。
	let elem = unsafe { CfRef::from_created(ptr as *mut c_void) }?;
	ax_set_messaging_timeout(&elem);
	Some(elem)
}

/// 把本 crate 的 2s 上限钉到 *elem* 上。超时不沿父子引用继承,命中测试
/// 拿到的 system-wide / 叶子 / 祖先各自都要设。
pub fn ax_set_messaging_timeout(elem: &CfRef) {
	// SAFETY:elem 是合法 AXUIElement。
	unsafe { sys::AXUIElementSetMessagingTimeout(elem.as_ptr(), AX_MESSAGING_TIMEOUT_SECS) };
}

/// 读一个 AX 属性:`Err(ax_error)` 或 `Ok(Some(value))`(Create-Rule 持
/// 有)/`Ok(None)`(成功但空值)。非零错误码时 out 参数从未被解引用(AX
/// 失败时不动它,读它 = 读未初始化栈)。
pub fn ax_attr(elem: &CfRef, name: &str) -> Result<Option<CfRef>, c_int32_t> {
	let key = cf_string(name).ok_or(AX_ERR_CANNOT_COMPLETE)?;
	let mut out: *const c_void = std::ptr::null();
	// SAFETY:elem/key 合法;out 是 out-param。
	let err = unsafe { sys::AXUIElementCopyAttributeValue(elem.as_ptr(), key.as_ptr(), &mut out) };
	if err != AX_ERR_SUCCESS {
		return Err(err);
	}
	// SAFETY:Copy-Rule +1。
	Ok(unsafe { CfRef::from_created(out as *mut c_void) })
}

/// AX 属性 → `String`(缺失与非字符串都 → `""`;两者都寻常:window 对
/// AXValue 答 -25205,滑块的 AXValue 是 CFNumber)。树走查的热路径。
pub fn ax_str(elem: &CfRef, name: &str) -> String {
	match ax_attr(elem, name) {
		Ok(Some(value)) => cf_string_value(value.as_ptr()),
		_ => String::new(),
	}
}

/// AX 属性 → bool,缺失回 *default*。default 有意义:AXEnabled 在很多元
/// 素上 unsupported,全部渲染成「禁用」既错又吵;缺席 = 未知 = 读作启用。
pub fn ax_bool(elem: &CfRef, name: &str, default: bool) -> bool {
	ax_bool_opt(elem, name).unwrap_or(default)
}

/// 三态布尔:ABSENT(None)与 `false` 不同 —— AXSelected 缺席是「此元素没
/// 有选中的概念」,false 是「可选、未选」。
pub fn ax_bool_opt(elem: &CfRef, name: &str) -> Option<bool> {
	match ax_attr(elem, name) {
		Ok(Some(value)) => cf_bool_value(value.as_ptr()),
		_ => None,
	}
}

/// *name* 可否被**写**(AXUIElementIsAttributeSettable)。唯一的「此输入
/// 可编辑吗」可靠信号:只读文本框报 AXEnabled=true 且带可读 value,敲字
/// 静默无效。任何错误都 fail-closed(false):不可知的属性按不可写对待。
pub fn ax_is_settable(elem: &CfRef, name: &str) -> bool {
	let Some(key) = cf_string(name) else { return false };
	let mut settable = false;
	// SAFETY:elem/key 合法;settable 是 out-param。
	let err = unsafe { sys::AXUIElementIsAttributeSettable(elem.as_ptr(), key.as_ptr(), &mut settable) };
	err == AX_ERR_SUCCESS && settable
}

/// 父元素(retained,+1):根或不答 AXParent 的元素 → `None`。
pub fn ax_parent(elem: &CfRef) -> Option<CfRef> {
	let value = ax_attr(elem, AX_PARENT).ok()??;
	if !cf_is(value.as_ptr(), type_ids().ax_element) {
		return None;
	}
	Some(value.retain())
}

/// 两个引用是否命名**同一**元素。`CFEqual` 而非指针比较:AXFocusedUIElement
/// 返回新鲜分配的引用,指针比较会把焦点标记永久点亮不了(静默 no-op)。
/// 双 NULL 是 false:「无元素」不与「无元素」同一。
///
/// snapshot 走查消费它(焦点元素与树节点的同一性)、read_children 的去重
/// 也是它(同一行可以同时出现在 AXRows 与 AXVisibleChildren 里,两次读取
/// 铸出两个不同引用 —— 指针比较会放同一行过两次,被复制的行比缺的行更
/// 糟:模型会当 index 7 和 index 9 是两行不同的东西去寻址)。
pub(crate) fn same_element(a: *const c_void, b: *const c_void) -> bool {
	!a.is_null() && !b.is_null() && unsafe { sys::CFEqual(a, b) }
}

/// `(x, y, w, h)`(左上屏幕坐标)或 `None`。AXPosition/AXSize 是 AXValue
/// 箱:先验箱、再验判别式,才允许解箱 —— 读取序错一步就是 y↔width 的静
/// 默转置。半帧比没有帧糟:消费方会为缺的半边发明数值,而渲染、命中测
/// 试、点击阶梯全都建立在那不存在的矩形上。无几何是寻常答案。
pub fn ax_frame(elem: &CfRef) -> Option<(f64, f64, f64, f64)> {
	let (x, y) = ax_value_point(elem, AX_POSITION)?;
	let (w, h) = ax_value_size(elem, AX_SIZE)?;
	Some((x, y, w, h))
}

fn ax_value_point(elem: &CfRef, name: &str) -> Option<(f64, f64)> {
	let mut out = CGPoint::default();
	if !unbox_ax_value(elem, name, K_AX_VALUE_CG_POINT, &mut out as *mut CGPoint as *mut c_void) {
		return None;
	}
	Some((out.x, out.y))
}

fn ax_value_size(elem: &CfRef, name: &str) -> Option<(f64, f64)> {
	let mut out = CGSize::default();
	if !unbox_ax_value(elem, name, K_AX_VALUE_CG_SIZE, &mut out as *mut CGSize as *mut c_void) {
		return None;
	}
	Some((out.width, out.height))
}

/// 三检缺一不可:读成功且返回了东西;那东西是 AXValue(应用可以答
/// CFNumber 或字符串 —— 对非 AXValue 调 AXValueGetType 是 UB);箱的判别
/// 式与 *want_type* 相符(字节落对结构体字段)。
fn unbox_ax_value(elem: &CfRef, name: &str, want_type: c_int32_t, out: *mut c_void) -> bool {
	let Ok(Some(value)) = ax_attr(elem, name) else {
		return false;
	};
	if !cf_is(value.as_ptr(), type_ids().ax_value) {
		return false;
	}
	// SAFETY:value 已验为 AXValue;out 与 want_type 匹配(调用点保证)。
	unsafe { sys::AXValueGetType(value.as_ptr()) == want_type && sys::AXValueGetValue(value.as_ptr(), want_type, out) }
}

/// 读元素数组属性(`AXChildren`/`AXWindows`)为 **+1** 引用:数组来自
/// Copy(我们拥有数组),元素属数组(随数组死)—— 想在数组释放后继续用
/// 元素就必须 retain。每项还验为 AXUIElement:坏掉的应用可以答字符串数
/// 组,对 CFString 指针执行动作是 segfault。
pub fn ax_retained_elements(elem: &CfRef, name: &str, limit: usize) -> Vec<CfRef> {
	let Ok(Some(array)) = ax_attr(elem, name) else {
		return Vec::new();
	};
	cf_array_items(array.as_ptr(), limit)
		.into_iter()
		.filter(|item| cf_is(*item, type_ids().ax_element))
		.map(|item| {
			// SAFETY:item 已验为 AXUIElement;retain 后建 +1 所有权。
			unsafe { CfRef::from_created(sys::CFRetain(item) as *mut c_void) }
				.expect("CFRetain of valid element returned NULL")
		})
		.collect()
}

/// 元素宣告的动作名(**已清洗**;见 [`sanitize_action`])。仅作参考:宣
/// 告列表是提示不是契约(实测 AXScrollArea 宣告后拒绝)。
pub fn ax_actions(elem: &CfRef, limit: usize) -> Vec<String> {
	let mut out: *const c_void = std::ptr::null();
	// SAFETY:elem 合法;out 是 out-param。
	let err = unsafe { sys::AXUIElementCopyActionNames(elem.as_ptr(), &mut out) };
	if err != AX_ERR_SUCCESS {
		return Vec::new();
	}
	// SAFETY:out 是 Copy-Rule +1 的数组。
	let array = unsafe { CfRef::from_created(out as *mut c_void) };
	match array {
		Some(array) => cf_array_items(array.as_ptr(), limit)
			.iter()
			.map(|item| sanitize_action(&cf_string_value(*item)))
			.filter(|name| !name.is_empty())
			.collect(),
		None => Vec::new(),
	}
}

/// 执行具名无障碍动作,返回**原始** AX 错误码(调用方分支:-25206 表示
/// 「宣告过但拒绝 —— 走回退」,其它码的数值属于错误消息)。
pub fn ax_perform(elem: &CfRef, action: &str) -> c_int32_t {
	let Some(name) = cf_string(action) else { return AX_ERR_CANNOT_COMPLETE };
	// SAFETY:elem/name 合法。
	unsafe { sys::AXUIElementPerformAction(elem.as_ptr(), name.as_ptr()) }
}

/// 写字符串属性(set_value 原语)。
pub fn ax_set_str(elem: &CfRef, name: &str, value: &str) -> c_int32_t {
	let (Some(key), Some(payload)) = (cf_string(name), cf_string(value)) else {
		return AX_ERR_CANNOT_COMPLETE;
	};
	// SAFETY:全部合法 CF 对象。
	unsafe { sys::AXUIElementSetAttributeValue(elem.as_ptr(), key.as_ptr(), payload.as_ptr()) }
}

/// 写布尔属性为 true(AXManualAccessibility 的 Electron 自选加入;
/// AXFocused 的「让键落进点名元素」)。
pub fn ax_set_true(elem: &CfRef, name: &str) -> c_int32_t {
	let Some(key) = cf_string(name) else { return AX_ERR_CANNOT_COMPLETE };
	// SAFETY:同上;value 是共享单例。
	unsafe { sys::AXUIElementSetAttributeValue(elem.as_ptr(), key.as_ptr(), cf_true()) }
}

/// 写 CFRange 属性(AXSelectedTextRange —— 文本选区的唯一可访问性形态;
/// 合成鼠标手势对应用层全路径无效是本平台的实测事实,选区只能走属性写)。
pub fn ax_set_range(elem: &CfRef, name: &str, range: CFRange) -> c_int32_t {
	let Some(key) = cf_string(name) else { return AX_ERR_CANNOT_COMPLETE };
	let Some(value) = ax_value_range(range) else { return AX_ERR_CANNOT_COMPLETE };
	// SAFETY:同 ax_set_true;value 是本进程创建的合法 AXValue。
	unsafe { sys::AXUIElementSetAttributeValue(elem.as_ptr(), key.as_ptr(), value.as_ptr()) }
}

/// 读 CFRange 属性(`AXSelectedTextRange`)。判别式三检与几何解箱同理
///(见 [`unbox_ax_value`])。
pub fn ax_range(elem: &CfRef, name: &str) -> Option<CFRange> {
	let mut out = CFRange::default();
	if !unbox_ax_value(elem, name, K_AX_VALUE_CF_RANGE, &mut out as *mut CFRange as *mut c_void) {
		return None;
	}
	Some(out)
}

/// CFRange → AXValue 箱(`AXValueCreate(kAXValueCFRangeType, ...)`)。
fn ax_value_range(range: CFRange) -> Option<CfRef> {
	// SAFETY:range 是与 K_AX_VALUE_CF_RANGE 匹配的 #[repr(C)] 缓冲;
	// Create-Rule +1。
	let value = unsafe { sys::AXValueCreate(K_AX_VALUE_CF_RANGE, &raw const range as *const c_void) };
	unsafe { CfRef::from_created(value as *mut c_void) }
}

/// 参数化几何属性:`AXBoundsForRange`(range 的屏幕矩形)。文本拖选的
/// 点→字符索引二分用它;无几何答案(点不在文本上)是寻常结果。
pub fn ax_bounds_for_range(elem: &CfRef, location: isize, length: isize) -> Option<CGRect> {
	let key = cf_string("AXBoundsForRange")?;
	let parameter = ax_value_range(CFRange { location, length })?;
	let mut out: *const c_void = std::ptr::null();
	// SAFETY:elem/key/parameter 均为本进程持有或创建;out 是 out-param。
	let err = unsafe {
		sys::AXUIElementCopyParameterizedAttributeValue(elem.as_ptr(), key.as_ptr(), parameter.as_ptr(), &mut out)
	};
	if err != AX_ERR_SUCCESS {
		return None;
	}
	// SAFETY:out 若非 null 为 +1(Copy 规则);立即解箱为 CGRect。
	let value = (unsafe { CfRef::from_created(out as *mut c_void) })?;
	let mut rect = CGRect::default();
	// SAFETY:先验箱再解箱(判别式),与 unbox_ax_value 同一纪律。
	unsafe {
		if sys::AXValueGetType(value.as_ptr()) != K_AX_VALUE_CG_RECT
			|| !sys::AXValueGetValue(value.as_ptr(), K_AX_VALUE_CG_RECT, &mut rect as *mut CGRect as *mut c_void)
		{
			return None;
		}
	}
	Some(rect)
}

/// 命中测试:屏幕点之下最深的 AXUIElement(system-wide 元素发出)。
pub fn ax_element_at_point(x: f64, y: f64) -> Option<CfRef> {
	// SAFETY:纯 Create 调用;Create-Rule +1。
	let system = unsafe { CfRef::from_created(sys::AXUIElementCreateSystemWide() as *mut c_void) }?;
	ax_set_messaging_timeout(&system);
	let mut found: *const c_void = std::ptr::null();
	// SAFETY:system 合法;x/y 按原型收 float(见 extern 注释);found 是
	// out-param。
	let err = unsafe { sys::AXUIElementCopyElementAtPosition(system.as_ptr(), x as f32, y as f32, &mut found) };
	if err != AX_ERR_SUCCESS {
		return None;
	}
	// SAFETY:found 若非 null 为 +1;且必须是 AXUIElement(见 ax_retained_elements
	// 的同款校验理由)。
	let element = (unsafe { CfRef::from_created(found as *mut c_void) })?;
	if !cf_is(element.as_ptr(), type_ids().ax_element) {
		return None;
	}
	ax_set_messaging_timeout(&element);
	Some(element)
}

/// 元素所属进程(`AXUIElementGetPid`)。命中测试的元素必须属于目标 pid
/// 才可成为动作落点 —— 全局命中不挑进程,写属性不验 pid 等于把选区设到
/// 旁边应用的文本上。
pub fn ax_pid(elem: &CfRef) -> Option<i32> {
	let mut pid: i32 = 0;
	// SAFETY:elem 合法;pid 是 out-param。
	let err = unsafe { sys::AXUIElementGetPid(elem.as_ptr(), &mut pid) };
	(err == AX_ERR_SUCCESS).then_some(pid)
}

/// `AXIsProcessTrusted()` —— **仅诊断**(见 permissions 模块)。
pub fn ax_is_process_trusted() -> bool {
	// SAFETY:无参纯查询。
	unsafe { sys::AXIsProcessTrusted() }
}

/// `CGPreflightScreenCaptureAccess()` —— **仅诊断**;Request 变体永不绑
/// 定(见 `sys` 块内注释)。
pub fn preflight_screen_capture() -> bool {
	// SAFETY:无参纯查询。
	unsafe { sys::CGPreflightScreenCaptureAccess() }
}

// ── 可选私有符号:`_AXUIElementGetWindow`(REF _OPTIONAL_FN_SPECS) ──

type AxGetWindowFn = unsafe extern "C" fn(*const c_void, *mut u32) -> c_int32_t;
static AX_GET_WINDOW: OnceLock<Option<AxGetWindowFn>> = OnceLock::new();

/// AX 窗口元素 → CoreGraphics window id,或 0。
///
/// 两个窗口命名空间**独立排序**(实测 Notes:AXWindows[0] 是 3 节点的空标
/// 题 AXDialog,最前的 CG 窗口才是 103 节点的真文档窗)—— 走一个捕另一
/// 个,给模型的是两个**不同窗口**的树与截图:一次自信却错误的观测,比报
/// 错更糟。私有符号缺席(未来 macOS)或元素非窗口时返回 0,调用方降级到
/// title/AXMain 匹配 —— REF 同。
pub fn ax_window_id(window: &CfRef) -> u32 {
	let getter = AX_GET_WINDOW.get_or_init(|| {
		let name = c"_AXUIElementGetWindow";
		// SAFETY:RTLD_DEFAULT 在全部已加载镜像中查符号;ApplicationServices
		// 已随本 crate 链接加载。缺失 → None(降级语义),绝不失败。
		let sym = unsafe { sys::dlsym(sys::RTLD_DEFAULT, name.as_ptr()) };
		if sym.is_null() {
			return None;
		}
		// SAFETY:_AXUIElementGetWindow 的观察签名是 (AXUIElementRef,
		// uint32_t*) -> AXError;dlsym 的 void* 到 fn 指针转换非空已验。
		Some(unsafe { std::mem::transmute::<*mut c_void, AxGetWindowFn>(sym) })
	});
	let Some(getter) = getter else { return 0 };
	let mut out: u32 = 0;
	// SAFETY:window 是合法 AXUIElement;out 是 out-param。
	if unsafe { getter(window.as_ptr(), &mut out) } != AX_ERR_SUCCESS {
		return 0;
	}
	out
}
