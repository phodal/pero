//! `press_key` 的 spec 词表 —— 平台无关语法架在 macOS 码表之上。
//! REF `keymap.py` 的移植。
//!
//! 两层,分层是承重的而非整洁:
//!
//! * **语法平台无关。** [`parse_spec`] 把 spec 字符串(`"cmd+shift+a"`)解析
//!   为抽象名的 [`KeySpec`];[`KEY_NAMES`]/[`MODIFIER_NAMES`] 是所有平台共享
//!   的词表。tools 在 dispatch chokepoint 内经此层校验 —— 未知键/修饰键在
//!   **任何** driver 向活应用合成按键之前被拒,在每个平台上。
//! * **下面的数字是 macOS 专属。** Carbon 虚拟键码(`kVK_*`,HITToolbox/
//!   Events.h)与 CoreGraphics 事件标志位(`kCGEventFlagMask*`)。它们是
//!   稳定 ABI 常量,无需框架即可读取(Linux CI 上可单测)—— 但不可移植,
//!   [`parse_key`] 的 `(keycode, flags)` 对是 macOS 形状。第二个平台**必须**
//!   以 [`KeySpec`] 为键自建码表,而不是重新解释这一张:Windows 的 `VK_*`
//!   与 `kVK_*` 是同一按键的不同数字,一个逐平台悄悄变义的元组正是「错误
//!   按键敲进活窗口」的来路。
//!
//! 每个合成键事件必须携带从零建起、只 OR 调用方所点修饰键的**显式**标志
//! 掩码。跳过这一步的原型曾把 `abc` 敲成 `' I Abc'` —— 事件继承了投递时
//! 用户的真实修饰键状态。

use std::collections::HashMap;
use std::sync::OnceLock;

use crate::types::ComputerUseError;

// ── CoreGraphics 事件标志位(kCGEventFlagMask*) ──
pub const FLAG_ALPHA_SHIFT: u64 = 0x0001_0000;
pub const FLAG_SHIFT: u64 = 0x0002_0000;
pub const FLAG_CONTROL: u64 = 0x0004_0000;
pub const FLAG_ALTERNATE: u64 = 0x0008_0000;
pub const FLAG_COMMAND: u64 = 0x0010_0000;
pub const FLAG_SECONDARY_FN: u64 = 0x0080_0000;

/// 模型可能给出的修饰键拼法,全部归一到 macOS 掩码。`super`/`meta`/`win`
/// 映到 Command 让跨平台提示仍可用;`fn` 收录因为某些应用快捷键需要它。
/// 这是 **macOS 的答案**;跨平台的**意图**归一在 [`MODIFIER_ALIASES`]。
pub const MODIFIERS: &[(&str, u64)] = &[
	("cmd", FLAG_COMMAND),
	("command", FLAG_COMMAND),
	("super", FLAG_COMMAND),
	("meta", FLAG_COMMAND),
	("win", FLAG_COMMAND),
	("shift", FLAG_SHIFT),
	("option", FLAG_ALTERNATE),
	("opt", FLAG_ALTERNATE),
	("alt", FLAG_ALTERNATE),
	("control", FLAG_CONTROL),
	("ctrl", FLAG_CONTROL),
	("fn", FLAG_SECONDARY_FN),
	("function", FLAG_SECONDARY_FN),
	("capslock", FLAG_ALPHA_SHIFT),
];

