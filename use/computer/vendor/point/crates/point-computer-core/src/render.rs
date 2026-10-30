//! 应用列表与无障碍快照的文本渲染 —— REF `render.py` 的移植。
//!
//! 渲染文本是模型从 computer use 看到的**唯一**东西(树先行、截图以路径
//! 中继是传输的属性而非可回归的策略)。本模块强制的两条不变量,各有测试:
//!
//! * 每个公开 renderer 以 [`policy::redact_result`] **收尾**,没有路径能
//!   放出未 redact 的树;
//! * `secure` 记录渲染 [`SECURE_PLACEHOLDER`],永不渲染其值字节 —— 不截断、
//!   不带提示的掩码,完全不出现。
//!
//! 纯层:无 unsafe、无 IO、无平台调用。

use crate::policy;
use crate::types::{
	AppRef, DEPTH_NOTE, ElementRec, FOCUS_MARKER, FOCUS_NOTE, Frame, NO_APPS_NOTE, SCREENSHOT_NOTE,
	SCREENSHOT_SCALE_NOTE, SECURE_PLACEHOLDER, SECURE_WINDOW_NOTE, SELECTION_NOTE, Snapshot, TREE_INDENT,
	TRUNCATED_NOTE, TRUNCATED_WINDOW_NOTE, WINDOW_ORIGIN_NOTE, fill,
};

// 人类可读截图大小的字节阶梯。留在本地:这是展示,不是业务逻辑。
const KIB: f64 = 1024.0;
const MIB: f64 = KIB * KIB;

/// `computer_list_apps` 列表的单字段上限。应用名/bundle id/窗口标题在此各占
/// 一行,一条敌意应用不能挤掉列表其余部分;随之而来的压平(见 [`clip`])
/// 正是阻止嵌入换行伪造额外条目的东西。
const APP_FIELD_LIMIT: usize = 200;

/// 渲染在屏应用列表。每应用一行,身份与后续 `app` 参数可匹配的形式一致;
/// 以 redaction 收尾:窗口标题 routinely 携带文档名、文件系统路径与卷名。
pub fn render_apps(apps: &[AppRef]) -> String {
	if apps.is_empty() {
		return policy::redact_result(NO_APPS_NOTE);
	}
	let mut lines = vec![format!("{} application(s) with on-screen windows:", apps.len())];
	for app in apps {
		// 与树头同理由压平:名字、bundle id、窗口标题全部来自目标进程,
		// 且在此一行一项 —— 嵌入换行能在这个列表里伪造额外「应用」。
		let name = clip(&app.name, APP_FIELD_LIMIT);
		let mut tail = Vec::new();
		if !app.bundle_id.is_empty() {
			tail.push(clip(&app.bundle_id, APP_FIELD_LIMIT));
		} else {
			// 裸二进制 / plist 读失败:策略的 bundle 前缀对它空转,列表必须
			// 把这件事写出来,不能看起来像「没有 bundle id 的普通应用」。
			tail.push("unresolved-id".to_string());
		}
		tail.push(format!("pid {}", app.pid));
		let mut line = format!("- {} [{}]", if name.is_empty() { "(unnamed)" } else { name.as_str() }, tail.join(", "));
		if !app.window_title.is_empty() {
			line.push_str(&format!(" — \"{}\"", clip(&app.window_title, APP_FIELD_LIMIT)));
		}
		lines.push(line);
	}
	policy::redact_result(&lines.join("\n"))
}

