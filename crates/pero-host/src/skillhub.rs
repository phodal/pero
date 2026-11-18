//! SkillHub catalog, release history and verified release identity lookup.
use pero_runtime::skill_market::{SkillHubInstall, SkillHubSort};
use reqwest::blocking::{Client, RequestBuilder};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;
use std::{io::Read, sync::OnceLock, time::Duration};

const ORIGIN: &str = "https://api.skillhub.cn";
const PAGE_SIZE: u8 = 12;
const MAX_RESPONSE_BYTES: u64 = 2 * 1024 * 1024;
static CLIENT: OnceLock<Result<Client, reqwest::Error>> = OnceLock::new();

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Namespace {
    handle: String,
    public_slug: String,
}

#[derive(Deserialize)]
struct SearchEnvelope {
    code: i32,
    data: Option<SearchPage>,
}

#[derive(Deserialize)]
struct SearchPage {
    skills: Vec<SearchItem>,
    total: u64,
}

#[derive(Deserialize)]
struct SearchItem {
    namespace: Option<Namespace>,
    name: String,
    description: Option<String>,
    description_zh: Option<String>,
    version: Option<String>,
    downloads: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    publisher: String,
    slug: String,
    name: String,
    description: String,
    description_zh: String,
    version: String,
    downloads: u64,
}

#[derive(Deserialize)]
struct VersionList {
    namespace: Namespace,
    versions: Vec<Release>,
}

#[derive(Deserialize)]
struct Detail {
    namespace: Namespace,
    skill: DetailSkill,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DetailSkill {
    display_name: String,
    summary: Option<String>,
    #[serde(rename = "summary_zh")]
    summary_zh: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Release {
    version_id: u64,
    version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    changelog: Option<String>,
    created_at: u64,
}

fn client() -> Result<&'static Client, String> {
    CLIENT
        .get_or_init(|| {
            Client::builder()
                .timeout(Duration::from_secs(10))
                .redirect(reqwest::redirect::Policy::none())
                .build()
        })
        .as_ref()
        .map_err(|_| "SkillHub HTTPS client is unavailable".into())
}

fn read<T: DeserializeOwned>(request: RequestBuilder) -> Result<T, String> {
    let response = request
        .send()
        .map_err(|_| "SkillHub could not be reached")?;
    if !response.status().is_success() {
        return Err(format!(
            "SkillHub returned HTTP {}",
            response.status().as_u16()
        ));
    }
    let mut bytes = Vec::new();
    response
        .take(MAX_RESPONSE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "SkillHub response could not be read")?;
    if bytes.len() as u64 > MAX_RESPONSE_BYTES {
        return Err("SkillHub response exceeds the size limit".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "SkillHub returned an invalid response".into())
}

fn is_segment(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

pub(super) fn search(keyword: &str, page: u32, sort: SkillHubSort) -> Result<Value, String> {
    if keyword.chars().count() > 120 || page == 0 {
        return Err("Invalid SkillHub search".into());
    }
    let query = [
        ("keyword", keyword.trim()),
        ("page", &page.to_string()),
        ("pageSize", &PAGE_SIZE.to_string()),
        (
            "sortBy",
            match sort {
                SkillHubSort::Score => "score",
                SkillHubSort::Downloads => "downloads",
                SkillHubSort::Updated => "updated_at",
            },
        ),
        ("order", "desc"),
    ];
    let response: SearchEnvelope =
        read(client()?.get(format!("{ORIGIN}/api/skills")).query(&query))?;
    let Some(data) = response.data.filter(|_| response.code == 0) else {
        return Err("SkillHub search is unavailable".into());
    };
    let items: Vec<_> = data
        .skills
        .into_iter()
        .filter_map(|item| {
            let namespace = item.namespace?;
            if !is_segment(&namespace.handle) || !is_segment(&namespace.public_slug) {
                return None;
            }
            Some(Entry {
                publisher: namespace.handle,
                slug: namespace.public_slug,
                name: item.name,
                description: item.description.unwrap_or_default(),
                description_zh: item.description_zh.unwrap_or_default(),
                version: item.version.unwrap_or_default(),
                downloads: item.downloads.unwrap_or_default(),
            })
        })
        .collect();
    Ok(serde_json::json!({"items": items, "total": data.total}))
}

pub(super) fn versions(namespace: &str, slug: &str) -> Result<Value, String> {
    Ok(serde_json::json!({"versions": load_versions(namespace, slug)?}))
}

fn load_versions(namespace: &str, slug: &str) -> Result<Vec<Release>, String> {
    if !is_segment(namespace) || !is_segment(slug) {
        return Err("Invalid SkillHub release identity".into());
    }
    let response: VersionList = read(
        client()?
            .get(format!("{ORIGIN}/api/v1/skills/{slug}/versions"))
            .query(&[("namespace", namespace)]),
    )?;
    response.for_skill(namespace, slug)
}

pub(super) fn install_release(
    publisher: String,
    slug: String,
    version_id: u64,
) -> Result<SkillHubInstall, String> {
    let version = load_versions(&publisher, &slug)?
        .into_iter()
        .find(|release| release.version_id == version_id)
        .ok_or("SkillHub release is no longer available")?
        .version;
    let detail: Detail = read(
        client()?
            .get(format!("{ORIGIN}/api/v1/skills/{slug}"))
            .query(&[("namespace", &publisher)]),
    )?;
    detail.namespace.matches(&publisher, &slug)?;
    Ok(SkillHubInstall {
        publisher,
        slug,
        name: detail.skill.display_name,
        description: detail.skill.summary.unwrap_or_default(),
        description_zh: detail.skill.summary_zh.unwrap_or_default(),
        version,
        version_id,
    })
}

impl VersionList {
    fn for_skill(self, namespace: &str, slug: &str) -> Result<Vec<Release>, String> {
        self.namespace.matches(namespace, slug)?;
        Ok(self.versions)
    }
}
impl Namespace {
    fn matches(&self, namespace: &str, slug: &str) -> Result<(), String> {
        if self.handle != namespace || self.public_slug != slug {
            return Err("SkillHub returned versions for a different skill".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_history_belongs_to_the_selected_publisher() {
        let json = r#"{"namespace":{"handle":"publisher","publicSlug":"docx"},"versions":[{"versionId":17,"version":"2.1.0","changelog":null,"createdAt":1794574725447,"downloadUrl":"https://example.invalid"}]}"#;
        for (namespace, slug, matched) in [
            ("publisher", "docx", true),
            ("another-publisher", "docx", false),
            ("publisher", "xlsx", false),
        ] {
            let result = serde_json::from_str::<VersionList>(json)
                .unwrap()
                .for_skill(namespace, slug);
            assert_eq!(result.is_ok(), matched);
            if let Ok(result) = result {
                let reply = serde_json::to_value(result).unwrap();
                assert_eq!(reply[0]["version"], "2.1.0");
                assert!(reply[0].get("downloadUrl").is_none());
            }
        }
    }
}