// ── 虚拟键码(kVK_*),完整 US 布局 ──
// 键名小写,归一后查找即大小写不敏感。命名键各带数个别名(`esc`/`escape`、
// `enter`/`return`、`pgup`/`pageup` …):模型的拼法不稳定,为拼法差异抛
// KeyParse 是无谓的失败。
pub const KEYCODES: &[(&str, u8)] = &[
	// 字母
	("a", 0),
	("b", 11),
	("c", 8),
	("d", 2),
	("e", 14),
	("f", 3),
	("g", 5),
	("h", 4),
	("i", 34),
	("j", 38),
	("k", 40),
	("l", 37),
	("m", 46),
	("n", 45),
	("o", 31),
	("p", 35),
	("q", 12),
	("r", 15),
	("s", 1),
	("t", 17),
	("u", 32),
	("v", 9),
	("w", 13),
	("x", 7),
	("y", 16),
	("z", 6),
	// 数字
	("0", 29),
	("1", 18),
	("2", 19),
	("3", 20),
	("4", 21),
	("5", 23),
	("6", 22),
	("7", 26),
	("8", 28),
	("9", 25),
	// 标点(未 shift 字形 + 各一个词别名)
	("-", 27),
	("minus", 27),
	("=", 24),
	("equal", 24),
	("equals", 24),
	("[", 33),
	("leftbracket", 33),
	("]", 30),
	("rightbracket", 30),
	("\\", 42),
	("backslash", 42),
	(";", 41),
	("semicolon", 41),
	("'", 39),
	("quote", 39),
	("apostrophe", 39),
	(",", 43),
	("comma", 43),
	(".", 47),
	("period", 47),
	("dot", 47),
	("/", 44),
	("slash", 44),
	("`", 50),
	("grave", 50),
	("backtick", 50),
	// 空白 / 编辑
	("space", 49),
	(" ", 49),
	("spacebar", 49),
	("return", 36),
	("enter", 36),
	("tab", 48),
	("delete", 51),
	("backspace", 51),
	("forwarddelete", 117),
	("del", 117),
	("escape", 53),
	("esc", 53),
	("help", 114),
	("insert", 114),
	// 导航
	("left", 123),
	("right", 124),
	("down", 125),
	("up", 126),
	("arrowleft", 123),
	("arrowright", 124),
	("arrowdown", 125),
	("arrowup", 126),
	("home", 115),
	("end", 119),
	("pageup", 116),
	("pgup", 116),
	("pagedown", 121),
	("pgdn", 121),
	("pgdown", 121),
	// 功能键
	("f1", 122),
	("f2", 120),
	("f3", 99),
	("f4", 118),
	("f5", 96),
	("f6", 97),
	("f7", 98),
	("f8", 100),
	("f9", 101),
	("f10", 109),
	("f11", 103),
	("f12", 111),
	("f13", 105),
	("f14", 107),
	("f15", 113),
	("f16", 106),
	("f17", 64),
	("f18", 79),
	("f19", 80),
	("f20", 90),
	// 小键盘
	("keypad0", 82),
	("keypad1", 83),
	("keypad2", 84),
	("keypad3", 85),
	("keypad4", 86),
	("keypad5", 87),
	("keypad6", 88),
	("keypad7", 89),
	("keypad8", 91),
	("keypad9", 92),
	("keypadclear", 71),
	("keypaddecimal", 65),
	("keypaddivide", 75),
	("keypadenter", 76),
	("keypadequals", 81),
	("keypadminus", 78),
	("keypadmultiply", 67),
	("keypadplus", 69),
	// 媒体 / 音量(裸键码;无需特殊 HID 处理)
	("mute", 74),
	("volumedown", 73),
	("volumeup", 72),
];

/// US 布局下必须 Shift 才够得着的字符。文本不得不以按键敲出时用(没有可
/// set value 的可寻址元素):`$` 的按键是 Shift+4,shift 标志只加在那一枚
/// 事件上。
pub const SHIFTED_CHARS: &[(&str, &str)] = &[
	("~", "`"),
	("!", "1"),
	("@", "2"),
	("#", "3"),
	("$", "4"),
	("%", "5"),
	("^", "6"),
	("&", "7"),
	("*", "8"),
	("(", "9"),
	(")", "0"),
	("_", "-"),
	("+", "="),
	("{", "["),
	("}", "]"),
	("|", "\\"),
	(":", ";"),
	("\"", "'"),
	("<", ","),
	(">", "."),
	("?", "/"),
];

/// spec 里修饰键与键之间接受的分隔符。`-` **刻意不在**其中:它本身就是键
/// 名,`cmd-` 会歧义。
const SPEC_SEPARATOR: char = '+';

