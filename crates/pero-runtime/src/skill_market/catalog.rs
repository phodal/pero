//! Served catalog projection. Installation still reads the pinned source fields.
use serde_json::{Map, Value};

const SECTION_TEXT_LIMIT: usize = 4_000;
const SECRET_KEYS: &[&str] = &[
    "api_key",
    "api-key",
    "apikey",
    "authorization",
    "password",
    "secret",
    "token",
];

/// Removes extraction code, raw frontmatter and credential-shaped text before a
/// catalog is shown or packaged. Source pins and license evidence stay intact.
pub fn sanitize_catalog(bytes: &[u8]) -> Result<Vec<u8>, String> {
    if bytes.len() > 64 * 1024 * 1024 {
        return Err("Skill catalog exceeds 64 MiB".into());
    }
    let mut value: Value =
        serde_json::from_slice(bytes).map_err(|error| format!("Invalid skill catalog: {error}"))?;
    let object = value.as_object_mut().ok_or("Invalid skill catalog")?;
    if object.get("schema_version").and_then(Value::as_u64) != Some(1) {
        return Err("Unsupported skill catalog version".into());
    }
    if let Some(skills) = object.get_mut("skills").and_then(Value::as_array_mut) {
        for skill in skills {
            sanitize_skill(skill);
        }
    }
    serde_json::to_vec(&value).map_err(|error| error.to_string())
}

pub(super) fn sanitize_skill(value: &mut Value) {
    let Some(object) = value.as_object_mut() else {
        return;
    };
    // The UI consumes the same source, license and compatibility decision as install.
    let admission =
        serde_json::from_value::<super::SkillCatalogEntry>(Value::Object(object.clone()))
            .map_err(|_| "Invalid skill catalog entry".to_string())
            .and_then(super::SkillMarketStore::accept_entry);
    object.insert(
        "installation".into(),
        match admission {
            Ok(_) => serde_json::json!({"allowed": true, "reason": ""}),
            Err(reason) => serde_json::json!({"allowed": false, "reason": reason}),
        },
    );
    object.remove("frontmatter_yaml");
    object.remove("classification");
    object.remove("related_instruction_ids");
    for key in ["description", "description_zh"] {
        clean_field(object, key, false);
    }
    for key in ["dependencies", "inputs", "outputs", "examples"] {
        let Some(sections) = object.get_mut(key).and_then(Value::as_array_mut) else {
            continue;
        };
        for section in sections.iter_mut() {
            if let Some(map) = section.as_object_mut() {
                clean_field(map, "text", true);
            }
        }
    }
    if let Some(notes) = object
        .get_mut("verification")
        .and_then(Value::as_object_mut)
        .and_then(|verification| verification.get_mut("notes"))
        .and_then(Value::as_array_mut)
    {
        for note in notes.iter_mut() {
            if let Some(text) = note.as_str() {
                *note = Value::String(clean_text(text, false));
            }
        }
    }
    if let Some(license) = object.get_mut("license").and_then(Value::as_object_mut) {
        license.remove("declaration");
    }
    sanitize_source(object.get_mut("source"));
    if let Some(sources) = object.get_mut("sources").and_then(Value::as_array_mut) {
        for source in sources {
            sanitize_source(Some(source));
        }
    }
}

fn sanitize_source(value: Option<&mut Value>) {
    let Some(object) = value.and_then(Value::as_object_mut) else {
        return;
    };
    object.remove("git_blob_sha");
    object.remove("resource_fingerprint");
}

fn clean_field(object: &mut Map<String, Value>, key: &str, cap: bool) {
    let Some(text) = object.get(key).and_then(Value::as_str).map(str::to_string) else {
        return;
    };
    object.insert(key.to_string(), Value::String(clean_text(&text, cap)));
}

fn clean_text(text: &str, cap: bool) -> String {
    let cleaned = redact_secrets(&strip_fences(text));
    if !cap {
        return cleaned;
    }
    let mut count = 0;
    for (index, _) in cleaned.char_indices() {
        if count == SECTION_TEXT_LIMIT {
            return format!("{}…", &cleaned[..index]);
        }
        count += 1;
    }
    cleaned
}

