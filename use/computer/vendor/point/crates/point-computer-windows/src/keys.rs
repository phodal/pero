//! Logical KeySpec to Windows VK; never reuse Carbon keycodes.
use point_computer_core::keymap::parse_spec;

/// Windows edit controls consume CR for a logical line break. Bound paced
/// input before dispatch so callers split larger text with fresh observations.
pub fn text_units(text: &str) -> Result<Vec<u16>, String> {
	let units: Vec<_> = text.replace("\r\n", "\n").replace('\r', "\n").replace('\n', "\r").encode_utf16().collect();
	if units.len() > 64 || units.contains(&0) {
		return Err("WINDOWS_TEXT_LIMIT: at most 64 UTF-16 units without NUL per observed action".into());
	}
	Ok(units)
}

pub fn translate(spec: &str) -> Result<(u16, Vec<u16>), String> {
	let parsed = parse_spec(spec).map_err(|e| e.to_string())?;
	let key = match parsed.key.as_str() {
		s if s.len() == 1 && s.as_bytes()[0].is_ascii_alphanumeric() => s.as_bytes()[0].to_ascii_uppercase() as u16,
		"enter" | "return" => 0x0d,
		"tab" => 0x09,
		"space" => 0x20,
		"escape" => 0x1b,
		"backspace" => 0x08,
		"delete" => 0x2e,
		"home" => 0x24,
		"end" => 0x23,
		"left" => 0x25,
		"up" => 0x26,
		"right" => 0x27,
		"down" => 0x28,
		"pageup" => 0x21,
		"pagedown" => 0x22,
		s if s.starts_with('f') => {
			let n = s[1..].parse::<u16>().map_err(|_| "unsupported Windows key")?;
			if !(1..=12).contains(&n) {
				return Err("unsupported Windows function key".into());
			}
			0x70 + n - 1
		}
		_ => return Err("unsupported Windows key; submit literal text separately".into()),
	};
	let modifiers = parsed
		.modifiers
		.iter()
		.map(|m| match m.as_str() {
			"ctrl" => Ok(0x11),
			"shift" => Ok(0x10),
			"alt" => Ok(0x12),
			"win" => Ok(0x5b),
			_ => Err("unsupported Windows modifier".to_string()),
		})
		.collect::<Result<Vec<_>, _>>()?;
	Ok((key, modifiers))
}

#[cfg(test)]
mod tests {
	use super::*;
	#[test]
	fn logical_chords_are_windows_codes() {
		assert_eq!(translate("ctrl+s").unwrap(), (0x53, vec![0x11]));
		assert_eq!(translate("Return").unwrap().0, 0x0d);
		assert!(translate("fn+a").is_err());
	}
	#[test]
	fn text_preserves_unicode_and_maps_one_logical_newline() {
		assert_eq!(text_units("中\n🙂\r\nend\r").unwrap(), "中\r🙂\rend\r".encode_utf16().collect::<Vec<_>>());
		assert_eq!(text_units(&"🙂".repeat(32)).unwrap().len(), 64);
		assert!(text_units(&"🙂".repeat(33)).is_err());
		assert!(text_units("a\0b").is_err());
	}
}