/// 抽象修饰键词表 —— 拼法本身,不带任何平台的数字掩码。模型对这些的拼法
/// 不稳定,为拼法差异拒绝是无谓失败,所以每个可信别名都收;`super`/`meta`/
/// `win` 刻意以自己的名字列出而非预先折叠:它们**意味**什么按平台决定
/// (macOS 是 Command;Windows 码表须自行决定 `cmd+s` 指 logo 键还是 Ctrl
/// —— 写它的模型的意思是 SAVE)。
pub fn modifier_names() -> impl Iterator<Item = &'static str> {
	MODIFIERS.iter().map(|(name, _)| *name)
}

/// 修饰键别名 → 规范名。手写而非从 [`MODIFIERS`] 按掩码恒等推导 —— 那张
/// 表是 **macOS 的答案**而不是问题本身:`super`/`meta`/`win` 在那边共享
/// `FLAG_COMMAND`,按掩码推导的表会把 `win` 规范成 `cmd`,替 Windows 预先
/// 决定 logo 键意味着 Ctrl。
///
/// 规范化使 [`KeySpec`] 可作跨平台缝隙。没有它,按 `spec.modifiers` 里
/// `"ctrl" in …` 自然书写的平台码表会静默漏掉 `control+c` —— 往活窗口送
/// 一枚裸 `c`,正是 [`parse_spec`] 要防止的「与请求不同的按键」。
///
/// **映射跟意图,不跟键名。** `cmd`/`command`/`super`/`meta` 全部规范到
/// `ctrl`:调用方写 `cmd+s` 的意思是保存,Windows 上那是 Ctrl+S —— 送
/// logo 键则打开搜索、文档没保存、随后的关闭丢掉编辑,一条从模型被告知
/// 可以这么写的 spec 走出来的数据丢失路径。`win` 是唯一指名物理 logo 键
/// 的拼法,因此保持自身,`win+d` 仍到 Show Desktop。macOS 不受影响:
/// [`MODIFIERS`] 在那边把这一切都映到 `FLAG_COMMAND`,`parse_key` 读的是
/// 那张表,不是这张。
pub const MODIFIER_ALIASES: &[(&str, &str)] = &[
	("cmd", "ctrl"),
	("command", "ctrl"),
	("super", "ctrl"),
	("meta", "ctrl"),
	("win", "win"),
	("shift", "shift"),
	("option", "alt"),
	("opt", "alt"),
	("alt", "alt"),
	("control", "ctrl"),
	("ctrl", "ctrl"),
	("fn", "fn"),
	("function", "fn"),
	("capslock", "capslock"),
];

/// 修饰键的规范拼法;未知原样返回。对参数全量,理由与 [`canonical_key`]
/// 相同:拒绝是 [`parse_spec`] 那一层的事,这里只归一。
pub fn canonical_modifier(name: &str) -> String {
	MODIFIER_ALIASES
		.iter()
		.find(|(alias, _)| *alias == name)
		.map(|(_, canonical)| (*canonical).to_string())
		.unwrap_or_else(|| name.to_string())
}

/// 抽象键词表:spec 可用的一切名字,别名在内。
pub fn key_names() -> impl Iterator<Item = &'static str> {
	KEYCODES.iter().map(|(name, _)| *name)
}

/// 在 macOS 上共享同一键码、在别处是**不同物理键**的名字。各自是自己的
/// 规范名,键别名表不能把它们折叠进邻居。
///
/// [`KEYCODES`] 是 macOS 表,而 macOS 把几个不同的键解析到同一个 `kVK_*`:
/// `delete`/`backspace` 都是 51,`help`/`insert` 都是 114。纯按键码恒等推导
/// 规范名会得到 `canonical_key("delete") == "backspace"` —— 对 macOS 正确,
/// 对 `VK_DELETE` 与 `VK_BACK` 是不同键的其他所有平台全错。按折叠名书写的
/// Windows 码表会对 `press_key("delete")` 送 Backspace —— 删光标**前**的
/// 字符而非其后 —— 且让 `VK_DELETE`/`VK_INSERT` 无法表达。
///
/// `space`/`spacebar` 也在内 —— 不是因为键不同,而是让规范拼法是平台码表
/// 会用的那个普通拼法。
const SELF_CANONICAL: &[&str] = &["delete", "backspace", "help", "insert", "space", "spacebar"];

