//! 极小 JSON 解析器 —— 仅为 keystone `computer_use.json` 服务。
//!
//! 刻意不引 serde:core 必须零依赖(见 crate 文档)。解析面收窄到
//! JSON 的一个子集(对象/数组/字符串/数字/布尔/null),任何非法输入返回
//! [`Json::Null`] 语义之外的 `Err` —— 调用方(enable_state)对一切错误
//! fail-soft 为「禁用」,因此这里的任何缺陷都只能关、不能开。

use std::collections::BTreeMap;
use std::fmt;

/// 解析后的 JSON 值。对象保持插入序(BTreeMap 按键序即可,顺序对语义无关)。
#[derive(Debug, Clone, PartialEq)]
pub enum Json {
	Null,
	Bool(bool),
	Num(f64),
	Str(String),
	Arr(Vec<Json>),
	Obj(BTreeMap<String, Json>),
}

impl Json {
	/// 对象按键取值;非对象或键不存在返回 `None`。
	pub fn get(&self, key: &str) -> Option<&Json> {
		match self {
			Json::Obj(map) => map.get(key),
			_ => None,
		}
	}

	/// 是否为 JSON `true`(严格恒等,拒绝 `"true"`/`1` —— 见 enable_state)。
	pub fn is_true(&self) -> bool {
		matches!(self, Json::Bool(true))
	}

	/// 字符串值。
	pub fn as_str(&self) -> Option<&str> {
		match self {
			Json::Str(s) => Some(s),
			_ => None,
		}
	}

	/// 数组值。
	pub fn as_array(&self) -> Option<&[Json]> {
		match self {
			Json::Arr(items) => Some(items),
			_ => None,
		}
	}
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JsonError;

impl fmt::Display for JsonError {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		f.write_str("malformed JSON")
	}
}

/// 解析一段 JSON 文本。
pub fn parse(text: &str) -> Result<Json, JsonError> {
	let mut p = Parser { bytes: text.as_bytes(), pos: 0 };
	p.skip_ws();
	let value = p.value()?;
	p.skip_ws();
	if p.pos != p.bytes.len() {
		return Err(JsonError);
	}
	Ok(value)
}

struct Parser<'a> {
	bytes: &'a [u8],
	pos: usize,
}

impl<'a> Parser<'a> {
	fn peek(&self) -> Option<u8> {
		self.bytes.get(self.pos).copied()
	}