/// 渲染一个快照:头、缩进元素树、截图引用。*text_limit* 逐字段(而非整体)
/// 限幅:单个话痨节点(装着整篇文档的文本区)不能挤掉树的其余部分。
/// 以 redaction 收尾 —— 无障碍值是任意用户内容,可逐字携带凭据。
pub fn render_tree(snap: &Snapshot, text_limit: usize) -> String {
	let mut lines = vec![format!("App={}", snap.app.label())];
	let header = window_header(snap, text_limit);
	if !header.is_empty() {
		lines.push(header);
	}
	lines.push(String::new());

	for rec in &snap.elements {
		lines.push(render_record(rec, text_limit));
	}

	if snap.elements.is_empty() {
		lines.push("(no accessible elements — the window exposed an empty tree)".to_string());
	}
	if snap.truncated {
		lines.push(fill(TRUNCATED_NOTE, &[("{count}", &snap.elements.len().to_string())]));
	}
	if snap.depth_truncated {
		lines.push(fill(DEPTH_NOTE, &[("{depth}", &max_depth(snap).to_string())]));
	}
	let trailer = snapshot_trailer(snap, text_limit);
	if !trailer.is_empty() {
		// 空行分隔:这些行是**关于**树的,不是树中节点;没有这条空隙,
		// 原点注会被读成最后一个元素的兄弟。
		lines.push(String::new());
		lines.extend(trailer);
	}

	let body = policy::redact_result(&lines.join("\n"));

	// 截图注刻意在 redaction **之后**拼接。它 100% 由本包机器生成 —— 自家
	// spool 路径(``shot-<epoch-ms>.jpeg``)、两个整数尺寸、一个字节数 ——
	// 不携带用户数据,无需 redact;而把它**送进** redaction 反而会弄坏它:
	// REF 的 bare-secret-key 启发式会命中 macOS 逐用户临时目录名里的长随机
	// 段(实测),macOS 上每条截图路径都会变不可用 —— 通道静默失效。上方
	// 真正携带任意用户内容的树体照常全量 redact。本移植的自带匹配器虽已
	// 刻意避开裸随机段匹配,不变量仍照守(双保险,且与 REF 行为一致)。
	let image_note = render_image_note(snap);
	if image_note.is_empty() { body } else { format!("{body}\n\n{image_note}") }
}

/// 元素的稳定身份,供两次走查之间的漂移检测。
///
/// 每个变更动作前比对:若此刻坐在某索引上的记录与模型所见指纹不同,树在
/// 它脚下动过 —— 拒绝动作而非点错控件。role/subrole/title 入选因为那是
/// 模型推理的依据(「Save 按钮」),任一变化即不同控件。**value 刻意排除**:
/// 文本框的值随用户键入而变,控件身份毫发未动;折进去会拒绝几乎每个合法
/// 动作。secure 记录只贡献 role/subrole/title —— 指纹永不读凭据字节。
pub fn fingerprint(rec: &ElementRec) -> String {
	format!("{}|{}|{}", rec.role, rec.subrole, rec.title)
}

/// 漂移与失败消息里的简短人/模型面身份。
pub fn describe_record(rec: &ElementRec) -> String {
	let mut label = if rec.role.is_empty() { "?".to_string() } else { rec.role.clone() };
	if !rec.subrole.is_empty() {
		label.push('/');
		label.push_str(&rec.subrole);
	}
	if rec.secure {
		return format!("{label} {SECURE_PLACEHOLDER}");
	}
	if !rec.title.is_empty() {
		return format!("{label} \"{}\"", rec.title);
	}
	label
}

/// 一行树:``<缩进><索引> <角色> "<标题>" [<动作>] <特质> <frame>``。
///
/// 字段顺序:模型**决策**所需的两样在前(它将寻址的索引、它匹配的标签),
/// **行动**所需的两样在后(特质、几何)。扫读「Save 按钮」的模型从左到右,
/// 到标题即可停。
fn render_record(rec: &ElementRec, text_limit: usize) -> String {
	let mut line = format!("{}{} {}", TREE_INDENT.repeat(rec.depth as usize), rec.index, rec.short_role());
	if rec.secure {
		// 安全关键分支。secure 记录的值永不渲染 —— 标题也不:密码框的标题
		// 有时就是它所属的账户名。占位符单独告诉模型「有元素、不可用」。
		// 特质与 frame 同免:`editable` 会证实此框接受输入,矩形会在屏幕上
		// 定位它供坐标点击。
		return format!("{line} {SECURE_PLACEHOLDER}");
	}
	let label = if rec.title.is_empty() { rec.value.as_str() } else { rec.title.as_str() };
	if !label.is_empty() {
		line.push_str(&format!(" \"{}\"", clip(label, text_limit)));
	}
	if !rec.actions.is_empty() {
		line.push_str(&format!(" [{}]", rec.actions.join(", ")));
	}
	if !rec.enabled {
		line.push_str(" (disabled)");
	}
	if !rec.traits.is_empty() {
		line.push_str(&format!(" ({})", rec.traits.join(", ")));
	}
	if rec.focused {
		// 行内标注而非只在尾注:尾注说**哪个**元素有焦点,这里在读到的
		// 当下说「就是这行」。两者都要 —— 截断的树可能切掉尾注的目标
		// 而仍显示此行。
		line.push(' ');
		line.push_str(FOCUS_MARKER);
	}
	if let Some(frame) = rec.frame {
		line.push(' ');
		line.push_str(&render_frame(frame));
	}
	line
}