/// 别名 → 规范名:按 [`KEYCODES`] 键码恒等推导,SELF_CANONICAL 例外。构建
/// 而非手写,使其不可能与上方表漂移;在那里加一个别名无需在此二次编辑。
///
/// 这让每个平台码表不必重复全部 `esc`/`escape`、`pgup`/`pageup`/`pagedown`/
/// `pgdn`/`pgdown`、`enter`/`return`、`del`/`forwarddelete` …:按规范名键入
/// 的 Windows 码表一网打尽,缺别名不可能静默拒绝一个模型合法拼出的键。
///
/// 规范名取该键码**最长**的拼法 —— 选描述形(`escape` 优于 `esc`、
/// `pagedown` 优于 `pgdn`),人读的表因此言之有物;并列按字母序破,选择
/// 确定而非依赖表序。
fn key_aliases() -> &'static HashMap<&'static str, &'static str> {
	static MAP: OnceLock<HashMap<&'static str, &'static str>> = OnceLock::new();
	MAP.get_or_init(|| {
		let mut map = HashMap::new();
		for (name, code) in KEYCODES {
			let canonical = if SELF_CANONICAL.contains(name) {
				*name
			} else {
				KEYCODES
					.iter()
					.filter(|(other, other_code)| other_code == code && !SELF_CANONICAL.contains(other))
					.map(|(other, _)| *other)
					.max_by(|a, b| (a.len(), *a).cmp(&(b.len(), *b)))
					.unwrap_or(*name)
			};
			map.insert(*name, canonical);
		}
		map
	})
}

/// 键的规范拼法;未知原样返回。对参数全量:未知名原样返回而非报错 ——
/// [`parse_spec`] 是拒绝层,这里只是归一器。
pub fn canonical_key(name: &str) -> String {
	key_aliases().get(name).map(|canonical| (*canonical).to_string()).unwrap_or_else(|| name.to_string())
}

/// 一枚解析后的按键 spec,抽象名 —— 无平台数字。
///
/// `modifiers` 持**规范**修饰键名(绝非掩码、绝非调用方别名),`key` 是
/// [`key_names`] 中的规范键名。
///
/// **调用方给的 `shift+` 与隐含的 shift 是同一个 spec。** 键 token 可以自
/// 带 Shift 需求(`$` 是 Shift+4,`A` 是 Shift+a),[`parse_spec`] 把它折进
/// `modifiers` 而非单独上报,故 `parse_spec("A") == parse_spec("shift+a")`。
///
/// 所以没有 `implied_shift` 字段。Shift 是这枚按键的要求,不是调用方拼法
/// 的属性;平台码表读 `"shift" ∈ spec.modifiers` 就行,不可能忘记第二面
/// 旗。来源字段也会破坏上面的相等 —— 产生同一按键的两个 spec 必须相等。
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct KeySpec {
	pub key: String,
	/// 已排序去重的规范修饰键名。
	pub modifiers: Vec<String>,
}

/// 把按键 spec 解析为平台无关的 [`KeySpec`]。**THE 校验缝隙。**
///
/// tools 的 `_perform` 在 dispatch chokepoint 调用它,未知修饰键/键在任何
/// 平台的 driver 能把它合成进活窗口之前被拒。空 spec、未知修饰键、未知
/// 键、无键部的 spec(`"cmd+"`)报 [`ComputerUseError::KeyParse`]。
///
/// 大声拒绝是对的:静默丢弃未识别的修饰键 = 送出与请求**不同**的按键。
///
/// 返回 spec 的两半都是**规范**的 —— 修饰键过 [`MODIFIER_ALIASES`],键过
/// 键别名表 —— 平台码表按每键每修饰键一种拼法书写。原样返回调用方拼法
/// 会在下一层重建此缝隙要防的失败:按 `"ctrl" ∈ spec.modifiers` 测试的码表
/// 会漏 `control+c` 送裸 `c`。
pub fn parse_spec(spec: &str) -> Result<KeySpec, ComputerUseError> {
	let tokens = tokenize(spec)?;
	let mut names: Vec<String> = Vec::new();
	for token in &tokens[..tokens.len() - 1] {
		let name = token.to_lowercase();
		if modifier_mask(&name).is_none() {
			return Err(ComputerUseError::KeyParse(format!("unknown modifier '{token}' in '{spec}'")));
		}
		let canonical = canonical_modifier(&name);
		if !names.contains(&canonical) {
			names.push(canonical);
		}
	}

	let key = tokens.last().expect("tokenize 保证非空");
	let (resolved, implied_shift) = resolve_name_token(key)
		.ok_or_else(|| ComputerUseError::KeyParse(format!("unknown key '{key}' in '{spec}'")))?;
	if implied_shift {
		// 折入:隐含 shift 与写出的是同一 spec。平台码表只读 modifiers,
		// 不可能忘记第二面旗。
		let shift = canonical_modifier("shift");
		if !names.contains(&shift) {
			names.push(shift);
		}
	}
	names.sort();
	Ok(KeySpec { key: resolved, modifiers: names })
}

