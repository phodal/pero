//! Local, explicitly installed Agent packages. Apps may depend on these packages;
//! a dependency never re-enables a package the user disabled.
use crate::apps::AppName;
use agent_client_protocol::schema::v1::McpServer;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Component, Path, PathBuf},
};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentPluginDefinition {
    pub schema_version: u32,
    pub name: AppName,
    pub version: String,
    #[serde(default)]
    pub instructions: String,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default, deserialize_with = "deserialize_servers")]
    pub mcp_servers: Vec<McpServer>,
}

impl AgentPluginDefinition {
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() > 128 * 1024 {
            return Err("Agent Plugin manifest exceeds 128 KiB".into());
        }
        let value: Self = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
        if value.schema_version != 1 {
            return Err("Unsupported Agent Plugin schemaVersion; expected 1".into());
        }
        if value.version.trim().is_empty()
            || value.version.len() > 64
            || value.instructions.len() > 64 * 1024
        {
            return Err("Invalid Agent Plugin version or instructions".into());
        }
        if value.skills.len() > 16 || value.mcp_servers.len() > 32 {
            return Err("Agent Plugin supports at most 16 Skills and 32 MCP servers".into());
        }
        let mut paths = BTreeSet::new();
        for path in &value.skills {
            if path.len() > 1024
                || path.contains(['\\', ':', '\0'])
                || !Path::new(path)
                    .components()
                    .all(|p| matches!(p, Component::Normal(_)))
                || Path::new(path).file_name().and_then(|p| p.to_str()) != Some("SKILL.md")
                || !paths.insert(path)
            {
                return Err("Agent Plugin Skill must be a unique relative SKILL.md path".into());
            }
        }
        let mut names = BTreeSet::from(["pero-app-use", "pero-connectors"]);
        for server in &value.mcp_servers {
            let name = match server {
                McpServer::Stdio(s) => {
                    let command = s.command.to_string_lossy();
                    let package_command = command.strip_prefix("{pluginRoot}/").is_some_and(|p| {
                        !p.is_empty()
                            && Path::new(p)
                                .components()
                                .all(|c| matches!(c, Component::Normal(_)))
                    });
                    if (!s.command.is_absolute() && !package_command)
                        || command.len() > 4096
                        || command.contains('\0')
                        || s.args.len() > 128
                        || s.env.len() > 128
                        || s.args.iter().any(|v| v.len() > 4096 || v.contains('\0'))
                        || s.env.iter().any(|v| {
                            v.name.is_empty()
                                || v.name.contains(['=', '\0'])
                                || v.value.contains('\0')
                        })
                    {
                        return Err("Agent Plugin MCP stdio needs an absolute or {pluginRoot} command and bounded arguments/environment".into());
                    }
                    s.name.as_str()
                }
                McpServer::Http(s) => {
                    validate_url(&s.url)?;
                    s.name.as_str()
                }
                McpServer::Sse(s) => {
                    validate_url(&s.url)?;
                    s.name.as_str()
                }
                _ => return Err("Unsupported Agent Plugin MCP transport".into()),
            };
            if name.trim().is_empty()
                || name.len() > 128
                || name.chars().any(char::is_control)
                || !names.insert(name)
            {
                return Err("Agent Plugin MCP server needs a unique non-reserved name".into());
            }
        }
        if value.instructions.trim().is_empty()
            && value.skills.is_empty()
            && value.mcp_servers.is_empty()
        {
            return Err("Agent Plugin must contribute instructions, Skills or MCP servers".into());
        }
        Ok(value)
    }
}

fn validate_url(value: &str) -> Result<(), String> {
    let url = url::Url::parse(value).map_err(|e| e.to_string())?;
    if value.len() > 4096
        || !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || value.contains('\\')
        || value.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err("Agent Plugin MCP URL must use HTTP or HTTPS".into());
    }
    Ok(())
}