/// 树之后的行:窗口原点、焦点、选区。三者都关于树而非树的成分,故在其后;
/// 以列表返回(而非就地追加)让顺序在一处陈述、无需渲染整个快照即可测。
/// 与截图注不同,它们随树体一起过 redaction:选区是任意用户内容,可逐字
/// 携带凭据 —— 那正是 redaction 存在的理由。
fn snapshot_trailer(snap: &Snapshot, text_limit: usize) -> Vec<String> {
	let mut out = Vec::new();
	if let Some(bounds) = snap.window_bounds {
		out.push(fill(
			WINDOW_ORIGIN_NOTE,
			&[
				("{x}", &py_round(bounds.x).to_string()),
				("{y}", &py_round(bounds.y).to_string()),
				("{width}", &py_round(bounds.w).to_string()),
				("{height}", &py_round(bounds.h).to_string()),
			],
		));
	}
	if let Some(focused) = snap.elements.iter().find(|rec| rec.focused) {
		out.push(fill(FOCUS_NOTE, &[("{index}", &focused.index.to_string()), ("{label}", &describe_record(focused))]));
	}
	if !snap.selected_text.is_empty() {
		// 与其他应用供给字符串同样压平裁剪:选区可以是整篇文档,其换行会在
		// 上方伪造树行。
		out.push(fill(SELECTION_NOTE, &[("{text}", &clip(&snap.selected_text, text_limit))]));
	}
	out
}

/// ``@ x=12,y=40 48x24`` —— 窗口本地位置与尺寸,整数像素。
///
/// 取整:亚像素精度对点击目标是噪声(Retina 窗口常落在半像素边界),且让
/// 树里每条 frame 宽一倍 —— 约 1200 个节点下是真实的 token 成本。`@` 前缀
/// 与 `WxH` 形状让两对数不会认错 —— 裸 ``12, 40, 48, 24`` 读作四个无标数,
/// 混淆哪对是尺寸的模型会瞄准错误像素。
fn render_frame(frame: Frame) -> String {
	format!("@ x={},y={} {}x{}", py_round(frame.x), py_round(frame.y), py_round(frame.w), py_round(frame.h))
}

/// ``Window: "<标题>", App: <名字>.`` —— 两者皆空时省略。
///
/// 两字段都过 [`clip`],理由与元素标题相同:窗口标题是攻击者可控的应用
/// 内容(浏览器标签的 `document.title`、文件名、邮件主题),而树的结构
/// **就是**缩进 —— 含换行的标题能在此头之下伪造树行(连同一个模型随后
/// 会去寻址的像样索引)或注入指令形状的文本。应用名同样处理:来自同一
/// 不可信进程。
fn window_header(snap: &Snapshot, text_limit: usize) -> String {
	let mut parts: Vec<String> = Vec::new();
	if !snap.window_title.is_empty() {
		parts.push(format!("Window: \"{}\"", clip(&snap.window_title, text_limit)));
	}
	if !snap.app.name.is_empty() {
		parts.push(format!("App: {}", clip(&snap.app.name, text_limit)));
	}
	if parts.is_empty() { String::new() } else { format!("{}.", parts.join(", ")) }
}