/// 把按键 spec 解析为 macOS `(keycode, flag_mask)`。
///
/// [`parse_spec`] 的 macOS 形状对应物:数字是 Carbon 键码与 CoreGraphics
/// 标志位,给 macOS driver 与其测试用,不给跨平台调用方。
///
/// 掩码从**零**建起 —— 绝不从当前修饰键状态 —— 合成事件恰好携带被请求的
/// 修饰键。空 spec、未知修饰键、未知键、无键部 spec 报 KeyParse;大声拒绝
/// 的理由同上:静默丢弃未识别的修饰键 = 往活应用送出与请求不同的按键。
pub fn parse_key(spec: &str) -> Result<(u8, u64), ComputerUseError> {
	let tokens = tokenize(spec)?;

	let mut flags: u64 = 0;
	for token in &tokens[..tokens.len() - 1] {
		let Some(mask) = modifier_mask(&token.to_lowercase()) else {
			return Err(ComputerUseError::KeyParse(format!("unknown modifier '{token}' in '{spec}'")));
		};
		flags |= mask;
	}

	let key = tokens.last().expect("tokenize 保证非空");
	let (keycode, implied_flags) = resolve_key_token(key);
	let Some(keycode) = keycode else {
		return Err(ComputerUseError::KeyParse(format!("unknown key '{key}' in '{spec}'")));
	};
	Ok((keycode, flags | implied_flags))
}

/// 单个可打印字符的 `(keycode, flag_mask)`,US 布局够不着的返回 `None`。
///
/// 按键合成路径用(向无 settable value 的目标敲文本)。够不着的字符调用方
/// 必须**跳过**而非代换 —— 往活应用敲错字符比不敲更糟。
pub fn char_keystroke(ch: &str) -> Option<(u8, u64)> {
	if ch.is_empty() {
		return None;
	}
	let (keycode, flags) = resolve_key_token(ch);
	keycode.map(|code| (code, flags))
}

fn modifier_mask(name: &str) -> Option<u64> {
	MODIFIERS.iter().find(|(modifier, _)| *modifier == name).map(|(_, mask)| *mask)
}

fn keycode_of(name: &str) -> Option<u8> {
	KEYCODES.iter().find(|(key, _)| *key == name).map(|(_, code)| *code)
}

fn shifted_base(key: &str) -> Option<&'static str> {
	SHIFTED_CHARS.iter().find(|(shifted, _)| *shifted == key).map(|(_, base)| *base)
}

/// 一个键 token → `(规范名 | None, 隐含 shift)`。与 [`resolve_key_token`]
/// 镜像但停留在名字空间:shifted 字形与大写规则只陈述一次,每个平台码表
/// 继承之。
fn resolve_name_token(key: &str) -> Option<(String, bool)> {
	if key.is_empty() {
		return None;
	}
	if let Some(base) = shifted_base(key) {
		return keycode_of(base).map(|_| (canonical_key(base), true));
	}
	let mut chars = key.chars();
	if let (Some(c), None) = (chars.next(), chars.next())
		&& c.is_alphabetic()
		&& c.is_uppercase()
	{
		let lowered = key.to_lowercase();
		return keycode_of(&lowered).map(|_| (canonical_key(&lowered), true));
	}
	let lowered = key.to_lowercase();
	keycode_of(&lowered).map(|_| (canonical_key(&lowered), false))
}

