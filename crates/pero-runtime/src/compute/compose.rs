//! Native Compose owns deployment. This adapter freezes its resolved recipe,
//! records actual members, and disposes only those container/network IDs.
use super::{Command, Path, PathBuf, command_output};
use crate::environments::{ContentDigest, Identity};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, io::Write};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ComposeMember {
    pub service: Identity,
    pub container: Identity,
    pub image: String,
    pub started_at: String,
    pub running: bool,
    pub health: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ComposeEvidence {
    pub project: Identity,
    pub daemon: Identity,
    pub recipe: ContentDigest,
    pub members: Vec<ComposeMember>,
    pub networks: Vec<Identity>,
    /// Named volumes survive disposal. Dataset identity belongs to the method.
    pub retained_volumes: Vec<String>,
}
pub struct ComposeDeployment {
    docker: PathBuf,
    context: String,
    record: PathBuf,
    evidence: ComposeEvidence,
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Container {
    id: Identity,
    image: String,
    config: ContainerConfig,
    state: ContainerState,
    mounts: Vec<Mount>,
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct ContainerConfig {
    labels: BTreeMap<String, String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct ContainerState {
    running: bool,
    started_at: String,
    health: Option<Health>,
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Health {
    status: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Mount {
    #[serde(rename = "Type")]
    kind: String,
    name: Option<String>,
}

impl ComposeDeployment {
    /// Operator explicitly approves this recipe, including its mounts and network
    /// policy. No image build/pull occurs during preparation; prepare images first.
    /// `record` is a new private operation directory, retained on partial failure.
    pub fn prepare(
        docker: PathBuf,
        context: String,
        source: &Path,
        record: &Path,
    ) -> Result<Self, String> {
        fs::create_dir(record)
            .map_err(|e| format!("Prepare needs a new operation directory: {e}"))?;
        let record = record.canonicalize().map_err(|e| e.to_string())?;
        let project: Identity = format!("pero-{}", uuid::Uuid::new_v4()).try_into().unwrap();
        let info = command_output(Command::new(&docker).args([
            "--context",
            &context,
            "info",
            "--format",
            "{{.ID}}",
        ]))?;
        if !info.status.success() {
            return Err("Selected Docker daemon is unavailable".into());
        }
        let daemon = String::from_utf8_lossy(&info.stdout)
            .trim()
            .to_owned()
            .try_into()
            .map_err(|e: crate::environments::EnvironmentError| e.to_string())?;
        let resolved = command_output(
            Command::new(&docker)
                .args([
                    "--context",
                    &context,
                    "compose",
                    "-p",
                    project.as_str(),
                    "-f",
                ])
                .arg(source)
                .args(["config", "--format", "json"]),
        )?;
        if !resolved.status.success() {
            return Err(String::from_utf8_lossy(&resolved.stderr).into_owned());
        }
        let recipe = ContentDigest::of(&resolved.stdout);
        let recipe_path = record.join("compose.json");
        fs::write(&recipe_path, &resolved.stdout).map_err(|e| e.to_string())?;
        let evidence = ComposeEvidence {
            project,
            daemon,
            recipe,
            members: vec![],
            networks: vec![],
            retained_volumes: vec![],
        };
        let mut deployment = Self {
            docker,
            context,
            record,
            evidence,
        };
        // Persist original operation identity before invoking the deployment owner.
        deployment.save()?;
        let started = command_output(
            Command::new(&deployment.docker)
                .args([
                    "--context",
                    &deployment.context,
                    "compose",
                    "-p",
                    deployment.evidence.project.as_str(),
                    "-f",
                ])
                .arg(&recipe_path)
                .args([
                    "up",
                    "--detach",
                    "--no-build",
                    "--pull",
                    "never",
                    "--wait",
                    "--wait-timeout",
                    "20",
                ]),
        );
        // Even a partial/unknown `up` is observed by the same project identity.
        deployment.refresh()?;
        match started {
            Ok(result) if result.status.success() => Ok(deployment),
            Ok(result) => Err(format!(
                "Compose preparation incomplete; reconcile {}: {}",
                deployment.record.display(),
                String::from_utf8_lossy(&result.stderr)
            )),
            Err(error) => Err(format!(
                "{error}; reconcile {}",
                deployment.record.display()
            )),
        }
    }
    /// Reopen only to observe/dispose; never repeat `up` on recovery.
    pub fn reopen(docker: PathBuf, context: String, record: PathBuf) -> Result<Self, String> {
        let evidence: ComposeEvidence = serde_json::from_slice(
            &fs::read(record.join("resources.json")).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        Ok(Self {
            docker,
            context,
            record,
            evidence,
        })
    }
    pub fn evidence(&self) -> &ComposeEvidence {
        &self.evidence
    }
    fn same_daemon(&self) -> Result<(), String> {
        let result = command_output(Command::new(&self.docker).args([
            "--context",
            &self.context,
            "info",
            "--format",
            "{{.ID}}",
        ]))?;
        if !result.status.success()
            || String::from_utf8_lossy(&result.stdout).trim() != self.evidence.daemon.as_str()
        {
            return Err("Original Compose daemon is unavailable or changed".into());
        }
        Ok(())
    }
    pub fn refresh(&mut self) -> Result<&ComposeEvidence, String> {
        self.same_daemon()?;
        let filter = format!(
            "label=com.docker.compose.project={}",
            self.evidence.project.as_str()
        );
        let listed = command_output(Command::new(&self.docker).args([
            "--context",
            &self.context,
            "ps",
            "--all",
            "--quiet",
            "--no-trunc",
            "--filter",
            &filter,
        ]))?;
        if !listed.status.success() {
            return Err("Cannot observe Compose members".into());
        }
        let ids = String::from_utf8_lossy(&listed.stdout);
        let ids: Vec<_> = ids.lines().collect();
        let members = if ids.is_empty() {
            vec![]
        } else {
            let result = command_output(
                Command::new(&self.docker)
                    .args(["--context", &self.context, "inspect"])
                    .args(&ids),
            )?;
            if !result.status.success() {
                return Err("Compose member observation interrupted".into());
            }
            serde_json::from_slice::<Vec<Container>>(&result.stdout).map_err(|e| e.to_string())?
        };
        let mut observed = Vec::new();
        let mut volumes = self.evidence.retained_volumes.clone();
        for member in members {
            let service = member
                .config
                .labels
                .get("com.docker.compose.service")
                .ok_or("Missing Compose service identity")?
                .to_owned()
                .try_into()
                .map_err(|e: crate::environments::EnvironmentError| e.to_string())?;
            for mount in member.mounts {
                if mount.kind == "volume" {
                    if let Some(name) = mount.name {
                        volumes.push(name);
                    }
                }
            }
            observed.push(ComposeMember {
                service,
                container: member.id,
                image: member.image,
                started_at: member.state.started_at,
                running: member.state.running,
                health: member.state.health.map(|h| h.status),
            });
        }
        observed.sort_by(|a, b| a.container.cmp(&b.container));
        // A later Compose update is a replacement, not continuation of this resource.
        if !self.evidence.members.is_empty()
            && (self.evidence.members.len() != observed.len()
                || self.evidence.members.iter().any(|original| {
                    !observed.iter().any(|next| {
                        next.container == original.container
                            && next.started_at == original.started_at
                            && next.image == original.image
                    })
                }))
        {
            return Err(
                "Original Compose member identity changed; keep the original disposal record"
                    .into(),
            );
        }
        let networks = command_output(Command::new(&self.docker).args([
            "--context",
            &self.context,
            "network",
            "ls",
            "--quiet",
            "--no-trunc",
            "--filter",
            &filter,
        ]))?;
        if !networks.status.success() {
            return Err("Cannot observe Compose networks".into());
        }
        let networks = String::from_utf8_lossy(&networks.stdout)
            .lines()
            .map(|s| s.to_owned().try_into())
            .collect::<Result<Vec<Identity>, _>>()
            .map_err(|e| e.to_string())?;
        volumes.sort();
        volumes.dedup();
        self.evidence.members = observed;
        self.evidence.networks = networks;
        self.evidence.retained_volumes = volumes;
        self.save()?;
        Ok(&self.evidence)
    }
    fn save(&self) -> Result<(), String> {
        let bytes = serde_json::to_vec_pretty(&self.evidence).map_err(|e| e.to_string())?;
        let pending = self.record.join("resources.pending");
        let mut file = fs::File::create(&pending).map_err(|e| e.to_string())?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        fs::rename(pending, self.record.join("resources.json")).map_err(|e| e.to_string())
    }
    /// Caller first ends every live Use. Shared/named volumes are always retained.
    pub fn dispose(&self) -> Result<(), String> {
        self.same_daemon()?;
        for member in &self.evidence.members {
            let result = command_output(Command::new(&self.docker).args([
                "--context",
                &self.context,
                "rm",
                "--force",
                member.container.as_str(),
            ]))?;
            if !result.status.success() {
                return Err(format!(
                    "Original member {} removal is unconfirmed",
                    member.container.as_str()
                ));
            }
        }
        for network in &self.evidence.networks {
            let result = command_output(Command::new(&self.docker).args([
                "--context",
                &self.context,
                "network",
                "rm",
                network.as_str(),
            ]))?;
            if !result.status.success() {
                return Err("Original Compose network removal is unconfirmed".into());
            }
        }
        Ok(())
    }
}