/// 截图引用行、抑制说明,或空串。
///
/// 含**任一** secure 元素的窗口完全得不到截图,文本说明原委:密码框渲染
/// 出的像素就是凭据 —— 树虽已 redact 值,像素没有。整窗抑制:没有可靠办法
/// 空白化已编码 JPEG 的子矩形,部分 redaction 若漏了比没有更糟。
///
/// **截断**走查的公告同理:截断的走查不能证明窗口无密码框,「未知」按
/// 「存在」处理(见 capture 的 fail-closed)。截断是 Chromium/Electron 窗口
/// 在 1200 默认下的**常态** —— 没有这条注,浏览器上的截图请求会无图、无
/// 原因,催生这些注本要防止的重试循环。先于 `image_path` 检查(解释不可
/// 被跳过)、后于 `has_secure`(两态并存时保留更具体的原因)。
///
/// 截断注**只在确实请求了图时**发出(`walk_budget.want_image` 回答)。每个
/// 变更动作的刷新走查按设计强制 `want_image=false`,而截断是常态 —— 无条件
/// 的注会给浏览器窗口上每次成功点击追加「Screenshot suppressed … Re-run
/// with a higher max_tree_nodes」,为一个没人要过的图的抑制做广告,还点名
/// 变更类工具根本不接受的参数:同一个重试循环反着来。`None`(后端直建、
/// 无预算盖戳的快照)保留公告 —— 请求未知时,多余的注比静默的缺席便宜。
fn render_image_note(snap: &Snapshot) -> String {
	if snap.has_secure {
		return SECURE_WINDOW_NOTE.to_string();
	}
	let want_image = snap.walk_budget.as_ref().is_some_and(|budget| budget.want_image);
	if snap.image_path.is_empty() && (snap.truncated || snap.depth_truncated) && want_image {
		return TRUNCATED_WINDOW_NOTE.to_string();
	}
	if snap.image_path.is_empty() {
		return String::new();
	}
	let note = fill(
		SCREENSHOT_NOTE,
		&[
			("{path}", &snap.image_path),
			("{width}", &snap.image_width.to_string()),
			("{height}", &snap.image_height.to_string()),
			("{size}", &human_bytes(snap.image_jpeg.len())),
		],
	);
	let scale_note = render_scale_note(snap);
	if scale_note.is_empty() { note } else { format!("{note}\n{scale_note}") }
}

/// 图像像素 → 屏幕点换算;不可知时为空串。
///
/// 四个输入齐全且健全才发出,因为**错的**换算比没有更糟:拿到坏比率的
/// 模型自信地点错地方,拿到空白的退回元素 frame。所以每项都是必需 ——
/// `window_bounds`(换算相加的原点与窗口尺寸参照)、正向的编码宽与窗口宽
/// (比率两项)—— 且只公布**单一** scale 而非每轴一个:编码器保 aspect
/// ratio(按长边缩放),两比率差距在一部舍入之内;印两个永远相等的数只会
/// 邀请读者相信它们可以不同。比率取自宽度:窗口高度含标题栏(Windows)
/// 或渲染含阴影,高度导出的比率可与宽度差一两像素;横向无此歧义。
fn render_scale_note(snap: &Snapshot) -> String {
	let Some(bounds) = snap.window_bounds else { return String::new() };
	if bounds.w <= 0.0 || snap.image_width == 0 {
		return String::new();
	}
	let scale = f64::from(snap.image_width) / bounds.w;
	if scale <= 0.0 {
		return String::new();
	}
	fill(
		SCREENSHOT_SCALE_NOTE,
		&[
			("{x}", &py_round(bounds.x).to_string()),
			("{y}", &py_round(bounds.y).to_string()),
			("{scale}", &scale.to_string()),
			("{win_width}", &py_round(bounds.w).to_string()),
			("{win_height}", &py_round(bounds.h).to_string()),
		],
	)
}

/// 渲染出的最深深度 —— 点出走查停在哪一层。
fn max_depth(snap: &Snapshot) -> u16 {
	snap.elements.iter().map(|rec| rec.depth).max().unwrap_or(0)
}

/// 折叠换行并按 *limit* 字符裁剪,带省略号标记。换行必须折叠:树的结构
/// **就是**缩进 —— 多行值会伪造树行,让页面内容冒充模型可寻址的元素。
///
/// 公开给平台的走查侧:一切进入 `Snapshot` 的任意文本(不止元素值,还有
/// `selected_text`)必须经同一把剪刀 —— 选区是任意用户内容,同样能带换行。
pub fn clip(text: &str, limit: usize) -> String {
	let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
	if limit > 0 && flat.chars().count() > limit {
		let mut out: String = flat.chars().take(limit).collect();
		out.push('…');
		out
	} else {
		flat
	}
}

/// ``24766`` → ``24.2 KB``。
fn human_bytes(size: usize) -> String {
	let size = size as f64;
	if size >= MIB {
		format!("{:.1} MB", size / MIB)
	} else if size >= KIB {
		format!("{:.1} KB", size / KIB)
	} else {
		format!("{} B", size as usize)
	}
}

