//! Host I/O for discovering and freezing explicitly selected context.
use base64::{Engine, engine::general_purpose::STANDARD};
use pero_contracts::{
    HostEvent,
    context::{ContextCandidate, ContextContent, ContextKind, ContextReference},
};
use std::{
    collections::BTreeMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::Command,
};

#[path = "context_symbols.rs"]
mod symbols;
const MAX_TEXT: usize = 128_000;
const MAX_RESULTS: usize = 100;
const MAX_SCAN: usize = 10_000;

pub struct ContextSources<'a> {
    pub workspace: &'a Path,
    pub history: &'a [HostEvent],
    pub home: Option<PathBuf>,
}

impl ContextSources<'_> {
    pub fn search(&self, kind: ContextKind, query: &str) -> Result<Vec<ContextCandidate>, String> {
        if query.len() > 1024 {
            return Err("Search query is too long".into());
        }
        let mut items = vec![];
        match kind {
            ContextKind::File
            | ContextKind::Directory
            | ContextKind::Image
            | ContextKind::Symbol => {
                let query = query.to_lowercase();
                for entry in ignore::WalkBuilder::new(self.workspace)
                    .hidden(false)
                    .require_git(false)
                    .filter_entry(|entry| !excluded(entry.path()))
                    .build()
                    .take(MAX_SCAN)
                    .filter_map(Result::ok)
                {
                    let path = entry.path();
                    let Some(file_type) = entry.file_type() else {
                        continue;
                    };
                    if file_type.is_symlink() || path == self.workspace {
                        continue;
                    }
                    if path.components().any(|c| {
                        matches!(
                            c.as_os_str().to_str(),
                            Some(".git" | "node_modules" | "target" | ".venv" | "vendor")
                        )
                    }) {
                        continue;
                    }
                    let relative = path
                        .strip_prefix(self.workspace)
                        .unwrap_or(path)
                        .to_string_lossy();
                    if kind == ContextKind::Symbol
                        && file_type.is_file()
                        && symbols::supported(path)
                    {
                        if let Ok(text) = read_text(path) {
                            items.extend(symbols::definitions(path, &text, &query));
                        }
                    } else if ((kind == ContextKind::Directory && file_type.is_dir())
                        || (kind == ContextKind::File && file_type.is_file())
                        || (kind == ContextKind::Image
                            && file_type.is_file()
                            && image_extension(path)))
                        && relative.to_lowercase().contains(&query)
                    {
                        items.push(ContextCandidate {
                            kind,
                            label: relative.into(),
                            source: path.to_string_lossy().into(),
                            detail: if file_type.is_dir() {
                                "Directory snapshot (max 64 files)".into()
                            } else {
                                String::new()
                            },
                        });
                    }
                    if items.len() >= MAX_RESULTS {
                        break;
                    }
                }
            }
            ContextKind::Thread => {
                for (source, text) in self.threads() {
                    let label = text
                        .lines()
                        .find(|line| !line.is_empty())
                        .unwrap_or(&source)
                        .chars()
                        .take(80)
                        .collect::<String>();
                    if format!("{label} {source}")
                        .to_lowercase()
                        .contains(&query.to_lowercase())
                    {
                        items.push(ContextCandidate {
                            kind,
                            label,
                            source,
                            detail: "Saved conversation snapshot".into(),
                        });
                    }
                }
            }
            ContextKind::Skill => {
                if "app-use".contains(&query.to_lowercase()) {items.push(ContextCandidate{kind,label:"app-use".into(),source:"pero-skill:app-use".into(),detail:"App objects, operations, evidence and declared data writes".into()});}
                for root in self.skill_roots() {
                    for entry in ignore::WalkBuilder::new(&root)
                        .hidden(false)
                        .require_git(false)
                        .max_depth(Some(4))
                        .build()
                        .filter_map(Result::ok)
                    {
                        if entry.file_name() != "SKILL.md" {
                            continue;
                        }
                        let Ok(text) = read_text(entry.path()) else {
                            continue;
                        };
                        let name = front_matter(&text, "name").unwrap_or_else(|| {
                            entry
                                .path()
                                .parent()
                                .and_then(Path::file_name)
                                .unwrap_or_default()
                                .to_string_lossy()
                                .into()
                        });
                        let description = front_matter(&text, "description").unwrap_or_default();
                        let origin = if root.starts_with(self.workspace) {
                            "project"
                        } else {
                            "global"
                        };
                        let detail = format!("{origin} · {description}");
                        if format!("{name} {detail}")
                            .to_lowercase()
                            .contains(&query.to_lowercase())
                        {
                            items.push(ContextCandidate {
                                kind,
                                label: name,
                                source: fs::canonicalize(entry.path())
                                    .unwrap_or_else(|_| entry.path().to_owned())
                                    .to_string_lossy()
                                    .into(),
                                detail,
                            });
                        }
                    }
                }
                items.sort_by(|a, b| a.source.cmp(&b.source));
                items.dedup_by(|a, b| a.source == b.source);
            }
            ContextKind::BranchDiff => {
                let base = if query.trim().is_empty() {
                    self.default_base()?
                } else {
                    query.trim().to_string()
                };
                self.git(&["rev-parse", "--verify", &format!("{base}^{{commit}}")])?;
                items.push(ContextCandidate {
                    kind,
                    label: format!("Branch Diff (vs {base})"),
                    source: base,
                    detail: "Working tree, staged and committed changes against base".into(),
                });
            }
            ContextKind::AppObject => return Ok(vec![]),
            ContextKind::Fetch => {
                let url = context_url(query)?;
                items.push(ContextCandidate {
                    kind,
                    label: url.to_string(),
                    source: url.to_string(),
                    detail: "Fetch URL as text context".into(),
                });
            }
            ContextKind::Selection => {
                return Err("Select a range in an editor before adding Selection".into());
            }
        }
        items.truncate(MAX_RESULTS);
        Ok(items)
    }

    pub fn resolve(
        &self,
        kind: ContextKind,
        source: &str,
        start: Option<u32>,
        end: Option<u32>,
    ) -> Result<ContextReference, String> {
        if source.is_empty() || source.len() > 4096 {
            return Err("Invalid context source".into());
        }
        if kind==ContextKind::Skill && source=="pero-skill:app-use" {
            return Ok(ContextReference{id:"pero-skill:app-use".into(),kind,label:"app-use".into(),source:source.into(),content:ContextContent::Text{text:crate::acp::APP_USE_SKILL.into()}});
        }
        let label;
        let content = match kind {
            ContextKind::AppObject => return Err("App context must be selected from its managed panel".into()),
            ContextKind::Fetch => {
                let url = context_url(source)?;
                let client = reqwest::blocking::Client::builder()
                    .timeout(std::time::Duration::from_secs(15))
                    .build()
                    .map_err(|e| e.to_string())?;
                let response = client
                    .get(url.clone())
                    .send()
                    .and_then(reqwest::blocking::Response::error_for_status)
                    .map_err(|e| e.to_string())?;
                let content_type = response
                    .headers()
                    .get(reqwest::header::CONTENT_TYPE)
                    .and_then(|h| h.to_str().ok())
                    .unwrap_or("");
                if !content_type.starts_with("text/")
                    && !content_type.contains("json")
                    && !content_type.contains("xml")
                {
                    return Err("URL does not return text, JSON or XML".into());
                }
                let mut bytes = Vec::new();
                response
                    .take(MAX_TEXT as u64 + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|e| e.to_string())?;
                if bytes.len() > MAX_TEXT {
                    return Err("Fetched content exceeds 128 KB".into());
                }
                let text =
                    String::from_utf8(bytes).map_err(|_| "Fetched content is not UTF-8 text")?;
                label = url.host_str().unwrap_or(source).into();
                ContextContent::Text { text }
            }
            ContextKind::Thread => {
                let text = self
                    .threads()
                    .remove(source)
                    .ok_or("Saved conversation is unavailable")?;
                label = text
                    .lines()
                    .find(|line| !line.is_empty())
                    .unwrap_or(source)
                    .chars()
                    .take(80)
                    .collect();
                ContextContent::Text { text }
            }
            ContextKind::BranchDiff => {
                self.git(&["rev-parse", "--verify", &format!("{source}^{{commit}}")])?;
                let text = self.git(&[
                    "diff",
                    "--no-ext-diff",
                    "--no-textconv",
                    "--binary",
                    source,
                    "--",
                ])?;
                if text.is_empty() {
                    return Err("There are no tracked changes against this base".into());
                }
                if text.len() > MAX_TEXT {
                    return Err("Branch diff exceeds 128 KB; choose files instead".into());
                }
                label = format!("Branch Diff (vs {source})");
                ContextContent::Text { text }
            }
            ContextKind::Image => {
                let path = self.path(source)?;
                if fs::metadata(&path).map_err(|e| e.to_string())?.len() > 10_000_000 {
                    return Err("Image exceeds 10 MB".into());
                }
                let data = fs::read(&path).map_err(|e| e.to_string())?;
                if data.len() > 10_000_000 {
                    return Err("Image exceeds 10 MB".into());
                }
                let mime_type = if data.starts_with(b"\x89PNG\r\n\x1a\n") {
                    "image/png"
                } else if data.starts_with(&[0xff, 0xd8, 0xff]) {
                    "image/jpeg"
                } else if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
                    "image/gif"
                } else if data.starts_with(b"RIFF") && data.get(8..12) == Some(b"WEBP") {
                    "image/webp"
                } else {
                    return Err("Choose a PNG, JPEG, GIF or WebP image".into());
                };
                label = path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into();
                ContextContent::Image {
                    data: STANDARD.encode(data),
                    mime_type: mime_type.into(),
                }
            }
            ContextKind::Directory => {
                let path = self.path(source)?;
                if !path.is_dir() {
                    return Err("Selected source is not a directory".into());
                }
                let mut text = String::new();
                let mut count = 0;
                let mut scanned = 0;
                for entry in ignore::WalkBuilder::new(&path)
                    .hidden(false)
                    .require_git(false)
                    .filter_entry(|entry| !excluded(entry.path()))
                    .build()
                    .take(MAX_SCAN + 1)
                    .filter_map(Result::ok)
                {
                    scanned += 1;
                    if scanned > MAX_SCAN {
                        return Err(
                            "Directory exceeds 10,000 entries; select a smaller directory".into(),
                        );
                    }
                    if !entry.file_type().is_some_and(|t| t.is_file()) {
                        continue;
                    }
                    let file = match read_text(entry.path()) {
                        Ok(file) => file,
                        Err(error) if error.contains("binary") || error.contains("UTF-8") => {
                            continue;
                        }
                        Err(error) => {
                            return Err(format!(
                                "Cannot snapshot {}: {error}",
                                entry.path().display()
                            ));
                        }
                    };
                    count += 1;
                    if count > 64 {
                        return Err(
                            "Directory exceeds 64 text files; select a smaller directory".into(),
                        );
                    }
                    text.push_str(&format!(
                        "\n--- {} ---\n{file}\n",
                        entry
                            .path()
                            .strip_prefix(&path)
                            .unwrap_or(entry.path())
                            .display()
                    ));
                    if text.len() > MAX_TEXT {
                        return Err(
                            "Directory snapshot exceeds 128 KB; select a smaller directory".into(),
                        );
                    }
                }
                if count == 0 {
                    return Err("Directory contains no readable text files".into());
                }
                label = path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into();
                ContextContent::Text { text }
            }
            ContextKind::Symbol => {
                let (file, range) = source
                    .rsplit_once("#L")
                    .ok_or("Symbol has no definition range")?;
                let (line_range, _) = range
                    .split_once('@')
                    .ok_or("Symbol has no source version; search again")?;
                let (start, end) = line_range
                    .split_once("-L")
                    .ok_or("Invalid symbol definition range")?;
                let start = start.parse::<u32>().map_err(|_| "Invalid symbol start")?;
                let end = end.parse::<u32>().map_err(|_| "Invalid symbol end")?;
                let path = self.path(file)?;
                let text = read_text(&path)?;
                let definitions = symbols::definitions(&path, &text, "");
                let definition = definitions
                    .iter()
                    .find(|d| {
                        d.source
                            .rsplit_once("#L")
                            .is_some_and(|(_, candidate_range)| candidate_range == range)
                    })
                    .ok_or("Symbol changed; search again")?;
                label = definition.label.clone();
                ContextContent::Text {
                    text: selected_lines(&text, start, end)?,
                }
            }
            ContextKind::File | ContextKind::Skill | ContextKind::Selection => {
                let path = self.path(source)?;
                let text = read_text(&path)?;
                label = if kind == ContextKind::Skill {
                    front_matter(&text, "name").unwrap_or_else(|| {
                        path.parent()
                            .and_then(Path::file_name)
                            .unwrap_or_default()
                            .to_string_lossy()
                            .into()
                    })
                } else {
                    path.file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into()
                };
                let text = if kind == ContextKind::Selection {
                    selected_lines(
                        &text,
                        start.ok_or("Selection start is missing")?,
                        end.ok_or("Selection end is missing")?,
                    )?
                } else {
                    text
                };
                ContextContent::Text { text }
            }
        };
        let reference = ContextReference {
            id: format!("{kind:?}:{}", uuid::Uuid::new_v4()),
            kind,
            label,
            source: source.into(),
            content,
        };
        ContextReference::validate_all(std::slice::from_ref(&reference)).map_err(str::to_string)?;
        Ok(reference)
    }

    fn path(&self, source: &str) -> Result<PathBuf, String> {
        let path = Path::new(source);
        fs::canonicalize(if path.is_absolute() {
            path.to_owned()
        } else {
            self.workspace.join(path)
        })
        .map_err(|e| e.to_string())
    }
    fn skill_roots(&self) -> Vec<PathBuf> {
        let mut roots = vec![
            self.workspace.join(".agents/skills"),
            self.workspace.join(".claude/skills"),
            self.workspace.join(".codex/skills"),
        ];
        if let Some(home) = &self.home {
            roots.extend([
                home.join(".agents/skills"),
                home.join(".codex/skills"),
                home.join(".claude/skills"),
                home.join(".mirasim/skills"),
            ]);
        }
        roots
    }
    fn threads(&self) -> BTreeMap<String, String> {
        let mut threads = BTreeMap::<String, String>::new();
        for event in self.history {
            let Some(id) = &event.thread_id else {
                continue;
            };
            let entry = threads.entry(id.clone()).or_default();
            if event.kind == "user_message" {
                entry.push_str(&format!("\nUser: {}\n", event.text));
            } else if event.kind == "session_update"
                && event.data["sessionUpdate"] == "agent_message_chunk"
            {
                if let Some(text) = event.data["content"]["text"].as_str() {
                    entry.push_str(text);
                }
            }
        }
        threads.retain(|_, text| !text.is_empty());
        threads
    }
    fn git(&self, args: &[&str]) -> Result<String, String> {
        let output = Command::new("git")
            .arg("-C")
            .arg(self.workspace)
            .args(args)
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        String::from_utf8(output.stdout).map_err(|_| "Git returned non-UTF8 data".into())
    }
    fn default_base(&self) -> Result<String, String> {
        for base in ["origin/main", "main", "origin/master", "master", "HEAD"] {
            if self.git(&["rev-parse", "--verify", base]).is_ok() {
                return Ok(base.into());
            }
        }
        Err("This directory is not a Git repository with a commit".into())
    }
}
fn image_extension(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(str::to_lowercase)
            .as_deref(),
        Some("png" | "jpg" | "jpeg" | "gif" | "webp")
    )
}
fn read_text(path: &Path) -> Result<String, String> {
    if !fs::metadata(path).map_err(|e| e.to_string())?.is_file() {
        return Err("Source is not a file".into());
    }
    if fs::metadata(path).map_err(|e| e.to_string())?.len() > MAX_TEXT as u64 {
        return Err("Text file exceeds 128 KB".into());
    }
    let text = fs::read_to_string(path).map_err(|_| "Source is not UTF-8 text".to_string())?;
    if text.contains('\0') {
        return Err("Source contains binary data".into());
    }
    Ok(text)
}
fn selected_lines(text: &str, start: u32, end: u32) -> Result<String, String> {
    let lines = text.lines().collect::<Vec<_>>();
    if start == 0 || end < start || end as usize > lines.len() {
        return Err("Selected range is unavailable; select it again".into());
    }
    Ok(lines[start as usize - 1..end as usize].join("\n"))
}
fn front_matter(text: &str, key: &str) -> Option<String> {
    let rest = text.strip_prefix("---\n")?;
    rest.split("\n---")
        .next()?
        .lines()
        .find_map(|line| line.strip_prefix(&format!("{key}:")))
        .map(|value| value.trim().trim_matches(['\'', '"']).to_string())
}