fn strip_fences(text: &str) -> String {
    let mut out = String::new();
    let mut fence: Option<(char, usize)> = None;
    for line in text.split_inclusive('\n') {
        let body = line.trim_end_matches(['\n', '\r']);
        if let Some(marker) = fence_marker(&opening(body)) {
            match fence {
                None => {
                    fence = Some(marker);
                    continue;
                }
                Some((mark, length)) if marker.0 == mark && marker.1 >= length => {
                    fence = None;
                    continue;
                }
                Some(_) => {}
            }
        }
        if fence.is_none() {
            out.push_str(line);
        }
    }
    out
}

fn opening(body: &str) -> String {
    let mut text = body.trim_start_matches(' ');
    while let Some(rest) = text.strip_prefix('>') {
        text = rest.trim_start_matches(' ');
    }
    text.to_string()
}

fn fence_marker(text: &str) -> Option<(char, usize)> {
    let bytes = text.as_bytes();
    if bytes.is_empty() || (bytes[0] != b'`' && bytes[0] != b'~') {
        return None;
    }
    let mark = bytes[0] as char;
    let length = bytes.iter().take_while(|byte| **byte == bytes[0]).count();
    if length < 3 {
        return None;
    }
    Some((mark, length))
}

fn redact_secrets(text: &str) -> String {
    let bytes = text.as_bytes();
    let lower = text.to_ascii_lowercase();
    let folded = lower.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut index = 0;
    while index < bytes.len() {
        if let Some((length, key)) = secret_key(folded, index) {
            let mut cursor = index + length;
            while cursor < folded.len() && folded[cursor].is_ascii_whitespace() {
                cursor += 1;
            }
            if cursor < folded.len() && (folded[cursor] == b':' || folded[cursor] == b'=') {
                cursor += 1;
                while cursor < folded.len() && folded[cursor].is_ascii_whitespace() {
                    cursor += 1;
                }
                let value = cursor;
                while cursor < folded.len()
                    && !folded[cursor].is_ascii_whitespace()
                    && folded[cursor] != b'"'
                    && folded[cursor] != b','
                {
                    cursor += 1;
                }
                if cursor > value {
                    out.push_str(key);
                    out.push_str("=<redacted>");
                    index = cursor;
                    continue;
                }
            }
        }
        let width = utf8_len(bytes[index]);
        out.push_str(&text[index..index + width]);
        index += width;
    }
    out
}

fn secret_key(bytes: &[u8], index: usize) -> Option<(usize, &'static str)> {
    if index > 0 && (bytes[index - 1].is_ascii_alphanumeric() || bytes[index - 1] == b'_') {
        return None;
    }
    let mut matched: Option<(usize, &'static str)> = None;
    for key in SECRET_KEYS {
        let key_bytes = key.as_bytes();
        if !bytes[index..].starts_with(key_bytes) {
            continue;
        }
        let end = index + key_bytes.len();
        if end < bytes.len() && (bytes[end].is_ascii_alphanumeric() || bytes[end] == b'_') {
            continue;
        }
        if matched.is_none_or(|(length, _)| key_bytes.len() > length) {
            matched = Some((key_bytes.len(), *key));
        }
    }
    matched
}

fn utf8_len(byte: u8) -> usize {
    if byte & 0b1000_0000 == 0 {
        1
    } else if byte & 0b1110_0000 == 0b1100_0000 {
        2
    } else if byte & 0b1111_0000 == 0b1110_0000 {
        3
    } else {
        4
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn served_catalog_drops_extraction_code_and_secrets() {
        let raw = r#"{"schema_version":1,"skills":[{"id":"owner/repo/SKILL.md","description":"Use the pinned source","frontmatter_yaml":"token: keep-me-out","examples":[{"heading":"Usage","text":"Run this\n```python\nimport os\n```\n>    ```bash\n>    export TOKEN=hiddenvalue\n>    ```\nThen set api_key: supersecretvalue"}],"source":{"repository":"owner/repo","commit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","path":"SKILL.md","sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","git_blob_sha":"cccccccccccccccccccccccccccccccccccccccc"}}]}"#;
        let served = String::from_utf8(sanitize_catalog(raw.as_bytes()).unwrap()).unwrap();
        assert!(!served.contains("frontmatter_yaml"));
        assert!(!served.contains("import os"));
        assert!(!served.contains("hiddenvalue"));
        assert!(!served.contains("supersecretvalue"));
        assert!(!served.contains("keep-me-out"));
        assert!(served.contains("api_key=<redacted>"));
        assert!(
            served.contains("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
        );
        assert!(!served.contains("git_blob_sha"));
        assert!(served.contains("Use the pinned source"));
    }
}