// ACP permits future fields; the local package contract deliberately admits only
// the supported transport fields, then immediately converts to the ACP types.
fn deserialize_servers<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Vec<McpServer>, D::Error> {
    let values = Vec::<serde_json::Value>::deserialize(deserializer)?;
    values
        .into_iter()
        .map(|value| {
            let object = value
                .as_object()
                .ok_or_else(|| serde::de::Error::custom("MCP server must be an object"))?;
            let (fields, nested) = match object.get("type").and_then(|v| v.as_str()) {
                Some("http" | "sse") => {
                    (&["type", "name", "url", "headers", "_meta"][..], "headers")
                }
                None if !object.contains_key("type") => {
                    (&["name", "command", "args", "env", "_meta"][..], "env")
                }
                _ => return Err(serde::de::Error::custom("Unsupported MCP transport")),
            };
            if object.keys().any(|key| !fields.contains(&key.as_str())) {
                return Err(serde::de::Error::custom("Unknown MCP server field"));
            }
            if let Some(items) = object.get(nested).and_then(|v| v.as_array()) {
                if items.iter().any(|item| {
                    item.as_object()
                        .is_some_and(|o| o.keys().any(|k| !matches!(k.as_str(), "name" | "value")))
                }) {
                    return Err(serde::de::Error::custom(
                        "Unknown MCP header/environment field",
                    ));
                }
            }
            let parsed = match object.get("type").and_then(|v| v.as_str()) {
                Some("http") => serde_json::from_value(value).map(McpServer::Http),
                Some("sse") => serde_json::from_value(value).map(McpServer::Sse),
                _ => serde_json::from_value(value).map(McpServer::Stdio),
            };
            parsed.map_err(serde::de::Error::custom)
        })
        .collect()
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPluginRevision {
    pub name: AppName,
    pub version: String,
    pub revision: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPluginSummary {
    #[serde(flatten)]
    pub package: AgentPluginRevision,
    pub enabled: bool,
}

#[derive(Clone, Debug)]
pub struct AgentPluginSkill {
    pub plugin: AppName,
    /// The durable installed source makes relative Skill resources resolvable.
    pub path: PathBuf,
    pub content: String,
}

#[derive(Clone, Debug, Default)]
pub struct AgentPluginSnapshot {
    pub plugins: Vec<AgentPluginRevision>,
    pub instructions: Vec<String>,
    pub skills: Vec<AgentPluginSkill>,
    pub mcp_servers: Vec<McpServer>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct InstallRecord {
    enabled: bool,
}

struct InstalledPlugin {
    snapshot: AgentPluginSnapshot,
    enabled: bool,
}

/// Disk ownership stays here; snapshots are values frozen for a new Session.
pub struct AgentPluginStore {
    root: PathBuf,
    installed: BTreeMap<AppName, InstalledPlugin>,
}

impl AgentPluginStore {
    pub fn open(root: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        let root = dunce::canonicalize(root).map_err(|e| e.to_string())?;
        let mut installed = BTreeMap::new();
        for entry in fs::read_dir(&root).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.file_name().to_string_lossy().starts_with('.')
                || !entry.file_type().map_err(|e| e.to_string())?.is_dir()
            {
                continue;
            }
            let record = entry.path().join(".installation.json");
            if !record.is_file() {
                continue;
            }
            let definition = AgentPluginDefinition::parse(
                &fs::read(entry.path().join("plugin.json")).map_err(|e| e.to_string())?,
            )?;
            if entry.file_name().to_str() != Some(definition.name.as_str()) {
                return Err("Installed Agent Plugin identity differs from its directory".into());
            }
            let state: InstallRecord =
                serde_json::from_slice(&fs::read(record).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
            let name = definition.name.clone();
            installed.insert(
                name,
                InstalledPlugin {
                    snapshot: load_snapshot(&entry.path(), &entry.path(), definition, true)?,
                    enabled: state.enabled,
                },
            );
        }
        Ok(Self { root, installed })
    }

    pub fn list(&self) -> Vec<AgentPluginSummary> {
        self.installed
            .values()
            .map(|p| AgentPluginSummary {
                package: p.snapshot.plugins[0].clone(),
                enabled: p.enabled,
            })
            .collect()
    }

    /// Installation is explicit and enabled by default. An existing package is
    /// never silently replaced or re-enabled by dependency reconciliation.
    pub fn install(&mut self, source: &Path) -> Result<AgentPluginSummary, String> {
        let definition = AgentPluginDefinition::parse(
            &fs::read(source.join("plugin.json")).map_err(|e| e.to_string())?,
        )?;
        self.install_definition(source, definition)
    }

    fn install_definition(
        &mut self,
        source: &Path,
        definition: AgentPluginDefinition,
    ) -> Result<AgentPluginSummary, String> {
        let name = definition.name.clone();
        if let Some(current) = self.installed.get(&name) {
            return Ok(AgentPluginSummary {
                package: current.snapshot.plugins[0].clone(),
                enabled: current.enabled,
            });
        }
        if fs::symlink_metadata(source)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
        {
            return Err("Agent Plugin source cannot be a symlink".into());
        }
        let source = dunce::canonicalize(source).map_err(|e| e.to_string())?;
        if source.starts_with(&self.root) || self.root.starts_with(&source) {
            return Err("Agent Plugin source and installation root must be separate".into());
        }
        let staging = self.root.join(format!(".install-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&staging).map_err(|e| e.to_string())?;
        let result = (|| {
            for path in package_files(&source, false)? {
                let relative = path.strip_prefix(&source).map_err(|e| e.to_string())?;
                let target = staging.join(relative);
                fs::create_dir_all(target.parent().ok_or("Agent Plugin file needs a parent")?)
                    .map_err(|e| e.to_string())?;
                fs::copy(path, target).map_err(|e| e.to_string())?;
            }
            let snapshot =
                load_snapshot(&staging, &self.root.join(name.as_str()), definition, false)?;
            write_record(&staging, true)?;
            fs::rename(&staging, self.root.join(name.as_str())).map_err(|e| e.to_string())?;
            let summary = AgentPluginSummary {
                package: snapshot.plugins[0].clone(),
                enabled: true,
            };
            self.installed.insert(
                name,
                InstalledPlugin {
                    snapshot,
                    enabled: true,
                },
            );
            Ok(summary)
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(staging);
        }
        result
    }

    pub fn set_enabled(&mut self, name: &AppName, enabled: bool) -> Result<(), String> {
        let plugin = self
            .installed
            .get_mut(name)
            .ok_or("Agent Plugin is not installed")?;
        write_record(&self.root.join(name.as_str()), enabled)?;
        plugin.enabled = enabled;
        Ok(())
    }

    pub fn ensure_dependencies(
        &mut self,
        names: &[AppName],
        source_app_root: &Path,
    ) -> Result<AgentPluginSnapshot, String> {
        let mut snapshot = AgentPluginSnapshot::default();
        let mut visited = BTreeSet::new();
        let mut servers = BTreeSet::new();
        for name in names {
            if !visited.insert(name) {
                continue;
            }
            if !self.installed.contains_key(name) {
                let source = source_app_root.join("agent-plugins").join(name.as_str());
                let definition = AgentPluginDefinition::parse(
                    &fs::read(source.join("plugin.json")).map_err(|e| {
                        format!(
                            "Required Agent Plugin {} is unavailable: {e}",
                            name.as_str()
                        )
                    })?,
                )?;
                if &definition.name != name {
                    return Err(format!(
                        "Required Agent Plugin {} has a mismatched package identity",
                        name.as_str()
                    ));
                }
                self.install_definition(&source, definition)?;
            }
            let plugin = self
                .installed
                .get(name)
                .ok_or("Agent Plugin installation is unavailable")?;
            if !plugin.enabled {
                return Err(format!(
                    "Required Agent Plugin {} is disabled; enable it explicitly",
                    name.as_str()
                ));
            }
            for server in &plugin.snapshot.mcp_servers {
                let server_name = match server {
                    McpServer::Stdio(s) => &s.name,
                    McpServer::Http(s) => &s.name,
                    McpServer::Sse(s) => &s.name,
                    _ => unreachable!(),
                };
                if !servers.insert(server_name.clone()) {
                    return Err(format!(
                        "Agent Plugin MCP server name conflicts: {server_name}"
                    ));
                }
            }
            snapshot.plugins.extend(plugin.snapshot.plugins.clone());
            snapshot
                .instructions
                .extend(plugin.snapshot.instructions.clone());
            snapshot.skills.extend(plugin.snapshot.skills.clone());
            snapshot
                .mcp_servers
                .extend(plugin.snapshot.mcp_servers.clone());
        }
        Ok(snapshot)
    }
}

fn load_snapshot(
    root: &Path,
    runtime_root: &Path,
    definition: AgentPluginDefinition,
    installed: bool,
) -> Result<AgentPluginSnapshot, String> {
    let mut digest = Sha256::new();
    for path in package_files(root, installed)? {
        let relative = path.strip_prefix(root).map_err(|e| e.to_string())?;
        let bytes = fs::read(&path).map_err(|e| e.to_string())?;
        let label = relative.to_string_lossy().replace('\\', "/");
        digest.update((label.len() as u64).to_le_bytes());
        digest.update(label.as_bytes());
        digest.update((bytes.len() as u64).to_le_bytes());
        digest.update(bytes);
    }
    let mut snapshot = AgentPluginSnapshot {
        plugins: vec![AgentPluginRevision {
            name: definition.name.clone(),
            version: definition.version,
            revision: format!("sha256:{:x}", digest.finalize()),
        }],
        mcp_servers: definition.mcp_servers,
        ..Default::default()
    };
    // This single literal makes bundled scripts portable. No environment or
    // shell interpolation occurs; ACP receives the final executable and args.
    let package_root = runtime_root.to_string_lossy();
    for server in &mut snapshot.mcp_servers {
        if let McpServer::Stdio(server) = server {
            server.command = server
                .command
                .to_string_lossy()
                .replace("{pluginRoot}", &package_root)
                .into();
            for arg in &mut server.args {
                *arg = arg.replace("{pluginRoot}", &package_root);
            }
        }
    }
    if !definition.instructions.trim().is_empty() {
        snapshot.instructions.push(definition.instructions);
    }
    for path in definition.skills {
        let content = fs::read_to_string(root.join(&path))
            .map_err(|e| format!("Cannot read Agent Plugin Skill {path}: {e}"))?;
        if content.trim().is_empty() || content.len() > 64 * 1024 {
            return Err(format!(
                "Agent Plugin Skill {path} must contain at most 64 KiB of nonempty text"
            ));
        }
        snapshot.skills.push(AgentPluginSkill {
            plugin: definition.name.clone(),
            path: runtime_root.join(path),
            content,
        });
    }
    Ok(snapshot)
}

fn package_files(root: &Path, installed: bool) -> Result<Vec<PathBuf>, String> {
    let mut pending = vec![root.to_path_buf()];
    let (mut files, mut entries, mut bytes) = (Vec::new(), 0, 0u64);
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name();
            if matches!(
                name.to_str(),
                Some(".git" | "node_modules" | "__pycache__" | ".venv" | ".DS_Store")
            ) {
                continue;
            }
            if installed && entry.path() == root.join(".installation.json") {
                continue;
            }
            if name.to_string_lossy().starts_with(".installation") {
                return Err("Agent Plugin contains Host installation metadata".into());
            }
            entries += 1;
            if entries > 2048 {
                return Err("Agent Plugin package exceeds 2,048 entries".into());
            }
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            if kind.is_dir() {
                pending.push(entry.path());
            } else if kind.is_file() {
                bytes += entry.metadata().map_err(|e| e.to_string())?.len();
                if bytes > 64 * 1024 * 1024 {
                    return Err("Agent Plugin package exceeds 64 MiB".into());
                }
                files.push(entry.path());
            } else {
                return Err("Agent Plugin package cannot contain symlinks or special files".into());
            }
        }
    }
    files.sort();
    Ok(files)
}

fn write_record(root: &Path, enabled: bool) -> Result<(), String> {
    let pending = root.join(".installation.pending");
    fs::write(
        &pending,
        serde_json::to_vec(&InstallRecord { enabled }).map_err(|e| e.to_string())?,
    )
    .and_then(|_| fs::rename(pending, root.join(".installation.json")))
    .map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "agent_plugins_tests.rs"]
mod tests;
