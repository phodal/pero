//! Stable identities for scientific conversation content.
//! A display number is not an identity: locating uses the saved token.
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SavedCitation {
    pub token: String,
    pub label: String,
}

pub fn chart_citation(artifact_id: &str) -> String {
    format!("chart:{artifact_id}")
}

pub fn table_citation(artifact_id: &str) -> String {
    format!("table:{artifact_id}")
}

pub fn doi_citation(value: &str) -> Option<String> {
    let doi = value.trim().trim_start_matches("doi:").trim();
    let bytes = doi.as_bytes();
    if !(8..=256).contains(&doi.len()) || !doi.starts_with("10.") || !doi.contains('/') {
        return None;
    }
    if !bytes.iter().all(|byte| byte.is_ascii_graphic() && *byte != b'<' && *byte != b'>') {
        return None;
    }
    Some(format!("doi:{doi}"))
}

pub fn bibtex_citation(entry: &str) -> Option<String> {
    let text = entry.trim();
    if !text.starts_with('@') || !text.contains('{') || text.len() > 8000 {
        return None;
    }
    Some(format!("bibtex:{:x}", Sha256::digest(text.as_bytes())))
}

/// Paper association uses the existing App location. The version in the locator is kept.
pub fn paper_citation(locator: &str) -> Option<String> {
    let location = pero_contracts::app_chat::AppLocation::parse(locator)?;
    if location.scope.app != "paper-agent" || location.scope.panel != "main" {
        return None;
    }
    let (id, target) = location.location.strip_prefix("report/")?.split_once('/')?;
    let hex = |value: &str, length: usize| value.len() == length && value.bytes().all(|byte| byte.is_ascii_hexdigit());
    let cited = target.strip_prefix("citation/").is_some_and(|index| (1..=9).contains(&index.len()) && index.bytes().all(|byte| byte.is_ascii_digit()))
        || target.strip_prefix("passage/").is_some_and(|value| hex(value, 64));
    if !hex(id, 64) || !cited {
        return None;
    }
    Some(locator.to_owned())
}

pub fn locate<'a>(saved: &'a [SavedCitation], token: &str) -> Option<&'a SavedCitation> {
    saved.iter().find(|item| item.token == token)
}

/// A literature reference found in conversation text. Its token is the identity.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LiteratureCitation {
    pub token: String,
    pub open: Option<LiteratureOpen>,
}

/// Where an existing owner can open this reference.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LiteratureOpen {
    /// `https://doi.org/…`, followed as a normal web link.
    Doi(String),
    /// The saved `pero-app-location` for Paper. The app owner opens it.
    Paper(String),
}

/// Citations in reading order. Repeating a token does not create a second identity.
pub fn literature_in(text: &str) -> Vec<LiteratureCitation> {
    let mut found = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut index = 0;
    while index < text.len() {
        if let Some((next, citation)) = literature_at(text, index) {
            if seen.insert(citation.token.clone()) {
                found.push(citation);
            }
            index = next.max(index + 1);
            continue;
        }
        index += text[index..].chars().next().map(char::len_utf8).unwrap_or(1);
    }
    found
}

fn literature_at(text: &str, index: usize) -> Option<(usize, LiteratureCitation)> {
    paper_at(text, index).or_else(|| bibtex_at(text, index)).or_else(|| doi_at(text, index))
}

fn at_boundary(text: &str, index: usize) -> bool {
    index == 0 || text[..index].chars().next_back().is_some_and(char::is_whitespace)
}

fn paper_at(text: &str, index: usize) -> Option<(usize, LiteratureCitation)> {
    const PREFIX: &str = "pero-app-location://paper-agent/main/report/";
    if !at_boundary(text, index) || !text[index..].starts_with(PREFIX) {
        return None;
    }
    let end = text[index..].find(char::is_whitespace).map(|offset| index + offset).unwrap_or(text.len());
    let locator = text[index..end].trim_end_matches(|ch: char| matches!(ch, '.' | ',' | ';' | ')' | ']'));
    let token = paper_citation(locator)?;
    Some((index + locator.len(), LiteratureCitation { token: token.clone(), open: Some(LiteratureOpen::Paper(token)) }))
}

fn bibtex_at(text: &str, index: usize) -> Option<(usize, LiteratureCitation)> {
    if !at_boundary(text, index) || !text[index..].starts_with('@') {
        return None;
    }
    let kind = text[index + 1..].chars().take_while(|ch| ch.is_ascii_alphabetic()).count();
    if kind == 0 {
        return None;
    }
    let after_kind = index + 1 + kind;
    let brace_offset = text[after_kind..].find('{')?;
    if !text[after_kind..after_kind + brace_offset].chars().all(char::is_whitespace) {
        return None;
    }
    let end = closing_brace(text, after_kind + brace_offset)?;
    let entry = &text[index..end];
    let token = bibtex_citation(entry)?;
    let open = doi_field(entry).map(|doi| LiteratureOpen::Doi(format!("https://doi.org/{doi}")));
    Some((end, LiteratureCitation { token, open }))
}

