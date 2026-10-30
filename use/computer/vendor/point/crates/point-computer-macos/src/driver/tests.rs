use super::*;

fn app() -> AppRef {
	AppRef {
		name: "Calculator".to_string(),
		pid: 12_345,
		bundle_id: "com.apple.calculator".to_string(),
		window_id: 77,
		window_title: "Calculator".to_string(),
	}
}

#[test]
fn status_is_supported_and_permissions_are_advisory() {
	let backend = MacOsBackend::new();
	let status = backend.status();
	assert!(status.supported);
	assert_eq!(status.platform_id, PLATFORM_MACOS);
	assert!(status.reason.is_empty());
	// 探针永不失败、词表闭合(详细信息见 permissions 模块测试)。
	let probe = backend.probe_permissions();
	assert!(!probe.responsible_hint.is_empty());
}

#[test]
fn accessibility_click_without_an_index_refuses_legibly() {
	// 无 rec 的 accessibility 点击:chokepoint 的 element_index 硬必
	// 需之外,driver 自己也拒绝 —— 拒绝点出两条可走的路。
	let backend = MacOsBackend::new();
	let result = backend.click(&app(), None, ClickRequest::default());
	assert!(!result.ok);
	assert!(result.text.contains("needs an element_index"), "{}", result.text);
	assert!(result.text.contains("click a POINT"), "{}", result.text);
}

#[test]
fn coordinate_methods_refuse_a_missing_point() {
	let backend = MacOsBackend::new();
	let mut req = ClickRequest { method: ClickMethod::AppPost, point: None, button: MouseButton::Left, count: 1 };
	let result = backend.click(&app(), None, req);
	assert!(!result.ok);
	assert!(result.text.contains("needs both x and y"), "{}", result.text);

	// 未知/未解析方法(auto 在此类型上仍可能出现):拒绝而非自作主
	// 张挑一条路径 —— 回退会做出与所求不同的手势。
	req.method = ClickMethod::Auto;
	req.point = Some((1.0, 1.0));
	let result = backend.click(&app(), None, req);
	assert!(!result.ok);
	assert!(result.text.contains("unknown click_method 'auto'"), "{}", result.text);
}

#[test]
fn drag_refuses_methods_without_a_drag_form() {
	// sky_click 没有拖拽形态:拒绝而非近似成别的手势。accessibility
	// **有** —— 文本选择(AXSelectedTextRange 直写),非文本落点拒绝
	// 于自己的文案(见 drag_text_selects_text_refuses_the_rest)。
	let backend = MacOsBackend::new();
	let req = DragRequest { method: ClickMethod::SkyClick, ..DragRequest::default() };
	let result = backend.drag(&app(), req);
	assert!(!result.ok);
	assert!(result.text.contains("unknown click_method"), "{}", result.text);
}

#[test]
fn drag_app_post_refuses_when_the_window_cannot_be_verified() {
	// pid 1_000_000 高于 kern.pid_max 默认(99999):无头 CI 与真桌面
	// 会话同样保证这只 AppRef 不在窗口列表里 —— 矩形核验无从做起,
	// 拒绝并指引重快照,而非投递一次必然无效的手势再报「dragged」。
	let backend = MacOsBackend::new();
	let ghost = AppRef {
		name: "Ghost".to_string(),
		pid: 1_000_000,
		bundle_id: String::new(),
		window_id: u32::MAX,
		window_title: String::new(),
	};
	let req = DragRequest { method: ClickMethod::AppPost, ..DragRequest::default() };
	let result = backend.drag(&ghost, req);
	assert!(!result.ok);
	assert!(result.text.contains("no longer on screen"), "{}", result.text);
	assert!(result.text.contains("computer_get_state"), "{}", result.text);
	// 标题栏点(窗口矩形内、被别的窗口盖住)是像素归属误拒的形状;
	// 谓词是矩形包含,不是 z 序像素归属。
	let frame = Frame { x: 413.0, y: 92.0, w: 603.0, h: 505.0 };
	assert!(frame_contains(&frame, 413.0, 92.0), "top-left corner is inside");
	assert!(frame_contains(&frame, 440.0, 120.0), "title bar is inside the rectangle");
	assert!(!frame_contains(&frame, 1016.0, 120.0), "right edge is exclusive");
	assert!(!frame_contains(&frame, 440.0, 90.0), "above the window is outside");
}