/// 一个键 token → `(keycode | None, 隐含 flags)`。隐含 flags 覆盖 shifted
/// 字形(`$` → Shift+4)与大写字母(`A` → Shift+a);调用方给的 `shift+`
/// 只是 OR 进同一位,两种拼法产出同一事件。
fn resolve_key_token(key: &str) -> (Option<u8>, u64) {
	if key.is_empty() {
		return (None, 0);
	}
	if let Some(base) = shifted_base(key) {
		return (keycode_of(base), FLAG_SHIFT);
	}
	let mut chars = key.chars();
	if let (Some(c), None) = (chars.next(), chars.next())
		&& c.is_alphabetic()
		&& c.is_uppercase()
	{
		return (keycode_of(&key.to_lowercase()), FLAG_SHIFT);
	}
	(keycode_of(&key.to_lowercase()), 0)
}

/// 把 spec 切成 `[*修饰键, 键]`,否则报 KeyParse。抽象/macOS 两条解析路径
/// 共用,语法 —— 含「`+` 本身是键」特例 —— 不可能在两处漂移。
fn tokenize(spec: &str) -> Result<Vec<String>, ComputerUseError> {
	let raw = spec.trim();
	if raw.is_empty() {
		return Err(ComputerUseError::KeyParse("empty key spec".into()));
	}

	// 裸 `+`(或以 `+` 结尾的 spec,如 `shift++`)指加号键本身 —— US 布局
	// 的 Shift+equal。先于切分处理,否则切分会产出空键部。
	let parts: Vec<&str> = if raw.len() == 1 && raw == "+" {
		vec!["+"]
	} else if let Some(stripped) = raw.strip_suffix('+') {
		stripped.split(SPEC_SEPARATOR).filter(|part| !part.is_empty()).chain(std::iter::once("+")).collect()
	} else {
		raw.split(SPEC_SEPARATOR).collect()
	};

	let tokens: Vec<String> =
		parts.iter().map(|part| part.trim()).filter(|part| !part.is_empty()).map(str::to_string).collect();
	if tokens.is_empty() {
		return Err(ComputerUseError::KeyParse(format!("no key in spec '{spec}'")));
	}
	Ok(tokens)
}

#[cfg(test)]
mod tests {
	use super::*;

	fn err(spec: &str) -> ComputerUseError {
		parse_key(spec).unwrap_err()
	}

	#[test]
	fn parse_key_macos_shapes() {
		assert_eq!(parse_key("a").unwrap(), (0, 0));
		assert_eq!(parse_key("cmd+shift+a").unwrap(), (0, FLAG_COMMAND | FLAG_SHIFT));
		// macOS 答案:意图别名全映 Command。
		for spelling in ["cmd", "command", "super", "meta", "win"] {
			let (_, flags) = parse_key(&format!("{spelling}+a")).unwrap();
			assert_eq!(flags, FLAG_COMMAND, "{spelling}");
		}
		assert_eq!(parse_key("alt+left").unwrap(), (123, FLAG_ALTERNATE));
		assert_eq!(parse_key("ctrl+up").unwrap(), (126, FLAG_CONTROL));
	}

	#[test]
	fn implied_shift_folds_into_flags() {
		assert_eq!(parse_key("$").unwrap(), (21, FLAG_SHIFT)); // Shift+4(kVK "4"=21)
		assert_eq!(parse_key("?").unwrap(), (44, FLAG_SHIFT));
		assert_eq!(parse_key("A").unwrap(), (0, FLAG_SHIFT));
		// 显式 shift OR 进同一位:两种拼法同一事件。
		assert_eq!(parse_key("shift+A").unwrap(), (0, FLAG_SHIFT));
	}

	#[test]
	fn plus_is_a_key() {
		assert_eq!(parse_key("+").unwrap(), (24, FLAG_SHIFT));
		assert_eq!(parse_key("shift++").unwrap(), (24, FLAG_SHIFT));
		assert_eq!(parse_key("cmd + +").unwrap(), (24, FLAG_COMMAND | FLAG_SHIFT));
	}