	fn skip_ws(&mut self) {
		while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
			self.pos += 1;
		}
	}

	fn expect(&mut self, byte: u8) -> Result<(), JsonError> {
		if self.peek() == Some(byte) {
			self.pos += 1;
			Ok(())
		} else {
			Err(JsonError)
		}
	}

	fn value(&mut self) -> Result<Json, JsonError> {
		match self.peek() {
			Some(b'{') => self.object(),
			Some(b'[') => self.array(),
			Some(b'"') => Ok(Json::Str(self.string()?)),
			Some(b't') => self.literal("true", Json::Bool(true)),
			Some(b'f') => self.literal("false", Json::Bool(false)),
			Some(b'n') => self.literal("null", Json::Null),
			Some(c) if c == b'-' || c.is_ascii_digit() => self.number(),
			_ => Err(JsonError),
		}
	}

	fn literal(&mut self, word: &str, value: Json) -> Result<Json, JsonError> {
		if self.bytes[self.pos..].starts_with(word.as_bytes()) {
			self.pos += word.len();
			Ok(value)
		} else {
			Err(JsonError)
		}
	}

	fn number(&mut self) -> Result<Json, JsonError> {
		let start = self.pos;
		if self.peek() == Some(b'-') {
			self.pos += 1;
		}
		let mut saw_digit = false;
		while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
			self.pos += 1;
			saw_digit = true;
		}
		if !saw_digit {
			return Err(JsonError);
		}
		if self.peek() == Some(b'.') {
			self.pos += 1;
			let mut frac = false;
			while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
				self.pos += 1;
				frac = true;
			}
			if !frac {
				return Err(JsonError);
			}
		}
		if matches!(self.peek(), Some(b'e' | b'E')) {
			self.pos += 1;
			if matches!(self.peek(), Some(b'+' | b'-')) {
				self.pos += 1;
			}
			let mut exp = false;
			while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
				self.pos += 1;
				exp = true;
			}
			if !exp {
				return Err(JsonError);
			}
		}
		let text = std::str::from_utf8(&self.bytes[start..self.pos]).map_err(|_| JsonError)?;
		text.parse::<f64>().map(Json::Num).map_err(|_| JsonError)
	}

	fn string(&mut self) -> Result<String, JsonError> {
		self.expect(b'"')?;
		let mut out = String::new();
		loop {
			match self.peek() {
				None | Some(b'"') => break,
				Some(b'\\') => {
					self.pos += 1;
					let escaped = self.peek().ok_or(JsonError)?;
					self.pos += 1;
					match escaped {
						b'"' => out.push('"'),
						b'\\' => out.push('\\'),
						b'/' => out.push('/'),
						b'b' => out.push('\u{0008}'),
						b'f' => out.push('\u{000C}'),
						b'n' => out.push('\n'),
						b'r' => out.push('\r'),
						b't' => out.push('\t'),
						b'u' => {
							let hi = self.hex4()?;
							let ch = if (0xD800..0xDC00).contains(&hi) {
								// 代理对:必须紧跟 \uDC00..\uDFFF 的低半部。
								if self.bytes[self.pos..].starts_with(b"\\u") {
									self.pos += 2;
									let lo = self.hex4()?;
									if (0xDC00..0xE000).contains(&lo) {
										let combined = 0x10000 + ((hi - 0xD800) << 10) + (lo - 0xDC00);
										char::from_u32(combined).ok_or(JsonError)?
									} else {
										return Err(JsonError);
									}
								} else {
									return Err(JsonError);
								}
							} else {
								char::from_u32(hi).ok_or(JsonError)?
							};
							out.push(ch);
						}
						_ => return Err(JsonError),
					}
				}
				Some(byte) if byte < 0x20 => return Err(JsonError),
				Some(_) => {
					// 逐 UTF-8 码点拷贝:输入是 &str,必然合法。
					let rest = std::str::from_utf8(&self.bytes[self.pos..]).map_err(|_| JsonError)?;
					let ch = rest.chars().next().ok_or(JsonError)?;
					out.push(ch);
					self.pos += ch.len_utf8();
				}
			}
		}
		self.expect(b'"')?;
		Ok(out)
	}

	fn hex4(&mut self) -> Result<u32, JsonError> {
		let mut value = 0u32;
		for _ in 0..4 {
			let digit = self.peek().ok_or(JsonError)?;
			let nibble = match digit {
				b'0'..=b'9' => u32::from(digit - b'0'),
				b'a'..=b'f' => u32::from(digit - b'a') + 10,
				b'A'..=b'F' => u32::from(digit - b'A') + 10,
				_ => return Err(JsonError),
			};
			value = value * 16 + nibble;
			self.pos += 1;
		}
		Ok(value)
	}

	fn array(&mut self) -> Result<Json, JsonError> {
		self.expect(b'[')?;
		let mut items = Vec::new();
		self.skip_ws();
		if self.peek() == Some(b']') {
			self.pos += 1;
			return Ok(Json::Arr(items));
		}
		loop {
			self.skip_ws();
			items.push(self.value()?);
			self.skip_ws();
			match self.peek() {
				Some(b',') => self.pos += 1,
				Some(b']') => {
					self.pos += 1;
					return Ok(Json::Arr(items));
				}
				_ => return Err(JsonError),
			}
		}
	}

	fn object(&mut self) -> Result<Json, JsonError> {
		self.expect(b'{')?;
		let mut map = BTreeMap::new();
		self.skip_ws();
		if self.peek() == Some(b'}') {
			self.pos += 1;
			return Ok(Json::Obj(map));
		}
		loop {
			self.skip_ws();
			let key = self.string()?;
			self.skip_ws();
			self.expect(b':')?;
			self.skip_ws();
			let value = self.value()?;
			map.insert(key, value);
			self.skip_ws();
			match self.peek() {
				Some(b',') => self.pos += 1,
				Some(b'}') => {
					self.pos += 1;
					return Ok(Json::Obj(map));
				}
				_ => return Err(JsonError),
			}
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn parses_keystone_shape() {
		let value = parse(
			r#"{"enabled": true, "allowed_apps": ["Preview", "Safari"],
			"extra_denied_apps": []}"#,
		)
		.unwrap();
		assert!(value.get("enabled").unwrap().is_true());
		let allowed = value.get("allowed_apps").unwrap().as_array().unwrap();
		assert_eq!(allowed.len(), 2);
		assert_eq!(allowed[0].as_str(), Some("Preview"));
		assert!(value.get("extra_denied_apps").unwrap().as_array().unwrap().is_empty());
	}

	#[test]
	fn strict_bool_identity() {
		let value = parse(r#"{"enabled": "true"}"#).unwrap();
		assert!(!value.get("enabled").unwrap().is_true());
		let value = parse(r#"{"enabled": 1}"#).unwrap();
		assert!(!value.get("enabled").unwrap().is_true());
	}

	#[test]
	fn rejects_trailing_garbage_and_broken_input() {
		assert!(parse("{} x").is_err());
		assert!(parse("{\"a\":}").is_err());
		assert!(parse("[1,]").is_err());
		assert!(parse("").is_err());
		assert!(parse("\"unterminated").is_err());
	}

	#[test]
	fn unicode_escapes_and_control_reject() {
		let value = parse(r#""é a ✓""#).unwrap();
		assert_eq!(value.as_str(), Some("é a ✓"));
		assert!(parse("\"\u{0001}\"").is_err());
		let surrogate_pair = parse(r#""😀""#).unwrap();
		assert_eq!(surrogate_pair.as_str(), Some("😀"));
	}
}