#[test]
fn drag_text_selects_text_refuses_the_rest() {
	// 无桌面会话里命中测试必失败 —— accessibility drag 的类型化拒绝
	// 可离线钉住;真实建立选区的路径由冒烟(ax_selected_text_range_
	// setter_smoke)与 CLI 实测覆盖。
	let backend = MacOsBackend::new();
	for button in [MouseButton::Right, MouseButton::Middle] {
		let req = DragRequest { method: ClickMethod::Accessibility, button, ..DragRequest::default() };
		let result = backend.drag(&app(), req);
		assert!(!result.ok);
		assert!(result.text.contains("left button"), "{}", result.text);
	}
	let req = DragRequest { method: ClickMethod::Accessibility, path: DragPath::Curved, ..DragRequest::default() };
	let result = backend.drag(&app(), req);
	assert!(!result.ok);
	assert!(result.text.contains("curved path"), "{}", result.text);
	let req = DragRequest { method: ClickMethod::Accessibility, ..DragRequest::default() };
	let result = backend.drag(&app(), req);
	assert!(!result.ok);
	assert!(result.text.contains("writable text element"), "{}", result.text);
}

#[test]
fn point_to_index_maps_monotext_and_clamps_line_edges() {
	// 9 字符等宽一行:x=100+10*i,y=200,高 16。
	let single = |i: isize| Some((100.0 + 10.0 * i as f64, 200.0, 10.0, 16.0));
	let mut f = single;
	assert_eq!(point_to_index(9, 105.0, 205.0, &mut f), Some(0));
	let mut f = single;
	assert_eq!(point_to_index(9, 135.0, 208.0, &mut f), Some(3));
	let mut f = single;
	assert_eq!(point_to_index(9, 185.0, 205.0, &mut f), Some(8));
	// 行首左/行尾右的空白:夹到该行边界。
	let mut f = single;
	assert_eq!(point_to_index(9, 90.0, 205.0, &mut f), Some(0));
	let mut f = single;
	assert_eq!(point_to_index(9, 500.0, 205.0, &mut f), Some(8));
	// 末行下方:夹到该行(选到文末),不拒。
	let mut f = single;
	assert_eq!(point_to_index(9, 105.0, 400.0, &mut f), Some(0));
	let mut f = single;
	assert_eq!(point_to_index(9, 185.0, 400.0, &mut f), Some(8));
	// 空文本:None。
	let mut never = |_: isize| -> Option<(f64, f64, f64, f64)> { unreachable!("count<=0 never probes") };
	assert_eq!(point_to_index(0, 1.0, 1.0, &mut never), None);
}

#[test]
fn point_to_index_maps_second_row() {
	// 每行 5 字符,两行:第二行 y=220。
	let two_rows = |i: isize| {
		let row = i / 5;
		let col = i % 5;
		Some((100.0 + 10.0 * col as f64, 200.0 + 20.0 * row as f64, 10.0, 16.0))
	};
	let mut f = two_rows;
	assert_eq!(point_to_index(10, 105.0, 225.0, &mut f), Some(5), "second row start");
	let mut f = two_rows;
	assert_eq!(point_to_index(10, 135.0, 205.0, &mut f), Some(3), "first row mid");
	let mut f = two_rows;
	assert_eq!(point_to_index(10, 145.0, 228.0, &mut f), Some(9), "second row end");
	// 行间 leading(第一行盒 200-216,第二行顶 220):夹到上一行。
	let mut f = two_rows;
	assert_eq!(point_to_index(10, 105.0, 218.0, &mut f), Some(0), "gap maps to previous row");
	// 末行下方:夹到末行。
	let mut f = two_rows;
	assert_eq!(point_to_index(10, 145.0, 400.0, &mut f), Some(9), "below last line clamps");
}

#[test]
fn same_identity_ignores_value_by_design() {
	let base = ElementRec {
		index: 3,
		role: "AXTextField".into(),
		subrole: "AXSearchField".into(),
		title: "Search".into(),
		value: "".into(),
		..ElementRec::default()
	};
	let typed_into = ElementRec { value: "hello".into(), ..base.clone() };
	// 用户打字改 value 不改身份 —— 折叠 value 会拒掉几乎每个正当动作。
	assert!(same_identity(&typed_into, &base));
	let different_control = ElementRec { role: "AXButton".into(), ..base.clone() };
	assert!(!same_identity(&different_control, &base));
	let retitled = ElementRec { title: "OK".into(), ..base };
	assert!(!same_identity(&retitled, &different_control));
}