	#[test]
	fn parse_errors_name_the_offender() {
		assert!(matches!(err(""), ComputerUseError::KeyParse(_)));
		assert!(matches!(err("   "), ComputerUseError::KeyParse(_)));
		// 以 "+" 结尾 = 加号键(Shift+equal),不是缺键部。
		assert_eq!(parse_key("cmd+").unwrap(), (24, FLAG_COMMAND | FLAG_SHIFT));
		let bad_modifier = err("hyper+a").to_string();
		assert!(bad_modifier.contains("unknown modifier 'hyper'"), "{bad_modifier}");
		let bad_key = err("cmd+nonsense").to_string();
		assert!(bad_key.contains("unknown key 'nonsense'"), "{bad_key}");
		// `-` 不是分隔符:它是键名。
		assert!(parse_key("cmd-a").is_err());
	}

	#[test]
	fn char_keystroke_reachability() {
		assert_eq!(char_keystroke("x").unwrap(), (7, 0));
		assert_eq!(char_keystroke("X").unwrap(), (7, FLAG_SHIFT));
		assert_eq!(char_keystroke("5").unwrap(), (23, 0));
		assert_eq!(char_keystroke("%").unwrap(), (23, FLAG_SHIFT));
		assert_eq!(char_keystroke("é"), None); // US 单键够不着:跳过,不代换
		assert_eq!(char_keystroke(""), None);
	}

	#[test]
	fn spec_is_cross_platform_intent() {
		// cmd/command/super/meta → ctrl(意图:保存就是 Ctrl+S)。
		for spelling in ["cmd", "command", "super", "meta"] {
			let spec = parse_spec(&format!("{spelling}+s")).unwrap();
			assert_eq!(spec.modifiers, vec!["ctrl".to_string()], "{spelling}");
		}
		// win 保持自身:win+d 是 Show Desktop 的物理键。
		let win = parse_spec("win+d").unwrap();
		assert_eq!(win.modifiers, vec!["win".to_string()]);
		// 别名归一:control 与 ctrl 是同一 spec。
		assert_eq!(parse_spec("control+c").unwrap(), parse_spec("ctrl+c").unwrap());
	}

	#[test]
	fn spec_implies_and_folds_shift() {
		assert_eq!(parse_spec("A").unwrap(), parse_spec("shift+a").unwrap());
		// "$" 的 base 是 "4":隐含 shift 折入后与显式拼法是同一 spec。
		assert_eq!(parse_spec("$").unwrap(), parse_spec("shift+4").unwrap());
		assert_eq!(parse_spec("$").unwrap().key, "4");
	}

	#[test]
	fn canonical_names_are_descriptive_and_self_canonical_kept() {
		assert_eq!(canonical_key("esc"), "escape");
		assert_eq!(canonical_key("pgdn"), "pagedown");
		assert_eq!(canonical_key("del"), "forwarddelete");
		// 最长拼法规则:code 123 组 {"left","arrowleft"} 的规范名是 arrowleft
		// (REF 同款 max-by-(len, name) 推导,两拼写共用一个规范名)。
		assert_eq!(canonical_key("arrowleft"), "arrowleft");
		assert_eq!(canonical_key("left"), "arrowleft");
		// SELF_CANONICAL:macOS 同码、别处异键 —— 不折叠。
		assert_eq!(canonical_key("backspace"), "backspace");
		assert_eq!(canonical_key("delete"), "delete");
		assert_eq!(canonical_key("insert"), "insert");
		// SELF_CANONICAL 内的名字自映射:spacebar 不折叠进 space(REF 同款
		// `name if name in _SELF_CANONICAL` 分支)。
		assert_eq!(canonical_key("spacebar"), "spacebar");
		assert_eq!(canonical_key("space"), "space");
	}

	#[test]
	fn keycode_table_spot_checks() {
		assert_eq!(keycode_of("a"), Some(0));
		assert_eq!(keycode_of("f13"), Some(105));
		assert_eq!(keycode_of("mute"), Some(74));
		assert_eq!(keycode_of("keypadenter"), Some(76));
		assert_eq!(keycode_of("É"), None);
		// delete 与 forwarddelete 是不同键:51 / 117。
		assert_ne!(keycode_of("delete"), keycode_of("forwarddelete"));
	}
}