fn closing_brace(text: &str, open: usize) -> Option<usize> {
    let mut depth = 0usize;
    for (offset, ch) in text[open..].char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(open + offset + 1);
                }
            }
            _ => {}
        }
    }
    None
}

fn doi_at(text: &str, index: usize) -> Option<(usize, LiteratureCitation)> {
    if !at_boundary(text, index) {
        return None;
    }
    let rest = &text[index..];
    let body = ["https://doi.org/", "http://doi.org/", "https://dx.doi.org/", "http://dx.doi.org/", "doi:"]
        .into_iter()
        .find_map(|prefix| rest.strip_prefix(prefix))?;
    let raw_len = body.bytes().take_while(|byte| byte.is_ascii_graphic() && !matches!(byte, b'<' | b'>' | b'"' | b'\'' | b')' | b']' | b'}' | b',')).count();
    let mut raw = &body[..raw_len];
    raw = raw.trim_end_matches(|ch: char| matches!(ch, '.' | ';' | ':'));
    let token = doi_citation(raw)?;
    let doi = token.trim_start_matches("doi:").to_owned();
    let consumed = rest.len() - body.len() + raw.len();
    Some((index + consumed, LiteratureCitation { token, open: Some(LiteratureOpen::Doi(format!("https://doi.org/{doi}"))) }))
}

fn doi_field(entry: &str) -> Option<String> {
    let lower = entry.to_ascii_lowercase();
    let start = lower.find("doi=").or_else(|| lower.find("doi ="))?;
    let after = entry[start + 3..].trim_start();
    let value = after.strip_prefix('=')?.trim_start();
    let value = value.strip_prefix('{').or_else(|| value.strip_prefix('"'))?;
    let end = value.find(['}', '"', ',', '\n'])?;
    doi_citation(&value[..end]).map(|token| token.trim_start_matches("doi:").to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renumbering_does_not_retarget_a_saved_citation() {
        let first = SavedCitation { token: table_citation("a".repeat(64).as_str()), label: "old table".into() };
        let second = SavedCitation { token: table_citation("b".repeat(64).as_str()), label: "new table".into() };
        let mut saved = vec![first.clone(), second.clone()];
        saved.reverse();
        assert_eq!(locate(&saved, &first.token).map(|item| item.label.as_str()), Some("old table"));
        assert_ne!(locate(&saved, &first.token).map(|item| item.token.as_str()), Some(second.token.as_str()));
    }

    #[test]
    fn literature_and_paper_identities_are_the_saved_source() {
        assert_eq!(doi_citation(" 10.1000/xyz.1 ").as_deref(), Some("doi:10.1000/xyz.1"));
        assert!(doi_citation("not-a-doi").is_none());
        let entry = "@article{key, doi={10.1000/xyz.1}}";
        let other = "@article{other, doi={10.1000/abc}}";
        assert_ne!(bibtex_citation(entry), bibtex_citation(other));
        assert_eq!(bibtex_citation(entry), bibtex_citation(entry));
        let paper = format!("pero-app-location://paper-agent/main/report/{}/citation/0", "c".repeat(64));
        assert_eq!(paper_citation(&paper).as_deref(), Some(paper.as_str()));
        assert!(paper_citation("pero-app-location://paper-agent/main/report/short").is_none());
    }

    #[test]
    fn conversation_text_keeps_literature_identity_when_order_changes() {
        let doi = "doi:10.1000/scientific-chat.1";
        let entry = "@article{sample, title={Declared source}, doi={10.1000/scientific-chat.1}}";
        let paper = format!("pero-app-location://paper-agent/main/report/{}/citation/0", "c".repeat(64));
        let forward = format!("See {doi}.\n{entry}\n{paper}.");
        let reversed = format!("{paper}\n{entry}\nhttps://doi.org/10.1000/scientific-chat.1");
        let first = literature_in(&forward);
        let second = literature_in(&reversed);
        assert_eq!(first.len(), 3);
        assert_eq!(second.len(), 3);
        assert_eq!(first[0].token, doi);
        assert_eq!(second[0].token, paper);
        assert_eq!(first[0].open, Some(LiteratureOpen::Doi("https://doi.org/10.1000/scientific-chat.1".into())));
        assert_eq!(first[2].open, Some(LiteratureOpen::Paper(paper.clone())));
        assert_eq!(first[1].token, second[1].token);
        assert_eq!(first[1].open, Some(LiteratureOpen::Doi("https://doi.org/10.1000/scientific-chat.1".into())));
        let saved: Vec<_> = first.iter().map(|item| SavedCitation { token: item.token.clone(), label: item.token.clone() }).collect();
        assert_eq!(locate(&saved, doi).map(|item| item.token.as_str()), Some(doi));
        assert!(literature_in("version 10.0100 is not a DOI").is_empty());
        assert!(literature_in("pero-app-location://paper-agent/main/report/short").is_empty());
    }
}