fn context_url(source: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(source.trim())
        .map_err(|_| "Enter a complete HTTP or HTTPS URL".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("Enter a complete HTTP or HTTPS URL".into());
    }
    Ok(url)
}

fn excluded(path: &Path) -> bool {
    matches!(
        path.file_name().and_then(|name| name.to_str()),
        Some(".git" | "node_modules" | "target" | ".venv" | "vendor" | "__pycache__")
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Workspace(PathBuf);
    impl Workspace {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("pero-context-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Workspace {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn selected_sources_are_frozen_and_unavailable_inputs_report_errors() {
        let workspace = Workspace::new();
        fs::write(
            workspace.0.join("source.rs"),
            "// fn fake() {}\nfn real() {\n    println!(\"hello\");\n}\n",
        )
        .unwrap();
        fs::create_dir(workspace.0.join("node_modules")).unwrap();
        fs::write(
            workspace.0.join("node_modules/ignored.rs"),
            "fn ignored() {}",
        )
        .unwrap();
        let sources = ContextSources {
            workspace: &workspace.0,
            history: &[],
            home: None,
        };
        fs::write(workspace.0.join(".gitignore"), "ignored.rs\n").unwrap();
        fs::write(workspace.0.join("ignored.rs"), "fn omitted() {}\n").unwrap();
        assert_eq!(sources.search(ContextKind::File, ".rs").unwrap().len(), 1);
        assert!(
            sources
                .search(ContextKind::File, "ignored")
                .unwrap()
                .is_empty()
        );
        let symbol = sources
            .search(ContextKind::Symbol, "real")
            .unwrap()
            .remove(0);
        let reference = sources
            .resolve(symbol.kind, &symbol.source, None, None)
            .unwrap();
        let first_file = sources
            .resolve(ContextKind::File, "source.rs", None, None)
            .unwrap();
        fs::write(
            workspace.0.join("source.rs"),
            "// fn fake() {}\nfn changed() {\n    println!(\"hello\");\n}\n",
        )
        .unwrap();
        let second_file = sources
            .resolve(ContextKind::File, "source.rs", None, None)
            .unwrap();
        assert_ne!(first_file.id, second_file.id);
        assert!(
            matches!(first_file.content, ContextContent::Text {text} if text.contains("fn real()"))
        );
        assert!(
            matches!(second_file.content, ContextContent::Text {text} if text.contains("fn changed()"))
        );
        assert!(
            matches!(reference.content,ContextContent::Text {text} if text.contains("fn real()"))
        );
        assert!(
            sources
                .resolve(symbol.kind, &symbol.source, None, None)
                .is_err()
        );
        for (kind, source, start, end) in [
            (ContextKind::File, "missing", None, None),
            (ContextKind::Selection, "source.rs", Some(0), Some(1)),
            (ContextKind::Selection, "source.rs", Some(1), Some(20)),
            (ContextKind::Image, "source.rs", None, None),
            (ContextKind::Fetch, "file:///etc/passwd", None, None),
        ] {
            assert!(sources.resolve(kind, source, start, end).is_err());
        }
    }

    #[test]
    fn directories_skills_and_saved_threads_have_real_content() {
        let workspace = Workspace::new();
        fs::create_dir_all(workspace.0.join(".agents/skills/example")).unwrap();
        fs::write(
            workspace.0.join(".agents/skills/example/SKILL.md"),
            "---\nname: example\ndescription: Example skill\n---\nUse actual content.\n",
        )
        .unwrap();
        #[cfg(unix)]
        {
            fs::create_dir(workspace.0.join(".claude")).unwrap();
            std::os::unix::fs::symlink(
                workspace.0.join(".agents/skills"),
                workspace.0.join(".claude/skills"),
            )
            .unwrap();
        }
        let mut user = HostEvent::new("user_message", None, "Question".into());
        user.thread_id = Some("thread-1".into());
        let mut reply = HostEvent::new("session_update", None, String::new());
        reply.thread_id = Some("thread-1".into());
        reply.data = serde_json::json!({"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Answer"}});
        let history = [user, reply];
        let sources = ContextSources {
            workspace: &workspace.0,
            history: &history,
            home: None,
        };
        let mut skills = sources.search(ContextKind::Skill, "example").unwrap();
        assert_eq!(
            skills.len(),
            1,
            "aliases of the same skill file must not duplicate the picker"
        );
        let skill = skills.remove(0);
        assert_eq!(skill.label, "example");
        let resolved_skill = sources
            .resolve(skill.kind, &skill.source, None, None)
            .unwrap();
        assert_eq!(resolved_skill.label, "example");
        let bundled = sources.search(ContextKind::Skill, "app-use").unwrap();
        let bundled = bundled.iter().find(|item|item.source=="pero-skill:app-use").unwrap();
        let bundled = sources.resolve(bundled.kind,&bundled.source,None,None).unwrap();
        assert!(matches!(bundled.content,ContextContent::Text{text} if text.contains("app_describe") && text.contains("fileReferences")));
        let directory = sources
            .resolve(ContextKind::Directory, ".agents/skills", None, None)
            .unwrap();
        assert!(
            matches!(directory.content,ContextContent::Text {text} if text.contains("SKILL.md") && text.contains("actual content"))
        );
        let thread = sources
            .resolve(ContextKind::Thread, "thread-1", None, None)
            .unwrap();
        assert!(
            matches!(thread.content,ContextContent::Text {text} if text.contains("Question") && text.contains("Answer"))
        );
        let fetch = sources
            .search(ContextKind::Fetch, "https://example.com/context")
            .unwrap();
        assert_eq!(fetch[0].source, "https://example.com/context");
    }
    #[test]
    fn fetch_freezes_loopback_text_and_reports_bad_status_type_and_size() {
        use std::{
            io::{Read, Write},
            net::TcpListener,
        };
        let workspace = Workspace::new();
        let sources = ContextSources {
            workspace: &workspace.0,
            history: &[],
            home: None,
        };
        for (status, mime, body, expected) in [
            ("200 OK", "text/plain", "frozen response".to_string(), true),
            (
                "200 OK",
                "application/json",
                "{\"value\":1}".to_string(),
                true,
            ),
            ("404 Not Found", "text/plain", "missing".to_string(), false),
            ("200 OK", "image/png", "binary".to_string(), false),
            ("200 OK", "text/plain", "x".repeat(MAX_TEXT + 1), false),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let url = format!("http://{}/context", listener.local_addr().unwrap());
            let expected_body = body.clone();
            let server = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(std::time::Duration::from_secs(3)))
                    .unwrap();
                let mut request = [0u8; 4096];
                let _ = stream.read(&mut request).unwrap();
                // The client may close on a rejected content type before the body is sent.
                let _ = write!(
                    stream,
                    "HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
            });
            let result = sources.resolve(ContextKind::Fetch, &url, None, None);
            server.join().unwrap();
            assert_eq!(result.is_ok(), expected, "{status}, {mime}");
            if let Ok(reference) = result {
                assert!(
                    matches!(reference.content, ContextContent::Text {text} if text == expected_body)
                );
            }
        }
    }

    #[test]
    fn branch_diff_snapshots_use_the_explicit_base_and_do_not_change_after_selection() {
        let workspace = Workspace::new();
        let git = |args: &[&str]| {
            let result = Command::new("git")
                .arg("-C")
                .arg(&workspace.0)
                .args(args)
                .output()
                .unwrap();
            assert!(
                result.status.success(),
                "{}",
                String::from_utf8_lossy(&result.stderr)
            );
            String::from_utf8(result.stdout).unwrap()
        };
        git(&["init", "--initial-branch=main"]);
        fs::write(workspace.0.join("value.txt"), "before\n").unwrap();
        git(&["add", "value.txt"]);
        git(&[
            "-c",
            "user.name=Context test",
            "-c",
            "user.email=context@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-m",
            "initial",
        ]);
        fs::write(workspace.0.join("value.txt"), "selected\n").unwrap();
        let sources = ContextSources {
            workspace: &workspace.0,
            history: &[],
            home: None,
        };
        let candidates = sources.search(ContextKind::BranchDiff, "main").unwrap();
        assert_eq!(candidates[0].source, "main");
        let reference = sources
            .resolve(ContextKind::BranchDiff, "main", None, None)
            .unwrap();
        fs::write(workspace.0.join("value.txt"), "later\n").unwrap();
        assert!(
            matches!(reference.content,ContextContent::Text {text} if text.contains("+selected") && !text.contains("+later"))
        );
        assert!(
            sources
                .resolve(ContextKind::BranchDiff, "missing-ref", None, None)
                .is_err()
        );
    }
}