/// Python `round` 的银行家舍入(REF 全部展示取整用它):半值向偶数。
/// 只影响恰好 .5 的显示值;与 REF 逐字对齐比「更熟悉的上取整」重要。
fn py_round(v: f64) -> i64 {
	let floor = v.floor();
	let diff = v - floor;
	let rounded = if diff > 0.5 {
		floor + 1.0
	} else if diff < 0.5 || (floor as i64) % 2 == 0 {
		floor
	} else {
		floor + 1.0
	};
	rounded as i64
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::types::{Frame, SnapshotRequest};

	fn rec(index: u32, role: &str, title: &str) -> ElementRec {
		ElementRec { index, role: role.into(), title: title.into(), ..Default::default() }
	}

	fn snap_with(elements: Vec<ElementRec>) -> Snapshot {
		Snapshot {
			app: AppRef {
				name: "Calculator".into(),
				pid: 501,
				bundle_id: "com.apple.calculator".into(),
				window_id: 12,
				window_title: "Calculator".into(),
			},
			elements,
			window_title: "Calculator".into(),
			..Default::default()
		}
	}

	#[test]
	fn fingerprint_excludes_value() {
		let mut a = rec(1, "AXTextField", "Notes");
		a.value = "draft one".into();
		let mut b = rec(1, "AXTextField", "Notes");
		b.value = "draft two — the user kept typing".into();
		assert_eq!(fingerprint(&a), fingerprint(&b));
		b.subrole = "AXSearchField".into();
		assert_ne!(fingerprint(&a), fingerprint(&b));
	}

	#[test]
	fn secure_record_renders_placeholder_only() {
		let mut secure = rec(4, "AXTextField", "Admin password");
		secure.subrole = "AXSecureTextField".into();
		secure.secure = true;
		secure.value = "hunter2".into();
		secure.frame = Some(Frame { x: 1.0, y: 2.0, w: 3.0, h: 4.0 });
		secure.traits = vec!["editable".into()];
		let text = render_tree(&snap_with(vec![secure]), 500);
		assert!(text.contains("<secure>"), "{text}");
		assert!(!text.contains("hunter2"), "{text}");
		assert!(!text.contains("Admin password"), "{text}");
		assert!(!text.contains("editable"), "{text}");
		assert!(!text.contains("@ x="), "{text}");
	}

	#[test]
	fn record_line_shape_and_order() {
		let mut r = rec(2, "AXButton", "Save");
		r.actions = vec!["AXPress".into()];
		r.traits = vec!["enabled".into()];
		r.enabled = true;
		r.frame = Some(Frame { x: 12.4, y: 40.2, w: 48.0, h: 24.0 });
		let line = render_record(&r, 500);
		assert!(line.starts_with("2 button \"Save\" [AXPress] (enabled)"), "{line}");
		assert!(line.ends_with("@ x=12,y=40 48x24"), "{line}");
		// 禁用括号在特质之前、动作之后。
		let mut disabled = rec(3, "AXCheckBox", "");
		disabled.enabled = false;
		disabled.traits = vec!["selected".into()];
		let dline = render_record(&disabled, 500);
		assert!(dline.contains("checkbox (disabled) (selected)"), "{dline}");
		// value 作 label 回退。
		let mut valued = rec(5, "AXStaticText", "");
		valued.value = "hello".into();
		assert!(render_record(&valued, 500).contains("\"hello\""));
	}

	#[test]
	fn clip_flattens_and_elides() {
		assert_eq!(clip("a\n  b\tc", 100), "a b c");
		assert_eq!(clip("abcdef", 3), "abc…");
		assert_eq!(clip("short", 0), "short"); // limit=0 = 不裁
		let forged = "line one\n12 button \"Evil\"";
		assert!(!clip(forged, 500).contains('\n'));
	}

	#[test]
	fn apps_listing_shape_and_redaction() {
		let empty = render_apps(&[]);
		assert_eq!(empty, NO_APPS_NOTE);

		let mut app = AppRef {
			name: "Notes".into(),
			pid: 77,
			bundle_id: "com.apple.Notes".into(),
			window_id: 3,
			window_title: "password=supersecret1".into(),
		};
		let text = render_apps(&[app.clone()]);
		assert!(text.starts_with("1 application(s) with on-screen windows:"), "{text}");
		assert!(text.contains("- Notes [com.apple.Notes, pid 77]"), "{text}");
		let unnamed = AppRef { name: "Google Chrome".into(), pid: 927, ..AppRef::default() };
		let unresolved = render_apps(&[unnamed]);
		assert!(unresolved.contains("- Google Chrome [unresolved-id, pid 927]"), "{unresolved}");
		// 标题里的凭据形状经 redaction 不外泄(kv 值段连带吞掉引号也一并涂)。
		assert!(text.contains("[REDACTED: credential]"), "{text}");
		assert!(!text.contains("supersecret1"), "{text}");
		app.window_title = " Meeting notes ".into();
		let plain = render_apps(&[app]);
		assert!(plain.contains("— \"Meeting notes\""), "{plain}");
	}

	#[test]
	fn tree_header_truncation_and_trailer_notes() {
		let mut s = snap_with(vec![rec(0, "AXWindow", "")]);
		s.window_bounds = Some(Frame { x: 100.0, y: 200.0, w: 800.0, h: 600.0 });
		s.truncated = true;
		s.walk_budget = Some(SnapshotRequest { want_image: true, ..Default::default() });
		let text = render_tree(&s, 500);
		assert!(text.starts_with("App=com.apple.calculator (pid 501)"), "{text}");
		assert!(text.contains("Window: \"Calculator\", App: Calculator."), "{text}");
		assert!(text.contains("[tree truncated at 1 nodes]"), "{text}");
		assert!(text.contains("Screenshot suppressed: the accessibility tree was truncated"), "{text}");
		assert!(text.contains("Window origin on screen: x=100,y=200 (800x600)."), "{text}");

		// want_image=false(变更动作的刷新走查):截断公告消失。
		s.walk_budget = Some(SnapshotRequest { want_image: false, ..Default::default() });
		let quiet = render_tree(&s, 500);
		assert!(!quiet.contains("Screenshot suppressed"), "{quiet}");

		// has_secure 优先于截断注(更具体的原因保留)。
		s.has_secure = true;
		let secured = render_tree(&s, 500);
		assert!(secured.contains("secure (password) field, so its pixels"), "{secured}");
	}

	#[test]
	fn screenshot_note_and_scale_conversion() {
		let mut s = snap_with(vec![rec(0, "AXWindow", "")]);
		s.window_bounds = Some(Frame { x: 0.0, y: 0.0, w: 1000.0, h: 500.0 });
		s.image_path = "/tmp/point-computer-shots/shot-1.jpeg".into();
		s.image_width = 500;
		s.image_height = 250;
		s.image_jpeg = vec![0u8; 24_766];
		let text = render_tree(&s, 500);
		assert!(text.contains("Screenshot: /tmp/point-computer-shots/shot-1.jpeg"), "{text}");
		assert!(text.contains("500x250 jpeg, 24.2 KB"), "{text}");
		assert!(text.contains("screen_x = 0 + image_x / 0.5"), "{text}");
		assert!(text.contains("(the image is 0.5x the window's 1000x500 pixels)"), "{text}");
		// 机器生成的截图注在 redaction 之后拼接:路径不被涂。
		assert!(text.contains(&s.image_path), "{text}");

		// 无 window_bounds:换算注省略(错换算比没有糟)。
		s.window_bounds = None;
		assert!(!render_tree(&s, 500).contains("Image-pixel to screen-point"),);
	}

	#[test]
	fn focus_and_selection_trailer() {
		let mut focused = rec(9, "AXTextArea", "Body");
		focused.focused = true;
		let mut s = snap_with(vec![focused]);
		s.selected_text = "the api_key=abcd1234efgh5678 is rotated".into();
		let text = render_tree(&s, 500);
		assert!(text.contains("Focus: element 9 (AXTextArea \"Body\")."), "{text}");
		assert!(text.contains("Selected text: [the [REDACTED: credential]"), "{text}");

		// 嵌入换行的选区不能伪造树行。
		s.selected_text = "a\n12 button \"Fake\"".into();
		let flat = render_tree(&s, 500);
		assert!(flat.contains("Selected text: [a 12 button \"Fake\"]"), "{flat}");
	}

	#[test]
	fn empty_tree_says_so() {
		let text = render_tree(&snap_with(vec![]), 500);
		assert!(text.contains("(no accessible elements — the window exposed an empty tree)"), "{text}");
	}

	#[test]
	fn banker_rounding_matches_ref() {
		assert_eq!(py_round(2.5), 2);
		assert_eq!(py_round(3.5), 4);
		assert_eq!(py_round(-2.5), -2);
		assert_eq!(py_round(12.4), 12);
		assert_eq!(py_round(40.6), 41);
	}

	#[test]
	fn human_bytes_ladder() {
		assert_eq!(human_bytes(999), "999 B");
		assert_eq!(human_bytes(24_766), "24.2 KB");
		assert_eq!(human_bytes(3 * 1024 * 1024), "3.0 MB");
	}
}
