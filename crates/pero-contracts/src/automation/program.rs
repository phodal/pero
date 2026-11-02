//! Bounded information watch: authorized sources, a fixed filter, and where the
//! summary is delivered. The scheduler does not interpret it; the Host freezes
//! it into the run the existing Agent executes.
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MAX_SOURCES: usize = 32;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InformationProgram {
    pub sources: Vec<InformationSource>,
    pub filter: InformationFilter,
    pub goal: String,
    pub output: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub locale: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InformationSource {
    pub id: String,
    pub provider: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub url: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub query: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InformationFilter {
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default)]
    pub regex: String,
}

impl InformationProgram {
    pub fn parse(value: &Value) -> Result<Self, String> {
        let program: Self = serde_json::from_value(value.clone()).map_err(|error| error.to_string())?;
        program.validate()?;
        Ok(program)
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.sources.is_empty() || self.sources.len() > MAX_SOURCES {
            return Err(format!("Information program requires 1–{MAX_SOURCES} sources"));
        }
        let mut seen = std::collections::BTreeSet::new();
        for source in &self.sources {
            if !seen.insert(source.id.as_str()) {
                return Err(format!("Duplicate information source {}", source.id));
            }
            source.validate()?;
        }
        if self.goal.trim().is_empty() || self.goal.len() > 4000 {
            return Err("Information program goal requires 1–4000 bytes".into());
        }
        if self.output != "run" && self.output != "pulse" {
            return Err("Information program output must be run or pulse".into());
        }
        if !self.locale.is_empty() && self.locale != "zh" && self.locale != "en" {
            return Err("Information program locale must be zh or en".into());
        }
        self.filter.validate()
    }
}

impl InformationSource {
    fn validate(&self) -> Result<(), String> {
        if self.id.is_empty() || self.id.len() > 64 || !self.id.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-' || byte == b'_') {
            return Err(format!("Information source id {:?} must be 1–64 lowercase letters, digits, - or _", self.id));
        }
        if self.provider == "search" {
            if self.query.trim().is_empty() || self.query.len() > 500 || !self.url.is_empty() {
                return Err("Search source requires a public query of 1–500 bytes and no URL".into());
            }
            return Ok(());
        }
        if !self.query.is_empty() {
            return Err("Only search sources accept a query".into());
        }
        if self.provider != "rss" && self.provider != "webpage" {
            return Err(format!("Unavailable information source provider {}", self.provider));
        }
        if self.url.len() > 2048 || self.url.contains('#') {
            return Err("Information source requires an absolute HTTP(S) URL without credentials or a fragment".into());
        }
        let url = url::Url::parse(&self.url).map_err(|_| "Information source requires an absolute HTTP(S) URL without credentials or a fragment".to_string())?;
        if url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() || (url.scheme() != "https" && url.scheme() != "http") {
            return Err("Information source requires an absolute HTTP(S) URL without credentials or a fragment".into());
        }
        Ok(())
    }
}

impl InformationFilter {
    fn validate(&self) -> Result<(), String> {
        if self.keywords.len() > 20 || self.regex.len() > 500 {
            return Err("Information program filter exceeds its limits".into());
        }
        for keyword in &self.keywords {
            if keyword.trim().is_empty() || keyword.len() > 100 {
                return Err("Information program keyword requires 1–100 bytes".into());
            }
        }
        regex::Regex::new(&self.regex).map_err(|_| "Information program filter regex is invalid".to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn news() -> Value {
        serde_json::json!({
            "sources": [
                {"id":"coding-agent-news","provider":"search","query":"Coding Agent Codex Claude Code Cursor Antigravity Kiro engineering news"},
                {"id":"harness-news","provider":"search","query":"AI software engineering agent harness platform engineering technical report"},
                {"id":"agent-tools-news","provider":"search","query":"Cursor Kiro Antigravity coding agents developer tools news"},
                {"id":"engineering-practice-news","provider":"search","query":"AI assisted software engineering agent security evaluation engineering practice"}
            ],
            "goal": "对 AI 软件工程、Coding Agent、Harness、团队上下文、协同工作与可信交付有价值的近期资讯",
            "filter": {"keywords": [], "regex": ""},
            "output": "pulse",
            "locale": "zh"
        })
    }

    #[test]
    fn software_engineering_news_template_is_an_information_program() {
        let program = InformationProgram::parse(&news()).unwrap();
        assert_eq!(program.sources.len(), 4);
        assert_eq!(program.output, "pulse");
        assert_eq!(program.locale, "zh");
        assert!(program.sources.iter().all(|source| source.provider == "search" && source.url.is_empty()));
    }

    #[test]
    fn information_program_rejects_unusable_sources_and_filters() {
        let mut value = news();
        let cases = [
            ("sources", serde_json::json!([]), "1–32"),
            ("output", serde_json::json!("mail"), "run or pulse"),
            ("locale", serde_json::json!("fr"), "zh or en"),
            ("goal", serde_json::json!("  "), "goal"),
        ];
        for (field, replacement, message) in cases {
            let saved = value[field].clone();
            value[field] = replacement;
            assert!(InformationProgram::parse(&value).unwrap_err().contains(message), "{field}");
            value[field] = saved;
        }
        value["sources"][0]["url"] = serde_json::json!("https://example.org");
        assert!(InformationProgram::parse(&value).unwrap_err().contains("no URL"));
        value["sources"][0] = serde_json::json!({"id":"feed","provider":"rss","url":"https://user:secret@example.org/feed"});
        assert!(InformationProgram::parse(&value).unwrap_err().contains("credentials"));
        value["sources"][0] = serde_json::json!({"id":"Feed","provider":"rss","url":"https://example.org/feed"});
        assert!(InformationProgram::parse(&value).unwrap_err().contains("lowercase"));
        value = news();
        value["filter"]["regex"] = serde_json::json!("(");
        assert!(InformationProgram::parse(&value).unwrap_err().contains("regex"));
        value["extra"] = serde_json::json!(true);
        assert!(InformationProgram::parse(&value).is_err());
    }
}
