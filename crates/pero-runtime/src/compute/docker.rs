use super::*;
use crate::environments::*;
use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet};

/// Resolved image evidence. A config ID is not a registry manifest digest.
#[derive(Clone)]
pub struct DockerImage {
    pub reference: ContentDigest,
    pub index: Option<ContentDigest>,
    pub config: Option<ContentDigest>,
    pub manifest: Option<ContentDigest>,
    pub os: Identity,
    pub architecture: Identity,
}
pub struct DockerOwner {
    docker: PathBuf,
    context: String,
    daemon: Identity,
    platform: String,
    image: DockerImage,
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct ImageObservation {
    id: String,
    os: String,
    architecture: String,
    descriptor: Option<ImageDescriptor>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImageDescriptor {
    media_type: String,
    digest: String,
}
impl DockerOwner {
    /// Operator-selected context and existing image. Preparation/pull is explicit
    /// and separate; launch never resolves a mutable tag or silently downloads.
    pub fn resolve(
        docker: PathBuf,
        context: String,
        image: &str,
        platform: &str,
    ) -> Result<Self, String> {
        let parts: Vec<_> = platform.split('/').collect();
        if !(2..=3).contains(&parts.len())
            || parts
                .iter()
                .any(|p| Identity::try_from((*p).to_owned()).is_err())
        {
            return Err("Select an explicit OCI platform such as linux/amd64".into());
        }
        let output = command_output(Command::new(&docker).args([
            "--context",
            &context,
            "info",
            "--format",
            "{{.ID}}",
        ]))?;
        if !output.status.success() {
            return Err("Selected Docker daemon is unavailable".into());
        }
        let daemon = String::from_utf8_lossy(&output.stdout)
            .trim()
            .to_owned()
            .try_into()
            .map_err(|e: EnvironmentError| e.to_string())?;
        let source_output = command_output(Command::new(&docker).args([
            "--context",
            &context,
            "image",
            "inspect",
            "--",
            image,
        ]))?;
        if !source_output.status.success() {
            return Err("Selected image is unavailable; prepare it explicitly".into());
        }
        let mut sources: Vec<ImageObservation> =
            serde_json::from_slice(&source_output.stdout).map_err(|e| e.to_string())?;
        if sources.len() != 1 {
            return Err("Expected exactly one source image".into());
        }
        let source = sources.remove(0);
        let reference: ContentDigest = source
            .id
            .strip_prefix("sha256:")
            .ok_or("Unsupported image reference")?
            .to_owned()
            .try_into()
            .map_err(|e: EnvironmentError| e.to_string())?;
        let index = source
            .descriptor
            .as_ref()
            .filter(|d| {
                matches!(
                    d.media_type.as_str(),
                    "application/vnd.oci.image.index.v1+json"
                        | "application/vnd.docker.distribution.manifest.list.v2+json"
                )
            })
            .map(|_| reference.clone());
        let output = command_output(Command::new(&docker).args([
            "--context",
            &context,
            "image",
            "inspect",
            "--platform",
            platform,
            "--",
            &format!("sha256:{}", reference.as_str()),
        ]))?;
        if !output.status.success() {
            return Err("Selected image is unavailable; prepare it explicitly".into());
        }
        let mut images: Vec<ImageObservation> =
            serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
        if images.len() != 1 {
            return Err("Expected exactly one Docker image".into());
        }
        let value = images.remove(0);
        let id: ContentDigest = value
            .id
            .strip_prefix("sha256:")
            .ok_or("Unsupported Docker image identity")?
            .to_owned()
            .try_into()
            .map_err(|e: EnvironmentError| e.to_string())?;
        if value.os != parts[0] || value.architecture != parts[1] {
            return Err("Selected platform is not locally available; prepare it explicitly".into());
        }
        let (config, manifest) = match value.descriptor {
            Some(descriptor)
                if matches!(
                    descriptor.media_type.as_str(),
                    "application/vnd.oci.image.manifest.v1+json"
                        | "application/vnd.docker.distribution.manifest.v2+json"
                ) =>
            {
                if descriptor.digest != format!("sha256:{}", id.as_str()) {
                    return Err("Docker manifest identity is inconsistent".into());
                }
                (None, Some(id.clone()))
            }
            Some(_) => {
                return Err(
                    "Docker returned an image index instead of the selected platform".into(),
                );
            }
            None => (Some(id.clone()), None),
        };
        Ok(Self {
            docker,
            context,
            daemon,
            platform: platform.to_owned(),
            image: DockerImage {
                reference,
                index,
                config,
                manifest,
                os: value
                    .os
                    .try_into()
                    .map_err(|e: EnvironmentError| e.to_string())?,
                architecture: value
                    .architecture
                    .try_into()
                    .map_err(|e: EnvironmentError| e.to_string())?,
            },
        })
    }
    pub fn image(&self) -> &DockerImage {
        &self.image
    }
}

/// One dedicated, booted container. Preparation starts only the fixed idle
/// holder; the admitted method is dispatched later through docker exec.
pub struct DockerResource {
    owner: DockerOwner,
    container: Identity,
    runtime: Identity,
    directory: PathBuf,
    launched: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct ContainerObservation {
    id: String,
    image: String,
    image_manifest_descriptor: Option<ImageDescriptor>,
    state: ContainerState,
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct ContainerState {
    running: bool,
    started_at: String,
    finished_at: String,
}
impl DockerOwner {
    /// This is explicit resource preparation, not scientific execution. The
    /// supplied image must provide /bin/sh and sleep; no implicit installation.
    pub fn prepare(
        self,
        resource_id: &Identity,
        directory: &Path,
    ) -> Result<DockerResource, String> {
        let directory = directory.canonicalize().map_err(|e| e.to_string())?;
        let mount_path = directory.to_str().ok_or("Docker workspace must be UTF-8")?;
        if mount_path.contains(',') {
            return Err("Docker bind source cannot contain a comma".into());
        }
        let name = format!("pero-resource-{}", ContentDigest::of(resource_id).as_str());
        let output = command_output(Command::new(&self.docker).args([
            "--context",
            &self.context,
            "create",
            "--pull=never",
            "--platform",
            &self.platform,
            "--name",
            &name,
            "--label",
            "org.pero.owner=compute",
            "--label",
            &format!("org.pero.resource={}", resource_id.as_str()),
            "--network=none",
            "--workdir",
            "/workspace",
            "--mount",
            &format!("type=bind,src={mount_path},dst=/workspace"),
            "--entrypoint",
            "/bin/sh",
            &format!("sha256:{}", self.image.reference.as_str()),
            "-c",
            "exec sleep infinity",
        ]))?;
        if !output.status.success() {
            return Err(format!(
                "Resource preparation failed or the original name already exists; reconcile {name}: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        let container: Identity = String::from_utf8_lossy(&output.stdout)
            .trim()
            .to_owned()
            .try_into()
            .map_err(|e: EnvironmentError| e.to_string())?;
        let output = command_output(Command::new(&self.docker).args([
            "--context",
            &self.context,
            "start",
            container.as_str(),
        ]))?;
        if !output.status.success() {
            return Err(format!(
                "Container {} did not start; inspect and dispose that original resource",
                container.as_str()
            ));
        }
        let observed = self.inspect(&container)?;
        if !observed.state.running {
            return Err(format!(
                "Container {} has no running process holder",
                container.as_str()
            ));
        }
        let runtime =
            ContentDigest::of(&(observed.id.as_str(), observed.state.started_at.as_str()))
                .as_str()
                .to_owned()
                .try_into()
                .unwrap();
        Ok(DockerResource {
            owner: self,
            container,
            runtime,
            directory,
            launched: false,
        })
    }
    fn inspect(&self, container: &Identity) -> Result<ContainerObservation, String> {
        let current = Self::resolve(
            self.docker.clone(),
            self.context.clone(),
            &format!("sha256:{}", self.image.reference.as_str()),
            &self.platform,
        )?;
        if current.daemon != self.daemon {
            return Err("Selected Docker daemon changed".into());
        }
        let output = command_output(Command::new(&self.docker).args([
            "--context",
            &self.context,
            "container",
            "inspect",
            container.as_str(),
        ]))?;
        if !output.status.success() {
            return Err("Original container cannot be observed".into());
        }
        let mut values: Vec<ContainerObservation> =
            serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
        if values.len() != 1 {
            return Err("Expected one original container".into());
        }
        let value = values.remove(0);
        if let Some(expected) = &self.image.manifest {
            if value
                .image_manifest_descriptor
                .as_ref()
                .map(|d| d.digest.as_str())
                != Some(format!("sha256:{}", expected.as_str()).as_str())
            {
                return Err(
                    "Container platform manifest does not match the selected software".into(),
                );
            }
        }
        if value.id != container.as_str()
            || value.image != format!("sha256:{}", self.image.reference.as_str())
        {
            return Err("Container identity or software changed".into());
        }
        Ok(value)
    }
}
impl DockerResource {
    pub fn container_id(&self) -> &Identity {
        &self.container
    }
    /// Only the exact resource this adapter created is disposed; no image,
    /// volume, shared service or other container is removed.
    pub fn dispose(&self) -> Result<(), String> {
        self.owner.inspect(&self.container)?;
        let output = command_output(Command::new(&self.owner.docker).args([
            "--context",
            &self.owner.context,
            "rm",
            "--force",
            self.container.as_str(),
        ]))?;
        if !output.status.success() {
            return Err("Container removal is unconfirmed".into());
        }
        Ok(())
    }
}
impl ProcessOwner for DockerResource {
    fn observe(&self, now_ms: u64) -> Result<ResourceBinding, String> {
        let observed = self.owner.inspect(&self.container)?;
        let runtime =
            ContentDigest::of(&(observed.id.as_str(), observed.state.started_at.as_str()))
                .as_str()
                .to_owned()
                .try_into()
                .unwrap();
        if runtime != self.runtime {
            return Err("Container boot incarnation changed".into());
        }
        let _ = observed.state.finished_at;
        let image = &self.owner.image;
        let profile = SoftwareProfile::observed(
            ComponentObservation::new(
                "image".to_owned().try_into().unwrap(),
                image.os.clone(),
                image.architecture.clone(),
                BTreeMap::from([(
                    "image".to_owned().try_into().unwrap(),
                    SoftwareComponent::OciImage {
                        index: image.index.clone(),
                        manifest: image.manifest.clone(),
                        config: image.config.clone(),
                        os: image.os.clone(),
                        architecture: image.architecture.clone(),
                    },
                )]),
            )
            .map_err(|e| e.to_string())?,
        );
        Ok(ResourceBinding {
            resource: ResourceRef {
                owner: "docker".to_owned().try_into().unwrap(),
                kind: "container".to_owned().try_into().unwrap(),
                scope: self.owner.daemon.clone(),
                id: self.container.clone(),
            },
            runtime,
            observed_at_ms: now_ms,
            readiness: if observed.state.running {
                Readiness::Ready
            } else {
                Readiness::NotReady
            },
            profile,
            capabilities: BTreeSet::from([Capability::Process]),
        })
    }
    fn launch(
        &mut self,
        _use_id: &Identity,
        invocation: &MethodInvocation,
    ) -> Result<ProcessHandle, String> {
        if self.launched {
            return Err("This execution target was already dispatched".into());
        }
        if !invocation.program.is_absolute() {
            return Err("Container method entry must be absolute".into());
        }
        if invocation
            .directory
            .canonicalize()
            .map_err(|e| e.to_string())?
            != self.directory
        {
            return Err("Invocation workspace differs from the prepared container".into());
        }
        if self.observe(0)?.readiness != Readiness::Ready {
            return Err("Container is not ready".into());
        }
        let mut command = Command::new(&self.owner.docker);
        command
            .args([
                "--context",
                &self.owner.context,
                "exec",
                "--workdir",
                "/workspace",
                self.container.as_str(),
            ])
            .arg(&invocation.program)
            .args(&invocation.arguments);
        super::logs(&mut command, &self.directory)?;
        self.launched = true;
        let process = OwnedProcess::spawn(&mut command).map_err(|e| e.to_string())?;
        Ok(ProcessHandle {
            process,
            cleanup: Some(ContainerCleanup {
                docker: self.owner.docker.clone(),
                context: self.owner.context.clone(),
                name: self.container.as_str().to_owned(),
            }),
        })
    }
}
