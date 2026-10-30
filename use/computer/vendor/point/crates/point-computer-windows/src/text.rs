//! Bounded focused, selected and document text. Password and unknown security
//! never reach the projection, including as a value that a later layer deletes.
use std::fmt::Write as _;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Security {
	Unknown,
	Secure,
	Clear,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Pattern {
	Unsupported,
	Supported,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Enrichment {
	pub state: &'static str,
	pub reason: &'static str,
	pub focused: Option<String>,
	pub selected: Option<String>,
	pub document: Option<String>,
}

/// Keep Unicode scalars, newlines and surrounding spaces. The budget is UTF-16
/// code units and never splits a surrogate pair.
pub fn bounded_utf16(text: &str, limit: usize) -> String {
	let mut out = String::new();
	let mut used = 0usize;
	for ch in text.chars() {
		let units = ch.len_utf16();
		if used + units > limit {
			break;
		}
		out.push(ch);
		used += units;
	}
	out
}

pub fn project(
	security: Security,
	tree_complete: bool,
	pattern: Pattern,
	focused: &str,
	selected: &str,
	document: &str,
	limit: usize,
) -> Enrichment {
	if security != Security::Clear {
		return Enrichment {
			state: "suppressed",
			reason: "secure_or_unknown",
			focused: None,
			selected: None,
			document: None,
		};
	}
	if pattern == Pattern::Unsupported {
		return Enrichment {
			state: "unavailable",
			reason: "text_pattern_unavailable",
			focused: None,
			selected: None,
			document: None,
		};
	}
	let focused = Some(bounded_utf16(focused, limit));
	let selected = Some(bounded_utf16(selected, limit));
	if !tree_complete {
		return Enrichment { state: "available", reason: "document_withheld", focused, selected, document: None };
	}
	Enrichment { state: "available", reason: "", focused, selected, document: Some(bounded_utf16(document, limit)) }
}

/// The provider closure is not called unless security is already confirmed clear.
pub fn read_if_safe<T>(security: Security, read: impl FnOnce() -> T) -> Option<T> {
	if security == Security::Clear { Some(read()) } else { None }
}

/// Text APIs stay closed until the tree is complete, security is clear, a
/// focused element exists, and no secure ancestor or sibling was seen.
pub fn read_allowed(security: Security, tree_complete: bool, has_focused: bool, has_secure: bool) -> bool {
	security == Security::Clear && tree_complete && has_focused && !has_secure
}

pub fn contains_secret(value: &Enrichment, secret: &str) -> bool {
	let mut rendered = String::new();
	let _ = write!(rendered, "{:?} {:?} {:?} {}", value.focused, value.selected, value.document, value.reason);
	rendered.contains(secret)
}

#[cfg(test)]
mod tests {
	use super::*;

	const SECRET: &str = "correct-horse-battery-staple";

	#[test]
	fn secure_or_unknown_does_not_project_or_read_text() {
		let mut reads = 0;
		assert!(
			read_if_safe(Security::Secure, || {
				reads += 1;
				SECRET
			})
			.is_none()
		);
		assert!(
			read_if_safe(Security::Unknown, || {
				reads += 1;
				SECRET
			})
			.is_none()
		);
		assert_eq!(reads, 0);
		assert!(!read_allowed(Security::Clear, false, true, false));
		assert!(!read_allowed(Security::Clear, true, true, true));
		assert!(!read_allowed(Security::Clear, true, false, false));
		assert!(!read_allowed(Security::Unknown, true, true, false));
		assert!(read_allowed(Security::Clear, true, true, false));
		let mut late = 0;
		assert!(
			read_if_safe(Security::Unknown, || {
				late += 1;
				SECRET
			})
			.is_none()
		);
		assert_eq!(late, 0);
		for security in [Security::Secure, Security::Unknown] {
			let projected = project(security, true, Pattern::Supported, SECRET, SECRET, SECRET, 500);
			assert_eq!(projected.state, "suppressed");
			assert!(!contains_secret(&projected, SECRET));
			assert!(projected.focused.is_none() && projected.document.is_none());
		}
	}

	#[test]
	fn incomplete_tree_omits_document_and_unsupported_pattern_is_empty() {
		let partial = project(Security::Clear, false, Pattern::Supported, " focused\n", " selected ", "DOC", 50);
		assert_eq!(partial.reason, "document_withheld");
		assert_eq!(partial.focused.as_deref(), Some(" focused\n"));
		assert_eq!(partial.selected.as_deref(), Some(" selected "));
		assert!(partial.document.is_none());
		let missing = project(Security::Clear, true, Pattern::Unsupported, SECRET, SECRET, SECRET, 50);
		assert_eq!(missing.state, "unavailable");
		assert_eq!(missing.reason, "text_pattern_unavailable");
		assert!(!contains_secret(&missing, SECRET));
	}

	#[test]
	fn utf16_budget_preserves_whitespace_newlines_and_surrogate_pairs() {
		assert_eq!(bounded_utf16(" a\n ", 8), " a\n ");
		let emoji = " \n🙂";
		assert_eq!(bounded_utf16(emoji, 2), " \n");
		assert_eq!(bounded_utf16(emoji, 4), " \n🙂");
		assert!(bounded_utf16(emoji, 3).chars().all(|ch| ch != '🙂'));
		let full = project(Security::Clear, true, Pattern::Supported, " 中文\n", "🙂", " end ", 20);
		assert_eq!(full.document.as_deref(), Some(" end "));
		assert_eq!(full.selected.as_deref(), Some("🙂"));
	}
}
