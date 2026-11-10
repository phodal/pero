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
}