#[test]
fn area_clamps_negative_dimensions() {
	// AX 对离屏/折叠元素可报负尺寸;负面积会比较成「比一切都小」,
	// 把祖先界线放行过去。
	assert_eq!(area((0.0, 0.0, -10.0, 5.0)), 0.0);
	assert_eq!(area((0.0, 0.0, 10.0, 5.0)), 50.0);
}

#[test]
fn pressed_and_click_texts_name_what_ran() {
	// 取胜动词在文案里:模型从结果学会这个元素应答什么。
	assert_eq!(pressed_text(3, "AXPress"), "pressed element 3");
	assert_eq!(pressed_text(3, "AXOpen"), "activated via AXOpen element 3");
	// 祖先回退明说按下的是容器。
	assert!(ancestor_pressed_text(3).contains("enclosing control"));

	let req = ClickRequest {
		method: ClickMethod::AppPost,
		point: Some((12.6, 40.2)),
		button: MouseButton::Left,
		count: 2,
	};
	assert_eq!(click_text(&req, &app()), "left click x2 at (13, 40) in 'Calculator' (app_post)");
	let single = ClickRequest { point: Some((5.0, 6.0)), count: 1, ..req };
	assert_eq!(click_text(&single, &app()), "left click at (5, 6) in 'Calculator' (app_post)");
}

#[test]
fn scroll_helpers_map_every_direction() {
	assert_eq!(scroll_action(ScrollDirection::Up), "AXScrollUpByPage");
	assert_eq!(scroll_action(ScrollDirection::Right), "AXScrollRightByPage");
	// delta 符号与阅读方向相反:Up 是正 axis-1(把内容往上拉)。
	assert_eq!(scroll_deltas(ScrollDirection::Up), (1, 0));
	assert_eq!(scroll_deltas(ScrollDirection::Down), (-1, 0));
	assert_eq!(scroll_deltas(ScrollDirection::Left), (0, 1));
	assert_eq!(scroll_deltas(ScrollDirection::Right), (0, -1));
}

#[test]
fn guarded_turns_a_panic_into_a_refusal_without_paths() {
	let result = guarded("click", || panic!("boom /internal/secret"));
	assert!(!result.ok);
	assert_eq!(result.text, "click failed unexpectedly (boom /internal/secret)");
	// 非 payload 型 panic 也有文案,永不 Err/永不 panic 二选一违约。
	let quiet = std::panic::catch_unwind(|| guarded("drag", || std::panic::panic_any(7usize)));
	let quiet = quiet.expect("guarded itself must not panic");
	assert_eq!(quiet.text, "drag failed unexpectedly (panic)");
}

#[test]
fn running_app_matches_on_name_or_bundle_id() {
	// 空名:不枚举直接 None(普通否定,不是错误路径)。
	assert!(running_app("   ").is_none());
	// 真实窗口列表往返:本测试进程不是 GUI 应用,匹配不上是预期。
	assert!(running_app("definitely-not-a-gui-app-xyz").is_none());
}

#[test]
fn launch_refuses_terminals_through_the_real_catalog() {
	// 真目录、真拒绝:终端类在解析前就被拒,文案点出 no-arguments 规
	// 则围不住的那一个形状。
	let backend = MacOsBackend::new();
	let result = backend.launch_app("iTerm2", LaunchPermit::none());
	assert!(!result.ok);
	assert!(result.text.contains("is a terminal"), "{}", result.text);
}

#[test]
fn launch_miss_reports_the_query_from_the_real_catalog() {
	// 真目录、真阶梯:把查询指到一个不存在的名字,断言拒绝点名原始查
	// 询(建议文案由真实目录生成,不硬编码)。
	let backend = MacOsBackend::new();
	let result = backend.launch_app("definitely-not-installed-xyz", LaunchPermit::none());
	assert!(!result.ok);
	assert!(result.text.contains("definitely-not-installed-xyz"), "{}", result.text);
}

/// 冒烟:观测动词在真实桌面上端到端(经 service 的 e2e 在 service 侧)。
#[test]
#[ignore = "needs a desktop window server session"]
fn resolve_and_snapshot_refuse_gracefully_without_accessibility() {
	let backend = MacOsBackend::new();
	let result = backend.resolve_app("definitely-not-running-xyz");
	assert!(!result.ok);
	assert!(result.text.contains("computer_list_apps"), "{}", result.text);
}
